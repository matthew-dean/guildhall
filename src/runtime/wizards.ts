/**
 * Wizard registry — first pass.
 *
 * A "wizard" is a resumable checklist that walks the user through a block of
 * harness configuration. Each wizard is composed of steps; each step's status
 * (done / pending / skipped) is **derived from on-disk facts** so the user
 * can leave and come back at any time, edit files by hand, and the wizard
 * auto-updates. The only wizard-specific state we persist is:
 *
 *   memory/wizards.yaml
 *     version: 1
 *     skipped:
 *       onboard:
 *         - coordinator
 *         - direction
 *     completedAt:
 *       onboard: 2026-04-24T...
 *
 * The first registered wizard is `onboard` — the 7-step absolute blocker to
 * agents being able to dispatch work. Subsequent wizards (per-task spec-fill,
 * release-readiness, coordinator-deepen, levers-confirm, invariants-review)
 * plug into the same shape via `registerWizard()`.
 *
 * This module is intentionally pure logic over a `ProjectSnapshot` facts
 * object: filesystem reads happen in `buildSnapshot()` and everywhere else
 * consumes the snapshot. That lets wizard behavior be unit-tested without
 * touching disk, and lets the API layer assemble one snapshot per request
 * and share it across every registered wizard.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { readGlobalProviders, type ProviderKind } from '@guildhall/config'

// ---------------------------------------------------------------------------
// Facts / snapshot
// ---------------------------------------------------------------------------

/**
 * Minimal slice of project state that wizards need for status derivation.
 * Built once per API request from files already on disk — see
 * `buildSnapshot()`. Everything here is optional: missing files just mean
 * the corresponding step stays pending.
 */
export interface ProjectSnapshot {
  /** Absolute project root. Always present. */
  projectPath: string
  /** guildhall.yaml parsed shape — missing or malformed → undefined. */
  config?: {
    id?: string
    name?: string
    bootstrap?: {
      verifiedAt?: string
      install?: unknown
      gates?: unknown
    }
    coordinators?: Array<{ id?: string; name?: string }>
  }
  /** Whether any non-oauth provider has a stored credential in the global store. */
  hasProvider: boolean
  /** Whether `memory/project-brief.md` exists and has > 40 chars of substance. */
  hasDirection: boolean
  /**
   * Whether `memory/workspace-goals.json` has been written (approve action)
   * OR a dismiss marker is present — either counts as "reviewed".
   * Also considered done if no repo anchors were detected (nothing to review).
   */
  workspaceImportReviewed: boolean
  /** Number of non-reserved user/project tasks in memory/TASKS.json. */
  taskCount: number
  /** Wizard-scoped persisted state (skip markers + completedAt stamps). */
  wizardState: WizardsState
}

export interface WizardsState {
  version: 1
  skipped: Record<string, string[]>
  completedAt: Record<string, string>
}

export function emptyWizardsState(): WizardsState {
  return { version: 1, skipped: {}, completedAt: {} }
}

// ---------------------------------------------------------------------------
// Wizard / step definitions
// ---------------------------------------------------------------------------

export type StepStatus = 'done' | 'pending' | 'skipped'

export interface WizardStep {
  /** Stable identifier, unique within a wizard. */
  id: string
  /** Short imperative title ("Pick a provider"). */
  title: string
  /** One-sentence "why the harness needs this" framing. Agent-voice. */
  why: string
  /**
   * True when this step can be skipped (user gets a warning chip; wizard
   * still reports not-yet-complete). False means skipping is not offered
   * (e.g. provider, bootstrap — without them nothing works).
   */
  skippable: boolean
  /** Pure status derivation from the snapshot. */
  status(snap: ProjectSnapshot): StepStatus
}

export interface Wizard {
  id: string
  title: string
  /** One-line lede shown at the top of the wizard page. */
  lede: string
  /** Ordered steps; first non-done/non-skipped is the "active" step. */
  steps: readonly WizardStep[]
  /** Predicate deciding whether this wizard currently applies. */
  applicable(snap: ProjectSnapshot): boolean
}

export interface WizardProgress {
  id: string
  title: string
  lede: string
  totalSteps: number
  doneCount: number
  skippedCount: number
  pendingCount: number
  /** The first pending step id, or null if all done/skipped. */
  activeStepId: string | null
  /** True when every step is `done` (skipped does NOT count). */
  complete: boolean
  steps: Array<{
    id: string
    title: string
    why: string
    status: StepStatus
    skippable: boolean
  }>
}

export function progressFor(wizard: Wizard, snap: ProjectSnapshot): WizardProgress {
  const skipped = new Set(snap.wizardState.skipped[wizard.id] ?? [])
  const steps = wizard.steps.map(s => {
    // Skipped is sticky until the underlying fact flips to done.
    const raw = s.status(snap)
    const status: StepStatus =
      raw === 'done' ? 'done' : skipped.has(s.id) ? 'skipped' : 'pending'
    return {
      id: s.id,
      title: s.title,
      why: s.why,
      status,
      skippable: s.skippable,
    }
  })
  const doneCount = steps.filter(s => s.status === 'done').length
  const skippedCount = steps.filter(s => s.status === 'skipped').length
  const pendingCount = steps.filter(s => s.status === 'pending').length
  const activeStep = steps.find(s => s.status === 'pending')
  return {
    id: wizard.id,
    title: wizard.title,
    lede: wizard.lede,
    totalSteps: steps.length,
    doneCount,
    skippedCount,
    pendingCount,
    activeStepId: activeStep?.id ?? null,
    complete: doneCount === steps.length,
    steps,
  }
}

// ---------------------------------------------------------------------------
// Onboard wizard: the seven-step absolute blocker.
// ---------------------------------------------------------------------------

const onboardSteps: readonly WizardStep[] = [
  {
    id: 'identity',
    title: 'Name this project',
    why:
      'Guildhall needs a workspace id and human name so multiple projects on this machine stay distinct.',
    skippable: false,
    status: snap => (snap.config?.id && snap.config.id.length > 0 ? 'done' : 'pending'),
  },
  {
    id: 'provider',
    title: 'Connect a provider',
    why:
      'Without a credentialed LLM provider the orchestrator cannot dispatch any agent at all.',
    skippable: false,
    status: snap => (snap.hasProvider ? 'done' : 'pending'),
  },
  {
    id: 'bootstrap',
    title: 'Verify install + gates',
    why:
      'Agents must run against an environment where tests + build + typecheck are known to pass. Until this is green, agents produce unverifiable PRs.',
    skippable: false,
    status: snap => {
      const v = snap.config?.bootstrap?.verifiedAt
      return typeof v === 'string' && v.length > 0 ? 'done' : 'pending'
    },
  },
  {
    id: 'coordinator',
    title: 'Pick at least one coordinator',
    why:
      'Coordinators are the agents that drive intake → spec → dispatch. Without one, no task ever gets picked up.',
    skippable: false,
    status: snap =>
      (snap.config?.coordinators?.length ?? 0) > 0 ? 'done' : 'pending',
  },
  {
    id: 'direction',
    title: 'Give the project direction',
    why:
      'Guildhall can draft a starting guess from the repo. Review it here so future tasks inherit the right product intent.',
    skippable: true,
    status: snap => (snap.hasDirection ? 'done' : 'pending'),
  },
  {
    id: 'workspaceImport',
    title: 'Review existing work',
    why:
      'If this is an existing repo, pull the goals, tasks, and milestones already in the README / roadmap / TODOs into the planner instead of starting at zero.',
    skippable: true,
    status: snap => (snap.workspaceImportReviewed ? 'done' : 'pending'),
  },
  {
    id: 'firstTask',
    title: 'Seed the first task',
    why:
      'Until there is at least one task, the orchestrator has nothing to tick on.',
    skippable: false,
    status: snap => (snap.taskCount > 0 ? 'done' : 'pending'),
  },
]

export const onboardWizard: Wizard = {
  id: 'onboard',
  title: 'Onboard',
  lede:
    'Walk the harness through everything it needs to start working on your project. Leave and come back any time — progress is saved.',
  steps: onboardSteps,
  applicable: () => true,
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry: Wizard[] = [onboardWizard]

export function registerWizard(w: Wizard): void {
  if (registry.some(r => r.id === w.id)) {
    throw new Error(`Wizard already registered: ${w.id}`)
  }
  registry.push(w)
}

export function listWizards(): readonly Wizard[] {
  return registry
}

// ---------------------------------------------------------------------------
// Task-scoped wizards (spec-fill, later: rollout-checks, verification-fill)
//
// Mirror of the project-wizard shape but parameterized over a TaskSnapshot.
// Kept as a parallel type family rather than a generic Wizard<S> because the
// registry is heterogeneous in practice and the two axes (project lifecycle
// vs. single-task lifecycle) want different applicability predicates anyway.
// ---------------------------------------------------------------------------

/**
 * Minimal slice of a single task's state that task-scoped wizards derive
 * status from. Built by `buildTaskSnapshot()`.
 */
export interface TaskSnapshot {
  id: string
  title: string
  description: string
  status: string
  spec: string
  brief: {
    userJob: string
    successCriteria: string
    approvedAt: string | null
  }
  acceptanceCriteriaCount: number
  /** Wizard-scoped persisted state — same store as project wizards. */
  wizardState: WizardsState
}

export interface TaskWizardStep {
  id: string
  title: string
  why: string
  skippable: boolean
  status(snap: TaskSnapshot): StepStatus
}

export interface TaskWizard {
  id: string
  title: string
  lede: string
  steps: readonly TaskWizardStep[]
  /** Predicate deciding whether this wizard currently applies to the task. */
  applicable(snap: TaskSnapshot): boolean
}

export function progressForTask(wizard: TaskWizard, snap: TaskSnapshot): WizardProgress {
  const key = `${wizard.id}:${snap.id}`
  const skipped = new Set(snap.wizardState.skipped[key] ?? [])
  const steps = wizard.steps.map(s => {
    const raw = s.status(snap)
    const status: StepStatus =
      raw === 'done' ? 'done' : skipped.has(s.id) ? 'skipped' : 'pending'
    return { id: s.id, title: s.title, why: s.why, status, skippable: s.skippable }
  })
  const doneCount = steps.filter(s => s.status === 'done').length
  const skippedCount = steps.filter(s => s.status === 'skipped').length
  const pendingCount = steps.filter(s => s.status === 'pending').length
  const activeStep = steps.find(s => s.status === 'pending')
  return {
    id: wizard.id,
    title: wizard.title,
    lede: wizard.lede,
    totalSteps: steps.length,
    doneCount,
    skippedCount,
    pendingCount,
    activeStepId: activeStep?.id ?? null,
    complete: doneCount === steps.length,
    steps,
  }
}

const specFillSteps: readonly TaskWizardStep[] = [
  {
    id: 'title',
    title: 'Give the task a title',
    why:
      'Every downstream view (planner, inbox, transcripts) uses the title as the primary label. A bare task id is unreadable.',
    skippable: false,
    status: snap => (snap.title.trim().length > 0 ? 'done' : 'pending'),
  },
  {
    id: 'description',
    title: 'Describe what the agent is looking at',
    why:
      'Without a short description the agent has to rediscover the intent every tick. One sentence unblocks this.',
    skippable: false,
    status: snap => (snap.description.trim().length >= 10 ? 'done' : 'pending'),
  },
  {
    id: 'brief',
    title: 'Fill in the product brief',
    why:
      'User need + Done-when are what review gates check. Without them the reviewer has nothing to compare the work against.',
    skippable: true,
    status: snap =>
      snap.brief.userJob.trim().length > 0 &&
      snap.brief.successCriteria.trim().length > 0
        ? 'done'
        : 'pending',
  },
  {
    id: 'acceptance',
    title: 'Add at least one acceptance criterion',
    why:
      'Acceptance criteria are the concrete finish line. Agents merge when criteria pass; without any criteria, the task never completes cleanly.',
    skippable: true,
    status: snap => (snap.acceptanceCriteriaCount > 0 ? 'done' : 'pending'),
  },
]

export const specFillWizard: TaskWizard = {
  id: 'spec-fill',
  title: 'Spec fill',
  lede:
    'Shape this task so the agent has enough context to work — and the reviewer has enough to verify.',
  steps: specFillSteps,
  // Applies to every task that isn't already done/cancelled. Exploring and
  // in-progress tasks both benefit from spec completeness.
  applicable: snap => {
    const terminal = new Set(['done', 'cancelled', 'archived'])
    return !terminal.has(snap.status)
  },
}

const taskRegistry: TaskWizard[] = [specFillWizard]

export function registerTaskWizard(w: TaskWizard): void {
  if (taskRegistry.some(r => r.id === w.id)) {
    throw new Error(`Task wizard already registered: ${w.id}`)
  }
  taskRegistry.push(w)
}

export function listTaskWizards(): readonly TaskWizard[] {
  return taskRegistry
}

export interface BuildTaskSnapshotOptions {
  projectPath: string
  task: {
    id?: string
    title?: string
    description?: string
    status?: string
    spec?: string
    productBrief?: {
      userJob?: string
      successCriteria?: string
      successMetric?: string
      approvedAt?: string | null
    }
    acceptanceCriteria?: unknown[]
  }
  readWizardsState?: (projectPath: string) => WizardsState
}

export function buildTaskSnapshot(opts: BuildTaskSnapshotOptions): TaskSnapshot {
  const readState = opts.readWizardsState ?? readWizardsState
  const t = opts.task
  const brief = t.productBrief ?? {}
  return {
    id: typeof t.id === 'string' ? t.id : '',
    title: typeof t.title === 'string' ? t.title : '',
    description: typeof t.description === 'string' ? t.description : '',
    status: typeof t.status === 'string' ? t.status : '',
    spec: typeof t.spec === 'string' ? t.spec : '',
    brief: {
      userJob: typeof brief.userJob === 'string' ? brief.userJob : '',
      // Accept either `successCriteria` or `successMetric` — the upstream
      // schema uses both historically.
      successCriteria:
        typeof brief.successCriteria === 'string'
          ? brief.successCriteria
          : typeof brief.successMetric === 'string'
            ? brief.successMetric
            : '',
      approvedAt: typeof brief.approvedAt === 'string' ? brief.approvedAt : null,
    },
    acceptanceCriteriaCount: Array.isArray(t.acceptanceCriteria)
      ? t.acceptanceCriteria.length
      : 0,
    wizardState: readState(opts.projectPath),
  }
}

// ---------------------------------------------------------------------------
// Snapshot builder (filesystem seam)
// ---------------------------------------------------------------------------

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

export function readWizardsState(projectPath: string): WizardsState {
  const path = join(projectPath, 'memory', 'wizards.yaml')
  if (!existsSync(path)) return emptyWizardsState()
  const raw = readYamlSafe(path) as Partial<WizardsState> | null
  if (!raw || typeof raw !== 'object') return emptyWizardsState()
  return {
    version: 1,
    skipped: (raw.skipped && typeof raw.skipped === 'object' ? raw.skipped : {}) as Record<string, string[]>,
    completedAt: (raw.completedAt && typeof raw.completedAt === 'object' ? raw.completedAt : {}) as Record<string, string>,
  }
}

export interface BuildSnapshotOptions {
  projectPath: string
  /** Override for tests — defaults to `readGlobalProviders`. */
  readProviders?: () => { providers?: Partial<Record<ProviderKind, unknown>> }
  /** Override for tests — defaults to reading from disk. */
  readWizardsState?: (projectPath: string) => WizardsState
  /**
   * Override for tests — defaults to checking the on-disk OAuth credential
   * files (`~/.claude/.credentials.json`, `~/.codex/auth.json`). The wizard's
   * "Connect a provider" step considers OAuth-detected providers a valid
   * connection just like a stored API key.
   */
  detectOauthProviders?: () => { claude: boolean; codex: boolean }
}

export function buildSnapshot(opts: BuildSnapshotOptions): ProjectSnapshot {
  const { projectPath } = opts
  const readProv = opts.readProviders ?? readGlobalProviders
  const readState = opts.readWizardsState ?? readWizardsState
  const detectOauth =
    opts.detectOauthProviders ??
    (() => ({
      claude: existsSync(join(homedir(), '.claude', '.credentials.json')),
      codex: existsSync(join(homedir(), '.codex', 'auth.json')),
    }))

  // guildhall.yaml
  const cfgPath = join(projectPath, 'guildhall.yaml')
  const cfg = existsSync(cfgPath) ? (readYamlSafe(cfgPath) as ProjectSnapshot['config']) : undefined

  // Provider presence: the orchestrator can dispatch if ANY of these is true:
  //   - a stored credential entry exists in the global providers store
  //     (anthropic-api / openai-api / explicit llama-cpp URL), OR
  //   - Claude Code OAuth is detected on disk, OR
  //   - Codex OAuth is detected on disk.
  // OAuth detection is filesystem-only (no `setProvider` is ever called for
  // it), so checking only the providers store mis-reports a connected machine
  // as "step pending" — which is exactly the bug users hit when Codex is
  // showing READY in the picker but the wizard still says "Connect a provider".
  let hasProvider = false
  try {
    const g = readProv()
    const entries = g.providers ?? {}
    hasProvider = Object.values(entries).some(v => v && typeof v === 'object')
  } catch {
    hasProvider = false
  }
  if (!hasProvider) {
    try {
      const oauth = detectOauth()
      if (oauth.claude || oauth.codex) hasProvider = true
    } catch {
      /* leave hasProvider as-is */
    }
  }

  // direction
  const briefPath = join(projectPath, 'memory', 'project-brief.md')
  let hasDirection = false
  if (existsSync(briefPath)) {
    try {
      const body = readFileSync(briefPath, 'utf8').trim()
      hasDirection = body.length > 40
    } catch {
      hasDirection = false
    }
  }

  // workspace import: goals.json written, OR dismiss marker, OR no anchors at all.
  const goalsPath = join(projectPath, 'memory', 'workspace-goals.json')
  const dismissPath = join(projectPath, 'memory', 'workspace-import-dismissed')
  let workspaceImportReviewed = existsSync(goalsPath) || existsSync(dismissPath)
  if (!workspaceImportReviewed) {
    const anchors = ['README.md', 'pnpm-workspace.yaml', 'package.json', 'packages', 'skills', 'ROADMAP.md']
    const anyAnchor = anchors.some(a => existsSync(join(projectPath, a)))
    if (!anyAnchor) workspaceImportReviewed = true
  }

  // tasks. Reserved setup/import bookkeeping tasks do not count as "first
  // task"; otherwise setup can claim the project is ready while Planner only
  // contains Guildhall's own housekeeping.
  const tasksPath = join(projectPath, 'memory', 'TASKS.json')
  const tasksRaw = readJsonSafe(tasksPath)
  const tasks = Array.isArray(tasksRaw)
    ? tasksRaw
    : tasksRaw && typeof tasksRaw === 'object' && Array.isArray((tasksRaw as { tasks?: unknown }).tasks)
      ? (tasksRaw as { tasks: unknown[] }).tasks
      : []
  const taskCount = tasks.filter(task => {
    if (!task || typeof task !== 'object') return false
    const t = task as { id?: unknown; domain?: unknown }
    if (t.id === 'task-meta-intake' || t.id === 'task-workspace-import') return false
    if (t.domain === '_meta' || t.domain === '_workspace_import') return false
    return true
  }).length

  return {
    projectPath,
    ...(cfg ? { config: cfg } : {}),
    hasProvider,
    hasDirection,
    workspaceImportReviewed,
    taskCount,
    wizardState: readState(projectPath),
  }
}
