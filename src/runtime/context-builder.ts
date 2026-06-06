import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Checkpoint, ConstructionMode, Task } from '@guildhall/core'
import { TaskQueue } from '@guildhall/core'
import { buildWorkerCorpusContext, loadCodebaseMap, refreshCodebaseMap } from '@guildhall/corpus-map'
import {
  constructionModeForTask,
  summarizeDesignSystem,
  selectApplicableReviewRubrics,
  renderRubricSelection,
} from '@guildhall/core'
import { checkpointIsFreshForTask, readCheckpoint } from '@guildhall/tools'
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
import { readProjectSkillProposals, selectRelevantProjectSkills } from '@guildhall/skills'
import {
  getProjectTaskLocalHistoryDir,
  getProjectTranscriptPath,
  inferProjectRootFromMemoryDir,
} from '@guildhall/sessions'
import { loadGoalForTask } from './business-envelope.js'
import { loadDesignSystem } from './design-system-store.js'
import { loadLanguageMap, renderLanguageMapContext } from './language-map.js'
import { renderWorkerMode, selectWorkerMode, type SelectedWorkerMode } from './worker-modes.js'
import { resolveRuntimePath } from './path-utils.js'
import { renderCompletionHandoffContext, CompletionHandoff } from './completion-handoff.js'
import { buildProofPathContext, ProofPath } from './proof-paths.js'
import type { CompletionHandoff as CompletionHandoffType } from './completion-handoff.js'
import type { ProofPath as ProofPathType } from './proof-paths.js'
import { buildEffectiveMemoryPacket, type EffectiveMemoryPacket } from './effective-memory-packet.js'
import {
  buildStructuralContextSlice,
  readAcceptedStructuralMap,
  renderStructuralAgentPacket,
  type StructuralAgentRole,
  type StructuralContextSlice,
} from './structural-map.js'
import { renderSurfaceReviewPacketsMarkdown } from './contract-surfaces.js'
import {
  buildTaskContextPacket,
  readProjectDeliveryModel,
  type TaskContextPacket,
} from './delivery-spine.js'

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
const MAX_CORPUS_MAP_CHARS = 3200
const MAX_ENV_MANIFEST_FILES = 8
const MAX_ENV_MANIFEST_KEYS_PER_FILE = 40
const RETRY_COACHING_AFTER_REVISIONS = 3
const execFileP = promisify(execFile)
const repoFileCache = new Map<string, string[]>()

const ACTIONABLE_FILE_HINT_RE = /^\s*(?:[-*]\s*|\d+\.\s*)?(edit|update|modify|create|write|verify|check|test|open|remove|delete|rename|trim|clean)\b/i
const SHELLISH_CANDIDATE_RE = /^(pnpm|npm|yarn|bun|cd|node)\b|--|&&|\|\|/
const GLOB_CANDIDATE_RE = /[*?{}]/
const ENV_FILE_RE = /^\.env(?:\.[A-Za-z0-9_-]+)?$/
const ENV_KEY_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/
const ENV_CONTEXT_TASK_RE = /\b(env|environment|credential|secret|key|token|oauth|provider|supabase|stripe|vercel|google|apple|webhook)\b/i
const LOCAL_WEB_APP_STARTER_FILES = ['package.json', 'index.html', 'src/main.js', 'src/styles.css']
const SINGLE_FILE_WEB_APP_FILES = ['index.html']
const UI_TASK_RE = /\b(ui|ux|frontend|front-end|web app|browser app|single-page app|page|screen|view|route|component|primitive|button|form|input|modal|drawer|toast|nav|toolbar|sidebar|layout|card|visual|design|palette|screenshot|app-store-caliber)\b/i

async function loadOrCreateCodebaseMap(memoryDir: string, task: Task) {
  const projectRoot = (task.worktreePath?.trim() || task.projectPath?.trim())
  const resolvedProjectRoot = projectRoot ? resolveRuntimePath(projectRoot) : ''
  const existing = await loadCodebaseMap(memoryDir)
  if (existing) {
    if (!resolvedProjectRoot || path.resolve(existing.project.root) === resolvedProjectRoot) return existing
  }
  if (!resolvedProjectRoot) return null
  const result = await refreshCodebaseMap({
    projectRoot: resolvedProjectRoot,
    memoryDir,
    reason: 'setup',
  })
  return result.map
}

function isActionableFileCandidate(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (!trimmed) return false
  if (trimmed.includes(' ')) return false
  if (SHELLISH_CANDIDATE_RE.test(trimmed)) return false
  if (GLOB_CANDIDATE_RE.test(trimmed)) return false
  return true
}

export function resolveLikelyTaskFiles(task: Task, checkpointFilesTouched: readonly string[] = []): string[] {
  const rawRoot = task.worktreePath?.trim() || task.projectPath?.trim() || ''
  const root = rawRoot ? resolveRuntimePath(rawRoot) : ''
  const out: string[] = []
  const seen = new Set<string>()
  const importedSourceHints = task.notes
    .flatMap((note) => {
      const content = typeof note.content === 'string' ? note.content.trim() : ''
      const match = content.match(/^Imported from:\s*(.+)$/i)
      if (!match?.[1]) return []
      return match[1]
        .split(',')
        .map((candidate) => candidate.trim())
        .filter(isActionableFileCandidate)
    })
  const reviewerFeedbackText = task.notes
    .filter((note) => note.role === 'reviewer' || note.agentId === 'reviewer-fanout' || note.agentId === 'reviewer-agent')
    .slice(-3)
    .map((note) => note.content)
    .join('\n')
  const specText = `${task.title}
${task.description}
${task.spec ?? ''}
${task.productBrief?.userJob ?? ''}
${task.productBrief?.successMetric ?? ''}
${reviewerFeedbackText}`
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
  const referencedBacktickedTestHints = Array.from(
    specText.matchAll(/`([^`]+\.(?:test|spec)\.ts)`/g),
    (match) => (match[1] ?? '').trim(),
  ).filter(isActionableFileCandidate)
  const bareMetricHints = Array.from(
    specText.matchAll(/(?:^|[\s(])([A-Za-z0-9_./\-[\]]+\.(?:ts|tsx|js|jsx|vue|md|json|yaml|yml))(?=$|[\s),.:;])/gm),
    (match) => (match[1] ?? '').trim(),
  )
    .filter(isActionableFileCandidate)
  const localWebStarterHints =
    rootedHints.length === 0 &&
    fallbackBacktickedHints.length === 0 &&
    referencedBacktickedTestHints.length === 0 &&
    bareMetricHints.length === 0 &&
    checkpointFilesTouched.length === 0 &&
    shouldInferLocalWebAppStarterFiles(specText)
      ? shouldInferSingleFileWebApp(specText)
        ? SINGLE_FILE_WEB_APP_FILES
        : LOCAL_WEB_APP_STARTER_FILES
      : []
  const preferredRootPrefix =
    rootedHints
      .map((candidate) => candidate.split('/'))
      .find((segments) => segments.length >= 2 && ['app', 'src', 'tests', 'server'].includes(segments[1] ?? ''))
      ?.[0] ?? ''

  const listRepoFiles = (repoRoot: string): string[] => {
    const normalized = path.resolve(repoRoot)
    const cached = repoFileCache.get(normalized)
    if (cached) return cached
    try {
      const stdout = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: normalized, encoding: 'utf-8', maxBuffer: 1024 * 1024 },
      )
      const files = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      repoFileCache.set(normalized, files)
      return files
    } catch {
      repoFileCache.set(normalized, [])
      return []
    }
  }

  const resolveRepoSuffixMatch = (repoRoot: string, candidate: string): string | null => {
    const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalizedCandidate) return null
    const matches = listRepoFiles(repoRoot).filter((file) => {
      const normalizedFile = file.replace(/\\/g, '/')
      return (
        normalizedFile === normalizedCandidate ||
        normalizedFile.endsWith(`/${normalizedCandidate}`)
      )
    })
    if (matches.length === 0) return null
    const preferred = matches.find((file) => /(?:^|\/)(src|app|tests|server)\//.test(file))
    return path.resolve(repoRoot, preferred ?? matches[0]!)
  }

  const normalizeCandidate = (trimmed: string): string => {
    if (trimmed.startsWith('/')) return path.resolve(trimmed)
    const withPrefix =
      preferredRootPrefix &&
      !trimmed.startsWith(`${preferredRootPrefix}/`) &&
      (trimmed.startsWith('tests/') || trimmed.startsWith('app/') || trimmed.startsWith('src/') || trimmed.startsWith('server/'))
        ? `${preferredRootPrefix}/${trimmed}`
        : trimmed
    if (!root) return withPrefix
    const nuxtWebPrefixed =
      !withPrefix.startsWith('web/') &&
      (withPrefix.startsWith('server/') || withPrefix.startsWith('app/') || withPrefix.startsWith('tests/')) &&
      existsSync(path.join(root, 'web', withPrefix.split('/')[0]!))
        ? `web/${withPrefix}`
        : withPrefix
    const rootBasename = path.basename(root)
    const deprojectedPath =
      rootBasename &&
      nuxtWebPrefixed.startsWith(`${rootBasename}/`)
        ? nuxtWebPrefixed.slice(rootBasename.length + 1)
        : ''
    if (deprojectedPath) {
      const candidate = path.resolve(root, deprojectedPath)
      if (existsSync(candidate)) return candidate
    }
    const rootedPath = path.resolve(root, nuxtWebPrefixed)
    if (existsSync(rootedPath)) return rootedPath
    const firstSlash = nuxtWebPrefixed.indexOf('/')
    if (firstSlash > 0) {
      const deprojectedLegacySourcePath = nuxtWebPrefixed.slice(firstSlash + 1)
      if (deprojectedLegacySourcePath) {
        const legacyCandidate = path.resolve(root, deprojectedLegacySourcePath)
        if (existsSync(legacyCandidate)) return legacyCandidate
      }
    }
    return (
      resolveRepoSuffixMatch(root, nuxtWebPrefixed) ??
      (deprojectedPath ? resolveRepoSuffixMatch(root, deprojectedPath) : null) ??
      resolveRepoSuffixMatch(root, withPrefix) ??
      resolveRepoSuffixMatch(root, trimmed) ??
      rootedPath
    )
  }

  const push = (candidate: string) => {
    const trimmed = candidate.trim()
    if (!trimmed) return
    const normalized = normalizeCandidate(trimmed)
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  for (const candidate of importedSourceHints) {
    push(candidate)
  }
  for (const candidate of rootedHints) {
    push(candidate)
  }
  for (const candidate of fallbackBacktickedHints) {
    push(candidate)
  }
  for (const candidate of referencedBacktickedTestHints) {
    push(candidate)
  }
  for (const candidate of bareMetricHints) {
    push(candidate)
  }
  for (const candidate of localWebStarterHints) {
    push(candidate)
  }
  for (const candidate of checkpointFilesTouched) {
    push(candidate)
  }
  return out.slice(0, 8)
}

function shouldInferLocalWebAppStarterFiles(specText: string): boolean {
  const normalized = specText.toLowerCase()
  const asksForRunnableApp =
    /\b(?:build|create|scaffold|implement)\b/.test(normalized) &&
    /\b(?:app|web app|page|ui|browser)\b/.test(normalized)
  const localWebSurface =
    /\bsingle-page\b/.test(normalized) ||
    /\bdependency-free\b/.test(normalized) ||
    /\bplain html\b/.test(normalized) ||
    /\bindex\.html\b/.test(normalized) ||
    /\blocal web\b/.test(normalized) ||
    /\bstatic web\b/.test(normalized) ||
    /\bbrowser-proof(?:able)?\b/.test(normalized) ||
    /\bbrowser proof\b/.test(normalized) ||
    /\blocal runtime\/browser proof\b/.test(normalized)
  const excludesGeneratedPaths =
    !/\b(?:ios|android|react native|swiftui|electron|backend service|api server)\b/.test(normalized)
  return asksForRunnableApp && localWebSurface && excludesGeneratedPaths
}

function shouldInferSingleFileWebApp(specText: string): boolean {
  const normalized = specText.toLowerCase()
  const namesSingleHtml =
    /\bsingle file\b/.test(normalized) ||
    /\bsingle `?index\.html`? file\b/.test(normalized) ||
    /\bindex\.html\b/.test(normalized)
  const excludesPackage =
    /\bno package\.json\b/.test(normalized) ||
    /\bno npm\b/.test(normalized) ||
    /\bno build (?:step|tools?)\b/.test(normalized) ||
    /\bdo not require npm install\b/.test(normalized)
  return namesSingleHtml && excludesPackage
}

function renderLikelyTaskFiles(task: Task, checkpointFilesTouched: readonly string[] = []): string {
  const files = resolveLikelyTaskFiles(task, checkpointFilesTouched)
  if (files.length === 0) return ''
  return ['**Likely target files:**', ...files.map((file) => `- ${file}`)].join('\n')
}

function looksLikeBrittleImplementationRecovery(text: string): boolean {
  return /\b(?:exact string|search string|string (?:was )?not found|template syntax mismatch|whitespace|formatting mismatch|failed to edit|attempts? to edit|replace failed|patch failed)\b/i.test(text) &&
    /\b(?:component exists|correctly imported|current file|template|props?|composable|import|\.vue|\.svelte|\.tsx?|\.jsx?)\b/i.test(text)
}

function renderRetryCoaching(input: {
  task: Task
  latestRevisionFeedback: string
  likelyFiles: readonly string[]
}): string {
  if (input.task.status !== 'in_progress') return ''

  const latestFeedback = input.latestRevisionFeedback.trim()
  const resolvedImplementationRecovery = [...input.task.escalations]
    .reverse()
    .find((escalation) => {
      if (!escalation.resolvedAt) return false
      const text = `${escalation.reason}\n${escalation.summary}\n${escalation.details ?? ''}\n${escalation.resolution ?? ''}`
      return looksLikeBrittleImplementationRecovery(text) || /implementation recovery/i.test(text)
    })
  const repeatedReviewLoop =
    input.task.revisionCount >= RETRY_COACHING_AFTER_REVISIONS &&
    latestFeedback.length > 0
  if (!repeatedReviewLoop && !resolvedImplementationRecovery) return ''

  const targetFiles = input.likelyFiles.slice(0, 4)
  const lines = [
    latestFeedback.length > 0
      ? 'You are in a retry, so do not merely replay the previous attempt. Use the reviewer feedback as a diagnosis and change your approach before editing.'
      : 'You are in a retry, so do not merely replay the previous attempt. Use the resolved recovery evidence as a diagnosis and change your approach before editing.',
  ]

  if (resolvedImplementationRecovery) {
    lines.push(
      'Do not ask the owner about local implementation mechanics such as component props, imports, template syntax, whitespace, or exact-string edit failures.',
      'Re-read the current target file and the referenced component/API before editing; avoid exact-string replacement when the file has drifted, and make a smaller structural edit against the current source.',
    )
  }

  if (repeatedReviewLoop) {
    lines.push(
      'Before changing code, compare the latest reviewer feedback to the current file contents and identify the specific still-failing item you are fixing.',
      'After the edit, run the narrowest verification that proves that item changed, then update the self-critique with the exact evidence.',
    )
  }

  if (targetFiles.length > 0) {
    lines.push('Start by reading these files in order:')
    lines.push(...targetFiles.map((file) => `- ${file}`))
  }

  return lines.join('\n')
}

function renderActiveRecoveryPlaybook(task: Task): string {
  const note = [...task.notes].reverse().find((candidate) => {
    if (candidate.role !== 'recovery-playbook') return false
    try {
      const parsed = JSON.parse(candidate.content) as Record<string, unknown>
      return parsed['status'] === 'started'
    } catch {
      return false
    }
  })
  if (!note) return ''
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(note.content) as Record<string, unknown>
  } catch {
    return ''
  }
  const playbook = typeof parsed['playbook'] === 'string' ? parsed['playbook'] : 'recovery'
  const summary = typeof parsed['summary'] === 'string' ? parsed['summary'] : ''
  const command = typeof parsed['command'] === 'string' ? parsed['command'] : ''
  const maxTurns = typeof parsed['maxTurns'] === 'number' ? parsed['maxTurns'] : undefined
  const allowedPaths = Array.isArray(parsed['allowedPaths'])
    ? parsed['allowedPaths'].filter((value): value is string => typeof value === 'string')
    : []
  const allowedTools = Array.isArray(parsed['allowedTools'])
    ? parsed['allowedTools'].filter((value): value is string => typeof value === 'string')
    : []

  return [
    `**Playbook:** ${playbook}`,
    summary ? `- Summary: ${summary}` : '',
    command ? `- Authoritative command: \`${command}\`` : '',
    allowedPaths.length > 0 ? `- Allowed paths: ${allowedPaths.join(', ')}` : '',
    allowedTools.length > 0 ? `- Allowed tools: ${allowedTools.join(', ')}` : '',
    typeof maxTurns === 'number' ? `- Max turns: ${maxTurns}` : '',
    '- Do not do broad repo research while this focused recovery playbook is active.',
    '- If the allowed paths or command are no longer valid, raise a concrete escalation instead of improvising outside the playbook.',
  ].filter(Boolean).join('\n')
}

function renderProjectSkills(task: Task, memoryDir: string, enabled: boolean): string {
  if (!enabled) return ''
  const skillSearchText = [
    task.title,
    task.description,
    task.spec ?? '',
    task.productBrief?.userJob ?? '',
    task.productBrief?.successMetric ?? '',
    ...task.acceptanceCriteria.map((criterion) => criterion.description),
  ].join('\n')
  const skills = selectRelevantProjectSkills(
    readProjectSkillProposals(memoryDir),
    skillSearchText,
  )
  if (skills.length === 0) return ''
  return skills
    .map((skill) => [
      `**${skill.name}:** ${skill.description}`,
      skill.content.trim(),
    ].join('\n'))
    .join('\n\n')
}

function isFrontendUiTask(task: Task): boolean {
  return UI_TASK_RE.test([
    task.title,
    task.description,
    task.spec ?? '',
    task.productBrief?.userJob ?? '',
    task.productBrief?.successMetric ?? '',
    ...task.acceptanceCriteria.map((criterion) => criterion.description),
  ].join('\n'))
}

function renderFrontendUiDesignQualityBar(task: Task): string {
  if (!isFrontendUiTask(task)) return ''
  return [
    '### Frontend/UI Design Quality Bar',
    'Functional acceptance is not enough. Build a shippable product surface: composition, hierarchy, density, copy, affordance, motion, and palette must work together.',
    '- Pick the right product layout, not a generic centered demo.',
    '- Use realistic domain data and compact IA.',
    '- Require screenshots/live previews when visual presentation changed.',
    '- Revise checklist-compliant but visually weak work before review.',
  ].join('\n')
}

function looksLikeStaleNewRequestBrief(task: Task): boolean {
  const brief = task.productBrief
  if (!brief || brief.approvedAt) return false
  const text = `${brief.userJob}\n${brief.successMetric}`
  if (!/\bNew request\b/i.test(text)) return false
  const taskText = `${task.title}\n${task.description}\n${task.spec ?? ''}`
  return !/^\s*New request\s*$/i.test(task.title) && taskText.trim().length > 0
}

function renderProductBriefContext(task: Task): string {
  if (!task.productBrief || looksLikeStaleNewRequestBrief(task)) return ''
  const nonGoals = task.productBrief.nonGoals ?? []
  const antiPatterns = task.productBrief.antiPatterns ?? []
  return `\n### Product Brief${task.productBrief.approvedAt ? ' (human-approved)' : ' (DRAFT — not yet approved)'}\n**User job:** ${task.productBrief.userJob}${task.productBrief.whyItMattersNow ? `\n**Why it matters now:** ${task.productBrief.whyItMattersNow}` : ''}\n**Success metric:** ${task.productBrief.successMetric}${nonGoals.length > 0 ? `\n**Non-goals:**\n${nonGoals.map(a => `- ${a}`).join('\n')}` : antiPatterns.length > 0 ? `\n**Anti-patterns (must NOT do):**\n${antiPatterns.map(a => `- ${a}`).join('\n')}` : ''}${task.productBrief.rolloutPlan ? `\n**Rollout plan:** ${task.productBrief.rolloutPlan}` : ''}`
}

function summarizeRawDesignSystem(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return [
    '**Draft design system:** raw `.guildhall/design-system.yaml` could not be normalized yet, but it is still authoritative design context for this task. Preserve its intent and normalize it later instead of ignoring it.',
    '',
    '```yaml',
    clipContextBlock(trimmed, 3500),
    '```',
  ].join('\n')
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
  if (/^(?:none|null|n\/a|na|nothing)$/i.test(nextAction)) return ''
  const hasSelfCritique = hasWorkerSelfCritiqueNote(task)
  const hasRecordedVerificationFailure = checkpoint?.resumeContext?.verification?.some(
    (entry) => entry.passed === false,
  ) ?? false
  if (
    hasSelfCritique &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(nextAction)
  ) {
    return 'Resume from the latest self-critique and recorded verification evidence, then hand off to review.'
  }
  if (
    !hasSelfCritique &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(nextAction) &&
    /hand off to review|handoff to review|transition to review/i.test(nextAction)
  ) {
    return 'Resume from the active worktree diff, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.'
  }
  if (
    hasRecordedVerificationFailure &&
    /resume from the active worktree diff/i.test(nextAction) &&
    /refresh focused verification/i.test(nextAction)
  ) {
    return 'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.'
  }
  return nextAction
}

function renderLatestCheckpoint(task: Task, checkpoint: Checkpoint | null): string {
  if (!checkpoint) return ''
  const nextAction = normalizedCheckpointNextAction(task, checkpoint)
  const lines = [
    `**Step ${checkpoint.step}** by ${checkpoint.agentId} at ${checkpoint.writtenAt}`,
    `- Intent: ${checkpoint.intent}`,
  ]
  if (nextAction) lines.push(`- Next planned action: ${nextAction}`)
  if (checkpoint.filesTouched.length > 0) {
    lines.push(`- Files touched: ${checkpoint.filesTouched.join(', ')}`)
  }
  if (checkpoint.resumeContext?.verification?.length) {
    const latestVerification = checkpoint.resumeContext.verification[checkpoint.resumeContext.verification.length - 1]
    if (latestVerification) {
      lines.push(
        `- Latest authoritative verification: ${latestVerification.command} (${latestVerification.passed ? 'passed' : 'failed'})${latestVerification.summary ? ` — ${latestVerification.summary}` : ''}`,
      )
    }
  }
  if (checkpoint.resumeContext?.companionFiles?.length) {
    lines.push(`- Companion files: ${checkpoint.resumeContext.companionFiles.join(', ')}`)
  }
  if (checkpoint.resumeContext?.workingHypothesis?.trim()) {
    lines.push(`- Working hypothesis: ${checkpoint.resumeContext.workingHypothesis.trim()}`)
  }
  if (checkpoint.resumeContext?.safeNextMutationSurface?.length) {
    lines.push(`- Safe next mutation surface: ${checkpoint.resumeContext.safeNextMutationSurface.join(', ')}`)
  }
  return lines.join('\n')
}

function shouldUseCheckpointForTask(task: Task, checkpoint: Checkpoint | null): checkpoint is Checkpoint {
  if (!checkpoint) return false
  if (checkpointIsFreshForTask(task, checkpoint)) return true
  return task.notes.some((note) => {
    if (note.role !== 'recovery') return false
    const noteAt = Date.parse(note.timestamp)
    const checkpointAt = Date.parse(checkpoint.writtenAt)
    return (
      Number.isFinite(noteAt) &&
      Number.isFinite(checkpointAt) &&
      noteAt >= checkpointAt &&
      /latest recovery checkpoint|latest durable checkpoint/i.test(note.content)
    )
  })
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

async function collectEnvManifest(projectRoot: string, task: Task): Promise<string> {
  const taskText = [
    task.title,
    task.description,
    task.spec ?? '',
    task.blockReason ?? '',
    ...task.acceptanceCriteria.map((criterion) => criterion.description),
  ].join('\n')
  if (!ENV_CONTEXT_TASK_RE.test(taskText)) return ''

  const found: Array<{ relativePath: string; keys: string[] }> = []
  const visited = new Set<string>()

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (found.length >= MAX_ENV_MANIFEST_FILES || depth > 2) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (found.length >= MAX_ENV_MANIFEST_FILES) return
      if (
        entry.name === '.git' ||
        entry.name === '.guildhall' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.output' ||
        entry.name === '.nuxt'
      ) {
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !ENV_FILE_RE.test(entry.name)) continue
      const relativePath = path.relative(projectRoot, full).replace(/\\/g, '/')
      if (visited.has(relativePath)) continue
      visited.add(relativePath)
      let content = ''
      try {
        content = await readManagedTextFile(full, 'utf-8')
      } catch {
        continue
      }
      const keys = Array.from(new Set(content
        .split(/\r?\n/)
        .map((line) => ENV_KEY_RE.exec(line)?.[1])
        .filter((key): key is string => Boolean(key))))
        .slice(0, MAX_ENV_MANIFEST_KEYS_PER_FILE)
      if (keys.length > 0) found.push({ relativePath, keys })
    }
  }

  await walk(projectRoot, 0)
  if (found.length === 0) return ''
  return [
    '### Environment Files (names only; values redacted)',
    'Use this to distinguish credentials that already exist locally from credentials or provider-dashboard access that still must be created or configured. Never print or store secret values.',
    ...found.map((file) => `- ${file.relativePath}: ${file.keys.join(', ')}`),
  ].join('\n')
}

function constructionResponsibility(mode: ConstructionMode): string {
  switch (mode) {
    case 'survey':
      return 'Gather project facts, constraints, and evidence before proposing work.'
    case 'blueprint':
      return 'Draft or revise the task blueprint with enough detail for build and inspection.'
    case 'frame':
      return 'Sequence and prepare the accepted blueprint into runnable work.'
    case 'build':
      return 'Implement against the accepted blueprint, using repo conventions for routine choices.'
    case 'inspect':
      return 'Inspect completed work against the blueprint, standards, and verification evidence.'
    case 'change_order':
      return 'Explain the changed assumption or scope evidence before asking for an owner decision.'
    case 'punch_list':
      return 'Finish, verify, or explicitly defer small remaining work without reopening broad scope.'
  }
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
  const worktreePath = resolveRuntimePath(task.worktreePath)
  try {
    const { stdout } = await execFileP('git', ['status', '--short', '--untracked-files=all'], {
      cwd: worktreePath,
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
      `**Active worktree:** ${worktreePath}`,
      '**Changed files to resume from first:**',
      ...shown.map((line) => `- ${line}`),
      extra > 0 ? `- ...and ${extra} more` : '',
    ].filter(Boolean).join('\n')
  } catch {
    return task.worktreePath ? `**Active worktree:** ${worktreePath}` : ''
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
   * FR-23: business-envelope summary for the task's goal. Empty when
   * the task has no `businessEnvelope.goalId` or the goal book is absent. Agents see the
   * goal title, success condition, and guardrails so they can self-check
   * against the envelope before taking destructive actions; the coordinator
   * makes the authoritative call via `evaluateEnvelope`.
   */
  envelope: string
  /**
   * Approved (or draft) design-system summary — tokens, primitives, copy
   * voice, a11y baseline. Empty when .guildhall/design-system.yaml is absent so
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
  /**
   * Compact architecture/corpus navigation for this task. Workers use this to
   * find existing primitives, helpers, and area conventions before editing.
   */
  corpusMap: string
  workerMode?: SelectedWorkerMode
  languageMap?: string
  reviewPacket?: string
  proofPaths?: string
  completionHandoff?: string
  effectiveMemory?: string
  effectiveMemoryPacket?: EffectiveMemoryPacket
  structuralMapContext?: string
  structuralMapOmitted?: StructuralContextSlice['omitted']
  contractSurfacePackets?: string
  deliverySpineContext?: string
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
  memoryDir: string,
  opts: { projectSkillsEnabled?: boolean } = {},
): Promise<BuiltContext> {
  const readSafe = async (file: string): Promise<string> => {
    try {
      return await readManagedTextFile(path.join(memoryDir, file), 'utf-8')
    } catch {
      return ''
    }
  }

  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const [memory, progress, decisions, designSystemRaw, exploring, goal, ds, worktreeResume, checkpoint, codebaseMap, languageMapData, envManifest] = await Promise.all([
    readSafe('MEMORY.md'),
    readSafe('PROGRESS.md'),
    readSafe('DECISIONS.md'),
    readSafe('design-system.yaml'),
    // Only bother with the transcript when we're actually in the exploring phase.
    task.status === 'exploring'
      ? readManagedTextFile(getProjectTranscriptPath(projectRoot, 'exploring', task.id), 'utf-8').catch(() => readSafe(path.join('exploring', `${task.id}.md`)))
      : Promise.resolve(''),
    // FR-23: resolve the task's parent goal. Missing-goal cases become
    // `undefined` — the summary renderer omits the envelope block.
    loadGoalForTask(memoryDir, task).catch(() => undefined),
    loadDesignSystem(memoryDir).catch(() => undefined),
    summarizeActiveWorktree(task),
    task.status === 'in_progress'
      ? readCheckpoint(memoryDir, task.id)
          .then((checkpoint) => shouldUseCheckpointForTask(task, checkpoint) ? checkpoint : null)
          .catch(() => null)
      : Promise.resolve(null),
    loadOrCreateCodebaseMap(memoryDir, task).catch(() => null),
    loadLanguageMap(memoryDir).catch(() => null),
    collectEnvManifest(projectRoot, task).catch(() => ''),
  ])
  const reviewPacket =
    task.status === 'review' || task.status === 'gate_check'
      ? await readManagedTextFile(path.join(getProjectTaskLocalHistoryDir(projectRoot, task.id), 'review-packet.md'), 'utf-8')
          .catch(() => readSafe(path.join('tasks', task.id, 'review-packet.md')))
      : ''

  const projectMemory = extractRelevantMemorySections(memory, task)
  const recentProgress = extractRecentProgress(progress)
  const recentDecisions = extractRelevantDecisions(decisions, task.domain)
  const exploringTranscript = exploring
    ? exploring.slice(-MAX_EXPLORING_CHARS)
    : ''
  const envelope = goal
    ? [
        `**Goal envelope:** ${goal.id} — ${goal.title} (${goal.status})`,
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
  } else if (task.status === 'in_progress') {
    personaPrompt = primaryEngineer
      ? renderPersonaPrompt(primaryEngineer, guildSignals)
      : [
          '## Worker role guidance',
          '',
          'You are the implementation worker for this task. Use the saved spec, acceptance criteria, project memory, and repository evidence to make the smallest coherent change that satisfies the task.',
          'Before inventing a component, command, file path, or dependency, verify it exists or create it deliberately as part of the implementation.',
          'Run the task success gates or the closest project-specific verification command before asking for review.',
        ].join('\n')
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

  const designSystem = ds ? summarizeDesignSystem(ds) : summarizeRawDesignSystem(designSystemRaw)
  const rubricSelection = selectApplicableReviewRubrics(task, ds)
  const coreRubrics = renderRubricSelection(rubricSelection)
  // Reviewer rubric items are attached per-reviewer at dispatch time (fan-out),
  // not pushed into the worker context. collectGuildRubrics is kept available
  // for the reviewer dispatcher.
  void collectGuildRubrics
  const reviewRubrics = coreRubrics
  const latestCheckpoint = renderLatestCheckpoint(task, checkpoint)
  const likelyTaskFiles = renderLikelyTaskFiles(task, checkpoint?.filesTouched ?? [])
  const corpusMap = codebaseMap
    ? buildWorkerCorpusContext(
        codebaseMap,
        {
          id: task.id,
          title: task.title,
          description: [
            task.description,
            task.spec ?? '',
            task.productBrief?.userJob ?? '',
            task.productBrief?.successMetric ?? '',
            ...task.acceptanceCriteria.map((criterion) => criterion.description),
          ].filter(Boolean).join('\n'),
          domain: task.domain,
          acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({
            description: criterion.description,
            command: criterion.command,
          })),
          likelyFiles: resolveLikelyTaskFiles(task, checkpoint?.filesTouched ?? []).map((file) => {
            const rawRoot = task.worktreePath?.trim() || task.projectPath?.trim() || codebaseMap.project.root
            const root = resolveRuntimePath(rawRoot)
            const relative = path.relative(root, file).replace(/\\/g, '/')
            return relative.startsWith('..') ? file : relative
          }),
        },
        { maxChars: MAX_CORPUS_MAP_CHARS },
      )
    : ''
  const activeRecoveryPlaybook = renderActiveRecoveryPlaybook(task)
  const projectSkills = renderProjectSkills(task, memoryDir, opts.projectSkillsEnabled === true)
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
  const likelyTaskFileList = resolveLikelyTaskFiles(task, checkpoint?.filesTouched ?? [])
  const retryCoaching = renderRetryCoaching({
    task,
    latestRevisionFeedback,
    likelyFiles: likelyTaskFileList,
  })
  const recentAgentNotes = task.notes
    .filter((note) => note.role !== 'reviewer')
    .slice(-MAX_AGENT_NOTES)
    .map((note) =>
      `**${note.agentId} (${note.role})** ${note.timestamp}:\n${clipContextBlock(note.content, MAX_AGENT_NOTE_CHARS)}`,
    )
  const specOverview = renderSpecOverview(task)
  const constructionMode = constructionModeForTask({
    status: task.status,
    blocker: task.blockReason,
  })
  const workerMode = task.status === 'in_progress' ? selectWorkerMode(task) : undefined
  const workerModePrompt = workerMode ? renderWorkerMode(workerMode) : ''
  const languageMap = languageMapData
    ? renderLanguageMapContext(languageMapData, [
        task.title,
        task.description,
        task.spec ?? '',
        task.productBrief?.userJob ?? '',
        task.productBrief?.successMetric ?? '',
      ].join('\n'))
    : ''
  const parsedProofPaths = parseProofPaths((task as Task & { proofPaths?: unknown }).proofPaths)
  const proofPaths = buildProofPathContext(parsedProofPaths)
  const completionHandoff = parseCompletionHandoff((task as Task & { completionHandoff?: unknown }).completionHandoff)
  const completionHandoffContext = completionHandoff ? renderCompletionHandoffContext(completionHandoff) : ''
  const effectiveMemoryPacket = await buildEffectiveMemoryPacket({ memoryDir, task }).catch(() => ({
    included: [],
    withheld: [],
    evidenceRefs: [],
    rendered: '',
  }))
  const effectiveMemory = effectiveMemoryPacket.rendered
  const structuralMap = readAcceptedStructuralMap(projectRoot)
  const structuralRole = structuralAgentRoleForTask(task)
  const structuralTask = {
    id: task.id,
    title: task.title,
    files: resolveLikelyTaskFiles(task),
    text: `${task.description}\n${task.spec ?? ''}`,
  }
  const structuralMapSlice = structuralMap ? buildStructuralContextSlice(structuralMap, structuralTask) : null
  const structuralMapContext = structuralMap
    ? renderStructuralAgentPacket({
        map: structuralMap,
        task: structuralTask,
        role: structuralRole,
      })
    : ''
  const structuralMapOmitted = structuralMapSlice?.omitted ?? []
  const contractSurfacePackets = task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check'
    ? renderSurfaceReviewPacketsMarkdown(task.contractSurfaceReviewPackets ?? [])
    : ''
  const deliverySpineContext = task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check'
    ? await buildDeliverySpineWorkerContext({ projectRoot, memoryDir, task }).catch(() => '')
    : ''

  const taskSummary = [
    `## Current Task: ${task.id}`,
    `**Title:** ${task.title}`,
    `**Domain:** ${task.domain}`,
    `**Status:** ${task.status}`,
    `**Construction mode:** ${constructionMode}`,
    `**Construction responsibility:** ${constructionResponsibility(constructionMode)}`,
    `**Priority:** ${task.priority}`,
    task.blockReason
      ? `**Current blocker:** ${task.blockReason}`
      : '',
    specOverview ? `\n### Spec Overview\n${specOverview}` : '',
    renderProductBriefContext(task),
    renderFrontendUiDesignQualityBar(task),
    task.acceptanceCriteria.length > 0
      ? `\n### Acceptance Criteria\n${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}`
      : '',
    task.outOfScope.length > 0
      ? `\n### Out of Scope\n${task.outOfScope.map(s => `- ${s}`).join('\n')}`
      : '',
    clippedRevisionFeedback
      ? `\n### Latest Required Revisions\n${clippedRevisionFeedback}`
      : '',
    retryCoaching
      ? `\n### Retry Coaching\n${retryCoaching}`
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
    activeRecoveryPlaybook
      ? `\n### Active Recovery Playbook\n${activeRecoveryPlaybook}`
      : '',
    envManifest
      ? `\n${envManifest}`
      : '',
    projectSkills
      ? `\n### Project Skills\n${projectSkills}`
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
    structuralMapContext,
    '',
    personaPrompt,
    '',
    workerModePrompt,
    '',
    envelope ? `## Business Envelope (FR-23)\n${envelope}` : '',
    '',
    designSystem ? `## Design System\n${designSystem}` : '',
    '',
    reviewRubrics ? `## Review Rubrics (selected for this task)\n${reviewRubrics}` : '',
    '',
    reviewPacket ? `## Review Packet\n${reviewPacket}` : '',
    '',
    contractSurfacePackets,
    '',
    deliverySpineContext,
    '',
    corpusMap,
    '',
    languageMap,
    '',
    proofPaths,
    '',
    completionHandoffContext,
    '',
    effectiveMemory,
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
    corpusMap,
    workerMode,
    languageMap,
    reviewPacket,
    proofPaths,
    completionHandoff: completionHandoffContext,
    effectiveMemory,
    effectiveMemoryPacket,
    structuralMapContext,
    structuralMapOmitted,
    contractSurfacePackets,
    deliverySpineContext,
    formatted,
  }
}

async function buildDeliverySpineWorkerContext(input: {
  projectRoot: string
  memoryDir: string
  task: Task
}): Promise<string> {
  const queue = await readTaskQueueForContext(input.memoryDir)
  const tasks = queue.tasks.some(candidate => candidate.id === input.task.id)
    ? queue.tasks
    : [...queue.tasks, input.task]
  const model = await readProjectDeliveryModel(input.projectRoot)
  if (!input.task.delivery && model.drivers.length === 0 && model.primitives.length === 0) return ''
  const packet = buildTaskContextPacket({ model, tasks, taskId: input.task.id })
  return renderDeliverySpineContext(packet)
}

async function readTaskQueueForContext(memoryDir: string): Promise<{ tasks: Task[] }> {
  try {
    const raw = await readManagedTextFile(path.join(memoryDir, 'TASKS.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    return TaskQueue.parse(Array.isArray(parsed) ? { version: 1, tasks: parsed } : parsed)
  } catch {
    return { tasks: [] }
  }
}

function renderDeliverySpineContext(packet: TaskContextPacket): string {
  const lines: string[] = ['## Delivery Spine Context']
  lines.push('')
  if (packet.whyThisNow) {
    lines.push('### Why this now')
    lines.push(packet.whyThisNow)
    lines.push('')
  }
  if (packet.persona) {
    lines.push('### Delivery persona')
    lines.push(`${packet.persona.label} (${packet.persona.id})`)
    if (packet.persona.guardrails.length > 0) {
      lines.push(...packet.persona.guardrails.map(guardrail => `- ${guardrail}`))
    }
    lines.push('')
  }
  const intent = packet.deliveryIntent
  const intentLines = [
    intent.driver ? `Driver: ${intent.driver.label}` : '',
    intent.provider ? `Provider: ${intent.provider.label}` : '',
    intent.containingPackage ? `Package: ${intent.containingPackage.title}` : '',
    intent.supports.length > 0 ? `Supports: ${intent.supports.join(', ')}` : '',
  ].filter(Boolean)
  if (intentLines.length > 0) {
    lines.push('### Delivery intent')
    lines.push(...intentLines)
    lines.push('')
  }
  const direct = packet.primitiveContext.direct.map(primitive => primitive.label)
  const ancestors = packet.primitiveContext.ancestors.map(primitive => primitive.label)
  const blockers = packet.primitiveContext.blockers.map(primitive => primitive.label)
  if (direct.length > 0 || ancestors.length > 0 || blockers.length > 0) {
    lines.push('### Primitive context')
    if (direct.length > 0) lines.push(`Uses: ${direct.join(', ')}`)
    if (ancestors.length > 0) lines.push(`Primitive ancestors: ${ancestors.join(' -> ')}`)
    if (blockers.length > 0) lines.push(`Primitive blockers: ${blockers.join(', ')}`)
    for (const invariant of packet.primitiveContext.invariants.slice(0, 12)) {
      lines.push(`- ${invariant.primitiveLabel}: ${invariant.invariant}`)
    }
    lines.push('')
  }
  const proof = packet.proofContext
  if (proof.proofKind || proof.requiredProof.length > 0 || proof.provesPrimitives.length > 0) {
    lines.push('### Proof')
    if (proof.proofKind) lines.push(`Proof kind: ${proof.proofKind}`)
    if (proof.provesPrimitives.length > 0) {
      lines.push(`This task proves: ${proof.provesPrimitives.map(primitive => primitive.label).join(', ')}`)
    }
    for (const obligation of proof.requiredProof.slice(0, 8)) {
      lines.push(`- ${obligation.primitiveLabel}: ${obligation.proof}`)
    }
    if (proof.existingEvidence.length > 0) lines.push(`Existing evidence: ${proof.existingEvidence.join(', ')}`)
    lines.push('')
  }
  if (packet.correctionHooks.length > 0) {
    lines.push('### Correction hooks')
    lines.push('If the driver, provider, primitive, blocker, or proof expectation is wrong, record the correction instead of silently following the wrong context.')
  }
  return lines.join('\n').trim()
}

function structuralAgentRoleForTask(task: Task): StructuralAgentRole {
  if (task.status === 'exploring') return 'spec'
  if (task.status === 'review') return 'reviewer'
  if (task.status === 'gate_check') return 'gate_checker'
  return 'worker'
}

function parseProofPaths(value: unknown): ProofPathType[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = ProofPath.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function parseCompletionHandoff(value: unknown): CompletionHandoffType | null {
  const parsed = CompletionHandoff.safeParse(value)
  return parsed.success ? parsed.data : null
}
