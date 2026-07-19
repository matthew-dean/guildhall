import {
  EscalationReason,
  ProductBrief as ProductBriefSchema,
  TaskKind as TaskKindSchema,
  TaskReadinessAssessment as TaskReadinessAssessmentSchema,
  TaskReadinessRecommendation as TaskReadinessRecommendationSchema,
  type TaskKind,
  type TaskReadinessRecommendation,
} from '@guildhall/core'

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function importedReferencesFromRequestIntake(task: RecordLike): string[] {
  if (!isRecord(task.requestIntake)) return []
  const evidenceRefs = stringArray(task.requestIntake.evidenceRefs)
  return evidenceRefs
    .map((ref) => {
      const match = /^import:(.+)$/.exec(ref.trim())
      return match?.[1]?.trim() ?? ''
    })
    .filter(Boolean)
}

function taskText(task: RecordLike): string {
  const criteria = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria
      .map(criterion => isRecord(criterion) && typeof criterion.description === 'string' ? criterion.description : '')
    : []
  return [
    task.title,
    task.description,
    task.spec,
    ...criteria,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n')
}

function fallbackTaskKind(task: RecordLike, readiness: RecordLike): TaskKind {
  const readinessKind = TaskKindSchema.safeParse(readiness.taskKind)
  if (readinessKind.success) return readinessKind.data
  const taskKind = TaskKindSchema.safeParse(task.taskKind)
  if (taskKind.success) return taskKind.data
  const text = taskText(task)
  if (/\b(research|compare|investigate)\b/i.test(text)) return 'research'
  if (/\b(decide|decision|choose)\b/i.test(text)) return 'decision'
  if (/\b(verify|test|proof)\b/i.test(text)) return 'verification'
  if (/\b(cleanup|remove|simplify|deduplicate|reduce)\b/i.test(text)) return 'cleanup'
  return 'implementation'
}

function fallbackRecommendation(readiness: RecordLike): TaskReadinessRecommendation {
  const parsed = TaskReadinessRecommendationSchema.safeParse(readiness.recommendation)
  return parsed.success ? parsed.data : 'ready'
}

function summaryFor(recommendation: TaskReadinessRecommendation): string {
  switch (recommendation) {
    case 'ready':
      return 'Task readiness was migrated from an older compact record.'
    case 'needs_one_question':
      return 'Task needs one owner-facing answer or finishability detail before dispatch.'
    case 'needs_research_spike':
      return 'Task should run research or a spike before implementation.'
    case 'requires_child_work':
      return 'Task must be planned as smaller child work before execution.'
    case 'shelve_defer':
      return 'Task should stay shelved or deferred until conditions change.'
  }
}

function fallbackDefinitionOfDone(task: RecordLike, taskKind: TaskKind, now: string): RecordLike {
  const acceptanceItems = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria
      .map(criterion => isRecord(criterion) && typeof criterion.description === 'string' ? criterion.description.trim() : '')
      .filter(Boolean)
    : []
  const defaultItem = taskKind === 'research'
    ? 'Research output names the recommendation, evidence, and unresolved questions.'
    : taskKind === 'decision'
      ? 'Decision record names the chosen option, tradeoffs, owner, and follow-up work.'
      : taskKind === 'verification'
        ? 'Verification records pass/fail evidence for the named proof path.'
        : taskKind === 'cleanup'
          ? 'Cleanup simplifies the target with regression proof.'
          : 'Implementation satisfies acceptance criteria and has recorded proof.'
  return {
    items: acceptanceItems.length > 0 ? acceptanceItems : [defaultItem],
    evidenceRequired: acceptanceItems.length > 0
      ? ['Acceptance criteria are checked or explicitly marked unverified.']
      : ['A concrete proof note is recorded before completion.'],
    updatedAt: now,
    createdBy: 'task-readiness-migration',
  }
}

function normalizeDefinitionOfDone(value: unknown, task: RecordLike, taskKind: TaskKind, now: string): RecordLike {
  const fallback = fallbackDefinitionOfDone(task, taskKind, now)
  if (!isRecord(value)) return fallback
  const items = stringArray(value.items)
  const evidenceRequired = stringArray(value.evidenceRequired)
  return {
    ...value,
    items: items.length > 0 ? items : fallback.items,
    evidenceRequired,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    createdBy: typeof value.createdBy === 'string' ? value.createdBy : 'task-readiness-migration',
  }
}

function normalizeContextBudget(value: unknown, task: RecordLike, recommendation: TaskReadinessRecommendation): RecordLike {
  const text = taskText(task)
  const estimatedTokens = Math.max(0, Math.ceil(text.length / 4))
  const fallbackRisk = recommendation === 'requires_child_work' ? 'high' : estimatedTokens > 2500 ? 'medium' : 'low'
  const fallbackFits = recommendation !== 'requires_child_work' && fallbackRisk !== 'high'
  if (!isRecord(value)) {
    return {
      estimatedTokens,
      risk: fallbackRisk,
      fitsInOneWorkerBrief: fallbackFits,
      reasons: recommendation === 'requires_child_work' ? ['Legacy readiness marked this task as requiring child work before execution.'] : [],
    }
  }
  const risk = value.risk === 'low' || value.risk === 'medium' || value.risk === 'high'
    ? value.risk
    : fallbackRisk
  return {
    ...value,
    estimatedTokens: Number.isInteger(value.estimatedTokens) && Number(value.estimatedTokens) >= 0
      ? value.estimatedTokens
      : estimatedTokens,
    risk,
    fitsInOneWorkerBrief: typeof value.fitsInOneWorkerBrief === 'boolean'
      ? value.fitsInOneWorkerBrief
      : recommendation !== 'requires_child_work' && risk !== 'high',
    reasons: stringArray(value.reasons),
  }
}

function normalizeDimensions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(dimension =>
      typeof dimension.id === 'string' &&
      (dimension.status === 'ok' || dimension.status === 'warn' || dimension.status === 'blocked') &&
      typeof dimension.summary === 'string',
    )
    .map(dimension => ({
      ...dimension,
      evidence: stringArray(dimension.evidence),
    }))
}

function normalizeBlockerPlans(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(plan => typeof plan.if === 'string' && typeof plan.then === 'string')
    .map(plan => ({
      ...plan,
      owner: plan.owner === 'owner' || plan.owner === 'external' ? plan.owner : 'guildhall',
    }))
}

function normalizeOpenQuestion(value: unknown): RecordLike | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.prompt !== 'string' || typeof value.reason !== 'string') return undefined
  return { prompt: value.prompt, reason: value.reason }
}

function normalizeReadiness(task: RecordLike, readiness: RecordLike, now: string): RecordLike {
  if (TaskReadinessAssessmentSchema.safeParse(readiness).success) return readiness
  const taskKind = fallbackTaskKind(task, readiness)
  const recommendation = fallbackRecommendation(readiness)
  const openQuestion = normalizeOpenQuestion(readiness.openQuestion)
  return {
    ...readiness,
    taskKind,
    recommendation,
    summary: typeof readiness.summary === 'string' && readiness.summary.trim()
      ? readiness.summary
      : summaryFor(recommendation),
    dimensions: normalizeDimensions(readiness.dimensions),
    definitionOfDone: normalizeDefinitionOfDone(readiness.definitionOfDone, task, taskKind, now),
    blockerPlans: normalizeBlockerPlans(readiness.blockerPlans),
    contextBudget: normalizeContextBudget(readiness.contextBudget, task, recommendation),
    ...(openQuestion ? { openQuestion } : {}),
    assessedAt: typeof readiness.assessedAt === 'string' ? readiness.assessedAt : now,
    assessedBy: typeof readiness.assessedBy === 'string' ? readiness.assessedBy : 'task-readiness-migration',
  }
}

function normalizeProductBrief(task: RecordLike, value: unknown, now: string): unknown {
  if (!isRecord(value)) return value
  if (ProductBriefSchema.safeParse(value).success) return value
  const text = taskText(task)
  const userJob =
    typeof value.userJob === 'string' && value.userJob.trim()
      ? value.userJob.trim()
      : typeof task.description === 'string' && task.description.trim()
        ? task.description.trim()
        : typeof task.title === 'string' && task.title.trim()
          ? task.title.trim()
          : 'Finish this task with a clear worker handoff.'
  const successMetric =
    typeof value.successMetric === 'string' && value.successMetric.trim()
      ? value.successMetric.trim()
      : typeof value.successCriteria === 'string' && value.successCriteria.trim()
        ? value.successCriteria.trim()
        : text
          ? `Guildhall can verify the task against the saved spec, acceptance criteria, or starting note.`
          : 'Guildhall can verify the task against explicit acceptance criteria.'
  const boundaries = [
    ...stringArray(value.nonGoals),
    ...stringArray(value.antiPatterns),
  ]
  return {
    userJob,
    whyItMattersNow:
      typeof value.whyItMattersNow === 'string' && value.whyItMattersNow.trim()
        ? value.whyItMattersNow.trim()
        : 'Migrated from an older partial task brief so Guildhall can reopen it for cleanup.',
    successMetric,
    nonGoals: boundaries.length > 0
      ? Array.from(new Set(boundaries))
      : ['Do not treat this migrated placeholder as final worker-handoff approval.'],
    antiPatterns: boundaries.length > 0
      ? Array.from(new Set(boundaries))
      : ['Do not treat this migrated placeholder as final worker-handoff approval.'],
    ...(typeof value.audience === 'string' ? { audience: value.audience } : {}),
    ...(typeof value.usageContext === 'string' ? { usageContext: value.usageContext } : {}),
    ...(typeof value.rolloutPlan === 'string' ? { rolloutPlan: value.rolloutPlan } : {}),
    ...(typeof value.brandInteractionNotes === 'string' ? { brandInteractionNotes: value.brandInteractionNotes } : {}),
    authoredBy: typeof value.authoredBy === 'string' ? value.authoredBy : 'task-brief-migration',
    authoredAt: typeof value.authoredAt === 'string' ? value.authoredAt : now,
  }
}

function normalizeEscalations(task: RecordLike, value: unknown, now: string): unknown {
  if (!Array.isArray(value)) return value
  const taskId = typeof task.id === 'string' && task.id.trim() ? task.id.trim() : 'unknown-task'
  return value.map((escalation, index) => {
    if (!isRecord(escalation)) return escalation
    const reason = EscalationReason.safeParse(escalation.reason)
    return {
      ...escalation,
      id: typeof escalation.id === 'string' && escalation.id.trim()
        ? escalation.id.trim()
        : `esc-${taskId}-${index + 1}`,
      taskId: typeof escalation.taskId === 'string' && escalation.taskId.trim()
        ? escalation.taskId.trim()
        : taskId,
      agentId: typeof escalation.agentId === 'string' && escalation.agentId.trim()
        ? escalation.agentId.trim()
        : 'legacy-task-queue-migration',
      reason: reason.success ? reason.data : 'human_judgment_required',
      summary: typeof escalation.summary === 'string' && escalation.summary.trim()
        ? escalation.summary.trim()
        : 'Legacy task escalation needs review.',
      raisedAt: typeof escalation.raisedAt === 'string' && escalation.raisedAt.trim()
        ? escalation.raisedAt.trim()
        : now,
    }
  })
}

/**
 * Migration-only adapter. Current runtime readers never call this function;
 * the final current-state boundary must receive already-materialized SQLite
 * rows instead of repairing old queue shapes during a request.
 */
export function normalizeLegacyTaskQueueForMigration(parsed: unknown, now = new Date().toISOString()): unknown {
  const normalizeTask = (task: unknown): unknown => {
    if (!isRecord(task)) return task
    const next: RecordLike = { ...task }
    if (stringArray(task.references).length === 0) {
      const importedReferences = importedReferencesFromRequestIntake(task)
      if (importedReferences.length > 0) {
        next.references = importedReferences
      }
    }
    if (isRecord(task.taskReadiness)) {
      next.taskReadiness = normalizeReadiness(task, task.taskReadiness, now)
    }
    if (isRecord(task.productBrief)) {
      next.productBrief = normalizeProductBrief(task, task.productBrief, now)
    }
    if (Array.isArray(task.escalations)) {
      next.escalations = normalizeEscalations(task, task.escalations, now)
    }
    return {
      ...next,
    }
  }

  if (Array.isArray(parsed)) return parsed.map(normalizeTask)
  if (isRecord(parsed) && Array.isArray(parsed.tasks)) {
    // Releases are optional. Older queue writers serialized the absence of a
    // selected release as null, while the runtime schema represents absence
    // by omitting the optional field.
    const { selectedReleaseId, ...queue } = parsed
    return {
      ...queue,
      ...(typeof selectedReleaseId === 'string' ? { selectedReleaseId } : {}),
      tasks: parsed.tasks.map(normalizeTask),
    }
  }
  return parsed
}
