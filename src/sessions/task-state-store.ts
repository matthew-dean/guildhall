import fs from 'node:fs/promises'
import path from 'node:path'
import {
  TaskEvidenceEvent,
  type TaskEvidenceKind,
  TaskRuntimeStateStore,
  TaskWorkspaceStateStore,
  type TaskRuntimeState,
  type TaskWorkspaceState,
} from '@guildhall/core'
import { atomicWriteText } from './atomic.js'
import {
  getProjectLocalHistoryDir,
  getProjectTaskLocalHistoryDir,
} from './local-history.js'

const EVIDENCE_FILE_BY_KIND: Record<TaskEvidenceKind, string> = {
  event: 'events.jsonl',
  note: 'notes.jsonl',
  gate_result: 'gate-results.jsonl',
  review_verdict: 'review-verdicts.jsonl',
  adjudication: 'adjudications.jsonl',
  escalation: 'escalations.jsonl',
  agent_issue: 'agent-issues.jsonl',
  merge_record: 'merge-records.jsonl',
  git_story: 'git-story.jsonl',
}

function nowIso(): string {
  return new Date().toISOString()
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

export function runtimeStatePath(projectRoot: string): string {
  return path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'tasks.json')
}

export function taskWorkspaceStatePath(projectRoot: string): string {
  return path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'task-workspaces.json')
}

export function taskEvidencePath(
  projectRoot: string,
  taskId: string,
  kind: TaskEvidenceKind,
): string {
  return path.join(
    getProjectTaskLocalHistoryDir(projectRoot, taskId),
    EVIDENCE_FILE_BY_KIND[kind],
  )
}

export async function readTaskRuntimeStore(projectRoot: string): Promise<TaskRuntimeStateStore> {
  const fallback = {
    version: 1,
    lastUpdated: nowIso(),
    tasks: {},
  }
  return TaskRuntimeStateStore.parse(
    await readJsonFile(runtimeStatePath(projectRoot), fallback),
  )
}

export async function writeTaskRuntimeStore(
  projectRoot: string,
  store: TaskRuntimeStateStore,
): Promise<void> {
  const file = runtimeStatePath(projectRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteText(file, `${JSON.stringify(TaskRuntimeStateStore.parse(store), null, 2)}\n`)
}

export async function upsertTaskRuntimeState(
  projectRoot: string,
  taskId: string,
  patch: Partial<Omit<TaskRuntimeState, 'taskId'>> & { updatedAt?: string },
): Promise<TaskRuntimeState> {
  const store = await readTaskRuntimeStore(projectRoot)
  const updatedAt = patch.updatedAt ?? nowIso()
  const next = {
    ...(store.tasks[taskId] ?? { taskId, updatedAt }),
    ...patch,
    taskId,
    updatedAt,
  }
  store.tasks[taskId] = next
  store.lastUpdated = updatedAt
  await writeTaskRuntimeStore(projectRoot, store)
  return next
}

export async function readTaskWorkspaceStore(projectRoot: string): Promise<TaskWorkspaceStateStore> {
  const fallback = {
    version: 1,
    lastUpdated: nowIso(),
    workspaces: {},
  }
  return TaskWorkspaceStateStore.parse(
    await readJsonFile(taskWorkspaceStatePath(projectRoot), fallback),
  )
}

export async function writeTaskWorkspaceStore(
  projectRoot: string,
  store: TaskWorkspaceStateStore,
): Promise<void> {
  const file = taskWorkspaceStatePath(projectRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteText(file, `${JSON.stringify(TaskWorkspaceStateStore.parse(store), null, 2)}\n`)
}

export async function upsertTaskWorkspaceState(
  projectRoot: string,
  taskId: string,
  patch: Partial<Omit<TaskWorkspaceState, 'taskId'>> & { updatedAt?: string },
): Promise<TaskWorkspaceState> {
  const store = await readTaskWorkspaceStore(projectRoot)
  const updatedAt = patch.updatedAt ?? nowIso()
  const next = {
    ...(store.workspaces[taskId] ?? { taskId, updatedAt }),
    ...patch,
    taskId,
    updatedAt,
  }
  store.workspaces[taskId] = next
  store.lastUpdated = updatedAt
  await writeTaskWorkspaceStore(projectRoot, store)
  return next
}

export async function appendTaskEvidence(
  projectRoot: string,
  taskId: string,
  event: Omit<TaskEvidenceEvent, 'taskId'> & { taskId?: string },
): Promise<TaskEvidenceEvent> {
  const parsed = TaskEvidenceEvent.parse({
    ...event,
    taskId,
  })
  const file = taskEvidencePath(projectRoot, taskId, parsed.kind)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(parsed)}\n`, 'utf-8')
  return parsed
}

export async function readTaskEvidence(
  projectRoot: string,
  taskId: string,
  opts: { kind?: TaskEvidenceKind } = {},
): Promise<TaskEvidenceEvent[]> {
  const kinds = opts.kind ? [opts.kind] : Object.keys(EVIDENCE_FILE_BY_KIND) as TaskEvidenceKind[]
  const events: TaskEvidenceEvent[] = []
  for (const kind of kinds) {
    const file = taskEvidencePath(projectRoot, taskId, kind)
    let raw = ''
    try {
      raw = await fs.readFile(file, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      events.push(TaskEvidenceEvent.parse(JSON.parse(line)))
    }
  }
  return events.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}
