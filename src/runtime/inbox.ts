/**
 * Coordinator inbox aggregator.
 *
 * The inbox is the prioritized queue of things the coordinator needs the
 * human to resolve right now. It sources exclusively from files already on
 * disk — `guildhall.yaml`, `memory/TASKS.json`, `memory/agent-settings.yaml`,
 * and a handful of workspace-signal files — so the endpoint is cheap enough
 * to poll and deterministic enough to snapshot in tests.
 *
 * Item ordering: severity (high → medium → low), then the kind enumeration
 * order declared by KIND_ORDER.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { BootstrapStatus } from './bootstrap-runner.js'
import {
  buildTaskSnapshot,
  specFillWizard,
  progressForTask,
  emptyWizardsState,
} from './wizards.js'

export type InboxSeverity = 'high' | 'medium' | 'low'

export type InboxItem =
  | { kind: 'bootstrap_missing'; severity: 'high'; title: string; detail: string; actionHref?: string }
  | { kind: 'workspace_import_pending'; severity: 'medium'; title: string; detail: string; signals: string[]; actionHref: string; dismissEndpoint: string }
  | { kind: 'brief_approval'; severity: 'medium'; taskId: string; title: string; detail: string; actionHref: string }
  | { kind: 'spec_approval'; severity: 'medium'; taskId: string; title: string; detail: string; actionHref: string }
  | { kind: 'open_escalation'; severity: 'high'; taskId: string; escalationId: string; title: string; detail: string; actionHref: string }
  | { kind: 'lever_questions'; severity: 'low'; title: string; detail: string; defaultCount: number; actionHref: string }
  | { kind: 'spec_fill_pending'; severity: 'low'; taskId: string; title: string; detail: string; actionHref: string; missingSteps: string[] }

export interface BuildInboxOptions {
  projectPath: string
}

/**
 * High-severity blockers that gate downstream actions in the UI.
 *
 * When true, the UI disables specific controls (Start, + New Task, etc.) with
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

export function buildInboxBlockers(items: readonly InboxItem[]): InboxBlockers {
  return {
    bootstrap: items.some(i => i.kind === 'bootstrap_missing'),
    workspaceImport: items.some(i => i.kind === 'workspace_import_pending'),
  }
}

const KIND_ORDER: Record<InboxItem['kind'], number> = {
  bootstrap_missing: 0,
  workspace_import_pending: 1,
  open_escalation: 2,
  brief_approval: 3,
  spec_approval: 4,
  lever_questions: 5,
  spec_fill_pending: 6,
}

const SEVERITY_ORDER: Record<InboxSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function truncateTitle(title: string, max = 80): string {
  if (title.length <= max) return title
  return title.slice(0, max - 1).trimEnd() + '…'
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
  const status = readJsonSafe(join(projectPath, 'memory', 'bootstrap.json')) as BootstrapStatus | null
  if (!status || status.success !== false) return null
  const failed = status.steps.find(s => s.result === 'fail')
  if (!failed) return 'The last bootstrap run failed. Open Ready to rerun the project checks.'
  const firstUsefulLine = bootstrapOutputLine(failed.output)
  return `${failed.command} failed with exit ${failed.exitCode}${firstUsefulLine ? `: ${firstUsefulLine}` : '.'}`
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

function tasksArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>
  if (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)) {
    return (raw as { tasks: Array<Record<string, unknown>> }).tasks
  }
  return []
}

export function buildInbox(opts: BuildInboxOptions): InboxItem[] {
  const { projectPath } = opts
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

  // --- workspace_import_pending --------------------------------------------
  const goalsPath = join(projectPath, 'memory', 'workspace-goals.json')
  const hasGoals = existsSync(goalsPath)
  const anchors = detectRepoAnchors(projectPath)
  const hasReadme = anchors.includes('README.md')
  const hasAnchor =
    anchors.includes('pnpm-workspace.yaml') ||
    anchors.includes('package.json') ||
    anchors.includes('packages') ||
    anchors.includes('skills') ||
    anchors.includes('ROADMAP.md')
  if (!hasGoals && hasReadme && hasAnchor) {
    items.push({
      kind: 'workspace_import_pending',
      severity: 'medium',
      title: 'Existing repo detected',
      detail: `Anchors found (${anchors.slice(0, 3).join(', ')}${anchors.length > 3 ? '…' : ''}). Open to see what the detector extracts — or dismiss.`,
      signals: anchors,
      actionHref: '/workspace-import',
      dismissEndpoint: '/api/project/workspace-import/dismiss',
    })
  }

  // --- tasks: briefs / specs / escalations / spec-fill gaps ----------------
  const tasksPath = join(projectPath, 'memory', 'TASKS.json')
  const tasks = tasksArray(readJsonSafe(tasksPath))
  // Cap the number of spec-fill nudges we emit so a project with 40 open
  // tasks doesn't flood the inbox — DoThisNext only consumes the top one
  // anyway, and the per-task Spec tab shows full progress inline.
  const SPEC_FILL_EMIT_CAP = 3
  let specFillEmitted = 0
  for (const t of tasks) {
    const id = typeof t.id === 'string' ? t.id : ''
    const title = typeof t.title === 'string' ? t.title : id
    if (!id) continue

    const brief = t.productBrief as { approvedAt?: unknown } | undefined
    if (brief && typeof brief === 'object' && !brief.approvedAt) {
      items.push({
        kind: 'brief_approval',
        severity: 'medium',
        taskId: id,
        title: truncateTitle(title),
        detail: 'Brief awaiting approval.',
        actionHref: '/task/' + encodeURIComponent(id),
      })
    }

    if (t.status === 'spec_review') {
      items.push({
        kind: 'spec_approval',
        severity: 'medium',
        taskId: id,
        title: truncateTitle(title),
        detail: 'Spec awaiting approval.',
        actionHref: '/task/' + encodeURIComponent(id),
      })
    }

    // spec-fill gap: only for tasks where the wizard is applicable and
    // incomplete. Title/description are almost always filled by intake so
    // the practically-interesting misses are brief + acceptance criteria.
    // We emit the LIVE missing-step list so DoThisNext can say "missing
    // acceptance criteria" rather than the vague "spec incomplete".
    //
    // Dedupe with brief_approval / spec_approval: if the brief is drafted
    // and awaiting approval, OR the spec is in review, don't also nudge
    // "finish the spec" — those surface with their own prescriptive verb.
    const briefDraftPending =
      brief && typeof brief === 'object' && !brief.approvedAt
    const specInReview = t.status === 'spec_review'
    if (specFillEmitted < SPEC_FILL_EMIT_CAP && !briefDraftPending && !specInReview) {
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
              title: truncateTitle(title),
              detail: `Missing ${missingLabels}.`,
              actionHref: '/task/' + encodeURIComponent(id),
              missingSteps,
            })
            specFillEmitted += 1
          }
        }
      }
    }

    const escalations = Array.isArray(t.escalations)
      ? (t.escalations as Array<Record<string, unknown>>)
      : []
    for (const esc of escalations) {
      if (esc.resolvedAt) continue
      const escId = typeof esc.id === 'string' ? esc.id : ''
      const summary =
        typeof esc.summary === 'string' && esc.summary.trim()
          ? esc.summary
          : typeof esc.reason === 'string'
            ? esc.reason
            : 'Agent escalation awaiting human input.'
      items.push({
        kind: 'open_escalation',
        severity: 'high',
        taskId: id,
        escalationId: escId,
        title: truncateTitle(title),
        detail: summary,
        actionHref: '/task/' + encodeURIComponent(id),
      })
    }
  }

  // --- lever_questions -----------------------------------------------------
  const settingsPath = join(projectPath, 'memory', 'agent-settings.yaml')
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
  items.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sev !== 0) return sev
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  })

  return items
}
