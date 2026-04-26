import {
  createCoordinatorAgent,
  createSpecAgent,
  createWorkerAgent,
  createReviewerAgent,
  createGateCheckerAgent,
  createPersonaReviewerAgent,
  buildModelSet,
  type GuildhallAgent,
  type AgentLLM,
} from '@guildhall/agents'
import { selectApiClient, inferPreferredProvider } from './provider-selection.js'
import {
  TaskQueue,
  TERMINAL_TASK_STATUSES,
  type AdjudicationRecord,
  type AgentIssue,
  type ReviewVerdict,
  type Task,
  type TaskStatus,
  type TaskPermissionMode,
  type CoordinatorDomain,
  type ProgressEntry,
} from '@guildhall/core'
import {
  readProjectConfig,
  updateProjectConfig,
  migrateProjectProvidersToGlobal,
  resolveGlobalCredentials,
  type ResolvedConfig,
} from '@guildhall/config'
import { PermissionMode, HookEvent, type HookExecutor } from '@guildhall/engine'
import { McpClientManager, createMcpTools } from '@guildhall/mcp'
import { loadSkillRegistry } from '@guildhall/skills'
import {
  logProgress,
  raiseEscalation,
  findReclaimTasks,
  loadReclaimCandidates,
  readCheckpoint,
  type ReclaimCandidate,
} from '@guildhall/tools'
import { pickNextTask, needsPreRejectionPolicy } from './orchestrator-picker.js'
import {
  AGENT_SETTINGS_FILENAME,
  loadLeverSettings,
  resolveDomainLevers,
  type DomainLevers,
  type ProjectLevers,
} from '@guildhall/levers'
import { buildContext } from './context-builder.js'
import { buildHookExecutor } from './hooks-loader.js'
import { buildDefaultCompactor } from './compactor-builder.js'
import { evaluateProposal, type PromotionAction } from './proposal-promotion.js'
import {
  evaluatePreRejection,
  type PreRejectionAction,
} from './pre-rejection-policy.js'
import { LivenessTracker, type StallFlag } from './liveness.js'
import {
  tickOutcomeToBackendEvent,
  agentIssueToBackendEvent,
} from './wire-events.js'
import type { BackendEvent } from '@guildhall/backend-host'
import {
  authorizeAction,
  buildRemediationContext,
  recordRemediationDecision,
  type AuthorizationDecision,
  type RemediationAction,
  type RemediationContext,
  type RemediationTrigger,
} from './remediation.js'
import {
  SlotAllocator,
  buildSlotEnv,
  slotSystemPromptRule,
  resolveSlotShape,
  type Slot,
  type RuntimeIsolationConfig,
} from './slot-allocator.js'
import {
  NodeGitDriver,
  type GitDriver,
} from './git-driver.js'
import {
  ensureWorktreeForDispatch,
  cleanupWorktreeForTerminal,
  resolveWorktreeMode,
  type WorktreeMode,
} from './worktree-manager.js'
import {
  dispatchMerge,
  appendFixupTask,
  resolveMergePolicy,
  type MergePolicy,
} from './merge-dispatcher.js'
import { atomicWriteText, loadSessionById } from '@guildhall/sessions'
import {
  pickNextTasks,
  resolveFanoutCapacity,
  type FanoutCapacity,
} from './fanout-dispatcher.js'
import { isStopRequested } from './stop-requested.js'
import { runBootstrap, bootstrapNeeded } from './bootstrap-runner.js'
import {
  META_INTAKE_TASK_ID,
  parseCoordinatorDraft,
} from './meta-intake.js'
import {
  deterministicReview,
  applyDeterministicVerdict,
  recordLlmVerdict,
  type ReviewerMode,
} from './reviewer-dispatch.js'
import { runGuildGates } from './guild-gate-runner.js'
import { loadDesignSystem } from './design-system-store.js'
import {
  selectApplicableGuilds,
  reviewersForTask,
  loadProjectGuildRoster,
  type GuildDefinition,
} from '@guildhall/guilds'
import {
  aggregateFanout,
  boundedConcurrency,
  personaVerdictToReviewRecord,
  type PersonaVerdict,
  type ReviewerFanoutPolicy,
} from './reviewer-fanout.js'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Agent id recorded against promotion decisions written by the orchestrator
 * itself — distinguishes them from LLM-driven agent tool calls in progress
 * entries and audit scans.
 */
const PROPOSAL_PROMOTER_AGENT_ID = 'proposal-promoter'
const PRE_REJECTION_POLICY_AGENT_ID = 'pre-rejection-policy'

type AgentGenerateResult = Awaited<ReturnType<OrchestratorAgent['generate']>>

function findMetaIntakeDraftText(result: AgentGenerateResult): string | null {
  const candidates = [
    result.text,
    ...(result.messages ?? [])
      .slice()
      .reverse()
      .filter((message) => message.role === 'assistant')
      .map((message) => messageContentText(message.content)),
  ]

  for (const candidate of candidates) {
    const text = candidate.trim()
    if (!text) continue
    if (parseCoordinatorDraft(text)) return text
  }
  return null
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const entry = block as { type?: unknown; text?: unknown }
      return entry.type === 'text' && typeof entry.text === 'string' ? entry.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Forge Orchestrator
//
// On each tick:
//   1. Read the task queue from disk
//   2. Pick the highest-priority actionable task
//   3. Build JIT context (memory excerpts, recent progress, decisions)
//   4. Route to the appropriate agent based on status
//   5. Re-read the queue to detect what the agent changed
//   6. Update revision counters / detect max-revision blocks
//   7. Append a structured entry to PROGRESS.md
//
// All orchestrator state is derived from disk — each tick is a pure function
// of (queue-on-disk, config). This means the loop can be stopped and restarted
// at any point without losing state.
// ---------------------------------------------------------------------------

/**
 * The subset of GuildhallAgent the orchestrator needs. Having our own interface
 * lets tests inject fakes without spinning up a QueryEngine.
 */
export interface OrchestratorAgent {
  readonly name: string
  generate(prompt: string): Promise<{
    text: string
    messages?: Array<{ role?: string; content?: unknown }>
  }>
  /**
   * FR-15: optional hook called by the orchestrator before `generate()` when
   * the task carries a `permissionMode` override. Agents that ignore this
   * (simple test fakes, etc.) stay at their baseline mode.
   */
  setPermissionMode?(mode: PermissionMode): PermissionMode
}

export interface OrchestratorAgentSet {
  spec: OrchestratorAgent
  worker: OrchestratorAgent
  reviewer: OrchestratorAgent
  gateChecker: OrchestratorAgent
  /** Keyed by domain id */
  coordinators: Record<string, OrchestratorAgent>
}

/**
 * Reviewer fan-out runner. Given a task and the applicable reviewer
 * personas, returns one `PersonaVerdict` per persona. The orchestrator
 * aggregates and transitions the task. Production wires a default runner
 * that constructs a `createPersonaReviewerAgent` per persona; tests inject
 * a stub that returns canned verdicts without touching an LLM.
 */
export type ReviewerFanoutRunner = (input: {
  task: Task
  personas: GuildDefinition[]
  context: string
  memoryDir: string
  projectPath: string
}) => Promise<PersonaVerdict[]>

export type { TickOutcome } from './tick-outcome.js'
import type { TickOutcome } from './tick-outcome.js'

export interface OrchestratorOptions {
  config: ResolvedConfig
  agents: OrchestratorAgentSet
  domainFilter?: string
  /** Injectable clock for deterministic tests */
  now?: () => string
  /** After this many consecutive idle ticks, run() shuts down */
  idleShutdownAfterTicks?: number
  /**
   * FR-18: optional hook executor. When present, the orchestrator fires
   * SESSION_START at the top of `run()` and SESSION_END before it returns.
   * Per-agent hook firing (PRE_TOOL_USE, etc.) happens inside each agent's
   * QueryEngine, which receives the same executor via the agent factory.
   */
  hookExecutor?: HookExecutor
  /**
   * FR-30: optional liveness tracker. When supplied, the orchestrator
   * registers/unregisters the agent around each `generate()` call so the
   * FR-32 remediation loop and any observability consumer can ask whether
   * the agent is silent past the `agent_health_strictness` threshold.
   *
   * For in-process agents, registration alone is sufficient: `generate()`
   * is a single blocking call, so silence is detected by a watchdog running
   * off the tick loop (e.g. the serve layer). Out-of-process workers
   * (FR-24) will touch the tracker per stdout event.
   *
   * When omitted, the orchestrator constructs an internal tracker keyed on
   * the current lever position so `scanStalls()` / `liveness` still work.
   */
  liveness?: LivenessTracker
  /**
   * Optional subscriber called once per emitted backend event (tick outcomes
   * translated via `tickOutcomeToBackendEvent`, agent-issues translated via
   * `agentIssueToBackendEvent`). The serve layer wires this into a per-
   * workspace SSE stream so the dashboard can watch ticks in real time.
   *
   * Exceptions from the subscriber are caught and logged — they must not
   * break the run loop.
   */
  onBackendEvent?: (event: BackendEvent) => void | Promise<void>
  /**
   * Optional flag the serve layer flips to request a graceful stop between
   * ticks. The orchestrator polls it after each tick's event drain and
   * exits before the next `sleep(tickDelayMs)`. Useful because the
   * supervisor doesn't want to cancel an in-flight `generate()` call.
   */
  stopSignal?: { stopRequested: boolean }
  /**
   * FR-24 / FR-25: git driver used for worktree + merge operations. Defaults
   * to `NodeGitDriver` (shells out to `git` + `gh`). Tests inject
   * `InMemoryGitDriver` so the tick loop can be exercised without touching a
   * real repo.
   */
  gitDriver?: GitDriver
  /**
   * Optional reviewer fan-out runner. When supplied, at `review` the
   * orchestrator runs one LLM call per applicable reviewer persona (each
   * through its own lens) instead of dispatching a single generic reviewer.
   * Verdicts aggregate under a strict-all policy: any revise bounces the
   * task to `in_progress` with combined feedback.
   *
   * When absent, the legacy single-reviewer dispatch runs unchanged.
   */
  reviewerFanout?: ReviewerFanoutRunner
}

const DEFAULT_IDLE_SHUTDOWN = 10

export class Orchestrator {
  private consecutiveIdleTicks = 0
  private readonly opts: OrchestratorOptions
  /**
   * FR-30: lazily-initialized tracker. `opts.liveness` wins when provided;
   * otherwise we build a default with `standard` strictness (can be
   * reconfigured at runtime via `updateLivenessStrictness` once the lever
   * file is read).
   */
  private readonly livenessTracker: LivenessTracker
  /**
   * FR-24: lazily-initialized on first dispatch. `null` means we have already
   * consulted the levers and runtime_isolation is `none`; a live
   * `SlotAllocator` means we're allocating slots for each dispatched task.
   * Initialized to `undefined` so the first dispatch knows to read the
   * levers and pick a mode.
   */
  private slotAllocator: SlotAllocator | null | undefined = undefined
  /**
   * FR-24/25: injected git driver. Default `NodeGitDriver` for real runs;
   * tests pass `InMemoryGitDriver` through options.
   */
  private readonly gitDriver: GitDriver
  /**
   * FR-24/25: serialize the read-modify-write cycle for TASKS.json when
   * multiple fanout dispatches finish in the same tick. Kept as a single
   * tail promise so writes are FIFO and no dispatchOne clobbers another's
   * edits.
   */
  private queueWriteChain: Promise<void> = Promise.resolve()

  constructor(opts: OrchestratorOptions) {
    this.opts = opts
    this.livenessTracker =
      opts.liveness ?? new LivenessTracker({ strictness: 'standard' })
    this.gitDriver = opts.gitDriver ?? new NodeGitDriver()
  }

  get config(): ResolvedConfig {
    return this.opts.config
  }

  /** FR-30: expose the liveness tracker so serve / tests can feed events. */
  get liveness(): LivenessTracker {
    return this.livenessTracker
  }

  /** FR-30: convenience — same as `this.liveness.scanStalls()`. */
  scanStalls(nowOverride?: number): StallFlag[] {
    return this.livenessTracker.scanStalls(nowOverride)
  }

  /**
   * FR-30: read the current `agent_health_strictness` lever and sync the
   * tracker. Callers (serve layer, tests) invoke this when the lever may
   * have changed. Silently falls back to `standard` if the lever file
   * cannot be read — stall detection should not be gated on perfect
   * settings state.
   */
  async refreshLivenessStrictness(): Promise<void> {
    try {
      const settingsPath = path.join(
        this.opts.config.memoryDir,
        AGENT_SETTINGS_FILENAME,
      )
      const settings = await loadLeverSettings({ path: settingsPath })
      this.livenessTracker.setStrictness(
        settings.project.agent_health_strictness.position,
      )
    } catch {
      this.livenessTracker.setStrictness('standard')
    }
  }

  /**
   * Single orchestrator step. Reads the queue, picks 1..N actionable tasks
   * per the `concurrent_task_dispatch` lever, and dispatches each through
   * `dispatchOne`. Returns one `TickOutcome` for the serial path, or a
   * `batch` outcome wrapping the N sub-outcomes for fanout.
   *
   * Agents run concurrently in fanout; queue writes are serialized via
   * `withQueueWriteLock` so concurrent dispatches never clobber one another.
   */
  async tick(): Promise<TickOutcome> {
    const queueBefore = await this.readQueue()
    const capacity = await this.resolveCapacity()
    const picks = pickNextTasks({
      queue: queueBefore,
      capacity,
      ...(this.opts.domainFilter ? { domainFilter: this.opts.domainFilter } : {}),
    })

    // Structural-reliability hard precondition: refuse to dispatch if the
    // project's bootstrap block is unverified or its last install failed.
    // Running a worker against an environment that can't even resolve
    // `pnpm` / `oxlint` / tsconfig guarantees gate failures on infrastructure
    // rather than on actual work — the Ready page surfaces the same state and
    // offers a "Run bootstrap" button. Skipped in idle ticks so a bootstrap-less
    // workspace with no pending work doesn't emit noise.
    if (picks.length > 0) {
      const halt = this.bootstrapHalt(picks.length)
      if (halt) return halt
    }

    if (picks.length === 0) {
      this.consecutiveIdleTicks++
      const allDone = queueBefore.tasks.every((t) =>
        (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(t.status),
      )
      return {
        kind: 'idle',
        consecutiveIdleTicks: this.consecutiveIdleTicks,
        allDone,
      }
    }
    this.consecutiveIdleTicks = 0

    if (picks.length === 1) {
      return await this.dispatchOne(picks[0]!, queueBefore)
    }

    // Fanout path: run each pick concurrently. `dispatchOne` catches its own
    // agent errors, so Promise.all is sufficient — any rejection here is a
    // true bug and should surface as a throw on the tick caller.
    const outcomes = await Promise.all(
      picks.map((t) => this.dispatchOne(t, queueBefore)),
    )
    return { kind: 'batch', outcomes }
  }

  /**
   * Dispatch a single task. Handles pre-policy (proposed, shelved) paths,
   * agent dispatch (with worktree setup + slot allocation), reviewer-mode
   * routing, merge dispatch on `done` transitions, worktree cleanup on
   * terminal transitions, revision counting, and progress logging.
   *
   * Queue mutations after `agent.generate()` go through `withQueueWriteLock`
   * so concurrent fanout dispatches serialize on the final write step.
   */
  async dispatchOne(task: Task, queueBefore: TaskQueue): Promise<TickOutcome> {
    // FR-21: proposals are decided by policy (the `task_origination` lever),
    // not by an LLM agent. Handle the transition inline.
    if (task.status === 'proposed') {
      return await this.decideProposal(task, queueBefore)
    }

    // FR-22: worker-shelved tasks pending pre_rejection_policy get resolved
    // via the same pure-policy path.
    if (needsPreRejectionPolicy(task)) {
      return await this.applyPreRejectionPolicy(task, queueBefore)
    }

    // Guild deterministic-check pre-pass at `gate_check`: each applicable
    // guild's pure-function checks (WCAG contrast, OKLab near-duplicates, …)
    // run *before* the LLM gate-checker. Failures short-circuit straight to
    // `in_progress` — there's no point running build/test if a token pair
    // fails WCAG. All-pass (or no applicable checks) falls through to the
    // normal shell-gate pass.
    if (task.status === 'gate_check') {
      const guildGateOutcome = await this.runGuildGatesInline(task, queueBefore)
      if (guildGateOutcome) return guildGateOutcome
    }

    // Handoff sequence pre-pass at `review`: when the task is running a
    // multi-step handoff and the current step is NOT the last, we capture
    // the step's handoff note, advance `handoffStep`, and revert status to
    // `in_progress`. The reviewer fan-out only fires on the final step's
    // completion. See docs/disagreement-and-handoff.md §2.
    if (task.status === 'review' && hasPendingHandoffStep(task)) {
      const handoffOutcome = await this.advanceHandoffStepInline(task)
      if (handoffOutcome) return handoffOutcome
    }

    // Reviewer fan-out at `review`: each applicable persona (Component
    // Designer, Accessibility Specialist, Color Theorist, …) reviews
    // independently through its own lens. Aggregation is strict — any revise
    // bounces the task to `in_progress` with combined feedback. Falls
    // through to the legacy single-reviewer dispatch when no fan-out runner
    // is configured or no reviewer personas apply.
    if (task.status === 'review' && this.opts.reviewerFanout) {
      const fanoutOutcome = await this.runReviewerFanoutInline(task, queueBefore)
      if (fanoutOutcome) return fanoutOutcome
    }

    if (task.id === META_INTAKE_TASK_ID && !task.spec) {
      const recovered = await this.recoverMetaIntakeDraftFromSpecSession(task)
      if (recovered) return recovered
    }

    const beforeStatus = task.status
    const selection = this.selectAgent(task)

    if (selection.kind === 'no-coordinator') {
      return { kind: 'no-coordinator', taskId: task.id, domain: task.domain }
    }

    const { agent, promptSuffix } = selection

    // FR-27 / AC-18: resolve reviewer mode once per dispatch so failures to
    // load levers fall back to `llm_only` (safest default).
    const reviewerMode: ReviewerMode =
      beforeStatus === 'review' ? await this.resolveReviewerMode(task.domain) : 'llm_only'

    if (beforeStatus === 'review' && reviewerMode === 'deterministic_only') {
      return await this.applyReviewVerdictInline({
        task,
        queue: queueBefore,
        llmError: undefined,
      })
    }

    // FR-24: if worktree_isolation is active, ensure a worktree exists before
    // the agent runs. On first creation, persist the path/branch/base on the
    // task so subsequent ticks reuse them. Skipped when mode is `none`.
    const worktreeMode = await this.resolveWorktreeModeSafe()
    let activeWorktreePath = this.opts.config.projectPath
    if (worktreeMode !== 'none') {
      const baseBranch = await this.resolveBaseBranch()
      try {
        const ensured = await ensureWorktreeForDispatch({
          task,
          mode: worktreeMode,
          projectPath: this.opts.config.projectPath,
          baseBranch,
          gitDriver: this.gitDriver,
        })
        activeWorktreePath = ensured.worktreePath
        // Persist metadata if we just minted a new worktree (or if the task
        // is missing any of the fields, e.g. legacy rows pre-FR-24).
        if (
          ensured.created ||
          task.worktreePath !== ensured.worktreePath ||
          task.branchName !== ensured.branchName ||
          task.baseBranch !== ensured.baseBranch
        ) {
          await this.withQueueWriteLock(async () => {
            const queue = await this.readQueue()
            const t = queue.tasks.find((x) => x.id === task.id)
            if (!t) return
            t.worktreePath = ensured.worktreePath
            t.branchName = ensured.branchName
            t.baseBranch = ensured.baseBranch
            t.updatedAt = this.now()
            queue.lastUpdated = this.now()
            await this.writeQueue(queue)
          })
          task.worktreePath = ensured.worktreePath
          task.branchName = ensured.branchName
          task.baseBranch = ensured.baseBranch
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await this.logTickProgress({
          task,
          agent: agent.name,
          beforeStatus,
          afterStatus: beforeStatus,
          transitioned: false,
          note: `error: worktree setup failed — ${message}`,
        })
        return {
          kind: 'agent-error',
          taskId: task.id,
          agent: agent.name,
          error: `worktree setup failed: ${message}`,
        }
      }
    }

    // When a worktree is freshly minted (or its lockfile has changed), re-run
    // the project's bootstrap inside the worktree so the worker lands in a
    // testable state. Status is stored per-worktree under `<wt>/.guildhall/`
    // so the project's shared memory isn't trampled and the cache disappears
    // naturally when the worktree is cleaned up. A failure here aborts the
    // dispatch — better to surface it than hand the worker a broken tree.
    const wtBootstrap = this.opts.config.bootstrap
    if (
      wtBootstrap &&
      wtBootstrap.commands.length > 0 &&
      activeWorktreePath !== this.opts.config.projectPath
    ) {
      const wtMemoryDir = path.join(activeWorktreePath, '.guildhall')
      const needed = bootstrapNeeded(
        wtMemoryDir,
        activeWorktreePath,
        wtBootstrap.commands,
        wtBootstrap.successGates,
      )
      if (needed) {
        console.log(`[guildhall] bootstrapping worktree ${activeWorktreePath}…`)
        const res = runBootstrap({
          projectPath: activeWorktreePath,
          memoryDir: wtMemoryDir,
          commands: wtBootstrap.commands,
          successGates: wtBootstrap.successGates,
          timeoutMs: wtBootstrap.timeoutMs,
        })
        if (!res.success) {
          const failed = res.steps.find((s) => s.result === 'fail')
          const msg = `worktree bootstrap failed on ${failed?.kind ?? 'step'} \`${failed?.command ?? ''}\` (exit ${failed?.exitCode ?? '?'})`
          await this.logTickProgress({
            task,
            agent: agent.name,
            beforeStatus,
            afterStatus: beforeStatus,
            transitioned: false,
            note: `error: ${msg}`,
          })
          return {
            kind: 'agent-error',
            taskId: task.id,
            agent: agent.name,
            error: msg,
          }
        }
      }
    }

    const ctx = await buildContext(task, this.opts.config.memoryDir)
    const tasksPath = this.tasksPath()

    // FR-24: slot allocation shapes the prompt + env for the worker. Slot is
    // released after the agent returns (or throws).
    const slot = await this.allocateSlotForTask(task)
    const slotPromptRule = slot ? slotSystemPromptRule(slot) : null

    const prompt = [
      ctx.formatted,
      '',
      `**Tasks file (for tool calls):** ${tasksPath}`,
      `**Memory dir (for tool calls):** ${this.opts.config.memoryDir}`,
      ...(activeWorktreePath !== this.opts.config.projectPath
        ? [`**Worktree (for code edits):** ${activeWorktreePath}`]
        : []),
      ...(slotPromptRule ? ['', slotPromptRule] : []),
      '',
      promptSuffix,
    ].join('\n')

    // FR-15: per-task permission mode override; re-applied every dispatch so
    // narrowed modes don't stick on long-lived agents.
    if (typeof agent.setPermissionMode === 'function') {
      const requested = task.permissionMode
        ? taskModeToPermissionMode(task.permissionMode)
        : PermissionMode.FULL_AUTO
      agent.setPermissionMode(requested)
    }

    // FR-30: register the agent with the liveness tracker for the duration
    // of this generate() call.
    this.livenessTracker.register(agent.name, task.id)
    await this.emitBackendEvent({
      type: 'agent_started',
      task_id: task.id,
      agent_name: agent.name,
      from_status: beforeStatus,
      message: `${agent.name} is working on ${task.title}`,
    })

    let generatedText = ''
    let generatedMetaIntakeDraft: string | null = null
    try {
      const result = await agent.generate(prompt)
      generatedText = result.text
      if (task.id === META_INTAKE_TASK_ID) {
        generatedMetaIntakeDraft = findMetaIntakeDraftText(result)
      }
    } catch (err) {
      this.livenessTracker.unregister(agent.name)
      await this.emitBackendEvent({
        type: 'agent_finished',
        task_id: task.id,
        agent_name: agent.name,
        from_status: beforeStatus,
        is_error: true,
        message: `${agent.name} stopped on ${task.title}`,
      })
      if (slot) this.slotAllocator?.release(task.id)
      const message = err instanceof Error ? err.message : String(err)

      if (
        beforeStatus === 'review' &&
        reviewerMode === 'llm_with_deterministic_fallback'
      ) {
        return await this.applyReviewVerdictInline({
          task,
          queue: queueBefore,
          llmError: message,
        })
      }

      await this.logTickProgress({
        task,
        agent: agent.name,
        beforeStatus,
        afterStatus: beforeStatus,
        transitioned: false,
        note: `error: ${message}`,
      })
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: agent.name,
        error: message,
      }
    }

    this.livenessTracker.unregister(agent.name)
    await this.emitBackendEvent({
      type: 'agent_finished',
      task_id: task.id,
      agent_name: agent.name,
      from_status: beforeStatus,
      message: `${agent.name} finished its current step on ${task.title}`,
    })
    if (slot) this.slotAllocator?.release(task.id)

    // Post-generate queue work is serialized across concurrent dispatches so
    // no two fanout workers clobber each other's writes.
    return await this.withQueueWriteLock(async () => {
      const queueAfter = await this.readQueue()
      const taskAfter = queueAfter.tasks.find((t) => t.id === task.id) ?? task
      let afterStatus = taskAfter.status
      let transitioned = beforeStatus !== afterStatus

      if (
        task.id === META_INTAKE_TASK_ID &&
        !taskAfter.spec &&
        generatedMetaIntakeDraft
      ) {
        taskAfter.spec = generatedMetaIntakeDraft
        if (taskAfter.status === 'exploring') taskAfter.status = 'spec_review'
        taskAfter.updatedAt = this.now()
        queueAfter.lastUpdated = this.now()
        await this.writeQueue(queueAfter)
        afterStatus = taskAfter.status
        transitioned = true
      }

      // FR-27 / AC-18: record LLM verdict when a review actually ran.
      if (beforeStatus === 'review') {
        const llmVerdict = recordLlmVerdict({
          queue: queueAfter,
          taskId: task.id,
          beforeStatus,
          afterStatus,
          now: this.now(),
        })
        if (llmVerdict) {
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
        }
      }

      // FR-10: new escalation → halt.
      if (taskAfter.escalations.length > task.escalations.length) {
        const newest = taskAfter.escalations[taskAfter.escalations.length - 1]!
        return {
          kind: 'escalated',
          taskId: task.id,
          agent: agent.name,
          reason: newest.reason,
          escalationId: newest.id,
        }
      }

      // FR-25: on `done` transition, run the merge dispatcher. Merge result
      // may move the task to `pending_pr` (manual_pr path) or `blocked` (with
      // a fixup task queued) — `afterStatus` is updated so the post-merge
      // cleanup / progress logging see the final state.
      if (
        afterStatus === 'done' &&
        beforeStatus !== 'done' &&
        worktreeMode !== 'none' &&
        taskAfter.branchName &&
        taskAfter.baseBranch
      ) {
        const mergePolicy = await this.resolveMergePolicySafe()
        const mergeOutcome = await dispatchMerge({
          task: taskAfter,
          policy: mergePolicy,
          projectPath: this.opts.config.projectPath,
          memoryDir: this.opts.config.memoryDir,
          gitDriver: this.gitDriver,
          now: this.now(),
        })
        taskAfter.mergeRecord = mergeOutcome.record
        taskAfter.status = mergeOutcome.newStatus
        taskAfter.updatedAt = this.now()
        queueAfter.lastUpdated = this.now()
        if (mergeOutcome.fixupTask) {
          appendFixupTask(queueAfter, mergeOutcome.fixupTask, this.now())
        }
        await this.writeQueue(queueAfter)
        afterStatus = mergeOutcome.newStatus
        transitioned = beforeStatus !== afterStatus
      }

      // Revision counting: review/gate_check → in_progress is a revise cycle.
      const revisionTrigger =
        (beforeStatus === 'review' || beforeStatus === 'gate_check') &&
        afterStatus === 'in_progress'

      let revisionCount = taskAfter.revisionCount
      if (revisionTrigger) {
        revisionCount = taskAfter.revisionCount + 1
        taskAfter.revisionCount = revisionCount
        taskAfter.updatedAt = this.now()
        queueAfter.lastUpdated = this.now()

        if (revisionCount > this.opts.config.maxRevisions) {
          await this.writeQueue(queueAfter)

          await raiseEscalation({
            tasksPath: this.tasksPath(),
            progressPath: this.progressPath(),
            taskId: task.id,
            agentId: agent.name,
            reason: 'max_revisions_exceeded',
            summary:
              `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
              `Requires human judgment.`,
            details:
              `Task bounced between ${beforeStatus} and in_progress ${revisionCount} times. ` +
              `Last agent: ${agent.name}.`,
          })

          await this.maybeCleanupWorktree(taskAfter, worktreeMode)

          return {
            kind: 'blocked-max-revisions',
            taskId: task.id,
            revisionCount,
          }
        }

        await this.writeQueue(queueAfter)
      }

      await this.logTickProgress({
        task: taskAfter,
        agent: agent.name,
        beforeStatus,
        afterStatus,
        transitioned,
        ...(transitioned ? {} : { note: 'no transition' }),
      })

      // FR-24: teardown on terminal transitions. `pending_pr` is preserved —
      // the human still needs the branch alive to merge the PR externally.
      await this.maybeCleanupWorktree(taskAfter, worktreeMode)

      return {
        kind: 'processed',
        taskId: task.id,
        agent: agent.name,
        beforeStatus,
        afterStatus,
        transitioned,
        revisionCount,
      }
    })
  }

  /**
   * Loop `tick()` until max ticks or idle shutdown. Logs a heartbeat banner
   * at start; each tick self-reports to PROGRESS.md.
   */
  async run(opts: { maxTicks?: number; tickDelayMs?: number } = {}): Promise<void> {
    const { maxTicks = Infinity, tickDelayMs = 2000 } = opts
    const idleLimit = this.opts.idleShutdownAfterTicks ?? DEFAULT_IDLE_SHUTDOWN

    this.banner()

    // FR-18: SESSION_START is the "orchestrator woke up" event. Hooks may use
    // it to prime a log, bump a health counter, or gate startup with a
    // blocking result. A blocking hook aborts run() before any tick fires.
    if (this.opts.hookExecutor != null) {
      const pre = await this.opts.hookExecutor.execute(HookEvent.SESSION_START, {
        event: HookEvent.SESSION_START,
        workspaceId: this.opts.config.workspaceId,
      })
      if (pre.blocked) {
        console.warn(
          `[guildhall] SESSION_START hook blocked startup: ${pre.reason ?? '(no reason)'}`,
        )
        return
      }
    }

    // Project bootstrap: run install/build/migrate commands and verify via
    // successGates before any task is dispatched. Skipped when the lockfile
    // hash + command set haven't changed since the last successful run.
    // A failed bootstrap aborts startup — dispatching workers into a project
    // that can't typecheck is worse than doing nothing.
    const bootstrap = this.opts.config.bootstrap
    if (bootstrap && bootstrap.commands.length > 0) {
      const needed = bootstrapNeeded(
        this.opts.config.memoryDir,
        this.opts.config.projectPath,
        bootstrap.commands,
        bootstrap.successGates,
      )
      if (needed) {
        console.log('[guildhall] running bootstrap…')
        const res = runBootstrap({
          projectPath: this.opts.config.projectPath,
          memoryDir: this.opts.config.memoryDir,
          commands: bootstrap.commands,
          successGates: bootstrap.successGates,
          timeoutMs: bootstrap.timeoutMs,
        })
        if (!res.success) {
          const failed = res.steps.find((s) => s.result === 'fail')
          console.error(
            `[guildhall] bootstrap failed on ${failed?.kind ?? 'step'} \`${failed?.command ?? ''}\` (exit ${failed?.exitCode ?? '?'}). See memory/bootstrap.json.`,
          )
          return
        }
        console.log(`[guildhall] bootstrap passed (${res.steps.length} steps).`)
      }
    }

    // FR-33: on startup, any task sitting in `in_progress`/`review`/`gate_check`
    // without a live agent is a crash-survivor. Log it — FR-32 will consume
    // these candidates; until then, this surfaces the state a human operator
    // needs to see. Failures are non-fatal (missing memory dir on a fresh
    // workspace is expected).
    try {
      const reclaim = await this.scanReclaimCandidates()
      for (const cand of reclaim) {
        const cpDesc = cand.checkpoint
          ? `checkpoint step ${cand.checkpoint.step} (${Math.round((cand.ageMs ?? 0) / 1000)}s old)`
          : 'no checkpoint'
        const flag = cand.autoEscalate ? ' [AUTO-ESCALATE: >24h]' : ''
        console.warn(
          `[guildhall] reclaim candidate: ${cand.task.id} [${cand.task.status}] ${cpDesc}${flag}`,
        )
      }
    } catch (err) {
      console.warn(
        `[guildhall] reclaim scan failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let tick = 0
    while (tick < maxTicks) {
      tick++
      const raw = await this.tick()

      // FR-24: flatten batch outcomes from fanout dispatch so the logging /
      // backend-event paths keep their one-entry-per-task shape.
      const allOutcomes: TickOutcome[] =
        raw.kind === 'batch' ? raw.outcomes : [raw]

      let shouldStop = false
      for (const outcome of allOutcomes) {
        if (outcome.kind === 'idle') {
          if (outcome.allDone) {
            console.log('[guildhall] All tasks complete or blocked. Shutting down.')
            shouldStop = true
            break
          }
          if (outcome.consecutiveIdleTicks > idleLimit) {
            console.log(
              `[guildhall] No actionable tasks for ${idleLimit} ticks. Shutting down.`,
            )
            shouldStop = true
            break
          }
        } else if (outcome.kind === 'processed') {
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} ${outcome.beforeStatus} → ${outcome.afterStatus} via ${outcome.agent}${outcome.transitioned ? '' : ' (no change)'}`,
          )
        } else if (outcome.kind === 'blocked-max-revisions') {
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} blocked after ${outcome.revisionCount} revisions.`,
          )
        } else if (outcome.kind === 'no-coordinator') {
          console.warn(
            `[guildhall] tick ${tick}: ${outcome.taskId} skipped — no coordinator for domain "${outcome.domain}".`,
          )
        } else if (outcome.kind === 'agent-error') {
          console.error(
            `[guildhall] tick ${tick}: ${outcome.agent} failed on ${outcome.taskId}: ${outcome.error}`,
          )
        } else if (outcome.kind === 'escalated') {
          console.warn(
            `[guildhall] tick ${tick}: ${outcome.taskId} escalated by ${outcome.agent} — ${outcome.reason} (${outcome.escalationId}).`,
          )
        } else if (outcome.kind === 'proposal-decided') {
          console.log(
            `[guildhall] tick ${tick}: proposal ${outcome.taskId} → ${outcome.newStatus} (${outcome.actionKind}, lever=${String(outcome.leverPosition)}).`,
          )
        } else if (outcome.kind === 'pre-rejection-applied') {
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} pre-rejection ${outcome.actionKind} → ${outcome.newStatus} (policy=${String(outcome.domainLeverPosition)}, count=${outcome.requeueCount}).`,
          )
        } else if (outcome.kind === 'bootstrap-required') {
          console.warn(
            `[guildhall] tick ${tick}: bootstrap ${outcome.reason} — ${outcome.pendingTaskCount} task(s) held; run bootstrap from /settings/ready.`,
          )
        }

        if (this.opts.onBackendEvent) {
          const tickEvent = tickOutcomeToBackendEvent(outcome)
          if (tickEvent) {
            try {
              await this.opts.onBackendEvent(tickEvent)
            } catch (err) {
              console.warn(
                `[guildhall] onBackendEvent threw (tick): ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
        }
      }

      if (shouldStop) break

      // FR-31: drain agent issues once per tick (shared across fanout outcomes
      // since the drain walks the whole queue). Issues do not alter task
      // status, so surfacing them outside the per-outcome loop keeps the wire
      // events deduplicated.
      const issues = await this.drainPendingIssues()
      for (const issue of issues) {
        console.log(
          `[guildhall] tick ${tick}: agent-issue ${issue.id} on ${issue.taskId} ` +
            `[${issue.severity}/${issue.code}] — ${issue.detail}`,
        )
        if (this.opts.onBackendEvent) {
          try {
            await this.opts.onBackendEvent(agentIssueToBackendEvent(issue))
          } catch (err) {
            console.warn(
              `[guildhall] onBackendEvent threw (issue): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }

      if (this.opts.stopSignal?.stopRequested) {
        console.log(`[guildhall] Stop requested after tick ${tick}. Shutting down.`)
        break
      }

      // FR-28: an external tool (systemd, remote operator, another guildhall
      // process) may write the marker file directly. Treat it the same as an
      // in-memory stopSignal flip so operators don't need signal delivery.
      if (isStopRequested(path.join(this.opts.config.projectPath, 'memory'))) {
        console.log(`[guildhall] Stop marker detected after tick ${tick}. Shutting down.`)
        if (this.opts.stopSignal) this.opts.stopSignal.stopRequested = true
        break
      }

      await sleep(tickDelayMs)
    }

    console.log(`[guildhall] Orchestrator stopped after ${tick} ticks.`)

    // FR-18: SESSION_END fires after the loop exits for any reason (idle
    // shutdown, all-done, max-ticks). We do not honor a `blocked` result here
    // because the session is already ending — hooks are advisory at this point.
    if (this.opts.hookExecutor != null) {
      await this.opts.hookExecutor.execute(HookEvent.SESSION_END, {
        event: HookEvent.SESSION_END,
        workspaceId: this.opts.config.workspaceId,
        ticks: tick,
      })
    }
  }

  /**
   * FR-31: scan the queue for agent-issue entries that have not yet been
   * broadcast, flip them to `broadcast=true`, and return them. Callers
   * (the run loop, serve layer, test harness) convert each one into an
   * `agent_issue` backend event via `agentIssueToBackendEvent`.
   *
   * Deliberately a separate channel from `tick()` outcomes: an issue does
   * NOT alter the task's status, so there is no lifecycle transition to
   * piggyback on, and multiple issues may surface across multiple tasks in
   * a single tick cycle.
   */
  /**
   * FR-32: collect every pending remediation trigger across the three
   * signal sources: FR-30 stall flags, FR-31 unresolved agent issues, and
   * FR-33 reclaim candidates. Deduplicated by (kind, taskId, agentId) so a
   * task that is simultaneously stalled AND has an open issue surfaces both
   * as distinct triggers (the coordinator may want to treat them
   * differently).
   *
   * Pure w.r.t. task state — does not mutate the queue or the tracker.
   */
  async collectRemediationTriggers(
    nowMs: number = Date.now(),
  ): Promise<RemediationTrigger[]> {
    const queue = await this.readQueue()
    const triggers: RemediationTrigger[] = []

    // FR-30 stalls
    for (const flag of this.livenessTracker.scanStalls(nowMs)) {
      triggers.push({
        kind: 'stall',
        taskId: flag.taskId,
        agentId: flag.agentId,
        flag,
      })
    }

    // FR-31 unresolved agent issues. Every open issue is a trigger — the
    // coordinator decides whether to act on each. The `broadcast` flag is
    // separate (it governs FR-16 wire-event emission, not remediation).
    for (const task of queue.tasks) {
      for (const issue of task.agentIssues) {
        if (issue.resolvedAt) continue
        triggers.push({
          kind: 'issue',
          taskId: task.id,
          agentId: issue.agentId,
          issue,
        })
      }
    }

    // FR-33 reclaim candidates
    const liveIds = this.livenessTracker.snapshot().map((e) => e.agentId)
    const stranded = findReclaimTasks(queue, liveIds)
    const candidates = await loadReclaimCandidates(
      this.opts.config.memoryDir,
      stranded,
      nowMs,
    )
    for (const cand of candidates) {
      triggers.push({
        kind: 'crash',
        taskId: cand.task.id,
        // A crashed task's best-effort agent id is its assignee; may be ''
        // if the task was picked up but the orchestrator never stamped an
        // assignee (edge case — coordinator can still decide).
        agentId: cand.task.assignedTo ?? '',
        candidate: cand,
      })
    }

    return triggers
  }

  /**
   * FR-32: build a remediation context for a single trigger. Pulls the
   * lever positions, the last durable checkpoint, and the prior-attempt
   * count off the task. The coordinator agent is invoked with this as its
   * input prompt in a subsequent step (that wiring lives in the serve
   * layer where the full coordinator-agent loop runs).
   */
  async buildRemediationContextFor(
    trigger: RemediationTrigger,
  ): Promise<RemediationContext> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((t) => t.id === trigger.taskId)
    if (!task) {
      throw new Error(
        `buildRemediationContextFor: task ${trigger.taskId} not on queue`,
      )
    }
    const checkpoint =
      trigger.kind === 'crash'
        ? trigger.candidate.checkpoint
        : await readCheckpoint(this.opts.config.memoryDir, task.id)

    const settings = await this.readLeverSettings()
    const domainLevers = resolveDomainLevers(settings, task.domain)

    return buildRemediationContext({
      trigger,
      task,
      levers: {
        remediationAutonomy: settings.project.remediation_autonomy.position,
        crashRecoveryDefault: domainLevers.crash_recovery_default.position,
        agentHealthStrictness: settings.project.agent_health_strictness.position,
      },
      checkpoint,
      priorAttempts: task.remediationAttempts,
      now: this.now(),
    })
  }

  /**
   * FR-32: authorize a coordinator-chosen action against the
   * `remediation_autonomy` lever + FR-33 24h auto-escalation. Pure — does
   * not execute or record.
   */
  authorizeRemediation(
    action: RemediationAction,
    context: RemediationContext,
  ): AuthorizationDecision {
    return authorizeAction(
      action,
      context.leverState.remediationAutonomy,
      context.trigger,
    )
  }

  /**
   * FR-32: persist a remediation decision to DECISIONS.md (per AC-24) and
   * bump the task's `remediationAttempts` counter. Called whether the
   * action was executed autonomously OR is pending human confirmation —
   * the decision itself is always recorded.
   *
   * This is deliberately orthogonal to action execution. Callers that do
   * execute (e.g. flipping the task to blocked for `escalate_to_human`)
   * invoke those side effects separately.
   */
  async recordRemediation(input: {
    context: RemediationContext
    action: RemediationAction
    authorization: AuthorizationDecision
    decidedBy: string
  }): Promise<void> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((t) => t.id === input.context.taskId)
    if (!task) {
      throw new Error(
        `recordRemediation: task ${input.context.taskId} not on queue`,
      )
    }
    await recordRemediationDecision({
      decisionsPath: this.decisionsPath(),
      context: input.context,
      action: input.action,
      authorization: input.authorization,
      decidedBy: input.decidedBy,
      domain: task.domain,
    })
    task.remediationAttempts = (task.remediationAttempts ?? 0) + 1
    task.updatedAt = this.now()
    queue.lastUpdated = this.now()
    await this.writeQueue(queue)
  }

  /**
   * FR-33: scan the queue for reclaim candidates — tasks in
   * `in_progress`/`review`/`gate_check` whose assigned agent is not in the
   * liveness tracker's live set. Returns each with its last durable
   * checkpoint (or null) and an `autoEscalate` flag for checkpoints older
   * than 24h.
   *
   * Pure w.r.t. task state: does not mutate the queue. The caller (FR-32
   * remediation loop) decides what to do with each candidate.
   */
  async scanReclaimCandidates(nowMs: number = Date.now()): Promise<ReclaimCandidate[]> {
    const queue = await this.readQueue()
    const liveIds = this.livenessTracker.snapshot().map((e) => e.agentId)
    const stranded = findReclaimTasks(queue, liveIds)
    return loadReclaimCandidates(this.opts.config.memoryDir, stranded, nowMs)
  }

  async drainPendingIssues(): Promise<AgentIssue[]> {
    const queue = await this.readQueue()
    const drained: AgentIssue[] = []
    let mutated = false

    for (const task of queue.tasks) {
      for (const issue of task.agentIssues) {
        if (!issue.broadcast && !issue.resolvedAt) {
          issue.broadcast = true
          drained.push(issue)
          mutated = true
        }
      }
    }

    if (mutated) {
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)
    }

    return drained
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private selectAgent(task: Task):
    | { kind: 'agent'; agent: OrchestratorAgent; promptSuffix: string }
    | { kind: 'no-coordinator' } {
    if (
      task.id !== META_INTAKE_TASK_ID &&
      (task.status === 'ready' || task.status === 'in_progress') &&
      !task.spec?.trim()
    ) {
      return {
        kind: 'agent',
        agent: this.opts.agents.spec,
        promptSuffix:
          "This task advanced without a saved spec. Do not implement it yet. " +
          "Write the implementation spec into the task spec via update-task, then set status to 'spec_review' so the coordinator can review it.",
      }
    }

    switch (task.status) {
      case 'exploring':
        return {
          kind: 'agent',
          agent: this.opts.agents.spec,
          promptSuffix:
            "Drive the conversational intake (FR-12): elicit outcome, numbered acceptance criteria, " +
            "out-of-scope list, happy path + edge cases, domain routing, blast radius, required skills, " +
            "and escalation triggers. When the spec is complete and the user approves, use the " +
            "update-task tool to set status to 'spec_review'.",
        }
      case 'spec_review': {
        if (!task.spec?.trim()) {
          return {
            kind: 'agent',
            agent: this.opts.agents.spec,
            promptSuffix:
              task.id === META_INTAKE_TASK_ID
                ? "The meta-intake task reached spec_review, but its spec field is empty. " +
                  "Write the full coordinator, lever, and bootstrap YAML draft into the task spec via update-task. " +
                  "If you emit the draft in your final text, include all YAML fences so the orchestrator can recover it."
                : "This task reached spec_review, but its spec field is empty. " +
                  "Write the implementation spec into the task spec via update-task before any coordinator or worker proceeds. " +
                  "Do not transition out of spec_review until the spec field is populated.",
          }
        }
        const coord = this.opts.agents.coordinators[task.domain]
        if (!coord) return { kind: 'no-coordinator' }
        return {
          kind: 'agent',
          agent: coord,
          promptSuffix:
            "Review this spec against your domain concerns. If approved, transition to 'ready'. " +
            "Otherwise, add a note explaining the required revision and set status back to 'exploring'.",
        }
      }
      case 'ready': {
        const coord = this.opts.agents.coordinators[task.domain]
        if (!coord) return { kind: 'no-coordinator' }
        return {
          kind: 'agent',
          agent: coord,
          promptSuffix:
            "Assign this task to the worker agent, set assignedTo='worker-agent', and transition status to 'in_progress'.",
        }
      }
      case 'in_progress':
        return {
          kind: 'agent',
          agent: this.opts.agents.worker,
          promptSuffix:
            "Implement this task per the spec. Write a self-critique note when done, then transition status to 'review'.",
        }
      case 'review':
        return {
          kind: 'agent',
          agent: this.opts.agents.reviewer,
          promptSuffix:
            "Review the completed work against the acceptance criteria. " +
            "Transition to 'gate_check' if approved, else 'in_progress' with a note listing required revisions.",
        }
      case 'gate_check':
        return {
          kind: 'agent',
          agent: this.opts.agents.gateChecker,
          promptSuffix:
            "Run all hard gates for this task and record their results. " +
            "If all pass, transition to 'done'; else 'in_progress' with the failing gate output.",
        }
      default:
        // done / blocked are terminal; pickNextTask should never return them
        return {
          kind: 'agent',
          agent: this.opts.agents.worker,
          promptSuffix: 'No action required.',
        }
    }
  }

  /**
   * FR-21: apply the `task_origination` lever to an agent-proposed task and
   * write the resulting transition to TASKS.json + PROGRESS.md. No LLM call.
   *
   * - `human_only`                         → shelve (not_viable)
   * - `agent_proposed_human_approved`      → spec_review (human approves)
   * - `agent_proposed_coordinator_approved`→ spec_review (coordinator approves)
   * - `agent_autonomous`                   → ready
   *
   * Malformed lever settings surface as an `agent-error` outcome — the caller
   * treats them like any other run-blocking problem and the task stays in
   * `proposed` until the file is fixed.
   */
  private async decideProposal(task: Task, queue: TaskQueue): Promise<TickOutcome> {
    let levers: DomainLevers
    try {
      const settingsPath = path.join(this.opts.config.memoryDir, AGENT_SETTINGS_FILENAME)
      const settings = await loadLeverSettings({ path: settingsPath })
      levers = resolveDomainLevers(settings, task.domain)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: PROPOSAL_PROMOTER_AGENT_ID,
        error: `failed to load lever settings: ${message}`,
      }
    }

    const decision = evaluateProposal({
      task,
      levers: { task_origination: levers.task_origination },
    })

    const now = this.now()
    const idx = queue.tasks.findIndex((t) => t.id === task.id)
    const target = queue.tasks[idx]!
    let newStatus: TaskStatus

    switch (decision.action.kind) {
      case 'reject':
        target.status = 'shelved'
        target.shelveReason = {
          code: 'not_viable',
          detail: decision.action.reason,
          rejectedBy: `system:${PROPOSAL_PROMOTER_AGENT_ID}`,
          rejectedAt: now,
          // Policy rejections are truly terminal — tag the source so the
          // pre_rejection_policy loop doesn't try to resurrect them, and
          // pre-mark the decision as applied.
          source: 'proposal_policy',
          policyApplied: true,
          requeueCount: 0,
        }
        target.completedAt = now
        newStatus = 'shelved'
        break
      case 'route_to_human':
      case 'route_to_coordinator':
        target.status = 'spec_review'
        newStatus = 'spec_review'
        break
      case 'auto_promote':
        target.status = 'ready'
        newStatus = 'ready'
        break
    }
    target.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)

    const progressEntry: ProgressEntry = {
      timestamp: now,
      agentId: PROPOSAL_PROMOTER_AGENT_ID,
      domain: task.domain,
      taskId: task.id,
      summary:
        `Proposal ${task.id}: proposed → ${newStatus} ` +
        `(${decision.action.kind}, lever=${String(decision.leverPosition)}). ` +
        decision.rationale,
      type: 'heartbeat',
    }
    try {
      await logProgress({ progressPath: this.progressPath(), entry: progressEntry })
    } catch {
      // PROGRESS.md unwriteable — non-fatal
    }

    return {
      kind: 'proposal-decided',
      taskId: task.id,
      actionKind: decision.action.kind,
      leverPosition: decision.leverPosition,
      newStatus,
    }
  }

  private async recoverMetaIntakeDraftFromSpecSession(task: Task): Promise<TickOutcome | null> {
    const snapshot = loadSessionById(
      this.opts.config.projectPath,
      `${this.opts.config.workspaceId}-spec`,
    )
    if (!snapshot) return null
    const taskCreatedMs = Date.parse(task.createdAt)
    const snapshotCreatedMs = snapshot.created_at * 1000
    if (
      Number.isFinite(taskCreatedMs) &&
      Number.isFinite(snapshotCreatedMs) &&
      snapshotCreatedMs < taskCreatedMs
    ) {
      return null
    }
    const draft = findMetaIntakeDraftText({
      text: '',
      messages: snapshot.messages,
    })
    if (!draft) return null

    const queue = await this.readQueue()
    const target = queue.tasks.find((t) => t.id === task.id)
    if (!target || target.spec) return null

    const beforeStatus = target.status
    target.spec = draft
    if (target.status === 'exploring') target.status = 'spec_review'
    target.updatedAt = this.now()
    queue.lastUpdated = this.now()
    await this.writeQueue(queue)

    await this.logTickProgress({
      task: target,
      agent: 'spec-agent',
      beforeStatus,
      afterStatus: target.status,
      transitioned: beforeStatus !== target.status,
      note: 'recovered meta-intake draft from saved spec-agent session',
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: 'spec-agent',
      beforeStatus,
      afterStatus: target.status,
      transitioned: beforeStatus !== target.status,
      revisionCount: target.revisionCount,
    }
  }

  /**
   * FR-22: apply `pre_rejection_policy` (domain) + `rejection_dampening`
   * (project) to a worker-shelved task. Either keeps the task shelved (mark
   * `policyApplied`) or resurrects it to `ready` at a possibly-lowered
   * priority. Always increments `requeueCount` so dampening thresholds fire
   * on repeat rejections.
   */
  private async applyPreRejectionPolicy(
    task: Task,
    queue: TaskQueue,
  ): Promise<TickOutcome> {
    let domainLevers: DomainLevers
    let projectLevers: ProjectLevers
    try {
      const settingsPath = path.join(this.opts.config.memoryDir, AGENT_SETTINGS_FILENAME)
      const settings = await loadLeverSettings({ path: settingsPath })
      domainLevers = resolveDomainLevers(settings, task.domain)
      projectLevers = settings.project
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: PRE_REJECTION_POLICY_AGENT_ID,
        error: `failed to load lever settings: ${message}`,
      }
    }

    const decision = evaluatePreRejection({
      currentRequeueCount: task.shelveReason?.requeueCount ?? 0,
      currentPriority: task.priority,
      domain: { pre_rejection_policy: domainLevers.pre_rejection_policy },
      project: { rejection_dampening: projectLevers.rejection_dampening },
    })

    const now = this.now()
    const idx = queue.tasks.findIndex((t) => t.id === task.id)
    const target = queue.tasks[idx]!
    const prevReason = target.shelveReason!
    let newStatus: TaskStatus

    switch (decision.action.kind) {
      case 'keep_shelved':
        target.shelveReason = {
          ...prevReason,
          policyApplied: true,
          requeueCount: decision.requeueCount,
        }
        if (!target.completedAt) target.completedAt = now
        newStatus = 'shelved'
        break
      case 'requeue':
        target.status = 'ready'
        target.priority = decision.action.newPriority
        // Preserve the shelve history on the task — mark it applied and
        // bump the requeue count so subsequent dampening reads are correct,
        // but leave the record in place for audit. completedAt is cleared
        // since the task is no longer terminal.
        target.shelveReason = {
          ...prevReason,
          policyApplied: true,
          requeueCount: decision.requeueCount,
        }
        target.completedAt = undefined
        newStatus = 'ready'
        break
    }
    target.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)

    const domainPos = String(decision.domainLeverPosition)
    const projectPos =
      typeof decision.projectLeverPosition === 'string'
        ? decision.projectLeverPosition
        : `${decision.projectLeverPosition.kind}${
            'after' in decision.projectLeverPosition
              ? `(after=${decision.projectLeverPosition.after})`
              : ''
          }`

    const progressEntry: ProgressEntry = {
      timestamp: now,
      agentId: PRE_REJECTION_POLICY_AGENT_ID,
      domain: task.domain,
      taskId: task.id,
      summary:
        `Pre-rejection policy: shelved → ${newStatus} ` +
        `(${decision.action.kind}, pre_rejection_policy=${domainPos}, ` +
        `rejection_dampening=${projectPos}, requeueCount=${decision.requeueCount}). ` +
        decision.action.reason,
      type: 'heartbeat',
    }
    try {
      await logProgress({ progressPath: this.progressPath(), entry: progressEntry })
    } catch {
      // PROGRESS.md unwriteable — non-fatal
    }

    return {
      kind: 'pre-rejection-applied',
      taskId: task.id,
      actionKind: decision.action.kind,
      domainLeverPosition: decision.domainLeverPosition,
      projectLeverPosition: decision.projectLeverPosition,
      newStatus,
      requeueCount: decision.requeueCount,
    }
  }

  private tasksPath(): string {
    return path.join(this.opts.config.memoryDir, 'TASKS.json')
  }

  private progressPath(): string {
    return path.join(this.opts.config.memoryDir, 'PROGRESS.md')
  }

  private decisionsPath(): string {
    return path.join(this.opts.config.memoryDir, 'DECISIONS.md')
  }

  /**
   * FR-32 helper: read agent-settings.yaml. Throws if missing — the
   * remediation loop requires real lever state to route authorization
   * decisions correctly (unlike stall scanning which can fall back to
   * 'standard' strictness).
   */
  private async readLeverSettings() {
    const settingsPath = path.join(
      this.opts.config.memoryDir,
      AGENT_SETTINGS_FILENAME,
    )
    return await loadLeverSettings({ path: settingsPath })
  }

  /**
   * FR-27 / AC-18: resolve the `reviewer_mode` for a domain. Any read error
   * (missing file, malformed YAML, unknown domain) falls back to `llm_only`
   * — the conservative default: a silent switch to `deterministic_only`
   * would skip real LLM review, which is strictly worse than falling back
   * to the existing LLM path.
   */
  private async resolveReviewerMode(domain: string): Promise<ReviewerMode> {
    try {
      const settings = await this.readLeverSettings()
      const domainLevers = resolveDomainLevers(settings, domain)
      return domainLevers.reviewer_mode.position as ReviewerMode
    } catch {
      return 'llm_only'
    }
  }

  /**
   * Resolve the `reviewer_fanout_policy` for a domain. Fan-out aggregation
   * uses this to decide how dissents roll up into the task-level verdict
   * (strict, advisory, majority) and whether to flag conflicts for
   * coordinator adjudication. Falls back to `strict` on any read error —
   * the conservative default, matching today's behavior before the lever
   * landed.
   */
  private async resolveReviewerFanoutPolicy(
    domain: string,
  ): Promise<ReviewerFanoutPolicy> {
    try {
      const settings = await this.readLeverSettings()
      const domainLevers = resolveDomainLevers(settings, domain)
      return domainLevers.reviewer_fanout_policy
        .position as ReviewerFanoutPolicy
    } catch {
      return 'strict'
    }
  }

  /**
   * FR-27 / AC-18: apply a deterministic reviewer verdict directly to the
   * queue. Used by the `deterministic_only` mode and by the
   * `llm_with_deterministic_fallback` mode after an LLM outage. Writes the
   * queue, logs a PROGRESS entry, and returns a `processed` TickOutcome.
   *
   * Revision-count bookkeeping is preserved: a `revise` verdict that bounces
   * the task back to `in_progress` bumps `revisionCount` just like the LLM
   * path does, and we enforce `maxRevisions` the same way.
   */
  /**
   * Guild deterministic-check pre-pass at `gate_check`. Runs the applicable
   * guilds' pure-function checks (e.g. WCAG contrast matrix, OKLab near-
   * duplicate scan), appends each result to `task.gateResults` as a `soft`
   * gate, and — if any failed — short-circuits to `in_progress` with
   * aggregated feedback. Returns `null` when no action was taken (all
   * passed, or no applicable guild checks), letting the caller fall
   * through to the normal shell-gate LLM dispatch.
   */
  private async runGuildGatesInline(
    task: Task,
    _queueBefore: TaskQueue,
  ): Promise<TickOutcome | null> {
    const designSystem = await loadDesignSystem(this.opts.config.memoryDir).catch(
      () => undefined,
    )
    const { guilds: roster } = loadProjectGuildRoster(this.opts.config.memoryDir)
    const gateOutcome = await runGuildGates({
      task,
      signals: {
        task,
        designSystem,
        memoryDir: this.opts.config.memoryDir,
        projectPath: task.projectPath,
      },
      now: this.now(),
      roster,
    })

    // No applicable checks ran → nothing to decide; let the shell-gate pass proceed.
    if (gateOutcome.gateResults.length === 0) return null

    // Persist the guild gate results regardless of pass/fail. This happens
    // under the queue write lock so concurrent fanout dispatches serialize.
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const t = queue.tasks.find((x) => x.id === task.id)
      if (!t) return null
      t.gateResults.push(...gateOutcome.gateResults)
      t.updatedAt = this.now()
      queue.lastUpdated = this.now()

      if (gateOutcome.allPassed) {
        await this.writeQueue(queue)
        await this.logTickProgress({
          task: t,
          agent: 'guild-gate-runner',
          beforeStatus,
          afterStatus: t.status,
          transitioned: false,
          note: `guild gates passed (${gateOutcome.gateResults.length} check${gateOutcome.gateResults.length === 1 ? '' : 's'})`,
        })
        // Passed → fall through to the shell-gate agent.
        return null
      }

      // Any guild gate failed → bounce to in_progress with aggregated feedback.
      const failed = gateOutcome.gateResults.filter((g) => !g.passed)
      const feedback = [
        `**Guild gates failed (${failed.length}):**`,
        ...failed.map((g) => `- \`${g.gateId}\`: ${(g.output ?? '').split('\n')[0] ?? 'failed'}`),
      ].join('\n')
      t.notes.push({
        agentId: 'guild-gate-runner',
        role: 'gate-checker',
        content: feedback,
        timestamp: this.now(),
      })
      t.status = 'in_progress'
      t.revisionCount += 1
      t.updatedAt = this.now()
      queue.lastUpdated = this.now()

      // Enforce maxRevisions the same way the reviewer path does.
      if (t.revisionCount > this.opts.config.maxRevisions) {
        await this.writeQueue(queue)
        await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: 'guild-gate-runner',
          reason: 'max_revisions_exceeded',
          summary:
            `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
            `Guild gates keep failing.`,
          details: feedback,
        })
        return {
          kind: 'blocked-max-revisions',
          taskId: task.id,
          revisionCount: t.revisionCount,
        } as TickOutcome
      }

      await this.writeQueue(queue)
      await this.logTickProgress({
        task: t,
        agent: 'guild-gate-runner',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `guild gates failed (${failed.length}) → in_progress`,
      })
      return {
        kind: 'processed',
        taskId: task.id,
        agent: 'guild-gate-runner',
        beforeStatus,
        afterStatus: 'in_progress',
      } as TickOutcome
    })
  }

  /**
   * Capture the current handoff step's worker note, record its completion
   * timestamp, advance `handoffStep`, and revert status to `in_progress`
   * so the next specialist picks up on the next tick. Only called when
   * `hasPendingHandoffStep(task)` is true; the final step falls through
   * to the normal reviewer fan-out.
   */
  private async advanceHandoffStepInline(
    task: Task,
  ): Promise<TickOutcome | null> {
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const t = queue.tasks.find((x) => x.id === task.id)
      if (!t || !t.handoffSequence) return null
      const idx = t.handoffStep ?? 0
      const currentStep = t.handoffSequence[idx]
      if (!currentStep) return null
      const nextStep = t.handoffSequence[idx + 1]
      if (!nextStep) return null // guarded by hasPendingHandoffStep but safe

      const now = this.now()
      const handoffNote = extractHandoffNote(t)
      // Clone the step shape — zod `.default([])` nested shapes can't be
      // partially mutated without TypeScript's exactOptionalPropertyTypes
      // complaining, so we rebuild the step.
      t.handoffSequence = t.handoffSequence.map((s, i) =>
        i === idx
          ? {
              ...s,
              completedAt: now,
              ...(handoffNote ? { handoffNote } : {}),
            }
          : s,
      )
      t.handoffStep = idx + 1
      t.status = 'in_progress'
      t.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      await this.logTickProgress({
        task: t,
        agent: 'handoff-orchestrator',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `handoff step ${idx + 1}/${t.handoffSequence.length} (${currentStep.agent}) → step ${idx + 2} (${nextStep.agent})`,
      })
      return {
        kind: 'processed',
        taskId: task.id,
        agent: 'handoff-orchestrator',
        beforeStatus,
        afterStatus: 'in_progress',
      } as TickOutcome
    })
  }

  /**
   * Reviewer fan-out pre-pass at `review`. Runs each applicable reviewer
   * persona through `opts.reviewerFanout` and aggregates their verdicts
   * strict-all: any `revise` bounces the task back to `in_progress` with
   * combined feedback. All approvals advance the task to `gate_check`.
   *
   * Returns `null` when no reviewer personas apply OR no runner is
   * configured — the caller falls through to the legacy single-reviewer
   * dispatch.
   */
  private async runReviewerFanoutInline(
    task: Task,
    _queueBefore: TaskQueue,
  ): Promise<TickOutcome | null> {
    const runner = this.opts.reviewerFanout
    if (!runner) return null

    const designSystem = await loadDesignSystem(this.opts.config.memoryDir).catch(
      () => undefined,
    )
    const { guilds: roster } = loadProjectGuildRoster(this.opts.config.memoryDir)
    const applicable = selectApplicableGuilds(
      {
        task,
        designSystem,
        memoryDir: this.opts.config.memoryDir,
        projectPath: task.projectPath,
      },
      roster,
    )
    const personas = reviewersForTask(applicable)
    if (personas.length === 0) return null

    // Build the JIT context once; every persona sees the same facts.
    const ctx = await buildContext(task, this.opts.config.memoryDir)

    let verdicts: PersonaVerdict[]
    try {
      verdicts = await runner({
        task,
        personas,
        context: ctx.formatted,
        memoryDir: this.opts.config.memoryDir,
        projectPath: task.projectPath,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.logTickProgress({
        task,
        agent: 'reviewer-fanout',
        beforeStatus: 'review',
        afterStatus: 'review',
        transitioned: false,
        note: `reviewer fan-out failed: ${message} — falling through to single reviewer`,
      })
      return null
    }
    if (verdicts.length === 0) return null

    // Policy selection + prior-rounds extraction for same-persona-repeat
    // dissent detection. When the lever is
    // `coordinator_adjudicates_on_conflict`, `aggregate.needsAdjudication`
    // may flip true — we branch on it below.
    const policy = await this.resolveReviewerFanoutPolicy(task.domain)
    const priorRounds = extractPriorVerdictRounds(task.reviewVerdicts)
    const aggregate = aggregateFanout(verdicts, { policy, priorRounds })
    const beforeStatus = task.status

    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const t = queue.tasks.find((x) => x.id === task.id)
      if (!t) return null

      // Persist one ReviewVerdict per persona — the audit trail shows which
      // expert agreed and which objected.
      const now = this.now()
      for (const v of verdicts) {
        t.reviewVerdicts.push(personaVerdictToReviewRecord(v, { now }))
      }

      // Under `coordinator_adjudicates_on_conflict`, recurrent same-persona
      // dissent short-circuits to the domain coordinator instead of looping
      // the worker. The worker will re-enter in_progress only after the
      // coordinator lands a binding AdjudicationRecord with scoped
      // instructions.
      if (aggregate.needsAdjudication) {
        const adjudicationOutcome = await this.routeToCoordinatorAdjudication({
          queue,
          task: t,
          aggregate,
          verdicts,
          round: priorRounds.length + 1,
          now,
          beforeStatus,
        })
        if (adjudicationOutcome) return adjudicationOutcome
        // If routing failed (no coordinator, etc.), fall through to the
        // default revise path so the system stays conservative.
      }

      if (aggregate.verdict === 'approve') {
        t.status = 'gate_check'
        t.updatedAt = now
        queue.lastUpdated = now
        await this.writeQueue(queue)
        await this.logTickProgress({
          task: t,
          agent: 'reviewer-fanout',
          beforeStatus,
          afterStatus: 'gate_check',
          transitioned: true,
          note: `fan-out approve (${verdicts.length} persona${verdicts.length === 1 ? '' : 's'})`,
        })
        return {
          kind: 'processed',
          taskId: task.id,
          agent: 'reviewer-fanout',
          beforeStatus,
          afterStatus: 'gate_check',
        } as TickOutcome
      }

      // Aggregate says revise — append combined feedback, bump revisionCount,
      // enforce maxRevisions.
      t.notes.push({
        agentId: 'reviewer-fanout',
        role: 'reviewer',
        content: aggregate.combinedFeedback,
        timestamp: now,
      })
      t.status = 'in_progress'
      t.revisionCount += 1
      t.updatedAt = now
      queue.lastUpdated = now

      if (t.revisionCount > this.opts.config.maxRevisions) {
        await this.writeQueue(queue)
        await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: 'reviewer-fanout',
          reason: 'max_revisions_exceeded',
          summary:
            `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
            `Reviewer fan-out keeps rejecting.`,
          details: aggregate.combinedFeedback,
        })
        return {
          kind: 'blocked-max-revisions',
          taskId: task.id,
          revisionCount: t.revisionCount,
        } as TickOutcome
      }

      await this.writeQueue(queue)
      await this.logTickProgress({
        task: t,
        agent: 'reviewer-fanout',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `fan-out revise (dissenters: ${aggregate.dissenting.map((d) => d.guildSlug).join(', ')})`,
      })
      return {
        kind: 'processed',
        taskId: task.id,
        agent: 'reviewer-fanout',
        beforeStatus,
        afterStatus: 'in_progress',
      } as TickOutcome
    })
  }

  /**
   * Route a fan-out aggregate with `needsAdjudication: true` to the domain
   * coordinator. The coordinator receives the verdict set + dissent
   * transcript, produces a binding AdjudicationRecord (appended to
   * `task.adjudications`), and either:
   *   - Advances the task to `gate_check` with superseded dissenters
   *     recorded (coordinator resolved the conflict in favor of approving
   *     the work).
   *   - Bounces to `in_progress` with the coordinator's `scopeInstructions`
   *     as the worker prompt, rather than the raw dissent (worker cannot
   *     relitigate; it executes within the adjudicated scope).
   *   - Raises an escalation if the coordinator cannot decide
   *     autonomously under the current `remediation_autonomy` posture.
   *
   * This method builds the record deterministically from the aggregate; the
   * live coordinator LLM pass will be layered on later (FR-32 remediation
   * loop extension). For now we record a deterministic "keep the dissent's
   * scoped instructions, mark recurrent-dissent as the trigger" decision
   * and bounce to the worker with those instructions — which is still a
   * meaningful improvement: the worker's prompt is the specific list of
   * changes, not the full conflict transcript.
   */
  private async routeToCoordinatorAdjudication(input: {
    queue: TaskQueue
    task: Task
    aggregate: ReturnType<typeof aggregateFanout>
    verdicts: readonly PersonaVerdict[]
    round: number
    now: string
    beforeStatus: TaskStatus
  }): Promise<TickOutcome | null> {
    const coord = this.opts.agents.coordinators[input.task.domain]
    const coordinatorId = coord?.name ?? 'coordinator-default'

    // For v1: the deterministic adjudication record. Every dissenter is
    // recorded as a "winning concern" (we treat all dissents as load-
    // bearing until an LLM coordinator pass overrides). The worker gets
    // scoped instructions = the union of dissent revision items, framed as
    // the coordinator's decision.
    const dissenterSlugs = input.aggregate.dissenting.map(d => d.guildSlug)
    const scopeInstructions: string[] = []
    for (const d of input.aggregate.dissenting) {
      for (const item of d.revisionItems) {
        if (!scopeInstructions.includes(item)) scopeInstructions.push(item)
      }
    }

    const rationale = [
      `Reviewer fan-out round ${input.round} produced recurring dissent from`,
      `${dissenterSlugs.join(', ')}. Policy \`coordinator_adjudicates_on_`,
      `conflict\` routes to the domain coordinator (${input.task.domain}).`,
      '',
      'Decision (deterministic v1): keep each dissenting persona\'s scoped',
      'instructions. Worker executes the scoped list; the dissent transcript',
      'is NOT in the worker prompt so the worker cannot relitigate.',
    ].join('\n')

    const adjudication: AdjudicationRecord = {
      round: input.round,
      trigger: input.aggregate.adjudicationTrigger ?? 'same_persona_repeat_dissent',
      dissenters: dissenterSlugs,
      winningConcerns: dissenterSlugs,
      supersededConcerns: [],
      summary: `Coordinator adjudicated: worker to address ${scopeInstructions.length} scoped item${scopeInstructions.length === 1 ? '' : 's'} from ${dissenterSlugs.join(', ')}`,
      rationale,
      scopeInstructions,
      decidedBy: 'coordinator',
      decidedAt: input.now,
    }
    input.task.adjudications.push(adjudication)

    // Write a DECISIONS.md entry capturing the adjudication so the audit
    // trail lives outside TASKS.json too.
    const decisionsPath = path.join(this.opts.config.memoryDir, 'DECISIONS.md')
    const decisionEntry = [
      `### ${input.now} — Reviewer fan-out adjudication`,
      '',
      `**Task:** ${input.task.id}`,
      `**Domain:** ${input.task.domain}`,
      `**Coordinator:** ${coordinatorId}`,
      `**Trigger:** ${adjudication.trigger} (round ${adjudication.round})`,
      `**Dissenters:** ${dissenterSlugs.join(', ') || 'none'}`,
      '',
      '**Rationale:**',
      rationale,
      '',
      '**Scoped instructions to worker:**',
      ...scopeInstructions.map(i => `- ${i}`),
      '',
      '---',
      '',
    ].join('\n')
    try {
      await fs.appendFile(decisionsPath, decisionEntry, 'utf8')
    } catch {
      // Appending to DECISIONS.md is best-effort; the task-level record is
      // the load-bearing trail.
    }

    // Build the worker's next prompt from scope instructions only.
    const scopedFeedback = [
      `**Coordinator adjudication (round ${adjudication.round}):**`,
      '',
      adjudication.summary,
      '',
      '**Scoped instructions (address exactly these items):**',
      ...scopeInstructions.map(i => `- ${i}`),
    ].join('\n')

    input.task.notes.push({
      agentId: coordinatorId,
      role: 'coordinator',
      content: scopedFeedback,
      timestamp: input.now,
    })
    input.task.status = 'in_progress'
    input.task.revisionCount += 1
    input.task.updatedAt = input.now
    input.queue.lastUpdated = input.now

    // maxRevisions still caps: if the coordinator keeps having to adjudicate,
    // escalate to human.
    if (input.task.revisionCount > this.opts.config.maxRevisions) {
      await this.writeQueue(input.queue)
      await raiseEscalation({
        tasksPath: this.tasksPath(),
        progressPath: this.progressPath(),
        taskId: input.task.id,
        agentId: coordinatorId,
        reason: 'max_revisions_exceeded',
        summary:
          `Adjudicated ${input.task.revisionCount} times (maxRevisions=${this.opts.config.maxRevisions}). ` +
          `Coordinator cannot resolve; escalating.`,
        details: rationale,
      })
      return {
        kind: 'blocked-max-revisions',
        taskId: input.task.id,
        revisionCount: input.task.revisionCount,
      } as TickOutcome
    }

    await this.writeQueue(input.queue)
    await this.logTickProgress({
      task: input.task,
      agent: coordinatorId,
      beforeStatus: input.beforeStatus,
      afterStatus: 'in_progress',
      transitioned: true,
      note: `coordinator adjudicated (dissenters: ${dissenterSlugs.join(', ')}) → scoped rework`,
    })
    return {
      kind: 'processed',
      taskId: input.task.id,
      agent: coordinatorId,
      beforeStatus: input.beforeStatus,
      afterStatus: 'in_progress',
    } as TickOutcome
  }

  private async applyReviewVerdictInline(opts: {
    task: Task
    queue: TaskQueue
    llmError: string | undefined
  }): Promise<TickOutcome> {
    const { task, queue, llmError } = opts
    const beforeStatus = task.status
    const verdict = deterministicReview(task)
    const { newStatus } = applyDeterministicVerdict({
      queue,
      taskId: task.id,
      verdict,
      now: this.now(),
      ...(llmError !== undefined ? { llmError } : {}),
    })

    const taskAfter = queue.tasks.find((t) => t.id === task.id)!
    const transitioned = beforeStatus !== newStatus
    const agentId = llmError
      ? 'reviewer-deterministic-fallback'
      : 'reviewer-deterministic'

    // Revision counting mirrors the LLM path: review → in_progress is a revise.
    let revisionCount = taskAfter.revisionCount
    if (newStatus === 'in_progress') {
      revisionCount = taskAfter.revisionCount + 1
      taskAfter.revisionCount = revisionCount
      taskAfter.updatedAt = this.now()
      queue.lastUpdated = this.now()

      if (revisionCount > this.opts.config.maxRevisions) {
        await this.writeQueue(queue)
        await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId,
          reason: 'max_revisions_exceeded',
          summary:
            `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
            `Requires human judgment.`,
          details:
            `Deterministic reviewer bounced the task to in_progress ` +
            `${revisionCount} times. Last reason: ${verdict.reason}.`,
        })
        return {
          kind: 'blocked-max-revisions',
          taskId: task.id,
          revisionCount,
        }
      }
    }

    await this.writeQueue(queue)
    await this.logTickProgress({
      task: taskAfter,
      agent: agentId,
      beforeStatus,
      afterStatus: newStatus,
      transitioned,
      note: llmError
        ? `deterministic fallback (LLM error: ${llmError}) → ${verdict.verdict}`
        : `deterministic review → ${verdict.verdict}`,
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: agentId,
      beforeStatus,
      afterStatus: newStatus,
      transitioned,
      revisionCount,
    }
  }

  /**
   * FR-24: resolve the workspace-level runtime-isolation config from
   * `guildhall.yaml`. Returns an empty config when the user hasn't supplied
   * one; the slot-allocator fills in built-in defaults.
   */
  private runtimeConfig(): RuntimeIsolationConfig {
    const raw = this.opts.config.runtime
    if (!raw) return {}
    const out: RuntimeIsolationConfig = {}
    if (raw.portBase !== undefined) out.portBase = raw.portBase
    if (raw.portStride !== undefined) out.portStride = raw.portStride
    if (raw.envVarPrefixTemplate !== undefined) {
      out.envVarPrefixTemplate = raw.envVarPrefixTemplate
    }
    if (raw.sharedEnv !== undefined) out.sharedEnv = raw.sharedEnv
    return out
  }

  /**
   * FR-24: returns the current slot allocator, instantiating it on demand
   * after reading the levers. The first call decides whether isolation is
   * enabled; subsequent calls reuse the same allocator (so slots persist
   * across ticks within one orchestrator lifetime).
   *
   * Exposed as `public` for tests and for the serve-layer supervisor that
   * needs to inspect / reset allocation state during crash recovery.
   */
  async ensureSlotAllocator(): Promise<SlotAllocator | null> {
    if (this.slotAllocator !== undefined) return this.slotAllocator
    try {
      const settings = await this.readLeverSettings()
      const shape = resolveSlotShape(settings.project)
      if (!shape.enabled) {
        this.slotAllocator = null
        return null
      }
      this.slotAllocator = new SlotAllocator(shape.capacity, this.runtimeConfig())
      return this.slotAllocator
    } catch {
      // Missing / unreadable settings — fall back to "no isolation". Surface
      // nothing here: the first tick that actually needs slots will read
      // levers again once they exist, and stall/remediation paths are
      // independent of this decision.
      this.slotAllocator = null
      return null
    }
  }

  /** FR-24: claim a slot for a task if isolation is enabled. */
  private async allocateSlotForTask(task: Task): Promise<Slot | null> {
    const allocator = await this.ensureSlotAllocator()
    if (!allocator) return null
    return allocator.allocate(task.id)
  }

  /**
   * FR-24: read the `concurrent_task_dispatch` lever. Falls back to serial
   * (capacity 1) on any read error — starting a fanout dispatch with stale
   * lever state would be strictly worse than running one task.
   */
  /**
   * Structural-reliability precondition check. Returns a halt outcome when
   * the bootstrap block is either absent/unverified (`bootstrap_required`) or
   * present with a failed install (`bootstrap_failed`). Returns null when the
   * project is either fully verified or has no bootstrap block configured at
   * all (legacy projects and fresh workspaces keep their pre-existing
   * behaviour — the inbox already surfaces "bootstrap_missing" for them).
   */
  private bootstrapHalt(pendingTaskCount: number): TickOutcome | null {
    const b = this.opts.config.bootstrap
    if (!b) return null
    const hasStructural =
      b.verifiedAt != null || b.install != null || b.gates != null ||
      b.commands.length > 0 || b.successGates.length > 0
    if (!hasStructural) return null
    if (b.install?.status === 'failed') {
      return { kind: 'bootstrap-required', reason: 'bootstrap_failed', pendingTaskCount }
    }
    if (b.verifiedAt == null) {
      return { kind: 'bootstrap-required', reason: 'bootstrap_required', pendingTaskCount }
    }
    return null
  }

  private async resolveCapacity(): Promise<FanoutCapacity> {
    try {
      const settings = await this.readLeverSettings()
      return resolveFanoutCapacity(settings.project)
    } catch {
      return 1
    }
  }

  /**
   * FR-24: read the `worktree_isolation` lever. Falls back to `'none'` on
   * error so a malformed lever file doesn't block progress.
   */
  private async resolveWorktreeModeSafe(): Promise<WorktreeMode> {
    try {
      const settings = await this.readLeverSettings()
      return resolveWorktreeMode(settings.project)
    } catch {
      return 'none'
    }
  }

  /**
   * FR-25: read the `merge_policy` lever. Falls back to `ff_only_local` so
   * a lever outage never pushes or opens a PR unexpectedly.
   */
  private async resolveMergePolicySafe(): Promise<MergePolicy> {
    try {
      const settings = await this.readLeverSettings()
      return resolveMergePolicy(settings.project)
    } catch {
      return 'ff_only_local'
    }
  }

  /**
   * FR-24: the base branch used when minting fresh per-task worktrees.
   * Cached after the first lookup — the default branch of a repo does not
   * change during an orchestrator run.
   */
  private cachedBaseBranch: string | undefined
  private async resolveBaseBranch(): Promise<string> {
    if (this.cachedBaseBranch) return this.cachedBaseBranch
    try {
      this.cachedBaseBranch = await this.gitDriver.currentBranch(
        this.opts.config.projectPath,
      )
    } catch {
      // Best-effort default — InMemoryGitDriver in tests defaults to 'main'.
      this.cachedBaseBranch = 'main'
    }
    return this.cachedBaseBranch
  }

  /**
   * FR-24: teardown helper. Called on terminal transitions (incl. merge
   * conflict → blocked, max-revisions block). Preserves the worktree for
   * `pending_pr` tasks until the human merges the PR.
   */
  private async maybeCleanupWorktree(
    task: Task,
    mode: WorktreeMode,
  ): Promise<void> {
    const isTerminal =
      task.status === 'done' ||
      task.status === 'shelved' ||
      task.status === 'blocked'
    const preservingForPr = task.status === 'pending_pr'
    if (!isTerminal && !preservingForPr) return
    try {
      await cleanupWorktreeForTerminal({
        task,
        mode,
        projectPath: this.opts.config.projectPath,
        gitDriver: this.gitDriver,
        preserveForPendingPr: preservingForPr,
      })
    } catch (err) {
      // Cleanup failures are non-fatal — the tick already succeeded and a
      // stale worktree directory is an annoyance, not a correctness problem.
      console.warn(
        `[guildhall] worktree cleanup failed for ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * FR-24: serialize queue-write critical sections across concurrent fanout
   * dispatches. Each call appends `fn` to a tail promise so writes happen
   * strictly in FIFO order. Errors from `fn` propagate to the caller but do
   * not break the chain for subsequent callers.
   */
  private withQueueWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queueWriteChain
    const current = prev.then(fn, fn)
    this.queueWriteChain = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  /**
   * FR-24: merge orchestrator env with the slot env. Pure; used by the
   * serve layer when spawning out-of-process workers. The in-process
   * dispatch path relies on system-prompt injection instead.
   */
  slotEnvFor(task: Task, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const slot = this.slotAllocator?.getByTask(task.id)
    if (!slot) return base
    return { ...base, ...buildSlotEnv(slot, this.runtimeConfig()) }
  }

  /**
   * FR-24: read-modify-write helper that serializes against concurrent fanout
   * dispatches. The mutator receives the parsed queue, mutates it (in place
   * or by returning a replacement), and the helper persists it atomically.
   * Used by tests and by out-of-process worker shims that need to update
   * TASKS.json without racing the orchestrator's own post-dispatch writes.
   */
  updateQueueAtomically(
    mutator: (queue: TaskQueue) => Promise<TaskQueue | void> | TaskQueue | void,
  ): Promise<void> {
    return this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const next = await mutator(queue)
      await this.writeQueue(next ?? queue)
    })
  }

  private async readQueue(): Promise<TaskQueue> {
    const raw = await fs.readFile(this.tasksPath(), 'utf-8')
    return TaskQueue.parse(JSON.parse(raw))
  }

  private async writeQueue(queue: TaskQueue): Promise<void> {
    atomicWriteText(this.tasksPath(), JSON.stringify(queue, null, 2) + '\n')
  }

  /**
   * Append a FR-09 typed progress entry. Classification:
   *   - milestone : task reached `done` (all gates passed)
   *   - blocked   : task reached `blocked` (max revisions or hard block)
   *   - escalation: agent error requiring human attention
   *   - heartbeat : a real transition that isn't one of the above
   *
   * No-op ticks (agent ran, chose not to transition, no error) are NOT
   * written here — that kind of liveness signal belongs in the ephemeral
   * SSE stream, not the on-disk progress history.
   */
  private async logTickProgress(entry: {
    task: Task
    agent: string
    beforeStatus: TaskStatus
    afterStatus: TaskStatus
    transitioned: boolean
    note?: string
  }): Promise<void> {
    const isError = entry.note?.startsWith('error:') ?? false
    const hasMeaningfulNote =
      entry.note !== undefined && entry.note !== 'no transition'
    if (!entry.transitioned && !isError && !hasMeaningfulNote) return

    const type = this.classifyEntry(entry.afterStatus, entry.note)
    const arrow = entry.transitioned
      ? `${entry.beforeStatus} → ${entry.afterStatus}`
      : `${entry.beforeStatus} (unchanged)`
    const summary = entry.note
      ? `${entry.task.title} — ${arrow}. ${entry.note}`
      : `${entry.task.title} — ${arrow}`

    const progressEntry: ProgressEntry = {
      timestamp: this.now(),
      agentId: entry.agent,
      domain: entry.task.domain,
      taskId: entry.task.id,
      summary,
      type,
    }

    try {
      await logProgress({ progressPath: this.progressPath(), entry: progressEntry })
    } catch {
      // PROGRESS.md unwriteable — non-fatal for the feedback loop itself
    }
  }

  private classifyEntry(
    afterStatus: TaskStatus,
    note: string | undefined,
  ): ProgressEntry['type'] {
    // Max-turns is self-healing (the next tick resumes), not a real failure —
    // don't inflate it to an escalation.
    if (note?.startsWith('error:') && !/Exceeded maximum turn limit/.test(note)) {
      return 'escalation'
    }
    if (afterStatus === 'done') return 'milestone'
    if (afterStatus === 'blocked') return 'blocked'
    return 'heartbeat'
  }

  private now(): string {
    return this.opts.now?.() ?? new Date().toISOString()
  }

  private async emitBackendEvent(event: BackendEvent): Promise<void> {
    if (!this.opts.onBackendEvent) return
    try {
      await this.opts.onBackendEvent(event)
    } catch (err) {
      console.warn(
        `[guildhall] onBackendEvent threw (${event.type}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private banner(): void {
    const c = this.opts.config
    console.log(`[guildhall] Workspace: ${c.workspaceName} (${c.workspaceId})`)
    console.log(`[guildhall] Project:   ${c.projectPath}`)
    console.log(`[guildhall] Memory:    ${c.memoryDir}`)
    console.log('[guildhall] Model assignment:')
    console.log(`  spec:        ${c.models.spec}`)
    console.log(`  coordinator: ${c.models.coordinator}`)
    console.log(`  worker:      ${c.models.worker}`)
    console.log(`  reviewer:    ${c.models.reviewer}`)
    console.log(`  gateChecker: ${c.models.gateChecker}`)
    console.log('[guildhall] Orchestrator started.')
  }
}

// `pickNextTask` / `needsPreRejectionPolicy` live in `./orchestrator-picker.ts`
// so the fanout dispatcher (FR-24) can share the same priority/status order.
export { pickNextTask, needsPreRejectionPolicy } from './orchestrator-picker.js'

/**
 * Map a ResolvedConfig coordinator entry to the full CoordinatorDomain
 * type expected by createCoordinatorAgent.
 */
function toCoordinatorDomain(
  entry: ResolvedConfig['coordinators'][number],
): CoordinatorDomain {
  return {
    id: entry.id,
    name: entry.name,
    mandate: entry.mandate || `Coordinate work for the "${entry.domain}" domain.`,
    projectPaths: entry.path ? [entry.path] : [],
    concerns: entry.concerns.map((c) => ({
      id: c.id,
      description: c.description,
      reviewQuestions: c.reviewQuestions,
    })),
    autonomousDecisions: entry.autonomousDecisions,
    escalationTriggers: entry.escalationTriggers,
  }
}

async function sessionNamespaceForProject(config: ResolvedConfig): Promise<string> {
  const epochPath = path.join(config.memoryDir, '.session-epoch')
  try {
    const existing = (await fs.readFile(epochPath, 'utf8')).trim()
    if (existing) return existing
  } catch {
    /* create below */
  }
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  await fs.mkdir(config.memoryDir, { recursive: true })
  await fs.writeFile(epochPath, `${epoch}\n`, 'utf8')
  return epoch
}

/**
 * Back-compat entry point for the CLI. Builds the real agent set using the
 * not-yet-wired LLM provider stub and runs the orchestrator loop.
 */
export async function runOrchestrator(
  config: ResolvedConfig,
  opts: {
    maxTicks?: number
    tickDelayMs?: number
    domainFilter?: string
    onBackendEvent?: (event: BackendEvent) => void | Promise<void>
    stopSignal?: { stopRequested: boolean }
  } = {},
): Promise<void> {
  // Provider selection reads project-local config (`.guildhall/config.yaml`)
  // so the setup wizard's choices (preferredProvider, pasted API keys, LM
  // Studio URL) actually take effect at orchestrator boot. Keys in env vars
  // still win as ambient defaults; values from disk override them when set.
  const projectCfg = readProjectConfig(config.projectPath)
  // When no explicit preferredProvider is configured, infer one from the
  // role→model assignment so a project that wires up qwen/deepseek locally
  // doesn't silently fall through to whichever cloud OAuth happens to be
  // present (past incident: qwen/qwen3.6-35b-a3b routed to Codex, which
  // rejected the model on every tick and left the session stuck).
  const preferredProvider =
    projectCfg.preferredProvider ?? inferPreferredProvider(config.models)
  // Credentials live in the global store (~/.guildhall/providers.yaml) —
  // env vars still win (resolveGlobalCredentials honors that precedence).
  // Any legacy project-local keys are opportunistically migrated before we
  // read them, so pre-0.3 projects get cleaned up on first boot.
  try {
    migrateProjectProvidersToGlobal(config.projectPath, {
      readProject: (p) => readProjectConfig(p),
      writeProject: (p, patch) => updateProjectConfig(p, patch),
    })
  } catch {
    /* best-effort — never block orchestrator boot on migration */
  }
  const creds = resolveGlobalCredentials()
  const selection = await selectApiClient({
    ...(preferredProvider ? { preferredProvider } : {}),
    ...(creds.anthropicApiKey ? { anthropicApiKey: creds.anthropicApiKey } : {}),
    ...(creds.openaiApiKey ? { openaiApiKey: creds.openaiApiKey } : {}),
    ...(creds.llamaCppUrl ? { llamaCppUrl: creds.llamaCppUrl } : {}),
  })
  if (selection.providerName === 'none') {
    console.warn(`[guildhall] ${selection.reason}`)
  } else {
    const detail = selection.reason ? ` (${selection.reason})` : ''
    console.log(`[guildhall] Provider: ${selection.providerName}${detail}`)
  }
  const apiClient = selection.apiClient
  const models = buildModelSet(config.models, apiClient)

  // FR-17: load bundled + user + workspace skills once per run. Each agent
  // factory receives the same frozen skill list so the composed system prompt
  // is deterministic across the orchestrator loop.
  const workspaceSkillDir = path.join(config.memoryDir, '..', 'skills')
  const skills = loadSkillRegistry({ extraSkillDirs: [workspaceSkillDir] }).listSkills()

  // FR-18: build a single HookExecutor from the workspace config's `hooks`
  // passthrough. Every agent shares the same executor so hook state (e.g. a
  // counter in an HTTP hook's receiver) is consistent across roles, and the
  // orchestrator uses it for SESSION_START / SESSION_END.
  const hookExecutor = buildHookExecutor({
    config,
    apiClient,
    defaultModel: config.models.worker,
  })

  // FR-19: shared reactive compactor. The engine only invokes this when a
  // turn fails with a prompt-too-long error, so it stays dormant on healthy
  // runs. Same api client is reused — compaction is a Claude summary call,
  // not a separate provider concept.
  const compactor = buildDefaultCompactor({
    apiClient,
    model: config.models.worker,
  })

  // FR-20: each agent gets auto-persisted snapshots under the project cwd so
  // a halted orchestrator can be resumed without losing per-role history. We
  // key sessions by agent role so the five roles don't stomp each other; the
  // workspace id is folded in to keep multi-project setups isolated.
  const sessionNamespace = await sessionNamespaceForProject(config)
  const sessionIdFor = (role: string) => `${config.workspaceId}-${sessionNamespace}-${role}`
  const persistFor = (role: string) => ({
    cwd: config.projectPath,
    sessionId: sessionIdFor(role),
  })

  // FR-21 parity: connect to configured MCP servers and inject their tools
  // into every agent's registry. A failed server surfaces via McpConnectionStatus
  // but the workspace still boots — upstream treats MCP as best-effort.
  const mcpServers = config.mcp?.servers ?? {}
  const mcpManager = new McpClientManager(mcpServers)
  if (Object.keys(mcpServers).length > 0) {
    try {
      await mcpManager.connectAll()
      const connected = mcpManager.listStatuses().filter((s) => s.state === 'connected').length
      const total = mcpManager.listStatuses().length
      console.log(`[guildhall] MCP: ${connected}/${total} server(s) connected`)
    } catch (err) {
      console.warn(
        `[guildhall] MCP connectAll failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  const mcpTools = createMcpTools(mcpManager)

  const baseAgentOpts = {
    skills,
    compactor,
    extraTools: mcpTools,
    ...(hookExecutor ? { hookExecutor } : {}),
  }

  const specAgentInst = createSpecAgent(models.spec, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('spec'),
  })
  const workerAgentInst = createWorkerAgent(models.worker, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('worker'),
  })
  const reviewerAgentInst = createReviewerAgent(models.reviewer, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('reviewer'),
  })
  const gateCheckerAgentInst = createGateCheckerAgent(models.gateChecker, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('gate-checker'),
    ...(config.bootstrap && config.bootstrap.successGates.length > 0
      ? { successGates: config.bootstrap.successGates }
      : {}),
  })
  const coordinators: Record<string, GuildhallAgent> = Object.fromEntries(
    config.coordinators.map((entry) => [
      entry.domain,
      createCoordinatorAgent(toCoordinatorDomain(entry), models.coordinator, {
        ...baseAgentOpts,
        sessionPersistence: persistFor(`coordinator-${entry.domain}`),
      }),
    ]),
  )

  // FR-20: on startup, opportunistically rehydrate each agent's history from
  // its last snapshot. Agents with no snapshot stay cold — loadSession returns
  // false and we move on. This is a no-op for fresh projects.
  for (const [label, agent] of [
    ['spec', specAgentInst],
    ['worker', workerAgentInst],
    ['reviewer', reviewerAgentInst],
    ['gate-checker', gateCheckerAgentInst],
    ...Object.entries(coordinators).map(([d, c]) => [`coordinator-${d}`, c] as const),
  ] as const) {
    const rehydrated = agent.loadSession({
      cwd: config.projectPath,
      sessionId: sessionIdFor(label),
    })
    if (rehydrated) {
      console.log(`[guildhall] Resumed ${label} agent from prior snapshot.`)
    }
  }

  const agents: OrchestratorAgentSet = {
    spec: specAgentInst,
    worker: workerAgentInst,
    reviewer: reviewerAgentInst,
    gateChecker: gateCheckerAgentInst,
    coordinators,
  }

  const reviewerFanout = buildDefaultReviewerFanout(models.reviewer, {
    ...(hookExecutor ? { hookExecutor } : {}),
    concurrency: projectCfg.reviewerFanoutConcurrency,
  })

  const orchestrator = new Orchestrator({
    config,
    agents,
    reviewerFanout,
    ...(opts.domainFilter ? { domainFilter: opts.domainFilter } : {}),
    ...(hookExecutor ? { hookExecutor } : {}),
    ...(opts.onBackendEvent ? { onBackendEvent: opts.onBackendEvent } : {}),
    ...(opts.stopSignal ? { stopSignal: opts.stopSignal } : {}),
  })

  try {
    await orchestrator.run({
      ...(opts.maxTicks !== undefined ? { maxTicks: opts.maxTicks } : {}),
      ...(opts.tickDelayMs !== undefined ? { tickDelayMs: opts.tickDelayMs } : {}),
    })
  } finally {
    await mcpManager.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * True iff the task is running a handoff sequence and has at least one
 * more step after the current one. Used by the `review` pre-pass to
 * distinguish "step complete, advance" from "final step complete, run
 * normal fan-out review."
 */
function hasPendingHandoffStep(task: Task): boolean {
  const seq = task.handoffSequence
  if (!seq || seq.length === 0) return false
  const idx = task.handoffStep ?? 0
  return idx + 1 < seq.length
}

/**
 * Parse the worker's latest note for a structured `## Handoff note` section
 * (case-insensitive header). Falls back to the entire note text when no
 * explicit section is present — always better to preserve the worker's
 * intent than to silently drop it.
 */
function extractHandoffNote(task: Task): string {
  // Walk backwards to find the latest worker note.
  for (let i = task.notes.length - 1; i >= 0; i--) {
    const n = task.notes[i]
    if (!n) continue
    if (
      n.role === 'worker' ||
      n.agentId === 'worker-agent' ||
      n.agentId?.endsWith('-engineer')
    ) {
      const content = n.content ?? ''
      const match = content.match(
        /^\s*##\s+Handoff note\s*\n([\s\S]*?)(?:\n##\s|\n?$)/im,
      )
      if (match) return match[1]!.trim()
      return content.trim()
    }
  }
  return ''
}

/**
 * Rebuild prior fan-out rounds from the flat `task.reviewVerdicts` trail.
 * Verdicts recorded within the same ISO second are treated as one round
 * (the fan-out persists every persona's verdict with the same `recordedAt`).
 * The most-recent round is placed last in the returned list so
 * `findRecurrentDissent` can compare against `priorRounds.at(-1)`.
 *
 * Each element is a PersonaVerdict-shaped slice derived from the stored
 * ReviewVerdict — `guildSlug` comes from `failingSignals[0]` (fan-out
 * writes the persona slug there on revise) or is inferred from the
 * `reason` text on approve.
 */
function extractPriorVerdictRounds(
  verdicts: readonly ReviewVerdict[],
): PersonaVerdict[][] {
  if (verdicts.length === 0) return []
  const rounds: PersonaVerdict[][] = []
  let currentKey: string | null = null
  let current: PersonaVerdict[] = []
  for (const v of verdicts) {
    const key = v.recordedAt
    if (key !== currentKey) {
      if (current.length > 0) rounds.push(current)
      current = []
      currentKey = key
    }
    // Fan-out tags failingSignals[0] with the persona slug on revise;
    // approves leave failingSignals empty. Fall back to parsing the slug
    // out of the reason prefix ("<guildName> approved/requested revision").
    const slug =
      v.failingSignals[0] ?? guessSlugFromReason(v.reason) ?? 'unknown'
    current.push({
      guildSlug: slug,
      guildName: slug,
      verdict: v.verdict,
      reasoning: v.reasoning ?? v.reason,
      // `revisionItems` aren't persisted verbatim on ReviewVerdict — the
      // dissent text lives in `reasoning`. The detector does token-set
      // overlap on the whole string, so passing `[reasoning]` is equivalent
      // to the empty-items case for this purpose.
      revisionItems: v.verdict === 'revise' ? [v.reasoning ?? v.reason] : [],
      rawOutput: v.reasoning ?? v.reason,
    })
  }
  if (current.length > 0) rounds.push(current)
  return rounds
}

function guessSlugFromReason(reason: string): string | null {
  // Fan-out writes "The <Persona Name> approved/requested revision" into
  // reason. Slugify the persona name section. This is advisory — callers
  // that need strict attribution should use failingSignals[0].
  const m = /^The\s+([A-Z][A-Za-z ]+?)\s+(approved|requested revision)/.exec(
    reason,
  )
  if (!m) return null
  return m[1]!.toLowerCase().replace(/\s+/g, '-')
}

/** FR-15: map the zod-enum task field onto the engine's PermissionMode enum. */
function taskModeToPermissionMode(mode: TaskPermissionMode): PermissionMode {
  switch (mode) {
    case 'plan':      return PermissionMode.PLAN
    case 'full_auto': return PermissionMode.FULL_AUTO
    case 'default':   return PermissionMode.DEFAULT
  }
}

/**
 * Build a ReviewerFanoutRunner that creates one fresh persona reviewer
 * agent per applicable persona and parses the structured verdict from
 * each response. The orchestrator aggregates across personas.
 *
 * ## Concurrency
 *
 * `opts.concurrency` controls how many persona calls run at once:
 * - `1` (default) — strictly sequential. Safe for LM Studio and any
 *   single-session local model; wall-clock cost is `N * per-persona`.
 * - `n > 1` — up to `n` personas in flight simultaneously. Appropriate
 *   for cloud providers (Anthropic, OpenAI, …) whose rate limits
 *   comfortably exceed `n`. Wall-clock cost collapses to roughly
 *   `ceil(N / n) * per-persona`.
 *
 * An LLM failure for one persona doesn't abort the whole review — we
 * record a parseable "revise" verdict so the strict-all aggregator
 * surfaces the failing persona with a readable reason.
 */
export function buildDefaultReviewerFanout(
  reviewerLlm: AgentLLM,
  opts: { hookExecutor?: HookExecutor; concurrency?: number } = {},
): ReviewerFanoutRunner {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1))
  return async ({ task, personas, context }) => {
    const { parsePersonaOutput } = await import('./reviewer-fanout.js')

    const runPersona = async (persona: GuildDefinition): Promise<PersonaVerdict> => {
      const agent = createPersonaReviewerAgent(persona, reviewerLlm, {
        ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
      })
      const prompt = [
        context,
        '',
        `Task id: ${task.id}. Review this task through your lens alone and emit the required verdict format.`,
      ].join('\n')
      try {
        const result = await agent.generate(prompt)
        return parsePersonaOutput(persona, result.text)
      } catch (err) {
        return parsePersonaOutput(
          persona,
          `**Verdict:** revise\n**Reasoning:** ${persona.name} failed to produce a verdict (${err instanceof Error ? err.message : String(err)}). Treating as revise per strict-all policy.`,
        )
      }
    }

    return boundedConcurrency(personas, concurrency, (persona) =>
      runPersona(persona),
    )
  }
}
