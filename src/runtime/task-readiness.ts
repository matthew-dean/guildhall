import type {
  ContextBudgetEstimate,
  DefinitionOfDone,
  IfThenBlockerPlan,
  Task,
  TaskKind,
  TaskReadinessAssessment,
  TaskReadinessDimension,
  TaskReadinessRecommendation,
} from '@guildhall/core'
import { taskKindFor } from './task-kinds.js'

const DEFAULT_ASSESSED_BY = 'coordinator-readiness'

export function assessTaskReadiness(task: Task, opts: { now?: string } = {}): TaskReadinessAssessment {
  const now = opts.now ?? new Date().toISOString()
  const taskKind = taskKindFor(task)
  const definitionOfDone = definitionOfDoneForTask(task, { now })
  const blockerPlans = ifThenBlockerPlansForTask(task)
  const contextBudget = contextBudgetEstimate(task)
  const dimensions = readinessDimensions(task, {
    taskKind,
    definitionOfDone,
    contextBudget,
  })
  const recommendation = recommendationFor(task, dimensions, contextBudget)

  return {
    taskKind,
    recommendation,
    summary: summaryForRecommendation(recommendation),
    dimensions,
    definitionOfDone,
    blockerPlans,
    contextBudget,
    ...(recommendation === 'needs_one_question'
      ? {
          openQuestion: {
            prompt: 'What should be true when this work is finished?',
            reason: 'Outcome clarity is the blocker Guildhall cannot infer safely from the current task.',
          },
        }
      : {}),
    assessedAt: now,
    assessedBy: DEFAULT_ASSESSED_BY,
  }
}

export function definitionOfDoneForTask(task: Task, opts: { now?: string } = {}): DefinitionOfDone {
  const explicit = explicitDoneLine(task.spec)
  const kind = taskKindFor(task)
  const items = unique([
    explicit,
    ...kindDefinitionItems(kind),
    ...(task.acceptanceCriteria ?? [])
      .map(ac => ac.description?.trim())
      .filter((value): value is string => Boolean(value)),
  ])
  const evidenceRequired = unique([
    ...(task.proofPaths?.length ? ['Complete the task proof path and record the result.'] : []),
    ...(task.acceptanceCriteria?.length ? ['Acceptance criteria are checked or explicitly marked unverified.'] : []),
    ...(kind === 'implementation' ? ['Changed behavior is verified by an automated, browser, or manual proof step.'] : []),
  ])

  return {
    items: items.length > 0 ? items : kindDefinitionItems(kind),
    evidenceRequired,
    updatedAt: opts.now,
    createdBy: 'task-readiness',
  }
}

export function ifThenBlockerPlansForTask(task: Task): IfThenBlockerPlan[] {
  const kind = taskKindFor(task)
  const plans: IfThenBlockerPlan[] = [
    {
      if: 'Verification cannot run in the current environment',
      then: 'Record the exact missing environment requirement and create setup or proof work before claiming completion.',
      owner: 'guildhall',
      reason: 'Finishability depends on honest proof.',
    },
  ]

  for (const dependency of task.dependsOn ?? []) {
    plans.push({
      if: `Dependency ${dependency} is not done`,
      then: 'Pause this work item and finish, block, or explicitly defer the dependency first.',
      owner: 'guildhall',
      reason: 'Dependencies are order constraints, not hidden implementation work.',
    })
  }

  if (kind === 'research') {
    plans.push({
      if: 'Research evidence is enough to choose a direction',
      then: 'Produce a decision-ready comparison instead of continuing into implementation.',
      owner: 'guildhall',
      reason: 'Research work should not quietly turn into implementation.',
    })
  }
  if (kind === 'decision') {
    plans.push({
      if: 'The choice changes product meaning, risk tolerance, release boundary, or business policy',
      then: 'Ask the owner for the decision with options and tradeoffs.',
      owner: 'owner',
      reason: 'Guildhall should not make product judgment invisible.',
    })
  }
  return plans
}

export function contextBudgetEstimate(task: Task): ContextBudgetEstimate {
  const text = taskText(task)
  const estimatedTokens = Math.ceil(text.length / 4)
  const reasons: string[] = []
  const surfaceCount = surfaceKeywords(text)
  if (estimatedTokens > 3500) reasons.push('The task text is large enough to crowd one worker brief.')
  if (surfaceCount >= 5) reasons.push('The task appears to span many project surfaces.')
  const risk: ContextBudgetEstimate['risk'] =
    estimatedTokens > 5000 || surfaceCount >= 6 ? 'high'
      : estimatedTokens > 2500 || surfaceCount >= 4 ? 'medium'
        : 'low'
  return {
    estimatedTokens,
    risk,
    fitsInOneWorkerBrief: risk !== 'high',
    reasons,
  }
}

function readinessDimensions(
  task: Task,
  input: {
    taskKind: TaskKind
    definitionOfDone: DefinitionOfDone
    contextBudget: ContextBudgetEstimate
  },
): TaskReadinessDimension[] {
  const text = taskText(task)
  const hasOutcome = hasClearOutcome(task, input.definitionOfDone)
  const proofable = hasProof(task, input.definitionOfDone)
  const mixedResearch = mixesResearchAndImplementation(task)
  const needsOwner = needsProductJudgment(text)
  return [
    dimension(
      'outcome_clarity',
      hasOutcome ? 'ok' : 'blocked',
      hasOutcome ? 'Outcome is specific enough to judge.' : 'Outcome is too vague to know what success means.',
      hasOutcome ? ['spec or Definition of Done names the finished state'] : ['missing acceptance criteria or finish boundary'],
    ),
    dimension(
      'size',
      isLargeTask(task, input.contextBudget) ? 'blocked' : 'ok',
      isLargeTask(task, input.contextBudget) ? 'Work is too broad for one clean worker/review pass.' : 'Work is sized for a focused pass.',
      task.sizePlan?.reasons ?? [],
    ),
    dimension(
      'proofability',
      proofable ? 'ok' : 'blocked',
      proofable ? 'Proof path or acceptance evidence is present.' : 'No proof path, acceptance check, or Definition of Done evidence is present.',
      proofable ? input.definitionOfDone.evidenceRequired : ['missing proof path'],
    ),
    dimension(
      'context_load',
      input.contextBudget.fitsInOneWorkerBrief ? input.contextBudget.risk === 'medium' ? 'warn' : 'ok' : 'blocked',
      input.contextBudget.fitsInOneWorkerBrief ? 'Useful context should fit in one worker brief.' : 'Useful context likely exceeds one worker brief.',
      input.contextBudget.reasons,
    ),
    dimension(
      'dependency_risk',
      (task.dependsOn?.length ?? 0) > 0 ? 'warn' : 'ok',
      (task.dependsOn?.length ?? 0) > 0 ? 'Dependencies must be resolved explicitly before dispatch.' : 'No explicit dependency risk.',
      task.dependsOn ?? [],
    ),
    dimension(
      'uncertainty',
      mixedResearch ? 'blocked' : uncertaintyWarning(text, input.taskKind) ? 'warn' : 'ok',
      mixedResearch ? 'Research and implementation are mixed in one task.' : uncertaintyWarning(text, input.taskKind) ? 'Uncertainty should be named before dispatch.' : 'Uncertainty is bounded for this task kind.',
      mixedResearch ? ['research and implementation language both appear'] : [],
    ),
    dimension(
      'user_judgment_exposure',
      needsOwner && !task.openQuestions?.some(question => !question.answeredAt) ? 'warn' : 'ok',
      needsOwner ? 'The task may require product or risk judgment.' : 'No obvious owner-only judgment is hidden in the task.',
      needsOwner ? ['product/risk/choice language detected'] : [],
    ),
  ]
}

function recommendationFor(
  task: Task,
  dimensions: TaskReadinessDimension[],
  contextBudget: ContextBudgetEstimate,
): TaskReadinessRecommendation {
  const byId = new Map(dimensions.map(dimension => [dimension.id, dimension]))
  if (task.status === 'shelved') return 'shelve_defer'
  if (byId.get('uncertainty')?.status === 'blocked') return 'needs_research_spike'
  if (byId.get('size')?.status === 'blocked' || byId.get('context_load')?.status === 'blocked' || !contextBudget.fitsInOneWorkerBrief) return 'split'
  if (byId.get('outcome_clarity')?.status === 'blocked') return 'needs_one_question'
  if (byId.get('proofability')?.status === 'blocked') return 'needs_one_question'
  return 'ready'
}

function summaryForRecommendation(recommendation: TaskReadinessRecommendation): string {
  switch (recommendation) {
    case 'ready':
      return 'Task is ready for a focused worker pass.'
    case 'needs_one_question':
      return 'Task needs one owner-facing answer or finishability detail before dispatch.'
    case 'needs_research_spike':
      return 'Task should run research or a spike before implementation.'
    case 'split':
      return 'Task should split into smaller finishable work items.'
    case 'shelve_defer':
      return 'Task should stay shelved or deferred until conditions change.'
  }
}

function kindDefinitionItems(kind: TaskKind): string[] {
  switch (kind) {
    case 'research':
      return ['Research output names the recommended option, alternatives considered, evidence, and unresolved questions.']
    case 'decision':
      return ['Decision record names the chosen option, tradeoffs, owner, and follow-up work.']
    case 'spike':
      return ['Spike output records what was learned, whether to proceed, and what production work remains.']
    case 'cleanup':
      return ['Cleanup removes or simplifies the target without changing intended behavior, with regression proof.']
    case 'verification':
      return ['Verification records pass/fail evidence for the named proof path.']
    case 'release':
      return ['Release work has artifacts, notes, publication steps, rollback notes, and post-release proof.']
    case 'learning':
      return ['Learning output proposes memory, practice, or preference changes without auto-activating them.']
    case 'implementation':
    default:
      return ['Implementation satisfies acceptance criteria and has recorded proof.']
  }
}

function explicitDoneLine(spec: string | undefined): string | null {
  if (!spec) return null
  const match = /what counts as done:\s*([^\n]+)/i.exec(spec)
  return match?.[1]?.replace(/^[-:\s]+/, '').trim() || null
}

function dimension(
  id: TaskReadinessDimension['id'],
  status: TaskReadinessDimension['status'],
  summary: string,
  evidence: string[] = [],
): TaskReadinessDimension {
  return { id, status, summary, evidence }
}

function hasClearOutcome(task: Task, definitionOfDone: DefinitionOfDone): boolean {
  if ((task.acceptanceCriteria?.length ?? 0) > 0) return true
  if (definitionOfDone.items.some(item => item.length > 20 && !/^Implementation satisfies/.test(item))) return true
  return /\b(done|success|outcome|user can|what counts as done|completion boundary)\b/i.test(taskText(task))
}

function hasProof(task: Task, definitionOfDone: DefinitionOfDone): boolean {
  if ((task.proofPaths?.length ?? 0) > 0) return true
  if ((task.acceptanceCriteria ?? []).some(ac => Boolean(ac.verifiedBy))) return true
  return definitionOfDone.evidenceRequired.length > 0 || /\b(test|typecheck|browser|proof|verify|screenshot|gate)\b/i.test(taskText(task))
}

function mixesResearchAndImplementation(task: Task): boolean {
  const text = taskText(task)
  return /\b(research|investigate|compare|evaluate)\b/i.test(text) &&
    /\b(implement|build|wire|add|change|migrate)\b/i.test(text)
}

function uncertaintyWarning(text: string, kind: TaskKind): boolean {
  if (kind === 'research' || kind === 'spike' || kind === 'decision') return false
  return /\b(tbd|unknown|unclear|maybe|choose|decide|best)\b/i.test(text)
}

function needsProductJudgment(text: string): boolean {
  return /\b(better|best|policy|taste|risk|rollout|pricing|business|should we|choose|decide)\b/i.test(text)
}

function isLargeTask(task: Task, contextBudget: ContextBudgetEstimate): boolean {
  if (task.sizePlan?.action === 'split_required' || task.sizePlan?.action === 'split_recommended') return true
  return contextBudget.risk === 'high' || surfaceKeywords(taskText(task)) >= 6
}

function surfaceKeywords(text: string): number {
  const keywords = ['ui', 'screen', 'api', 'database', 'migration', 'docs', 'release', 'verification', 'provider', 'settings', 'onboarding', 'runtime']
  return keywords.filter(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(text)).length
}

function taskText(task: Task): string {
  return [
    task.title,
    task.description,
    task.spec,
    task.productBrief?.userJob,
    task.productBrief?.successMetric,
    ...(task.acceptanceCriteria ?? []).map(ac => ac.description),
    ...(task.outOfScope ?? []),
  ].filter(Boolean).join('\n')
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}
