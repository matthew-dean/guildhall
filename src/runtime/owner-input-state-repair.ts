import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText, getProjectStateDir } from '@guildhall/sessions'
import { applyBoundedChatTransition } from './bounded-chat-machine.js'
import { OwnerInputRequest, type OwnerInputRequest as OwnerInputRequestRecord } from './owner-input.js'
import { isInvalidOwnerQuestionPrompt } from './owner-question-normalizer.js'

export interface OwnerInputStateRepairInput {
  projectRoot: string
  apply: boolean
  now?: string
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
const REPAIR_AGENT_ID = `migration:${REPAIR_ID}`
const TASKS_RELATIVE_PATH = '.guildhall/TASKS.json'

export async function repairOwnerInputState(
  input: OwnerInputStateRepairInput,
): Promise<OwnerInputStateRepairResult> {
  const now = input.now ?? new Date().toISOString()
  const memoryDir = getProjectStateDir(input.projectRoot)
  const requests = await readOwnerInputRequests(memoryDir)
  const decisions = planRepairs(requests)

  const cancelledInvalid = decisions.filter(decision => decision.action === 'cancel_invalid').map(decision => decision.request.id)
  const resolvedByAssumption = decisions.filter(decision => decision.action === 'resolve_by_assumption').map(decision => decision.request.id)
  const cancelledDuplicates = decisions.filter(decision => decision.action === 'cancel_duplicate').map(decision => decision.request.id)

  const affectedPaths = decisions.length > 0
    ? ['.guildhall/owner-input', '.guildhall/bounded-chat', TASKS_RELATIVE_PATH]
    : []

  if (!input.apply || decisions.length === 0) {
    return { cancelledInvalid, resolvedByAssumption, cancelledDuplicates, affectedPaths }
  }

  const queueFile = path.join(memoryDir, 'TASKS.json')
  const queue = await readQueue(queueFile)
  for (const decision of decisions) {
    await closeOwnerInput(memoryDir, decision, now)
    appendRepairNote(queue, decision, now)
  }
  atomicWriteText(queueFile, `${JSON.stringify({ ...queue, lastUpdated: now }, null, 2)}\n`)

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
    const assumption = containedPlanningNoteAssumption(request)
    if (assumption) {
      decisions.push({
        request,
        action: 'resolve_by_assumption',
        reason: 'The decision is low-risk after atomic-commit containment, so Guildhall should proceed with a recorded assumption instead of interrupting.',
        assumption,
      })
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
  const prompt = request.prompt.trim()
  const normalized = prompt.replace(/\s+/g, ' ').toLowerCase()
  return (
    isInvalidOwnerQuestionPrompt(prompt) ||
    /^no problem\b/.test(normalized) ||
    /\bi already have the question posted\b/.test(normalized) ||
    /\bthe question is already there in the task'?s `?openquestions`?\b/.test(normalized) ||
    /^i have enough from\b/.test(normalized)
  )
}

function containedPlanningNoteAssumption(request: OwnerInputRequestRecord): string | null {
  const prompt = request.prompt.toLowerCase()
  const choices = request.choices ?? []
  if (!prompt.includes('review timezone wording later')) return null
  const cursorPlanChoice = choices.find(choice => choice.includes('.cursor/plan.md'))
  if (!cursorPlanChoice) return null
  return 'Use `.cursor/plan.md` as the planning backlog target for the harmless timezone-wording follow-up note.'
}

function duplicateSignature(request: OwnerInputRequestRecord): string | null {
  if (request.source.kind !== 'task') return null
  if (!request.choices || request.choices.length === 0) return null
  const choices = request.choices
    .map(choice => choice.replace(/\s+/g, ' ').trim().toLowerCase())
    .join('|')
  return `${request.source.taskId}:${choices}`
}

async function closeOwnerInput(memoryDir: string, decision: RepairDecision, now: string): Promise<void> {
  const nextRequest = OwnerInputRequest.parse({
    ...decision.request,
    status: 'cancelled',
    updatedAt: now,
    receipts: [
      ...decision.request.receipts,
      {
        machineId: 'owner-input',
        machineVersion: 1,
        commandId: `${REPAIR_ID}:${decision.request.id}`,
        entityId: decision.request.id,
        from: decision.request.status,
        event: decision.action,
        to: 'cancelled',
        actor: REPAIR_AGENT_ID,
        evidenceRefs: [`bounded-chat:${decision.request.boundedChatSessionId}`],
        createdAt: now,
      },
    ],
  })
  await writeJson(path.join(memoryDir, 'owner-input', `${nextRequest.id}.json`), nextRequest)

  const sessionFile = path.join(memoryDir, 'bounded-chat', `${decision.request.boundedChatSessionId}.json`)
  const session = JSON.parse(await fs.readFile(sessionFile, 'utf8')) as {
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
      commandId: `${REPAIR_ID}:${decision.request.id}:cancel-session`,
      priorReceipts: Array.isArray(session.transitionReceipts) ? session.transitionReceipts as never : [],
      actor: REPAIR_AGENT_ID,
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
  const dir = path.join(memoryDir, 'owner-input')
  const entries = await fs.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  })
  const requests = await Promise.all(entries
    .filter(entry => entry.endsWith('.json'))
    .map(async entry => {
      const raw = await fs.readFile(path.join(dir, entry), 'utf8')
      return OwnerInputRequest.parse(JSON.parse(raw))
    }))
  return requests.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

async function readQueue(file: string): Promise<QueueShape> {
  const raw = await fs.readFile(file, 'utf8').catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '{"tasks":[]}'
    throw err
  })
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return { tasks: parsed as RawTask[] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return parsed as QueueShape
  }
  return { tasks: [] }
}

function appendRepairNote(queue: QueueShape, decision: RepairDecision, now: string): void {
  if (decision.request.source.kind !== 'task') return
  const taskId = decision.request.source.taskId
  const task = queue.tasks.find(item => item.id === taskId)
  if (!task) return
  const notes = Array.isArray(task.notes) ? [...task.notes] : []
  const content = decision.assumption
    ? `Repaired stale owner-input state during ${REPAIR_ID}.\n\nCancelled question: ${decision.request.prompt}\nAssumption: ${decision.assumption}\nReason: ${decision.reason}`
    : `Repaired stale owner-input state during ${REPAIR_ID}.\n\nCancelled question: ${decision.request.prompt}\nReason: ${decision.reason}`
  if (!notes.some(note =>
    note && typeof note === 'object' &&
    (note as { agentId?: unknown }).agentId === REPAIR_AGENT_ID &&
    typeof (note as { content?: unknown }).content === 'string' &&
    (note as { content: string }).content.includes(decision.request.id))) {
    notes.push({
      agentId: REPAIR_AGENT_ID,
      role: 'state-repair',
      content: `${content}\nOwner-input request: ${decision.request.id}`,
      timestamp: now,
    })
  }
  task.notes = notes
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`)
}

export { REPAIR_ID as OWNER_INPUT_STATE_REPAIR_ID }
