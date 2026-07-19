import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  atomicWriteText,
  getProjectSystemStateDir,
  getProjectSystemStatePathFromMemoryDir,
  replaceProjectStateDatabaseOwnerInputs,
} from '@guildhall/sessions'
import {
  createBoundedChatSession,
  loadBoundedChatSession,
  saveBoundedChatSession,
  type BoundedChatSession,
} from './bounded-chat.js'
import { applyBoundedChatTransition } from './bounded-chat-machine.js'
import {
  OwnerInputObjective,
  OwnerInputRequest,
  OwnerInputSource,
  OwnerInputTarget,
  ownerInputSourceKey,
  type OwnerInputRequest as OwnerInputRequestRecord,
} from './owner-input.js'
import { normalizeStructuredOwnerQuestion } from './owner-question-normalizer.js'

const OwnerQuestionInput = z.object({
  kind: z.string().optional(),
  prompt: z.string(),
  subject: z.string().optional(),
  description: z.string().optional(),
  choices: z.array(z.string()).optional(),
  selectionMode: z.string().optional(),
})

const CreateOwnerInputRequestInput = z.object({
  projectRoot: z.string(),
  projectId: z.string(),
  commandId: z.string(),
  now: z.string(),
  actor: z.string(),
  source: OwnerInputSource,
  target: OwnerInputTarget,
  question: OwnerQuestionInput.optional(),
  prompt: z.string().optional(),
  helperText: z.string().optional(),
  choices: z.array(z.string()).optional(),
  objective: OwnerInputObjective,
  sessionSource: z.string().optional(),
})

export type CreateOwnerInputRequestInput = z.input<typeof CreateOwnerInputRequestInput>

export interface CreateOwnerInputRequestResult {
  request: OwnerInputRequestRecord
  session: BoundedChatSession
  created: boolean
}

export async function createOwnerInputRequest(
  rawInput: CreateOwnerInputRequestInput,
): Promise<CreateOwnerInputRequestResult> {
  const input = CreateOwnerInputRequestInput.parse(rawInput)
  const rawQuestion = input.question ?? (input.prompt
    ? { prompt: input.prompt, description: input.helperText, choices: input.choices }
    : null)
  if (!rawQuestion) {
    throw new Error('owner-input requires a structured question')
  }
  const normalizedQuestion = normalizeStructuredOwnerQuestion(rawQuestion)
  if (!normalizedQuestion) {
    throw new Error('owner-input prompt is agent narration, not an answerable user question')
  }
  const memoryDir = projectMemoryDir(input.projectRoot)
  await fsp.mkdir(ownerInputDir(memoryDir), { recursive: true })

  const sourceKey = ownerInputSourceKey(input.source)
  const existing = (await listOwnerInputRequests(input.projectRoot))
    .find(request => request.sourceKey === sourceKey || request.commandIds.includes(input.commandId))

  if (existing) {
    const session = await loadBoundedChatSession({
      memoryDir,
      sessionId: existing.boundedChatSessionId,
    })
    return { request: existing, session, created: false }
  }

  const requestId = `oir-${shortHash(`${input.projectId}:${sourceKey}`)}`
  const session = await createBoundedChatSession({
    memoryDir,
    projectId: input.projectId,
    source: input.sessionSource ?? `owner-input:${sourceKey}`,
    now: input.now,
    objective: input.objective,
    initialSubObjective: {
      id: input.source.kind === 'task' && input.source.questionId
        ? input.source.questionId
        : `owner-input-${shortHash(sourceKey)}`,
      objective: input.objective.label,
      prompt: normalizedQuestion.prompt,
      helperText: normalizedQuestion.description,
      choices: normalizedQuestion.choices,
      selectionMode: normalizedQuestion.selectionMode === 'multiple' ? 'multiple' : 'single',
    },
  })

  const request = OwnerInputRequest.parse({
    id: requestId,
    projectId: input.projectId,
    source: input.source,
    sourceKey,
    target: input.target,
    prompt: normalizedQuestion.prompt,
    choices: normalizedQuestion.choices,
    selectionMode: normalizedQuestion.selectionMode,
    objective: input.objective,
    status: 'waiting_for_owner',
    boundedChatSessionId: session.id,
    commandIds: [input.commandId],
    receipts: [],
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actor,
  })
  await writeOwnerInputRequest(memoryDir, request)
  refreshOwnerInputProjection(input.projectRoot, input.now)
  return { request, session, created: true }
}

export async function listOwnerInputRequests(projectRoot: string): Promise<OwnerInputRequestRecord[]> {
  const dir = ownerInputDir(projectMemoryDir(projectRoot))
  const entries = await fsp.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  })
  const requests = await Promise.all(entries
    .filter(entry => entry.endsWith('.json'))
    .map(async (entry) => {
      const raw = await fsp.readFile(path.join(dir, entry), 'utf-8')
      return OwnerInputRequest.parse(JSON.parse(raw))
    }))
  return requests.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export async function findOwnerInputRequestBySource(
  projectRoot: string,
  source: z.input<typeof OwnerInputSource>,
): Promise<OwnerInputRequestRecord | null> {
  const parsed = OwnerInputSource.parse(source)
  const sourceKey = ownerInputSourceKey(parsed)
  return (await listOwnerInputRequests(projectRoot)).find(request => request.sourceKey === sourceKey) ?? null
}

export function listOwnerInputRequestsSync(projectRoot: string): OwnerInputRequestRecord[] {
  const dir = ownerInputDir(projectMemoryDir(projectRoot))
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(entry => entry.endsWith('.json'))
    .map(entry => {
      const raw = fs.readFileSync(path.join(dir, entry), 'utf-8')
      return OwnerInputRequest.parse(JSON.parse(raw))
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export function waitingOwnerInputTaskIdsSync(projectRoot: string): Set<string> {
  return new Set(
    listOwnerInputRequestsSync(projectRoot)
      .filter((request): request is OwnerInputRequestRecord & { source: { kind: 'task'; taskId: string } } =>
        request.status === 'waiting_for_owner' && request.source.kind === 'task')
      .map(request => request.source.taskId),
  )
}

export async function cancelOwnerInputRequestsForTask(input: {
  projectRoot: string
  taskId: string
  now?: string
  reason?: string
}): Promise<number> {
  const now = input.now ?? new Date().toISOString()
  const memoryDir = projectMemoryDir(input.projectRoot)
  const requests = (await listOwnerInputRequests(input.projectRoot))
    .filter(request =>
      request.status !== 'fulfilled' &&
      request.status !== 'cancelled' &&
      request.source.kind === 'task' &&
      request.source.taskId === input.taskId,
    )

  for (const request of requests) {
    const nextRequest = OwnerInputRequest.parse({
      ...request,
      status: 'cancelled',
      updatedAt: now,
      receipts: [
        ...request.receipts,
        {
          machineId: 'owner-input',
          machineVersion: 1,
          commandId: `task-reframe:${input.taskId}:${request.id}`,
          entityId: request.id,
          from: request.status,
          event: 'cancel',
          to: 'cancelled',
          actor: 'task-reframe',
          evidenceRefs: [`task:${input.taskId}`],
          createdAt: now,
        },
      ],
    })
    await writeOwnerInputRequest(memoryDir, nextRequest)

    const session = await loadBoundedChatSession({
      memoryDir,
      sessionId: request.boundedChatSessionId,
    })
    if (session.status !== 'fulfilled' && session.status !== 'cancelled') {
      const transition = applyBoundedChatTransition({
        sessionId: session.id,
        currentStatus: session.status,
        event: 'cancel',
        commandId: `task-reframe:${input.taskId}:${request.id}:session`,
        priorReceipts: session.transitionReceipts,
        actor: 'task-reframe',
        evidenceRefs: [`owner-input:${request.id}`],
        now,
        context: { activeSubObjectiveId: session.activeSubObjectiveId },
      })
      if (transition.kind === 'rejected') {
        throw new Error(`Could not cancel bounded chat ${session.id}: ${transition.reason}`)
      }
      if (transition.kind === 'applied') {
        session.transitionReceipts = [...session.transitionReceipts, transition.receipt]
      }
      session.status = transition.kind === 'already_applied' ? transition.currentState : transition.nextState
      session.closure = {
        outcome: 'cancelled',
        summary: input.reason ?? `Cancelled because task ${input.taskId} was reframed.`,
        settingUpdates: [],
        taskDrafts: [],
        evidence: [`task:${input.taskId}`],
        closedAt: now,
      }
      session.updatedAt = now
      await saveBoundedChatSession(memoryDir, session)
    }
  }

  if (requests.length > 0) refreshOwnerInputProjection(input.projectRoot, now)
  return requests.length
}

export async function markOwnerInputRequestForBoundedChatReview(input: {
  projectRoot: string
  boundedChatSessionId: string
  now?: string
  actor?: string
}): Promise<OwnerInputRequestRecord | null> {
  const requests = await listOwnerInputRequests(input.projectRoot)
  const request = requests.find(item => item.boundedChatSessionId === input.boundedChatSessionId)
  if (!request) return null
  if (request.status !== 'waiting_for_owner') return request
  const now = input.now ?? new Date().toISOString()
  const next = OwnerInputRequest.parse({
    ...request,
    status: 'coordinator_review',
    updatedAt: now,
    receipts: [
      ...request.receipts,
      {
        machineId: 'owner-input',
        machineVersion: 1,
        commandId: `owner-response:${input.boundedChatSessionId}`,
        entityId: request.id,
        from: request.status,
        event: 'submit_owner_response',
        to: 'coordinator_review',
        actor: input.actor ?? 'owner',
        evidenceRefs: [`bounded-chat:${input.boundedChatSessionId}`],
        createdAt: now,
      },
    ],
  })
  await writeOwnerInputRequest(projectMemoryDir(input.projectRoot), next)
  refreshOwnerInputProjection(input.projectRoot, now)
  return next
}

export function refreshOwnerInputProjection(projectRoot: string, _updatedAt: string): void {
  const openRequests = listOwnerInputRequestsSync(projectRoot)
    .filter(request => request.status === 'waiting_for_owner' || request.status === 'coordinator_review')
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
  const next = openRequests[0]
  replaceProjectStateDatabaseOwnerInputs(projectRoot, openRequests.map(request => ({
    id: request.id,
    status: request.status,
    prompt: request.prompt,
    taskId: request.source.kind === 'task' ? request.source.taskId : null,
    updatedAt: request.updatedAt,
    payload: request,
  })))
}

async function writeOwnerInputRequest(memoryDir: string, request: OwnerInputRequestRecord): Promise<void> {
  const filePath = path.join(ownerInputDir(memoryDir), `${request.id}.json`)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(OwnerInputRequest.parse(request), null, 2) + '\n')
}

function projectMemoryDir(projectRoot: string): string {
  return getProjectSystemStateDir(projectRoot)
}

function ownerInputDir(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'owner-input')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
