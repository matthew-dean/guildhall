import { appendManagedTextFile, readManagedTextFile, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  appendTaskEvidence,
  atomicWriteText,
  getProjectSystemStateDir,
  getProjectSystemStatePath,
  getProjectSystemStatePathFromMemoryDir,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseTaskPoint,
} from '@guildhall/sessions'
import { applyBoundedChatTransition } from './bounded-chat-machine.js'
import { OwnerInputRequest, type OwnerInputRequest as OwnerInputRequestRecord } from './owner-input.js'
import { isInvalidOwnerQuestionPrompt } from './owner-question-normalizer.js'
import { refreshOwnerInputProjection } from './owner-input-store.js'
import * as projectStateBoundary from './project-state-boundary.js'

export interface OwnerInputStateRepairInput {
  projectRoot: string
  apply: boolean
  now?: string
  repairId?: string
}

export interface OwnerInputStateRepairResult {
  cancelledInvalid: string[]
  resolvedByAssumption: string[]
  cancelledDuplicates: string[]
  affectedPaths: string[]
}

interface RawTask {
  id?: unknown
  title?: unknown
  notes?: unknown
  [key: string]: unknown
}

interface QueueShape {
  lastUpdated?: unknown
  tasks: RawTask[]
  [key: string]: unknown
}

interface RepairDecision {
  request: OwnerInputRequestRecord
  action: 'cancel_invalid' | 'resolve_by_assumption' | 'cancel_duplicate'
  reason: string
  assumption?: string
}

const REPAIR_ID = '0.10.0/owner-input-state-repair'
const TASKS_RELATIVE_PATH = 'TASKS.json'

export async function repairOwnerInputState(
  input: OwnerInputStateRepairInput,
): Promise<OwnerInputStateRepairResult> {
  const now = input.now ?? new Date().toISOString()
  const repairId = input.repairId ?? REPAIR_ID
  const repairAgentId = `migration:${repairId}`
  const memoryDir = getProjectSystemStateDir(input.projectRoot)
  const requests = await readOwnerInputRequests(memoryDir)
  const decisions = planRepairs(requests)

  const cancelledInvalid = decisions.filter(decision => decision.action === 'cancel_invalid').map(decision => decision.request.id)
  const resolvedByAssumption = decisions.filter(decision => decision.action === 'resolve_by_assumption').map(decision => decision.request.id)
  const cancelledDuplicates = decisions.filter(decision => decision.action === 'cancel_duplicate').map(decision => decision.request.id)
  const promoted = readProjectStateDatabaseCurrentAuthority(input.projectRoot) === 'database'

  const affectedPaths = decisions.length > 0
    ? [
        'project-state/owner-input',
        'project-state/bounded-chat',
        promoted ? 'project-state/task-evidence' : `project-state/${TASKS_RELATIVE_PATH}`,
      ]
    : []

  if (!input.apply || decisions.length === 0) {
    return { cancelledInvalid, resolvedByAssumption, cancelledDuplicates, affectedPaths }
  }

  if (promoted) {
    for (const decision of decisions) {
      await closeOwnerInput(memoryDir, decision, now, repairId, repairAgentId)
      await appendRepairNoteEvidence(input.projectRoot, decision, now, repairId, repairAgentId)
    }
  } else {
    const queueFile = getProjectSystemStatePath(input.projectRoot, TASKS_RELATIVE_PATH)
    // This branch is migration-only. Runtime readers intentionally refuse
    // historical TASKS shapes, so import the legacy file explicitly here and
    // immediately write the repaired queue through the migration export.
    const queue = queueForRepair(JSON.parse(await readManagedTextFile(queueFile, 'utf8')))
    for (const decision of decisions) {
      await closeOwnerInput(memoryDir, decision, now, repairId, repairAgentId)
      appendRepairNote(queue, decision, now, repairId, repairAgentId)
    }
    projectStateBoundary.writeProjectTaskQueueWithSummary(queueFile, { ...queue, lastUpdated: now }, {
      projectId: path.basename(input.projectRoot),
      projectRoot: input.projectRoot,
      fullCompatibility: true,
    })
  }
  refreshOwnerInputProjection(input.projectRoot, now)

  return { cancelledInvalid, resolvedByAssumption, cancelledDuplicates, affectedPaths }
}

function planRepairs(requests: OwnerInputRequestRecord[]): RepairDecision[] {
  const waiting = requests.filter(request => request.status === 'waiting_for_owner')
  const decisions: RepairDecision[] = []

  for (const request of waiting) {
    if (isNarrationRequest(request)) {
      decisions.push({
        request,
        action: 'cancel_invalid',
        reason: 'The owner-input prompt is agent narration or evidence summary, not an answerable owner question.',
      })
      continue
    }
  }

  const alreadyPlanned = new Set(decisions.map(decision => decision.request.id))
  const byChoiceSignature = new Map<string, OwnerInputRequestRecord[]>()
  for (const request of waiting) {
    if (alreadyPlanned.has(request.id)) continue
    const signature = duplicateSignature(request)
    if (!signature) continue
    const bucket = byChoiceSignature.get(signature) ?? []
    bucket.push(request)
    byChoiceSignature.set(signature, bucket)
  }
  for (const bucket of byChoiceSignature.values()) {
    if (bucket.length < 2) continue
    const keep = [...bucket].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
    for (const request of bucket) {
      if (request.id === keep?.id) continue
      decisions.push({
        request,
        action: 'cancel_duplicate',
        reason: `Duplicate owner-input request for the same task decision; kept ${keep?.id ?? 'the earliest equivalent request'}.`,
      })
    }
  }

  return decisions
}

function isNarrationRequest(request: OwnerInputRequestRecord): boolean {
  // Only the structural question contract decides this repair. A valid
  // question may use any vocabulary or model voice; prose phrase lists are
  // not a durable classifier.
  return isInvalidOwnerQuestionPrompt(request.prompt)
}

function duplicateSignature(request: OwnerInputRequestRecord): string | null {
  if (request.source.kind !== 'task') return null
  if (!request.choices || request.choices.length === 0) return null
  const choices = request.choices
    .map(choice => choice.replace(/\s+/g, ' ').trim().toLowerCase())
    .join('|')
  return `${request.source.taskId}:${choices}`
}

async function closeOwnerInput(
  memoryDir: string,
  decision: RepairDecision,
  now: string,
  repairId: string,
  repairAgentId: string,
): Promise<void> {
  const nextRequest = OwnerInputRequest.parse({
    ...decision.request,
    status: 'cancelled',
    updatedAt: now,
    receipts: [
      ...decision.request.receipts,
      {
        machineId: 'owner-input',
        machineVersion: 1,
        commandId: `${repairId}:${decision.request.id}`,
        entityId: decision.request.id,
        from: decision.request.status,
        event: decision.action,
        to: 'cancelled',
        actor: repairAgentId,
        evidenceRefs: [`bounded-chat:${decision.request.boundedChatSessionId}`],
        createdAt: now,
      },
    ],
  })
  await writeJson(ownerInputRequestPath(memoryDir, nextRequest.id), nextRequest)

  const sessionFile = boundedChatSessionPath(memoryDir, decision.request.boundedChatSessionId)
  const session = JSON.parse(await readManagedTextFile(sessionFile, 'utf8')) as {
    id: string
    status: 'active' | 'waiting_for_owner' | 'coordinator_review' | 'fulfilled' | 'blocked' | 'cancelled'
    transitionReceipts?: unknown[]
    activeSubObjectiveId?: string | null
    subObjectives?: Array<{ id?: string; status?: string }>
    closure?: unknown
    updatedAt?: string
  }
  if (session.status !== 'cancelled') {
    const transition = applyBoundedChatTransition({
      sessionId: session.id,
      currentStatus: session.status,
      event: 'cancel',
      commandId: `${repairId}:${decision.request.id}:cancel-session`,
      priorReceipts: Array.isArray(session.transitionReceipts) ? session.transitionReceipts as never : [],
      actor: repairAgentId,
      evidenceRefs: [`owner-input:${decision.request.id}`],
      now,
      context: { activeSubObjectiveId: session.activeSubObjectiveId },
    })
    if (transition.kind === 'rejected') {
      throw new Error(`owner-input repair could not cancel ${session.id}: ${transition.reason}`)
    }
    session.status = transition.kind === 'already_applied' ? transition.currentState : transition.nextState
    if (transition.kind === 'applied') {
      session.transitionReceipts = [...(session.transitionReceipts ?? []), transition.receipt]
    }
    for (const subObjective of session.subObjectives ?? []) {
      if (subObjective.id === session.activeSubObjectiveId && subObjective.status === 'active') {
        subObjective.status = 'blocked'
      }
    }
    session.closure = {
      outcome: 'cancelled',
      summary: decision.assumption
        ? `Cancelled owner question; Guildhall will proceed with assumption: ${decision.assumption}`
        : `Cancelled owner question: ${decision.reason}`,
      settingUpdates: [],
      taskDrafts: [],
      evidence: [`owner-input:${decision.request.id}`],
      closedAt: now,
    }
    session.updatedAt = now
    await writeJson(sessionFile, session)
  }
}

async function readOwnerInputRequests(memoryDir: string): Promise<OwnerInputRequestRecord[]> {
  const dir = ownerInputRequestsDir(memoryDir)
  const entries = await fs.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  })
  const requests = await Promise.all(entries
    .filter(entry => entry.endsWith('.json'))
    .map(async entry => {
      const raw = await readManagedTextFile(path.join(dir, entry), 'utf8')
      return OwnerInputRequest.parse(JSON.parse(raw))
    }))
  return requests.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

function ownerInputRequestsDir(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'owner-input')
}

function ownerInputRequestPath(memoryDir: string, requestId: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, path.join('owner-input', `${requestId}.json`))
}

function boundedChatSessionPath(memoryDir: string, sessionId: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, path.join('bounded-chat', `${sessionId}.json`))
}

function queueForRepair(parsed: unknown): QueueShape {
  if (Array.isArray(parsed)) return { tasks: parsed as RawTask[] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return parsed as QueueShape
  }
  throw new Error('Cannot repair owner-input state because the authoritative task queue is malformed.')
}

function appendRepairNote(
  queue: QueueShape,
  decision: RepairDecision,
  now: string,
  repairId: string,
  repairAgentId: string,
): void {
  if (decision.request.source.kind !== 'task') return
  const taskId = decision.request.source.taskId
  const task = queue.tasks.find(item => item.id === taskId)
  if (!task) return
  const notes = Array.isArray(task.notes) ? [...task.notes] : []
  const note = repairNotePayload(decision, now, repairId, repairAgentId)
  if (!notes.some(note =>
    note && typeof note === 'object' &&
    (note as { agentId?: unknown }).agentId === repairAgentId &&
    typeof (note as { content?: unknown }).content === 'string' &&
    (note as { content: string }).content.includes(decision.request.id))) {
    notes.push(note)
  }
  task.notes = notes
}

async function appendRepairNoteEvidence(
  projectRoot: string,
  decision: RepairDecision,
  now: string,
  repairId: string,
  repairAgentId: string,
): Promise<void> {
  if (decision.request.source.kind !== 'task') return
  const taskId = decision.request.source.taskId
  const tasksPath = getProjectSystemStatePath(projectRoot, TASKS_RELATIVE_PATH)
  if (!readProjectStateDatabaseTaskPoint(tasksPath, taskId)) return
  await appendTaskEvidence(projectRoot, taskId, {
    id: `owner-input-repair-${repairId.replace(/[^0-9A-Za-z_.-]/g, '-')}-${decision.request.id}`,
    kind: 'note',
    recordedAt: now,
    payload: repairNotePayload(decision, now, repairId, repairAgentId),
  })
}

function repairNotePayload(
  decision: RepairDecision,
  now: string,
  repairId: string,
  repairAgentId: string,
): { agentId: string; role: string; content: string; timestamp: string } {
  const content = decision.assumption
    ? `Repaired stale owner-input state during ${repairId}.\n\nCancelled question: ${decision.request.prompt}\nAssumption: ${decision.assumption}\nReason: ${decision.reason}`
    : `Repaired stale owner-input state during ${repairId}.\n\nCancelled question: ${decision.request.prompt}\nReason: ${decision.reason}`
  return {
    agentId: repairAgentId,
    role: 'state-repair',
    content: `${content}\nOwner-input request: ${decision.request.id}`,
    timestamp: now,
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`)
}

export { REPAIR_ID as OWNER_INPUT_STATE_REPAIR_ID }
