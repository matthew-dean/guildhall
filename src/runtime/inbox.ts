/**
 * Coordinator inbox aggregator.
 *
 * The inbox is the prioritized queue of things the coordinator needs the
 * human to resolve right now. It sources exclusively from files already on
 * disk — `guildhall.yaml`, system-local task state, project settings,
 * and a handful of workspace-signal files — so the endpoint is cheap enough
 * to poll and deterministic enough to snapshot in tests.
 *
 * Item ordering: severity (high → medium → low), then the kind enumeration
 * order declared by KIND_ORDER.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getProjectLocalHistoryDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { parse as parseYaml } from 'yaml'
import type { Task } from '@guildhall/core'
import { META_INTAKE_TASK_ID } from './meta-intake.js'
import type { BootstrapStatus } from './bootstrap-runner.js'
import { readProjectDeliveryModelSync } from './delivery-spine.js'
import {
  buildSnapshot,
  buildTaskSnapshot,
  type BuildSnapshotOptions,
  onboardWizard,
  progressFor,
  specFillWizard,
  progressForTask,
  emptyWizardsState,
} from './wizards.js'

export type InboxSeverity = 'high' | 'medium' | 'low'

export type InboxItem =
  | { kind: 'required_migration'; severity: 'high'; migrationId: string; title: string; detail: string; actionHref: string; blocking: true; dismissible: false; source: { system: 'migrations'; id: string } }
  | { kind: 'project_understanding'; severity: 'high' | 'medium'; title: string; detail: string; signals: string[]; actionHref: string; dismissEndpoint: string }
  | { kind: 'bootstrap_missing'; severity: 'high'; title: string; detail: string; actionHref?: string }
  | { kind: 'setup_pending'; severity: 'medium'; stepId: string; title: string; detail: string; actionHref: string }
  | { kind: 'workspace_import_pending'; severity: 'medium'; title: string; detail: string; signals: string[]; actionHref: string; dismissEndpoint: string }
  | { kind: 'import_draft_queue'; severity: 'medium'; taskId: string; title: string; detail: string; actionHref: string }
  | { kind: 'contract_result_review'; severity: 'medium'; resultId: string; contractId: string; title: string; detail: string; actionHref: string; changeCount: number; reviewBuckets: string[]; warningCount: number; source: { system: 'delivery-spine'; id: string } }
  | { kind: 'lever_questions'; severity: 'low'; title: string; detail: string; defaultCount: number; actionHref: string }
  | { kind: 'spec_fill_pending'; severity: 'low'; taskId: string; title: string; detail: string; actionHref: string; missingSteps: string[] }

export interface BuildInboxOptions {
  projectPath: string
  snapshotOptions?: Omit<BuildSnapshotOptions, 'projectPath'>
}

/**
 * High-severity blockers that gate downstream actions in the UI.
 *
 * When true, the UI disables specific controls (Start, + New request, etc.) with
 * a tooltip pointing the user back at the relevant Inbox item. Kept as a
 * narrow, explicit shape — derived from the Inbox items themselves — rather
 * than letting every consumer re-derive the rules.
 */
export interface InboxBlockers {
  /** Bootstrap not verified → orchestrator cannot safely dispatch agents. */
  bootstrap: boolean
  /** Workspace signals present but not imported → new tasks may duplicate existing goals. */
  workspaceImport: boolean
}

export const ATTENTION_OWNED_INBOX_KINDS = [
  'required_migration',
  'project_understanding',
  'bootstrap_missing',
  'setup_pending',
  'workspace_import_pending',
  'import_draft_queue',
  'contract_result_review',
  'lever_questions',
  'spec_fill_pending',
] as const satisfies readonly InboxItem['kind'][]

const ATTENTION_OWNED_INBOX_KIND_SET = new Set<InboxItem['kind']>(ATTENTION_OWNED_INBOX_KINDS)

export function buildInboxBlockers(items: readonly InboxItem[]): InboxBlockers {
  return {
    bootstrap: items.some(i => i.kind === 'bootstrap_missing'),
    workspaceImport: items.some(i => i.kind === 'workspace_import_pending'),
  }
}

export function isAttentionOwnedInboxItem(item: Pick<InboxItem, 'kind'>): boolean {
  return ATTENTION_OWNED_INBOX_KIND_SET.has(item.kind)
}

const KIND_ORDER: Record<InboxItem['kind'], number> = {
  required_migration: 0,
  project_understanding: 1,
  bootstrap_missing: 2,
  setup_pending: 3,
  workspace_import_pending: 4,
  import_draft_queue: 5,
  contract_result_review: 6,
  lever_questions: 7,
  spec_fill_pending: 8,
}

const SEVERITY_ORDER: Record<InboxSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function compareInboxItems(
  a: Pick<InboxItem, 'kind' | 'severity'>,
  b: Pick<InboxItem, 'kind' | 'severity'>,
): number {
  const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  if (sev !== 0) return sev
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
}

function truncateTitle(title: string, max = 80): string {
  if (title.length <= max) return title
  return title.slice(0, max - 1).trimEnd() + '...'
}

function inboxTitle(taskId: string, title: string): string {
  if (taskId === 'task-meta-intake') return 'Inspect the repo and draft starter tasks'
  if (taskId === 'task-workspace-import') return 'Review existing project work'
  return truncateTitle(title)
}

function inboxItemDedupeKey(item: InboxItem): string {
  const taskId = 'taskId' in item ? item.taskId : ''
  const actionHref = 'actionHref' in item && typeof item.actionHref === 'string' ? item.actionHref : ''
  const detail = 'detail' in item && typeof item.detail === 'string' ? item.detail : ''
  return [
    item.kind,
    taskId,
    item.title,
    detail,
    actionHref,
  ].map(value => value.trim().replace(/\s+/g, ' ').toLowerCase()).join('\u0000')
}

export function dedupeInboxItems(items: readonly InboxItem[]): InboxItem[] {
  const seen = new Set<string>()
  const deduped: InboxItem[] = []
  for (const item of items) {
    const key = inboxItemDedupeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readYamlSafe(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function bootstrapOutputLine(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line =>
      line.length > 0 &&
      !line.startsWith('>') &&
      !line.startsWith('Scope:') &&
      !line.startsWith(' ERR_PNPM_') &&
      !line.startsWith(' ELIFECYCLE'),
    )
  return lines.find(line => /\berror\b|failed|Cannot find module|command not found|spawn ENOENT/i.test(line)) ?? lines[0]
}

function failedBootstrapDetail(projectPath: string): string | null {
  const status = readJsonSafe(join(getProjectLocalHistoryDir(projectPath), 'bootstrap.json')) as BootstrapStatus | null
  if (!status || status.success !== false) return null
  const failed = status.steps.find(s => s.result === 'fail')
  if (!failed) return 'The last readiness check failed. Open readiness checks to rerun the project checks.'
  const firstUsefulLine = bootstrapOutputLine(failed.output)
  return `${failed.command} failed with exit ${failed.exitCode}${firstUsefulLine ? `: ${firstUsefulLine}` : '.'}`
}

function setupActionHref(stepId: string): string {
  switch (stepId) {
    case 'identity':
      return '/settings/advanced'
    case 'provider':
      return '/providers'
    case 'bootstrap':
      return '/settings/ready'
    case 'workspaceImport':
      return '/workspace-import'
    default:
      return '/thread'
  }
}

/**
 * Cheap, sync repo-shape check: which well-known anchor files/dirs exist?
 *
 * NOTE: distinct from `detectWorkspaceSignals` in
 * `workspace-import/detect.ts`, which runs the full (async) content
 * extraction pipeline — parsing README headings, TODO comments, git log,
 * etc. — and returns semantic `WorkspaceSignal`s (candidate goals, tasks,
 * milestones).
 *
 * The inbox chip uses the anchor check to decide whether to nudge the
 * user toward /workspace-import at all; the import tab then runs the
 * semantic detector for the actual review content. The two surfaces MUST
 * speak different vocabularies ("anchors" vs "signals") — we previously
 * reused the word "signals" on both, producing the confusing pattern
 * where the chip said "Found 5 signals" and the tab said "No signals
 * detected".
 */
export function detectRepoAnchors(projectPath: string): string[] {
  const candidates = [
    'README.md',
    'pnpm-workspace.yaml',
    'package.json',
    'packages',
    'skills',
    'ROADMAP.md',
  ]
  return candidates.filter(name => existsSync(join(projectPath, name)))
}

function tasksArray(raw: unknown): Task[] {
  if (Array.isArray(raw)) return raw as Task[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)) {
    return (raw as { tasks: Task[] }).tasks
  }
  return []
}

function contractResultReviewItems(projectPath: string): InboxItem[] {
  const records = readProjectDeliveryModelSync(projectPath).validationEvidence
  return records
    .filter((record): record is Record<string, unknown> => Boolean(record && typeof record === 'object'))
    .filter(record => {
      const status = typeof record.status === 'string' ? record.status : ''
      return status === 'pending_review' || status === 'auto_applicable'
    })
    .map(record => {
      const resultId = typeof record.id === 'string' ? record.id : 'contract-result'
      const contractId = typeof record.contractId === 'string' ? record.contractId : 'agent-contract'
      const summary = record.summary && typeof record.summary === 'object'
        ? record.summary as Record<string, unknown>
        : {}
      const changeCount = ['drivers', 'primitives', 'taskLinks', 'ownerQuestions']
        .map(key => typeof summary[key] === 'number' ? summary[key] as number : 0)
        .reduce((total, value) => total + value, 0)
      const buckets = Array.isArray(record.reviewBuckets)
        ? record.reviewBuckets
          .map(bucket => bucket && typeof bucket === 'object' && typeof (bucket as { kind?: unknown }).kind === 'string'
            ? (bucket as { kind: string }).kind
            : '')
          .filter(Boolean)
        : []
      const warningCount = Array.isArray(record.warnings) ? record.warnings.length : 0
      const noun = contractId === 'project-primitive-setup'
        ? 'primitive setup result'
        : 'contract result'
      const bucketText = buckets.length > 0 ? ` Buckets: ${buckets.join(', ')}.` : ''
      const warningText = warningCount > 0 ? ` ${warningCount} warning${warningCount === 1 ? '' : 's'} need review.` : ''
      return {
        kind: 'contract_result_review',
        severity: 'medium',
        resultId,
        contractId,
        title: `Review ${noun}`,
        detail: `${changeCount} proposed change${changeCount === 1 ? '' : 's'} are waiting for accept, merge, proof, or rejection.${bucketText}${warningText}`,
        actionHref: '/overview/inbox',
        changeCount,
        reviewBuckets: buckets,
        warningCount,
        source: { system: 'delivery-spine', id: resultId },
      }
    })
}

export function buildInbox(opts: BuildInboxOptions): InboxItem[] {
  const { projectPath, snapshotOptions } = opts
  const items: InboxItem[] = []
  const bootstrapFailure = failedBootstrapDetail(projectPath)

  // --- bootstrap_missing ---------------------------------------------------
  const yamlPath = join(projectPath, 'guildhall.yaml')
  if (existsSync(yamlPath)) {
    const cfg = readYamlSafe(yamlPath) as
      | {
          bootstrap?: {
            install?: unknown
            gates?: unknown
            commands?: unknown
            successGates?: unknown
            verifiedAt?: unknown
          }
        }
      | null
    const b = cfg?.bootstrap
    const hasInstall =
      (Array.isArray(b?.install) && b!.install.length > 0) ||
      (typeof b?.install === 'object' && b!.install !== null && !Array.isArray(b!.install)) ||
      (Array.isArray(b?.commands) && b!.commands.length > 0)
    const hasGates =
      (Array.isArray(b?.gates) && b!.gates.length > 0) ||
      (typeof b?.gates === 'object' && b!.gates !== null && !Array.isArray(b!.gates)) ||
      (Array.isArray(b?.successGates) && b!.successGates.length > 0)
    // Structural form considered "complete" when it has a verifiedAt stamp
    // AND an install + gates block — this matches the hard precondition the
    // orchestrator enforces before dispatching tasks.
    const hasVerifiedAt = typeof b?.verifiedAt === 'string' && b!.verifiedAt.length > 0
    const isComplete = hasInstall && hasGates && (
      // Structural shape: require verifiedAt
      (typeof b?.install === 'object' && !Array.isArray(b?.install))
        ? hasVerifiedAt
        : true
    )
    if (bootstrapFailure) {
      items.push({
        kind: 'bootstrap_missing',
        severity: 'high',
        title: 'Bootstrap failed',
        detail: bootstrapFailure,
        actionHref: '/settings/ready',
      })
    } else if (!b || !isComplete) {
      items.push({
        kind: 'bootstrap_missing',
        severity: 'high',
        title: 'Bootstrap incomplete',
        detail:
          'No verified install/gate commands in guildhall.yaml — agents run against an unverified environment.',
        actionHref: '/settings/ready',
      })
    }
  }

  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  const tasks = tasksArray(readJsonSafe(tasksPath))
  const workspaceImportTask = tasks.find(t => t?.id === 'task-workspace-import')
  const workspaceImportTaskStatus =
    workspaceImportTask && typeof workspaceImportTask.status === 'string'
      ? workspaceImportTask.status
      : ''
  const workspaceImportTaskOpen =
    workspaceImportTask != null &&
    !['done', 'cancelled', 'archived'].includes(workspaceImportTaskStatus)

  const setupProgress = progressFor(onboardWizard, buildSnapshot({ projectPath, ...(snapshotOptions ?? {}) }))
  const activeSetupStep = setupProgress.steps.find(step => step.id === setupProgress.activeStepId)
  if (activeSetupStep && ['direction', 'firstTask'].includes(activeSetupStep.id)) {
    items.push({
      kind: 'setup_pending',
      severity: 'medium',
      stepId: activeSetupStep.id,
      title: activeSetupStep.title,
      detail: activeSetupStep.why,
      actionHref: setupActionHref(activeSetupStep.id),
    })
  }

  // --- workspace_import_pending --------------------------------------------
  const goalsPath = getProjectSystemStatePath(projectPath, 'workspace-goals.json')
  const hasGoals = existsSync(goalsPath)
  const anchors = detectRepoAnchors(projectPath)
  const hasReadme = anchors.includes('README.md')
  const hasAnchor =
    anchors.includes('pnpm-workspace.yaml') ||
    anchors.includes('package.json') ||
    anchors.includes('packages') ||
    anchors.includes('skills') ||
    anchors.includes('ROADMAP.md')
  if (workspaceImportTaskOpen || (!hasGoals && hasReadme && hasAnchor)) {
    const signals = anchors.length > 0 ? anchors : ['workspace import']
    items.push({
      kind: 'workspace_import_pending',
      severity: 'medium',
      title: workspaceImportTaskOpen ? 'Review existing project work' : 'Existing repo detected',
      detail: workspaceImportTaskOpen
        ? 'Review the sources and possible backlog tasks Guildhall found.'
        : `Anchors found (${anchors.slice(0, 3).join(', ')}${anchors.length > 3 ? '...' : ''}). Open to see what the detector extracts — or dismiss.`,
      signals,
      actionHref: '/workspace-import',
      dismissEndpoint: '/api/project/workspace-import/dismiss',
    })
  }

  // --- tasks: briefs / specs / escalations / spec-fill gaps ----------------
  const importDrafts = tasks.filter(t => t && typeof t === 'object' && t.status === 'import_draft')
  const setupStillOwnsNextAction = activeSetupStep != null && activeSetupStep.id !== 'workspaceImport'
  if (importDrafts.length > 0 && !setupStillOwnsNextAction) {
    const nextDraft = importDrafts[0]!
    const nextDraftId = typeof nextDraft.id === 'string' ? nextDraft.id : ''
    const nextDraftTitle = typeof nextDraft.title === 'string' && nextDraft.title.trim()
      ? nextDraft.title.trim()
      : 'Imported draft'
    if (nextDraftId) {
      const queuedDetail =
        importDrafts.length === 1
          ? `Review the imported draft "${truncateTitle(nextDraftTitle, 64)}" and decide whether to shape it now.`
          : `Start with "${truncateTitle(nextDraftTitle, 64)}". ${importDrafts.length - 1} more imported drafts are waiting behind it.`
      items.push({
        kind: 'import_draft_queue',
        severity: 'medium',
        taskId: nextDraftId,
        title:
          importDrafts.length === 1
            ? '1 imported draft needs a task brief'
            : `${importDrafts.length} imported drafts need task briefs`,
        detail: queuedDetail,
        actionHref: nextDraftId === 'task-workspace-import'
          ? '/workspace-import'
          : '/task/' + encodeURIComponent(nextDraftId),
      })
    }
  }

  items.push(...contractResultReviewItems(projectPath))

  // Cap the number of spec-fill nudges we emit so a project with 40 open
  // tasks doesn't flood the inbox — DoThisNext only consumes the top one
  // anyway, and the per-task Spec tab shows full progress inline.
  const SPEC_FILL_EMIT_CAP = 3
  let specFillEmitted = 0
  const taskInboxOrder = [...tasks].sort((left, right) => {
    const leftUpdated = typeof left?.updatedAt === 'string' ? left.updatedAt : ''
    const rightUpdated = typeof right?.updatedAt === 'string' ? right.updatedAt : ''
    return rightUpdated.localeCompare(leftUpdated)
  })
  for (const t of taskInboxOrder) {
    const id = typeof t.id === 'string' ? t.id : ''
    const title = typeof t.title === 'string' ? t.title : id
    if (!id) continue

    const brief = t.productBrief as { approvedAt?: unknown } | undefined

    // spec-fill gap: only for tasks where the wizard is applicable and
    // incomplete. Title/description are almost always filled by intake so
    // the practically-interesting misses are brief + acceptance criteria.
    // We emit the LIVE missing-step list so DoThisNext can say "missing
    // acceptance criteria" rather than the vague "spec incomplete".
    const briefDraftPending =
      brief && typeof brief === 'object' && !brief.approvedAt
    const specInReview = t.status === 'spec_review'
    if (
      id !== 'task-workspace-import' &&
      specFillEmitted < SPEC_FILL_EMIT_CAP &&
      !briefDraftPending &&
      !specInReview
    ) {
      const snap = buildTaskSnapshot({
        projectPath,
        task: t as Parameters<typeof buildTaskSnapshot>[0]['task'],
        readWizardsState: () => emptyWizardsState(),
      })
      if (specFillWizard.applicable(snap)) {
        const prog = progressForTask(specFillWizard, snap)
        if (!prog.complete) {
          const missingSteps = prog.steps
            .filter(s => s.status === 'pending')
            .map(s => s.id)
          if (missingSteps.length > 0) {
            const labelById: Record<string, string> = {
              title: 'title',
              description: 'description',
              brief: 'product brief',
              acceptance: 'acceptance criteria',
            }
            const missingLabels = missingSteps
              .map(id => labelById[id] ?? id)
              .join(', ')
            items.push({
              kind: 'spec_fill_pending',
              severity: 'low',
              taskId: id,
              title: inboxTitle(id, title),
              detail:
                id === 'task-workspace-import'
                  ? 'Review the sources and possible backlog tasks Guildhall found.'
                  : `Optional cleanup: add ${missingLabels} so agents and reviewers have a clearer brief.`,
              actionHref:
                id === 'task-workspace-import'
                  ? '/workspace-import'
                  : '/task/' + encodeURIComponent(id) + '?tab=spec',
              missingSteps,
            })
            specFillEmitted += 1
          }
        }
      }
    }

  }

  // --- lever_questions -----------------------------------------------------
  const settingsPath = getProjectSystemStatePath(projectPath, 'agent-settings.yaml')
  if (existsSync(settingsPath)) {
    const raw = readYamlSafe(settingsPath) as
      | {
          project?: Record<string, { setBy?: unknown }>
          domains?: { default?: Record<string, { setBy?: unknown }> }
        }
      | null
    let defaultCount = 0
    const countBucket = (bucket: Record<string, { setBy?: unknown }> | undefined) => {
      if (!bucket || typeof bucket !== 'object') return
      for (const entry of Object.values(bucket)) {
        if (entry && typeof entry === 'object' && entry.setBy === 'system-default') {
          defaultCount += 1
        }
      }
    }
    countBucket(raw?.project)
    countBucket(raw?.domains?.default)
    if (defaultCount > 0) {
      items.push({
        kind: 'lever_questions',
        severity: 'low',
        title: `${defaultCount} levers at system defaults`,
        detail: 'Defaults are still in effect for some project policies.',
        defaultCount,
        actionHref: '/settings/advanced',
      })
    }
  }

  // --- stable sort ---------------------------------------------------------
  items.sort(compareInboxItems)

  return dedupeInboxItems(items)
}
