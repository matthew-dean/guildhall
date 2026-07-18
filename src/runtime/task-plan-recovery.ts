import type { Task } from '@guildhall/core'
import { validateSpecCompletionBoundary } from './spec-quality.js'

/**
 * A task may only enter an execution lane with a current, bounded blueprint.
 * Keep this predicate shared by HTTP recovery and the orchestrator so those
 * entry points cannot disagree about whether a worker is allowed to run.
 */
export function hasUsableBlueprint(task: Task): boolean {
  return validateSpecCompletionBoundary(task).ok
}

/**
 * Clear only the current planning contract when Guildhall discovers that its
 * saved plan cannot be executed. Historical evidence stays in the evidence
 * ledger; the next spec pass must start from visible project sources.
 */
export function resetCurrentPlanForProofRecovery(
  task: Task,
  input: { reason: string; now: string; agentId?: string; role?: string },
): void {
  task.proofPaths = undefined
  task.acceptanceCriteria = []
  task.productBrief = undefined
  task.spec = undefined
  task.structuredSpec = undefined
  task.contractSurfaceReviewPackets = undefined
  task.acceptanceCriteriaProofState = undefined
  task.taskReadiness = undefined
  task.reviewRisk = undefined
  task.definitionOfDone = undefined
  task.blockerPlans = undefined
  task.contextBudget = undefined
  task.decomposition = undefined
  task.coordinatorReflections = undefined
  task.workUnitAnalysis = undefined
  task.sizePlan = undefined
  task.taskKind = undefined
  task.openQuestions = []
  task.gateResults = []
  task.reviewVerdicts = []
  task.adjudications = []
  task.notes.push({
    agentId: input.agentId ?? 'system',
    role: input.role ?? 'proof-recovery',
    content: `Guildhall cleared the stale current plan and will re-intake a source-backed implementation contract: ${input.reason}`,
    timestamp: input.now,
  })
}
