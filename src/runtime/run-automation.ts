import path from 'node:path'

import { TaskQueue, TERMINAL_TASK_STATUSES, type AgentQuestion, type TaskStatus } from '@guildhall/core'
import {
  appendTaskEvidence,
  getProjectSystemStatePathFromMemoryDir,
  inferProjectRootFromMemoryDir,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseQueue,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseTaskPointWithRevision,
  readProjectStateTextFromMemoryDirAsync,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'

import { approveSpec, resumeExploring } from './intake.js'
import { reviewInProcessWorkForGuildhallImprovements } from './improvement-review.js'
import {
  extractAcceptanceCriteriaFromSpec,
  productBriefFromSpecCompletionBoundary,
  specSectionBody,
  validateSpecCompletionBoundary,
} from './spec-quality.js'
import { workSubtreeIds } from './work-hierarchy.js'
import {
  FORBIDDEN_PROJECT_TASK_FIELDS,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueWithSummary,
} from './project-state-boundary.js'

export type RunAutomationPolicy = 'ask_more_often' | 'ask_when_necessary' | 'fully_automated'

export interface RunAutomationResolution {
  kind: 'answer_questions' | 'repair_product_brief' | 'approve_spec' | 'request_spec_revision' | 'resolve_automation_blocker' | 'record_design_lens_review' | 'record_improvement_review'
  taskId: string
  detail: string
}

export interface RunAutomationResult {
  changed: boolean
  resolutions: RunAutomationResolution[]
}

export interface ScopedRunSummary {
  allTerminal: boolean
  statusSummary: string
}

export async function summarizeScopedRun(input: {
  memoryDir: string
  rootTaskId?: string
}): Promise<ScopedRunSummary> {
  const queue = await readQueue(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const tasks = scopedIds ? queue.tasks.filter(task => scopedIds.has(task.id)) : queue.tasks
  const terminal = new Set<TaskStatus>(TERMINAL_TASK_STATUSES)
  const allTerminal = tasks.length > 0 && tasks.every(task => terminal.has(task.status))
  const counts = new Map<TaskStatus, number>()
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  const statusSummary = [...counts.entries()]
    .map(([status, count]) => `${count} ${status}`)
    .join(', ') || 'no scoped tasks'
  return { allTerminal, statusSummary }
}

export async function applyRunAutomationPolicy(input: {
  memoryDir: string
  policy?: RunAutomationPolicy | 'supervised'
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
}): Promise<RunAutomationResult> {
  if (input.policy !== 'fully_automated') return { changed: false, resolutions: [] }
  const resolutions: RunAutomationResolution[] = []
  const answered = await answerScopedQuestions({ ...input, resolutions })
  const repaired = await repairScopedSpecApprovalInputs({ ...input, resolutions })
  const improvementReviewed = await reviewScopedWorkForGuildhallImprovements({ ...input, resolutions })
  const approved = await approveScopedSpecs({ ...input, resolutions })
  const unblocked = await resolveScopedAutomationBlockers({ ...input, resolutions })
  return {
    changed: answered || repaired || improvementReviewed || approved || unblocked,
    resolutions,
  }
}

async function reviewScopedWorkForGuildhallImprovements(input: {
  memoryDir: string
  rootTaskId?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const result = await reviewInProcessWorkForGuildhallImprovements({
    memoryDir: input.memoryDir,
    ...(input.rootTaskId ? { rootTaskId: input.rootTaskId } : {}),
  })
  for (const findingId of result.design.createdFindingIds) {
    const taskId = findingId.replace(/^design-lens-review-/, '')
    input.resolutions.push({
      kind: 'record_design_lens_review',
      taskId,
      detail: 'Recorded a design-lens recheck finding so in-process UI work benefits from the current design-system guidance.',
    })
  }
  for (const taskId of result.notedTaskIds) {
    input.resolutions.push({
      kind: 'record_improvement_review',
      taskId,
      detail: 'Recorded a conservative improvement-review note so active work can benefit from current Guildhall guidance.',
    })
  }
  return result.design.createdFindingIds.length > 0 || result.notedTaskIds.length > 0
}

async function answerScopedQuestions(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const queueRead = await readQueueForMutation(input.memoryDir)
  const queue = queueRead.queue
  const previousQueue = structuredClone(queue)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const resumes: Array<{ taskId: string; message: string }> = []
  let changed = false
  for (const task of queue.tasks) {
    if (scopedIds && !scopedIds.has(task.id)) continue
    const unanswered = (task.openQuestions ?? []).filter(question => !question.answeredAt)
    if (unanswered.length === 0) continue
    const now = new Date().toISOString()
    task.openQuestions = (task.openQuestions ?? []).map(question => question.answeredAt
      ? question
      : {
          ...question,
          answeredAt: now,
          answer: automaticQuestionAnswer(question, input.ownerIntent),
        })
    task.updatedAt = now
    changed = true
    input.resolutions.push({
      kind: 'answer_questions',
      taskId: task.id,
      detail: `Answered ${unanswered.length} open question(s) using the run's fully automated owner-delegate policy.`,
    })
    resumes.push({
      taskId: task.id,
      message: unanswered
        .map(question => `Fully automated answer for "${question.id}": ${automaticQuestionAnswer(question, input.ownerIntent)}`)
        .join('\n'),
    })
  }
  if (!changed) return false
  queue.lastUpdated = new Date().toISOString()
  await writeQueue(input.memoryDir, previousQueue, queue, queueRead.expectedQueueRevision)
  for (const resume of resumes) await resumeAutomationMessage(input.memoryDir, resume.taskId, resume.message)
  return true
}

async function repairScopedSpecApprovalInputs(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  if (isPromotedProject(input.memoryDir)) return repairPromotedScopedSpecApprovalInputs(input)
  const queueRead = await readQueueForMutation(input.memoryDir)
  const queue = queueRead.queue
  const previousQueue = structuredClone(queue)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  let changed = false
  const now = new Date().toISOString()
  const promotedEvidence: PromotedTaskEvidence[] = []
  for (const task of queue.tasks) {
    if (scopedIds && !scopedIds.has(task.id)) continue
    if (task.status !== 'spec_review' || !task.spec?.trim()) continue
    if (typeof task.productBrief?.approvedAt === 'string') continue
    const hasUsableBrief =
      task.productBrief?.userJob?.trim() &&
      task.productBrief?.successMetric?.trim() &&
      !isPlaceholderNewRequestBrief(task.productBrief)
    if (hasUsableBrief) continue
    const brief = inferProductBriefForAutomation(task, input.ownerIntent)
    if (!brief) continue
    task.productBrief = {
      userJob: brief.userJob,
      successMetric: brief.successMetric,
      antiPatterns: brief.antiPatterns,
      ...(brief.rolloutPlan ? { rolloutPlan: brief.rolloutPlan } : {}),
      authoredBy: input.actor ?? 'run-automation',
      authoredAt: now,
    }
    const note = {
      agentId: input.actor ?? 'run-automation',
      role: 'automation',
      content: [
        'Fully automated run repaired the structured product brief before spec approval.',
        'The brief was inferred from the existing spec/owner intent so the run could continue without a human-only paperwork loop.',
      ].join('\n'),
      timestamp: now,
    }
    task.notes = [...(task.notes ?? []), note]
    promotedEvidence.push({
      taskId: task.id,
      event: {
        id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-brief`,
        kind: 'note',
        recordedAt: now,
        payload: note,
      },
    })
    task.updatedAt = now
    changed = true
    input.resolutions.push({
      kind: 'repair_product_brief',
      taskId: task.id,
      detail: 'Inferred the missing structured product brief from the spec before approval.',
    })
  }
  if (changed) {
    queue.lastUpdated = now
    await writeQueue(input.memoryDir, previousQueue, queue, queueRead.expectedQueueRevision, promotedEvidence)
  }
  return changed
}

function isPlaceholderNewRequestBrief(
  brief: { userJob?: string; successMetric?: string } | undefined,
): boolean {
  if (!brief) return false
  const text = `${brief.userJob ?? ''}\n${brief.successMetric ?? ''}`
  return /\bverify whether .+? is already done\b/i.test(text) ||
    /\bremaining work for ["']?.+?["']? is described clearly enough/i.test(text)
}

async function approveScopedSpecs(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  if (isPromotedProject(input.memoryDir)) return approvePromotedScopedSpecs(input)
  const queueRead = await readQueueForMutation(input.memoryDir)
  const queue = queueRead.queue
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  let changed = false
  for (const task of queue.tasks) {
    if (scopedIds && !scopedIds.has(task.id)) continue
    if (task.status !== 'spec_review' || !task.spec?.trim()) continue
    const approved = await approveSpec({
      memoryDir: input.memoryDir,
      taskId: task.id,
      approvalNote: 'Fully automated run approved this spec on behalf of the original owner intent.',
    })
    if (approved.success) {
      changed = true
      input.resolutions.push({
        kind: 'approve_spec',
        taskId: task.id,
        detail: 'Approved spec_review so the run could continue without human input.',
      })
    } else {
      const message = [
        `Fully automated run could not approve this spec yet: ${approved.error ?? 'approval failed'}.`,
        'Revise the spec into Guildhall\'s required completion-boundary shape, preserve the original owner intent, and continue without asking for human approval.',
        ...(input.ownerIntent ? ['', `Original owner intent: ${input.ownerIntent}`] : []),
      ].join('\n')
      await resumeAutomationMessage(input.memoryDir, task.id, message)
      changed = true
      input.resolutions.push({
        kind: 'request_spec_revision',
        taskId: task.id,
        detail: approved.error ?? 'approval failed',
      })
    }
  }
  return changed
}

async function resolveScopedAutomationBlockers(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  if (isPromotedProject(input.memoryDir)) return resolvePromotedScopedAutomationBlockers(input)
  const queueRead = await readQueueForMutation(input.memoryDir)
  const queue = queueRead.queue
  const previousQueue = structuredClone(queue)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  let changed = false
  const promotedEvidence: PromotedTaskEvidence[] = []
  for (const task of queue.tasks) {
    if (scopedIds && !scopedIds.has(task.id)) continue
    const blockerText = [
      task.blockReason,
      ...(task.escalations ?? []).filter(escalation => !escalation.resolvedAt).map(escalation => `${escalation.summary} ${escalation.details ?? ''}`),
    ].filter(Boolean).join('\n')
    if (
      task.status !== 'blocked' ||
      /worktree|bootstrap|already exists|fatal:|permission denied|missing dependency/i.test(blockerText) ||
      !/human|approval|question|judgment|ambiguous|turn limit|turn budget/i.test(blockerText)
    ) {
      continue
    }
    const now = new Date().toISOString()
    task.status = 'exploring'
    task.blockReason = undefined
    task.updatedAt = now
    task.escalations = (task.escalations ?? []).map(escalation => escalation.resolvedAt ? escalation : {
      ...escalation,
      resolvedAt: now,
      resolvedBy: input.actor ?? 'run-automation',
      resolution: 'Fully automated run resolved this as an automation-compatible blocker and asked the task to continue from the owner intent.',
    })
    const note = {
      agentId: input.actor ?? 'run-automation',
      role: 'automation',
      content: [
        'Resolved retryable blocker under fully automated run policy.',
        'Continue from the owner intent and do not wait for human input unless an external dependency is truly unavailable.',
        ...(input.ownerIntent ? ['', `Owner intent: ${input.ownerIntent}`] : []),
      ].join('\n'),
      timestamp: now,
    }
    task.notes = [...(task.notes ?? []), note]
    promotedEvidence.push({
      taskId: task.id,
      event: {
        id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-blocker`,
        kind: 'note',
        recordedAt: now,
        payload: note,
      },
    })
    for (const escalation of task.escalations ?? []) {
      promotedEvidence.push({
        taskId: task.id,
        event: {
          id: `automation-escalation-${task.id}-${escalation.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
          kind: 'escalation',
          recordedAt: now,
          payload: escalation,
        },
      })
    }
    changed = true
    input.resolutions.push({
      kind: 'resolve_automation_blocker',
      taskId: task.id,
      detail: 'Reopened a human-input-style blocker so automation could continue.',
    })
  }
  if (changed) {
    queue.lastUpdated = new Date().toISOString()
    await writeQueue(input.memoryDir, previousQueue, queue, queueRead.expectedQueueRevision, promotedEvidence)
  }
  return changed
}

async function resolvePromotedScopedAutomationBlockers(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const queue = await readQueue(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const tasksPath = getProjectSystemStatePathFromMemoryDir(input.memoryDir, 'TASKS.json')
  let changed = false
  for (const indexedTask of queue.tasks) {
    if (scopedIds && !scopedIds.has(indexedTask.id)) continue
    if (indexedTask.status !== 'blocked') continue
    const task = promotedTaskDefinition(input.memoryDir, indexedTask.id)
    if (!task) continue
    const blockerText = [
      task.blockReason,
      ...(task.escalations ?? []).filter((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)
        .map((escalation: { summary: string; details?: string }) => `${escalation.summary} ${escalation.details ?? ''}`),
    ].filter(Boolean).join('\n')
    if (
      /worktree|bootstrap|already exists|fatal:|permission denied|missing dependency/i.test(blockerText) ||
      !/human|approval|question|judgment|ambiguous|turn limit|turn budget/i.test(blockerText)
    ) continue

    const now = new Date().toISOString()
    const resolvedEscalations = (task.escalations ?? []).map((escalation: Record<string, any>) => escalation.resolvedAt ? escalation : {
      ...escalation,
      resolvedAt: now,
      resolvedBy: input.actor ?? 'run-automation',
      resolution: 'Fully automated run resolved this as an automation-compatible blocker and asked the task to continue from the owner intent.',
    })
    const promoted = writePromotedTaskDetailMutation(tasksPath, task.id, {
      projectId: path.basename(projectRoot),
      projectRoot,
      mutate: current => {
        current.status = 'exploring'
        delete current.blockReason
        if (resolvedEscalations.some((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)) {
          current.openEscalations = resolvedEscalations
            .filter((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)
            .map((escalation: { id: string }) => escalation.id)
        } else {
          delete current.openEscalations
        }
        current.updatedAt = now
        return current
      },
    })
    if (!promoted) throw new Error(`Promoted task ${task.id} could not resolve the automation blocker`)

    await upsertTaskRuntimeState(projectRoot, task.id, {
      openEscalationIds: resolvedEscalations
        .filter((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)
        .map((escalation: { id: string }) => escalation.id),
      updatedAt: now,
    })
    for (const escalation of resolvedEscalations) {
      await appendTaskEvidence(projectRoot, task.id, {
        id: `automation-escalation-${task.id}-${escalation.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'escalation',
        recordedAt: now,
        payload: escalation,
      })
    }
    const note = [
      'Resolved retryable blocker under fully automated run policy.',
      'Continue from the owner intent and do not wait for human input unless an external dependency is truly unavailable.',
      ...(input.ownerIntent ? ['', `Owner intent: ${input.ownerIntent}`] : []),
    ].join('\n')
    await appendTaskEvidence(projectRoot, task.id, {
      id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-blocker`,
      kind: 'note',
      recordedAt: now,
      payload: {
        agentId: input.actor ?? 'run-automation',
        role: 'automation',
        content: note,
        timestamp: now,
      },
    })
    changed = true
    input.resolutions.push({
      kind: 'resolve_automation_blocker',
      taskId: task.id,
      detail: 'Reopened a human-input-style blocker through the promoted point/evidence/runtime boundaries.',
    })
  }
  return changed
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database') {
    const queue = readProjectStateDatabaseQueue(tasksPath)
    if (!queue) throw new Error(`Current project-state index is unavailable for ${tasksPath}`)
    return queue as unknown as TaskQueue
  }
  // Bootstrap-only compatibility read. Promoted projects fail closed above.
  const raw = await readProjectStateTextFromMemoryDirAsync(memoryDir, 'TASKS.json')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed)
    ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
    : TaskQueue.parse(parsed)
}

interface QueueMutationRead {
  queue: TaskQueue
  expectedQueueRevision: number | null
}

interface PromotedTaskEvidence {
  taskId: string
  event: Parameters<typeof appendTaskEvidence>[2]
}

async function readQueueForMutation(memoryDir: string): Promise<QueueMutationRead> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) !== 'database') {
    return { queue: await readQueue(memoryDir), expectedQueueRevision: null }
  }
  const queue = readProjectStateDatabaseQueue(tasksPath)
  if (!queue) throw new Error(`Current project-state index is unavailable for ${tasksPath}`)
  return {
    queue: queue as unknown as TaskQueue,
    expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
  }
}

async function writeQueue(
  memoryDir: string,
  previousQueue: TaskQueue,
  queue: TaskQueue,
  expectedQueueRevision: number | null,
  promotedEvidence: readonly PromotedTaskEvidence[] = [],
): Promise<void> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database') {
    if (await writePromotedSingleTaskMutation(tasksPath, previousQueue, queue, expectedQueueRevision, memoryDir, promotedEvidence)) return
    throw new Error(`Promoted automation update for ${tasksPath} did not match a normalized task/evidence mutation`)
  }
  // Bootstrap-only queue persistence. Imports/migrations own any later full-state writes.
  writeProjectTaskQueueWithSummary(tasksPath, queue, {
    projectId: path.basename(inferProjectRootFromMemoryDir(memoryDir)),
    expectedQueueRevision,
  })
}

async function writePromotedSingleTaskMutation(
  tasksPath: string,
  previousQueue: TaskQueue,
  queue: TaskQueue,
  expectedQueueRevision: number | null,
  memoryDir: string,
  promotedEvidence: readonly PromotedTaskEvidence[],
): Promise<boolean> {
  if (!Number.isInteger(expectedQueueRevision) || expectedQueueRevision! < 0) return false
  if (previousQueue.tasks.length !== queue.tasks.length) return false

  const previousById = new Map(previousQueue.tasks.map(task => [task.id, task]))
  const nextById = new Map(queue.tasks.map(task => [task.id, task]))
  if (previousById.size !== nextById.size || [...previousById.keys()].some(id => !nextById.has(id))) return false

  const changedTaskIds = [...previousById.keys()].filter(id => !sameJson(previousById.get(id), nextById.get(id)))
  if (changedTaskIds.length !== 1) return false
  const taskId = changedTaskIds[0]
  if (!taskId) return false

  const previousTask = previousById.get(taskId) as unknown as Record<string, unknown>
  const nextTask = nextById.get(taskId) as unknown as Record<string, unknown>
  const changedFields = [...new Set([...Object.keys(previousTask), ...Object.keys(nextTask)])]
    .filter(field => !sameJson(previousTask[field], nextTask[field]))
  const forbiddenChanged = changedFields.filter(field => FORBIDDEN_PROJECT_TASK_FIELDS.includes(field as typeof FORBIDDEN_PROJECT_TASK_FIELDS[number]))
  if (forbiddenChanged.length > 0 && promotedEvidence.length === 0) {
    return false
  }
  const mutableFields = changedFields.filter(field => !FORBIDDEN_PROJECT_TASK_FIELDS.includes(field as typeof FORBIDDEN_PROJECT_TASK_FIELDS[number]))
  if (mutableFields.length === 0) {
    return appendPromotedTaskEvidence(
      inferProjectRootFromMemoryDir(memoryDir),
      promotedEvidence.filter(entry => entry.taskId === taskId),
    )
  }

  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const committed = writePromotedTaskDetailMutation(tasksPath, taskId, {
    projectId: path.basename(projectRoot),
    projectRoot,
    mutate: current => {
      const next = { ...current }
      for (const field of mutableFields) {
        if (Object.prototype.hasOwnProperty.call(nextTask, field)) next[field] = nextTask[field]
        else delete next[field]
      }
      return next
    },
  })
  if (!committed) return false
  return appendPromotedTaskEvidence(projectRoot, promotedEvidence.filter(entry => entry.taskId === taskId))
}

async function resumeAutomationMessage(memoryDir: string, taskId: string, message: string): Promise<void> {
  if (!isPromotedProject(memoryDir)) {
    await resumeExploring({ memoryDir, taskId, message })
    return
  }
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  const now = new Date().toISOString()
  const promoted = writePromotedTaskDetailMutation(tasksPath, taskId, {
    projectId: path.basename(projectRoot),
    projectRoot,
    mutate: current => {
      if (current.status !== 'blocked') current.status = 'exploring'
      current.updatedAt = now
      return current
    },
  })
  if (!promoted) throw new Error(`Promoted task ${taskId} could not record automation progress`)
  await appendTaskEvidence(projectRoot, taskId, {
    id: `automation-note-${taskId}-${now.replace(/[^0-9A-Za-z]/g, '')}-resume`,
    kind: 'note',
    recordedAt: now,
    payload: {
      agentId: 'run-automation',
      role: 'automation',
      content: message,
      timestamp: now,
    },
  })
}

async function approvePromotedScopedSpecs(input: {
  memoryDir: string
  rootTaskId?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const queueRead = await readQueueForMutation(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queueRead.queue.tasks, input.rootTaskId)) : null
  let changed = false
  for (const indexedTask of queueRead.queue.tasks) {
    if (scopedIds && !scopedIds.has(indexedTask.id)) continue
    if (indexedTask.status !== 'spec_review') continue
    const task = promotedTaskDefinition(input.memoryDir, indexedTask.id)
    if (!task) continue
    const result = await approvePromotedSpec(input.memoryDir, task)
    if (result.success) {
      changed = true
      input.resolutions.push({
        kind: 'approve_spec',
        taskId: indexedTask.id,
        detail: 'Approved spec_review through the promoted task point boundary.',
      })
      continue
    }
    const message = `Fully automated run could not approve this spec yet: ${result.error ?? 'approval failed'}.`
    await resumeAutomationMessage(input.memoryDir, indexedTask.id, message)
    changed = true
    input.resolutions.push({
      kind: 'request_spec_revision',
      taskId: indexedTask.id,
      detail: result.error ?? 'approval failed',
    })
  }
  return changed
}

async function repairPromotedScopedSpecApprovalInputs(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const queueRead = await readQueueForMutation(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queueRead.queue.tasks, input.rootTaskId)) : null
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const tasksPath = getProjectSystemStatePathFromMemoryDir(input.memoryDir, 'TASKS.json')
  const now = new Date().toISOString()
  let changed = false
  for (const indexedTask of queueRead.queue.tasks) {
    if (scopedIds && !scopedIds.has(indexedTask.id)) continue
    if (indexedTask.status !== 'spec_review') continue
    const task = promotedTaskDefinition(input.memoryDir, indexedTask.id)
    if (!task || typeof task.spec !== 'string' || !task.spec.trim()) continue
    if (typeof task.productBrief?.approvedAt === 'string') continue
    const hasUsableBrief =
      task.productBrief?.userJob?.trim() &&
      task.productBrief?.successMetric?.trim() &&
      !isPlaceholderNewRequestBrief(task.productBrief)
    if (hasUsableBrief) continue
    const brief = inferProductBriefForAutomation(task as TaskQueue['tasks'][number], input.ownerIntent)
    if (!brief) continue
    const note = {
      agentId: input.actor ?? 'run-automation',
      role: 'automation',
      content: [
        'Fully automated run repaired the structured product brief before spec approval.',
        'The brief was inferred from the existing spec/owner intent so the run could continue without a human-only paperwork loop.',
      ].join('\n'),
      timestamp: now,
    }
    const promoted = writePromotedTaskDetailMutation(tasksPath, task.id, {
      projectId: path.basename(projectRoot),
      projectRoot,
      mutate: current => ({
        ...current,
        productBrief: {
          userJob: brief.userJob,
          successMetric: brief.successMetric,
          antiPatterns: brief.antiPatterns,
          ...(brief.rolloutPlan ? { rolloutPlan: brief.rolloutPlan } : {}),
          authoredBy: input.actor ?? 'run-automation',
          authoredAt: now,
        },
        updatedAt: now,
      }),
    })
    if (!promoted) throw new Error(`Promoted task ${task.id} could not record the repaired product brief`)
    await appendTaskEvidence(projectRoot, task.id, {
      id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-brief`,
      kind: 'note',
      recordedAt: now,
      payload: note,
    })
    changed = true
    input.resolutions.push({
      kind: 'repair_product_brief',
      taskId: task.id,
      detail: 'Inferred the missing structured product brief from the spec before approval.',
    })
  }
  return changed
}

async function approvePromotedSpec(
  memoryDir: string,
  task: Record<string, any>,
): Promise<{ success: boolean; error?: string }> {
  if (task.status !== 'spec_review' || typeof task.spec !== 'string' || !task.spec.trim()) {
    return { success: false, error: 'task is not ready for promoted spec approval' }
  }
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0
    ? task.acceptanceCriteria
    : extractAcceptanceCriteriaFromSpec(task.spec)
  const productBrief = task.productBrief ?? productBriefFromSpecCompletionBoundary(task.spec) ?? undefined
  const candidate = { ...task, acceptanceCriteria, productBrief }
  const quality = validateSpecCompletionBoundary(candidate)
  if (!quality.ok) return { success: false, error: `Spec is not ready for approval: ${quality.errors.join(' ')}` }
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  const now = new Date().toISOString()
  const promoted = writePromotedTaskDetailMutation(tasksPath, task.id, {
    projectId: path.basename(projectRoot),
    projectRoot,
    mutate: current => ({
      ...current,
      ...(candidate.productBrief ? { productBrief: candidate.productBrief } : {}),
      acceptanceCriteria: candidate.acceptanceCriteria,
      status: 'ready',
      updatedAt: now,
    }),
  })
  if (!promoted) return { success: false, error: 'task point mutation was rejected' }
  await appendTaskEvidence(projectRoot, task.id, {
    id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-approve`,
    kind: 'note',
    recordedAt: now,
    payload: {
      agentId: 'run-automation',
      role: 'automation',
      content: 'Fully automated run approved this spec on behalf of the original owner intent.',
      timestamp: now,
    },
  })
  return { success: true }
}

function isPromotedProject(memoryDir: string): boolean {
  return readProjectStateDatabaseCurrentAuthorityFromTasksPath(
    getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json'),
  ) === 'database'
}

function promotedTaskDefinition(memoryDir: string, taskId: string): Record<string, any> | null {
  const point = readProjectStateDatabaseTaskPointWithRevision(
    getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json'),
    taskId,
  )
  return point?.task.definition as Record<string, any> | null
}

async function appendPromotedTaskEvidence(
  projectRoot: string,
  evidence: readonly PromotedTaskEvidence[],
): Promise<boolean> {
  for (const entry of evidence) {
    await appendTaskEvidence(projectRoot, entry.taskId, entry.event)
  }
  return true
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function automaticQuestionAnswer(question: AgentQuestion, ownerIntent: string | undefined): string {
  if (question.kind === 'confirm') return question.restatement
  if (question.kind === 'choice') return question.choices[0] ?? fallbackAnswer(ownerIntent)
  if (question.kind === 'yesno') return `Yes. ${fallbackAnswer(ownerIntent)}`
  return fallbackAnswer(ownerIntent)
}

function fallbackAnswer(ownerIntent: string | undefined): string {
  return ownerIntent
    ? `Use the safest interpretation consistent with the owner intent: ${ownerIntent}`
    : 'Use the safest reversible interpretation and continue without waiting for human input.'
}

function inferProductBriefForAutomation(
  task: TaskQueue['tasks'][number],
  ownerIntent: string | undefined,
): { userJob: string; successMetric: string; antiPatterns: string[]; rolloutPlan?: string } | null {
  const spec = task.spec ?? ''
  const productBrief = parseProductBriefSection(spec)
  if (productBrief?.userJob && productBrief?.successMetric) {
    return {
      userJob: productBrief.userJob,
      successMetric: productBrief.successMetric,
      antiPatterns: productBrief.antiPatterns,
      ...(productBrief.rolloutPlan ? { rolloutPlan: productBrief.rolloutPlan } : {}),
    }
  }

  const boundary = specSectionBody(spec, 'Completion Boundary')
  const outcome = fieldFromSection(boundary, 'Product outcome')
  const done = fieldFromSection(boundary, 'What counts as done')
  if (outcome && done) {
    return {
      userJob: outcome,
      successMetric: done,
      antiPatterns: productBrief?.antiPatterns ?? [],
      ...(productBrief?.rolloutPlan ? { rolloutPlan: productBrief.rolloutPlan } : {}),
    }
  }

  if (isDeterministicFileRequest([task.description, ownerIntent].filter(Boolean).join('\n'))) {
    return {
      userJob: 'Complete the deterministic file request exactly as specified.',
      successMetric: task.description,
      antiPatterns: ['Do not create or modify unrelated files.'],
    }
  }

  return null
}

function parseProductBriefSection(spec: string): { userJob?: string; successMetric?: string; antiPatterns: string[]; rolloutPlan?: string } | null {
  const section = specSectionBody(spec, 'Product Brief')
  if (!section) return null
  const result: { userJob?: string; successMetric?: string; antiPatterns: string[]; rolloutPlan?: string } = { antiPatterns: [] }
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '')
    const match = /^([^:]+):\s*(.+)$/.exec(line)
    if (!match) continue
    const field = normalizeBriefField(match[1]!)
    const value = cleanMarkdownValue(match[2]!)
    if (!value) continue
    if (field === 'user job') result.userJob = value
    if (field === 'success metric') result.successMetric = value
    if (field === 'anti patterns' || field === 'anti-patterns') result.antiPatterns = [value]
    if (field === 'rollout plan' && !/^none\.?$/i.test(value)) result.rolloutPlan = value
  }
  return result.userJob || result.successMetric ? result : null
}

function fieldFromSection(section: string, wanted: string): string | null {
  const wantedField = normalizeBriefField(wanted)
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '')
    const match = /^([^:]+):\s*(.+)$/.exec(line)
    if (!match) continue
    if (normalizeBriefField(match[1]!) !== wantedField) continue
    const value = cleanMarkdownValue(match[2]!)
    return value || null
  }
  return null
}

function normalizeBriefField(raw: string): string {
  return raw
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function cleanMarkdownValue(raw: string): string {
  return raw
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .replace(/^_+|_+$/g, '')
    .trim()
}

function isDeterministicFileRequest(text: string): boolean {
  return /\b(?:create|write|add)\s+(?:a\s+|one\s+|single\s+)?file\b/i.test(text) &&
    /\b(?:containing|content(?:s)?\s+(?:is|are)|with(?:\s+content)?)\s+exactly\b/i.test(text)
}
