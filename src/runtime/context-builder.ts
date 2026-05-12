import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Checkpoint, Task } from '@guildhall/core'
import {
  summarizeDesignSystem,
  selectApplicableReviewRubrics,
  renderRubricSelection,
} from '@guildhall/core'
import { readCheckpoint } from '@guildhall/tools'
import { latestResolvedRetryEscalationAt } from '@guildhall/tools'
import {
  selectApplicableGuilds,
  pickPrimaryEngineer,
  renderPersonaPrompt,
  renderSpecContributions,
  collectGuildRubrics,
  reviewersForTask,
  loadProjectGuildRoster,
} from '@guildhall/guilds'
import { loadGoalForTask } from './business-envelope.js'
import { loadDesignSystem } from './design-system-store.js'

// ---------------------------------------------------------------------------
// Just-in-time context builder
//
// Instead of dumping all of MEMORY.md into every agent call, this builder
// assembles a focused, task-scoped context block. This is critical for
// local LLMs with limited context windows — irrelevant content actively
// degrades output quality.
//
// Each agent receives:
//   1. Its own role description (from its system prompt)
//   2. The specific task it's working on
//   3. Relevant memory excerpts (sections matching task domain/keywords)
//   4. The last N progress entries (recent activity, not full history)
//   5. Recent decisions relevant to the task's domain
//
// Context is assembled fresh for each agent invocation.
// ---------------------------------------------------------------------------

const RECENT_PROGRESS_LINES = 60   // Last ~10-15 entries
const MAX_MEMORY_CHARS = 4000       // Cap memory injection size
const MAX_DECISIONS_CHARS = 2000    // Cap decisions injection size
const MAX_EXPLORING_CHARS = 6000    // Transcript tail cap for exploring intake
const MAX_WORKTREE_HINT_LINES = 12
const MAX_REVISION_FEEDBACK_CHARS = 3500
const MAX_AGENT_NOTE_CHARS = 1200
const MAX_AGENT_NOTES = 3
const MAX_SPEC_OVERVIEW_CHARS = 3200
const execFileP = promisify(execFile)

const ACTIONABLE_FILE_HINT_RE = /^\s*(?:[-*]\s*|\d+\.\s*)?(edit|update|modify|create|write|verify|check|test|open|remove|delete|rename|trim|clean)\b/i
const SHELLISH_CANDIDATE_RE = /^(pnpm|npm|yarn|bun|cd|node)\b|--|&&|\|\|/
const GLOB_CANDIDATE_RE = /[*?{}]/

function isActionableFileCandidate(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (!trimmed) return false
  if (trimmed.includes(' ')) return false
  if (SHELLISH_CANDIDATE_RE.test(trimmed)) return false
  if (GLOB_CANDIDATE_RE.test(trimmed)) return false
  return true
}

export function resolveLikelyTaskFiles(task: Task, checkpointFilesTouched: readonly string[] = []): string[] {
  const root = task.worktreePath?.trim() || task.projectPath?.trim() || ''
  const out: string[] = []
  const seen = new Set<string>()
  const specText = `${task.title}
${task.description}
${task.spec ?? ''}`
  const commandCandidates: string[] = []
  for (const ac of task.acceptanceCriteria) {
    const command = String(ac.command ?? '')
    for (const match of command.matchAll(/(?:^|\s)(tests\/[^\s]+\.(?:test|spec)\.ts)(?=\s|$)/g)) {
      const candidate = (match[1] ?? '').trim()
      if (isActionableFileCandidate(candidate)) commandCandidates.push(candidate)
    }
    for (const match of command.matchAll(/(?:^|\s)([^\s]+\.(?:test|spec)\.ts)(?=\s|$)/g)) {
      const candidate = (match[1] ?? '').trim()
      if (isActionableFileCandidate(candidate)) commandCandidates.push(candidate)
    }
  }
  const rootedHints = [
    ...commandCandidates,
    ...specText
      .split('\n')
      .flatMap((line) => {
        if (!ACTIONABLE_FILE_HINT_RE.test(line)) return []
        return Array.from(
          line.matchAll(/`([^`]+\.(?:ts|tsx|js|jsx|vue|md|json|yaml|yml))`/g),
          (match) => (match[1] ?? '').trim(),
        ).filter(isActionableFileCandidate)
      }),
  ]
  const fallbackBacktickedHints =
    rootedHints.length > 0
      ? []
      : Array.from(
          specText.matchAll(/`([^`]+\.(?:ts|tsx|js|jsx|vue|md|json|yaml|yml))`/g),
          (match) => (match[1] ?? '').trim(),
        )
          .filter(isActionableFileCandidate)
          .filter((candidate) => !/\.(?:test|spec)\.ts$/i.test(candidate))
  const preferredRootPrefix =
    rootedHints
      .map((candidate) => candidate.split('/'))
      .find((segments) => segments.length >= 2 && ['app', 'src', 'tests', 'server'].includes(segments[1] ?? ''))
      ?.[0] ?? ''

  const normalizeCandidate = (trimmed: string): string => {
    if (trimmed.startsWith('/')) return path.resolve(trimmed)
    const withPrefix =
      preferredRootPrefix &&
      !trimmed.startsWith(`${preferredRootPrefix}/`) &&
      (trimmed.startsWith('tests/') || trimmed.startsWith('app/') || trimmed.startsWith('src/'))
        ? `${preferredRootPrefix}/${trimmed}`
        : trimmed
    return root ? path.resolve(root, withPrefix) : withPrefix
  }

  const push = (candidate: string) => {
    const trimmed = candidate.trim()
    if (!trimmed) return
    const normalized = normalizeCandidate(trimmed)
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  for (const candidate of rootedHints) {
    push(candidate)
  }
  for (const candidate of fallbackBacktickedHints) {
    push(candidate)
  }
  for (const candidate of checkpointFilesTouched) {
    push(candidate)
  }
  return out.slice(0, 8)
}

function renderLikelyTaskFiles(task: Task, checkpointFilesTouched: readonly string[] = []): string {
  const files = resolveLikelyTaskFiles(task, checkpointFilesTouched)
  if (files.length === 0) return ''
  return ['**Likely target files:**', ...files.map((file) => `- ${file}`)].join('\n')
}

function hasWorkerSelfCritiqueNote(task: Task): boolean {
  return [...task.notes].reverse().some((note) => {
    const role = typeof note.role === 'string' ? note.role.trim().toLowerCase() : ''
    const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
    const content = typeof note.content === 'string' ? note.content : ''
    if (content.trim().length === 0 || !/self-critique/i.test(content)) return false
    if (role === 'self-critique') return true
    if (agentId === 'worker-agent') return true
    return role === 'implementation' || role === 'implementer' || role === 'worker'
  })
}

function normalizedCheckpointNextAction(task: Task, checkpoint: Checkpoint | null): string {
  const nextAction = checkpoint?.nextPlannedAction?.trim() ?? ''
  if (!nextAction) return ''
  if (
    hasWorkerSelfCritiqueNote(task) &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(nextAction)
  ) {
    return 'Resume from the latest self-critique and recorded verification evidence, then hand off to review.'
  }
  return nextAction
}

function renderLatestCheckpoint(task: Task, checkpoint: Checkpoint | null): string {
  if (!checkpoint) return ''
  const nextAction = normalizedCheckpointNextAction(task, checkpoint)
  const lines = [
    `**Step ${checkpoint.step}** by ${checkpoint.agentId} at ${checkpoint.writtenAt}`,
    `- Intent: ${checkpoint.intent}`,
    `- Next planned action: ${nextAction}`,
  ]
  if (checkpoint.filesTouched.length > 0) {
    lines.push(`- Files touched: ${checkpoint.filesTouched.join(', ')}`)
  }
  return lines.join('\n')
}

function renderResolvedEscalationGuidance(task: Task): string {
  const resolved = [...task.escalations]
    .filter((escalation) => escalation.resolvedAt && escalation.resolution?.trim())
    .sort((a, b) => Date.parse(b.resolvedAt ?? '') - Date.parse(a.resolvedAt ?? ''))
    .slice(0, 3)
  if (resolved.length === 0) return ''
  const lines = [
    '### Resolved Human Decisions To Honor',
    'Do not reopen these questions unless new evidence appears in the same files or verification scope.',
  ]
  for (const escalation of resolved) {
    lines.push(
      `- **${escalation.id}** [${escalation.reason}] ${escalation.summary}`,
      `  - Resolution (${escalation.resolvedBy ?? 'human'} at ${escalation.resolvedAt}): ${escalation.resolution?.trim() ?? ''}`,
    )
  }
  return lines.join('\n')
}

function clipContextBlock(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxChars - 19)).trimEnd()}\n...[truncated]`
}

function renderSpecOverview(task: Task): string {
  const raw = task.spec?.trim()
  if (!raw) return ''
  const summaryMatch = raw.match(/## Summary\s*([\s\S]*?)(?=\n##\s+[A-Z]|\n#\s+[A-Z]|$)/i)
  const summaryBody = (summaryMatch?.[1] ?? raw).trim()
  return clipContextBlock(summaryBody, MAX_SPEC_OVERVIEW_CHARS)
}

async function summarizeActiveWorktree(task: Task): Promise<string> {
  if (task.status !== 'in_progress' || !task.worktreePath?.trim()) return ''
  try {
    const { stdout } = await execFileP('git', ['status', '--short', '--untracked-files=all'], {
      cwd: task.worktreePath,
      maxBuffer: 1024 * 1024,
    })
    const lines = stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .filter((line) => !line.includes('/.guildhall/'))
    if (lines.length === 0) return ''
    const shown = lines.slice(0, MAX_WORKTREE_HINT_LINES)
    const extra = lines.length - shown.length
    return [
      `**Active worktree:** ${task.worktreePath}`,
      '**Changed files to resume from first:**',
      ...shown.map((line) => `- ${line}`),
      extra > 0 ? `- ...and ${extra} more` : '',
    ].filter(Boolean).join('\n')
  } catch {
    return task.worktreePath ? `**Active worktree:** ${task.worktreePath}` : ''
  }
}

export interface BuiltContext {
  taskSummary: string
  projectMemory: string
  recentProgress: string
  recentDecisions: string
  /**
   * FR-08 / FR-12: if the task is in the `exploring` phase, the last chunk of
   * the ongoing conversation transcript so the Spec Agent can resume intake
   * mid-conversation instead of starting over. Empty for tasks not in exploring
   * or with no transcript yet.
   */
  exploringTranscript: string
  /**
   * Stage-scoped persona prompt additive. What this holds depends on the
   * task status:
   *   - `exploring`    — every applicable designer/specialist's
   *                      `specContribution` prose, so the Spec Agent
   *                      elicits the answers each expert needs.
   *   - `in_progress`  — the single primary engineer's principles (Frontend
   *                      Engineer, TypeScript Engineer, ...) framed as the
   *                      worker's persona. Framework-specialized when
   *                      detected (Vue / React / Svelte / ...).
   *   - `review`       — empty (the reviewer fan-out attaches personas at
   *                      dispatch time, one reviewer per applicable guild).
   *   - other statuses — empty; those stages don't need persona prompt.
   */
  personaPrompt: string
  /**
   * Slugs of guilds currently applicable. Downstream consumers (reviewer
   * dispatcher, gate runner) use this instead of re-running applicability
   * predicates.
   */
  applicableGuildSlugs: string[]
  /**
   * Slug of the primary engineer persona (if any) for the current task —
   * populated at `in_progress`. Lets the orchestrator trace which engineer
   * built the code in the audit log.
   */
  primaryEngineerSlug: string | null
  /**
   * Slugs of guilds that should produce independent review verdicts at
   * `review`. Populated regardless of status so a preview of the fan-out is
   * visible throughout the task's life.
   */
  reviewerSlugs: string[]
  /**
   * FR-23: business-envelope summary for the task's parent goal. Empty when
   * the task has no `parentGoalId` or the goal book is absent. Agents see the
   * goal title, success condition, and guardrails so they can self-check
   * against the envelope before taking destructive actions; the coordinator
   * makes the authoritative call via `evaluateEnvelope`.
   */
  envelope: string
  /**
   * Approved (or draft) design-system summary — tokens, primitives, copy
   * voice, a11y baseline. Empty when memory/design-system.yaml is absent so
   * pure-infra projects pay nothing.
   */
  designSystem: string
  /**
   * Review rubric selection rendered as markdown. Reviewer agents use it to
   * structure their verdict; worker agents read it as a pre-flight checklist.
   * Always includes the code-review rubric; design/copy/a11y/product lenses
   * attach only when the task's surface warrants it.
   */
  reviewRubrics: string
  reviewPacket?: string
  /** Concatenated string ready to prepend to an agent message */
  formatted: string
}

/**
 * Extract sections from MEMORY.md that are relevant to the given task.
 * Relevance is determined by matching domain name, task keywords, and
 * any component/file names mentioned in the task description.
 */
function extractRelevantMemorySections(memory: string, task: Task): string {
  const keywords = [
    task.domain,
    ...task.title.toLowerCase().split(/\s+/),
    ...(task.description.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []),
  ].map(k => k.toLowerCase())

  const sections = memory.split(/^## /m).filter(Boolean)

  const scored = sections.map(section => {
    const lower = section.toLowerCase()
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0)
    return { section: `## ${section}`, score }
  })

  const relevant = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.section)
    .join('\n')

  return relevant.slice(0, MAX_MEMORY_CHARS)
}

/**
 * Extract the last N lines of PROGRESS.md.
 */
function extractRecentProgress(progress: string): string {
  const lines = progress.trimEnd().split('\n')
  return lines.slice(-RECENT_PROGRESS_LINES).join('\n')
}

/**
 * Extract decision entries from DECISIONS.md that match the task's domain.
 */
function extractRelevantDecisions(decisions: string, domain: string): string {
  const entries = decisions.split(/^---$/m).filter(Boolean)
  const relevant = entries
    .filter(e => e.toLowerCase().includes(domain.toLowerCase()))
    .slice(-5) // Last 5 relevant decisions
    .join('\n---\n')

  return relevant.slice(0, MAX_DECISIONS_CHARS)
}

/**
 * Render a "where we are in the handoff sequence" header + the prior
 * steps' handoff notes. The active engineer reads this to pick up the
 * previous specialist's work without re-deriving the state from the
 * worktree diff alone.
 */
function renderHandoffStepHeader(input: {
  sequence: ReadonlyArray<import('@guildhall/core').HandoffStep>
  stepIndex: number
}): string {
  const step = input.sequence[input.stepIndex]
  if (!step) return ''
  const total = input.sequence.length
  const lines: string[] = [
    `## Handoff sequence — step ${input.stepIndex + 1} of ${total}`,
    '',
    `You are the engineer for this step (\`${step.agent}\`). The task is being worked by a sequence of specialists sharing one worktree. Your scope is **only** what this step owns — do not re-do previous steps' work, do not preempt later steps.`,
    '',
  ]
  if (step.scope.length > 0) {
    lines.push('**Your scope (acceptance criteria ids):**')
    for (const s of step.scope) lines.push(`- ${s}`)
    lines.push('')
  }
  if (step.instructions && step.instructions.trim().length > 0) {
    lines.push('**Step-specific instructions:**')
    lines.push(step.instructions.trim())
    lines.push('')
  }
  const priorSteps = input.sequence.slice(0, input.stepIndex)
  const notes = priorSteps
    .map((p, i) => ({ step: i + 1, agent: p.agent, note: p.handoffNote ?? '' }))
    .filter((p) => p.note.trim().length > 0)
  if (notes.length > 0) {
    lines.push('**Prior step handoff notes:**')
    for (const n of notes) {
      lines.push('')
      lines.push(`### From step ${n.step} (${n.agent})`)
      lines.push('')
      lines.push(n.note)
    }
    lines.push('')
  }
  lines.push(
    'When you finish your scope, write a structured handoff note (what you completed, state of the worktree, known gaps for the next agent) inside your self-critique under the heading `## Handoff note` before flipping the task to `review`.',
  )
  return lines.join('\n')
}

export async function buildContext(
  task: Task,
  memoryDir: string
): Promise<BuiltContext> {
  const readSafe = async (file: string): Promise<string> => {
    try {
      return await fs.readFile(path.join(memoryDir, file), 'utf-8')
    } catch {
      return ''
    }
  }

  const [memory, progress, decisions, exploring, goal, ds, worktreeResume, checkpoint] = await Promise.all([
    readSafe('MEMORY.md'),
    readSafe('PROGRESS.md'),
    readSafe('DECISIONS.md'),
    // Only bother with the transcript when we're actually in the exploring phase.
    task.status === 'exploring'
      ? readSafe(path.join('exploring', `${task.id}.md`))
      : Promise.resolve(''),
    // FR-23: resolve the task's parent goal. Missing-goal cases become
    // `undefined` — the summary renderer omits the envelope block.
    loadGoalForTask(memoryDir, task).catch(() => undefined),
    loadDesignSystem(memoryDir).catch(() => undefined),
    summarizeActiveWorktree(task),
    task.status === 'in_progress'
      ? readCheckpoint(memoryDir, task.id).catch(() => null)
      : Promise.resolve(null),
  ])
  const reviewPacket =
    task.status === 'review' || task.status === 'gate_check'
      ? await readSafe(path.join('tasks', task.id, 'review-packet.md'))
      : ''

  const projectMemory = extractRelevantMemorySections(memory, task)
  const recentProgress = extractRecentProgress(progress)
  const recentDecisions = extractRelevantDecisions(decisions, task.domain)
  const exploringTranscript = exploring
    ? exploring.slice(-MAX_EXPLORING_CHARS)
    : ''
  const envelope = goal
    ? [
        `**Parent goal:** ${goal.id} — ${goal.title} (${goal.status})`,
        `**Success condition:** ${goal.successCondition}`,
        goal.guardrails.length > 0
          ? `**Guardrails:**\n${goal.guardrails
              .map(
                (g) =>
                  `- [${g.kind}] ${g.description}${g.tags.length ? ` (tags: ${g.tags.join(', ')})` : ''}`,
              )
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''
  const guildSignals = {
    task,
    designSystem: ds,
    memoryDir,
    projectPath: task.projectPath,
  }
  const { guilds: roster } = loadProjectGuildRoster(memoryDir)
  const applicableGuilds = selectApplicableGuilds(guildSignals, roster)
  const applicableGuildSlugs = applicableGuilds.map((g) => g.slug)
  const reviewerSlugs = reviewersForTask(applicableGuilds).map((g) => g.slug)

  // Engineer selection: handoff sequence (when present) wins over the
  // default `pickPrimaryEngineer` heuristic. The current step's `agent`
  // slug names the engineer; we look it up in the roster directly so a
  // project's custom engineer (via memory/guilds.yaml) is honored.
  const handoffStep =
    task.handoffSequence && typeof task.handoffStep === 'number'
      ? task.handoffSequence[task.handoffStep]
      : undefined
  let primaryEngineer = pickPrimaryEngineer(applicableGuilds)
  if (handoffStep) {
    const stepEngineer = roster.find(
      (g) => g.slug === handoffStep.agent && g.role === 'engineer',
    )
    if (stepEngineer) primaryEngineer = stepEngineer
  }
  const primaryEngineerSlug = primaryEngineer?.slug ?? null

  // Stage-scoped persona prompt. See BuiltContext.personaPrompt for the
  // rationale. When a handoff step is active, append the prior steps'
  // handoff notes + this step's scope/instructions so the engineer picks
  // up where the previous specialist left off.
  let personaPrompt = ''
  if (task.status === 'exploring') {
    personaPrompt = renderSpecContributions(applicableGuilds, guildSignals)
  } else if (task.status === 'in_progress' && primaryEngineer) {
    personaPrompt = renderPersonaPrompt(primaryEngineer, guildSignals)
    if (handoffStep && task.handoffSequence) {
      personaPrompt = [
        personaPrompt,
        '',
        renderHandoffStepHeader({
          sequence: task.handoffSequence,
          stepIndex: task.handoffStep ?? 0,
        }),
      ].join('\n')
    }
  }

  const designSystem = ds ? summarizeDesignSystem(ds) : ''
  const rubricSelection = selectApplicableReviewRubrics(task, ds)
  const coreRubrics = renderRubricSelection(rubricSelection)
  // Reviewer rubric items are attached per-reviewer at dispatch time (fan-out),
  // not pushed into the worker context. collectGuildRubrics is kept available
  // for the reviewer dispatcher.
  void collectGuildRubrics
  const reviewRubrics = coreRubrics
  const latestCheckpoint = renderLatestCheckpoint(task, checkpoint)
  const likelyTaskFiles = renderLikelyTaskFiles(task, checkpoint?.filesTouched ?? [])
  const resolvedEscalationGuidance = renderResolvedEscalationGuidance(task)
  const reviewerFeedbackCutoffMs = (() => {
    const cutoff = latestResolvedRetryEscalationAt(task)
    const parsed = cutoff ? Date.parse(cutoff) : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  })()
  const latestRevisionFeedback = [...task.notes]
    .reverse()
    .find((note) =>
      (note.agentId === 'reviewer-fanout' || note.agentId === 'reviewer-agent') &&
      note.role === 'reviewer' &&
      (reviewerFeedbackCutoffMs === null || Date.parse(note.timestamp) > reviewerFeedbackCutoffMs),
    )?.content ?? ''
  const clippedRevisionFeedback = latestRevisionFeedback
    ? clipContextBlock(latestRevisionFeedback, MAX_REVISION_FEEDBACK_CHARS)
    : ''
  const recentAgentNotes = task.notes
    .filter((note) => note.role !== 'reviewer')
    .slice(-MAX_AGENT_NOTES)
    .map((note) =>
      `**${note.agentId} (${note.role})** ${note.timestamp}:\n${clipContextBlock(note.content, MAX_AGENT_NOTE_CHARS)}`,
    )
  const specOverview = renderSpecOverview(task)

  const taskSummary = [
    `## Current Task: ${task.id}`,
    `**Title:** ${task.title}`,
    `**Domain:** ${task.domain}`,
    `**Status:** ${task.status}`,
    `**Priority:** ${task.priority}`,
    specOverview ? `\n### Spec Overview\n${specOverview}` : '',
    task.productBrief
      ? `\n### Product Brief${task.productBrief.approvedAt ? ' (human-approved)' : ' (DRAFT — not yet approved)'}\n**User job:** ${task.productBrief.userJob}\n**Success metric:** ${task.productBrief.successMetric}${task.productBrief.antiPatterns.length > 0 ? `\n**Anti-patterns (must NOT do):**\n${task.productBrief.antiPatterns.map(a => `- ${a}`).join('\n')}` : ''}${task.productBrief.rolloutPlan ? `\n**Rollout plan:** ${task.productBrief.rolloutPlan}` : ''}`
      : '',
    task.acceptanceCriteria.length > 0
      ? `\n### Acceptance Criteria\n${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}`
      : '',
    task.outOfScope.length > 0
      ? `\n### Out of Scope\n${task.outOfScope.map(s => `- ${s}`).join('\n')}`
      : '',
    clippedRevisionFeedback
      ? `\n### Latest Required Revisions\n${clippedRevisionFeedback}`
      : '',
    latestCheckpoint
      ? `\n### Latest Checkpoint\n${latestCheckpoint}`
      : '',
    worktreeResume
      ? `\n### Resume From Current Worktree\n${worktreeResume}`
      : '',
    resolvedEscalationGuidance
      ? `\n${resolvedEscalationGuidance}`
      : '',
    likelyTaskFiles
      ? `\n### Likely Target Files\n${likelyTaskFiles}`
      : '',
    recentAgentNotes.length > 0
      ? `\n### Agent Notes\n${recentAgentNotes.join('\n\n')}`
      : '',
  ].filter(Boolean).join('\n')

  const formatted = [
    '<!-- FORGE CONTEXT: injected just-in-time, do not modify -->',
    '',
    taskSummary,
    '',
    personaPrompt,
    '',
    envelope ? `## Business Envelope (FR-23)\n${envelope}` : '',
    '',
    designSystem ? `## Design System\n${designSystem}` : '',
    '',
    reviewRubrics ? `## Review Rubrics (selected for this task)\n${reviewRubrics}` : '',
    '',
    reviewPacket ? `## Review Packet\n${reviewPacket}` : '',
    '',
    projectMemory ? `## Relevant Project Memory\n${projectMemory}` : '',
    '',
    recentProgress ? `## Recent Progress\n${recentProgress}` : '',
    '',
    recentDecisions ? `## Recent Decisions (${task.domain})\n${recentDecisions}` : '',
    '',
    exploringTranscript
      ? `## Exploring Transcript (tail)\n${exploringTranscript}`
      : '',
    '',
    '<!-- END FORGE CONTEXT -->',
  ].filter(s => s !== undefined).join('\n').trim()

  return {
    taskSummary,
    projectMemory,
    recentProgress,
    recentDecisions,
    exploringTranscript,
    personaPrompt,
    applicableGuildSlugs,
    primaryEngineerSlug,
    reviewerSlugs,
    envelope,
    designSystem,
    reviewRubrics,
    reviewPacket,
    formatted,
  }
}
