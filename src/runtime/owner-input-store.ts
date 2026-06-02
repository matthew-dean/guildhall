import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'
import {
  createBoundedChatSession,
  loadBoundedChatSession,
  type BoundedChatSession,
} from './bounded-chat.js'
import {
  OwnerInputObjective,
  OwnerInputRequest,
  OwnerInputSource,
  OwnerInputTarget,
  ownerInputSourceKey,
  type OwnerInputRequest as OwnerInputRequestRecord,
} from './owner-input.js'

const CreateOwnerInputRequestInput = z.object({
  projectRoot: z.string(),
  projectId: z.string(),
  commandId: z.string(),
  now: z.string(),
  actor: z.string(),
  source: OwnerInputSource,
  target: OwnerInputTarget,
  prompt: z.string(),
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
      prompt: input.prompt,
      helperText: input.helperText,
      choices: input.choices,
    },
  })

  const request = OwnerInputRequest.parse({
    id: requestId,
    projectId: input.projectId,
    source: input.source,
    sourceKey,
    target: input.target,
    prompt: input.prompt,
    choices: input.choices,
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

async function writeOwnerInputRequest(memoryDir: string, request: OwnerInputRequestRecord): Promise<void> {
  const filePath = path.join(ownerInputDir(memoryDir), `${request.id}.json`)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(OwnerInputRequest.parse(request), null, 2) + '\n')
}

function projectMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, '.guildhall')
}

function ownerInputDir(memoryDir: string): string {
  return path.join(memoryDir, 'owner-input')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
