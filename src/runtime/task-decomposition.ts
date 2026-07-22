import type {
  CoordinatorReflectionRecord,
  DefinitionOfDone,
  Task,
  TaskDecompositionRecord,
  TaskDecompositionReasonCode,
  TaskKind,
  TaskSplitRecommendation,
} from '@guildhall/core'
import { buildDecompositionChildDrafts, buildTaskSizePlan } from '@guildhall/core'
import { assessTaskReadiness } from './task-readiness.js'

export function decomposeTaskForFinishability(
  task: Task,
  opts: { now?: string } = {},
): TaskDecompositionRecord {
  const now = opts.now ?? new Date().toISOString()
  const assessment = assessTaskReadiness(task, { now })
  const reasons = decompositionReasons(task, assessment)
  const action = actionForRecommendation(assessment.recommendation)
  return {
    action,
    reasons,
    childDrafts: childDraftsFor(task, action, assessment.definitionOfDone),
    createdAt: now,
    createdBy: 'task-decomposition',
  }
}

export function applyTaskShaping(task: Task, opts: { now?: string; recordNote?: boolean } = {}): Task {
  const now = opts.now ?? new Date().toISOString()
  if (!task.sizePlan) {
    task.sizePlan = buildTaskSizePlan({
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        ...(task.spec ? { spec: task.spec } : {}),
        ...(task.acceptanceCriteria?.length ? { acceptanceCriteria: task.acceptanceCriteria } : {}),
        ...(task.outOfScope?.length ? { outOfScope: task.outOfScope } : {}),
        ...(task.workUnitAnalysis ? { workUnitAnalysis: task.workUnitAnalysis } : {}),
        ...(task.structuredSpec ? { structuredSpec: task.structuredSpec } : {}),
      },
      createdAt: now,
      createdBy: 'task-shaping',
    })
  }
  const readiness = assessTaskReadiness(task, { now })
  const decomposition = decomposeTaskForFinishability(task, { now })
  task.taskKind = readiness.taskKind
  task.taskReadiness = readiness
  task.definitionOfDone = readiness.definitionOfDone
  task.blockerPlans = readiness.blockerPlans
  task.contextBudget = readiness.contextBudget
  task.decomposition = decomposition
  if (opts.recordNote ?? true) {
    task.notes.push({
      agentId: 'coordinator',
      role: 'coordinator',
      content: `Task readiness action: ${readiness.recommendation}. ${readiness.summary}`,
      timestamp: now,
    })
  }
  task.updatedAt = now
  return task
}

export function suggestCoordinatorReflection(
  tasks: Task[],
  opts: { now?: string } = {},
): CoordinatorReflectionRecord {
  const now = opts.now ?? new Date().toISOString()
  const candidates: CoordinatorReflectionRecord['candidates'] = []
  const splitPressure = tasks.filter(task =>
    task.sizePlan?.action === 'split_required' ||
    task.sizePlan?.action === 'split_recommended' ||
    task.sizePlan?.action === 'decompose_before_execution' ||
    task.taskReadiness?.recommendation === 'requires_child_work',
  )
  if (splitPressure.length >= 2) {
    candidates.push({
      kind: 'practice',
      title: 'Split broad work before dispatch',
      rationale: `${splitPressure.length} recent tasks were large enough to need splitting before a worker pass.`,
      status: 'proposed',
    })
  }

  const openQuestions = tasks.filter(task => task.openQuestions?.some(question => !question.answeredAt))
  if (openQuestions.length > 0) {
    candidates.push({
      kind: 'preference',
      title: 'Inspect before asking owner questions',
      rationale: `${openQuestions.length} task(s) still need owner answers; review whether Guildhall could have inspected first.`,
      status: 'proposed',
    })
  }

  const active = tasks.filter(task => ['in_progress', 'review', 'gate_check', 'blocked'].includes(task.status))
  if (active.length >= 4) {
    candidates.push({
      kind: 'practice',
      title: 'Lower active work in progress',
      rationale: `${active.length} tasks are active or blocked; prefer finishing, blocking clearly, or shelving before opening more work.`,
      status: 'proposed',
    })
  }

  return {
    summary: candidates.length > 0
      ? `Coordinator reflection suggested ${candidates.length} practice/preference candidate(s); none were auto-activated.`
      : 'Coordinator reflection found no new practice or preference candidates.',
    candidates,
    createdAt: now,
    createdBy: 'coordinator-reflection',
  }
}

function decompositionReasons(
  task: Task,
  assessment: ReturnType<typeof assessTaskReadiness>,
): TaskDecompositionRecord['reasons'] {
  const reasons: TaskDecompositionRecord['reasons'] = []
  const add = (code: TaskDecompositionReasonCode, detail: string) => {
    if (!reasons.some(reason => reason.code === code)) reasons.push({ code, detail })
  }
  for (const dimension of assessment.dimensions) {
    if (dimension.status === 'ok') continue
    switch (dimension.id) {
      case 'outcome_clarity':
        add('unclear_outcome', dimension.summary)
        break
      case 'proofability':
        add('missing_proof_path', dimension.summary)
        break
      case 'context_load':
        add('too_much_context', dimension.summary)
        break
      case 'dependency_risk':
        add('hidden_dependency', dimension.summary)
        break
      case 'size':
        add('too_broad', dimension.summary)
        break
      case 'uncertainty':
        add('mixed_research_and_implementation', dimension.summary)
        break
      case 'user_judgment_exposure':
        add('product_judgment_required', dimension.summary)
        break
    }
  }
  return reasons
}

function actionForRecommendation(recommendation: ReturnType<typeof assessTaskReadiness>['recommendation']): TaskDecompositionRecord['action'] {
  switch (recommendation) {
    case 'ready':
      return 'keep'
    case 'needs_one_question':
      return 'ask_one_question'
    case 'needs_research_spike':
      return 'research_first'
    case 'requires_child_work':
      return 'split'
    case 'shelve_defer':
      return 'defer'
  }
}

function childDraftsFor(
  task: Task,
  action: TaskDecompositionRecord['action'],
  definitionOfDone: DefinitionOfDone,
): TaskDecompositionRecord['childDrafts'] {
  if (action === 'research_first') return []

  if (action !== 'split') return []
  if (!task.workUnitAnalysis?.units?.length) {
    return []
  }
  const recommendations = buildDecompositionChildDrafts({ task })

  return recommendations.map((recommendation) => ({
    title: recommendation.title,
    kind: taskKindForRecommendation(recommendation.suggestedTaskKind),
    reason: recommendation.reason,
    dependsOn: recommendation.dependsOn,
    definitionOfDone: definitionOfDoneForRecommendation(definitionOfDone, taskKindForRecommendation(recommendation.suggestedTaskKind)),
  }))
}

function taskKindForRecommendation(kind: TaskSplitRecommendation['suggestedTaskKind']): TaskKind {
  switch (kind) {
    case 'research':
    case 'decision':
    case 'spike':
    case 'cleanup':
    case 'verification':
    case 'release':
    case 'learning':
      return kind
    default:
      return 'implementation'
  }
}

function definitionOfDoneForRecommendation(
  defaultDefinitionOfDone: DefinitionOfDone,
  suggestedTaskKind?: TaskKind,
): DefinitionOfDone {
  if (suggestedTaskKind === 'research' || suggestedTaskKind === 'decision' || suggestedTaskKind === 'spike') {
    return {
      items: ['The split records the concrete outcome, evidence, and unresolved follow-up.'],
      evidenceRequired: ['Source-backed decomposition evidence is attached to the task.'],
      createdBy: 'task-decomposition',
    }
  }
  if (suggestedTaskKind === 'verification') {
    return {
      items: ['Verification result records expected evidence, actual evidence, and remaining uncertainty.'],
      evidenceRequired: ['Proof path result is recorded.'],
      createdBy: 'task-decomposition',
    }
  }
  return defaultDefinitionOfDone
}
