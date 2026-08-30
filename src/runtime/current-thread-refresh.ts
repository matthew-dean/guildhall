import {
  getProjectStateDir,
  getProjectSystemStatePath,
  readProjectStateDatabaseQueue,
  readProjectStateDatabaseQueueDefinition,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseRevisionFromTasksPath,
  readProjectStateDatabaseTasks,
  readProjectStateDatabaseQueueWithRevision,
  readProjectStateDatabaseSummary,
  readProjectStateDatabaseThreadSurfaceState,
  markProjectStateDatabaseProjectionCurrent,
  writeProjectStateDatabaseCurrentThread,
} from '@guildhall/sessions'
import { buildSnapshotAsync } from './wizards.js'
import { buildThread, type BuildThreadOptions } from './thread.js'
import {
  buildCurrentThreadProjection,
  DEFAULT_CURRENT_THREAD_COMPLETED_TURN_WINDOW,
  DEFAULT_CURRENT_THREAD_PENDING_TURN_WINDOW,
  buildThreadHistoryProjection,
  type CurrentThreadProjection,
} from './current-thread-projection.js'
import {
  readProjectCurrentTaskEvidenceWithRevisionAtBoundary,
  readProjectTaskQueue,
} from './project-state-boundary.js'
import { TaskQueue, type Task } from '@guildhall/core'
import { listBoundedChatSessionsAsync } from './bounded-chat.js'
import { listPressureTestIntakesAsync, summarizeProjectCheckIn } from './pressure-test-intake.js'

type RecentEvent = NonNullable<BuildThreadOptions['recentEvents']>[number]

export interface RefreshCurrentThreadProjectionOptions {
  runStatus?: string
  activeTaskId?: string
  pausedTaskId?: string
  recentEvents?: RecentEvent[]
}

const CURRENT_THREAD_READ_ATTEMPTS = 2
const CURRENT_THREAD_CURRENT_TASK_WINDOW = DEFAULT_CURRENT_THREAD_PENDING_TURN_WINDOW + 1
const CURRENT_THREAD_TERMINAL_TASK_WINDOW = DEFAULT_CURRENT_THREAD_COMPLETED_TURN_WINDOW
const CURRENT_THREAD_CURRENT_STATUSES = new Set([
  'proposed',
  'import_draft',
  'exploring',
  'spec_review',
  'ready',
  'in_progress',
  'review',
  'gate_check',
  'blocked',
])
const CURRENT_THREAD_TERMINAL_STATUSES = new Set([
  'blocked',
  'pending_pr',
  'done',
  'shelved',
  'archived',
  'cancelled',
])

// buildThread needs the current task facts that can become visible turns, but
// it does not need the rest of a rich task definition for this read model.
const THREAD_TASK_FIELDS = [
  'id',
  'title',
  'description',
  'projectPath',
  'request',
  'requestIntake',
  'references',
  'sourceClaims',
  'status',
  'spec',
  'structuredSpec',
  'specReviewGate',
  'acceptanceCriteria',
  'productBrief',
  'dependsOn',
  'notes',
  'revisionCount',
  'blocker',
  'blockReason',
  'escalations',
  'delivery',
  'workKind',
  'workVisibility',
  'taskReadiness',
  'currentSummary',
  'openQuestions',
  'hierarchy',
  'createdAt',
  'updatedAt',
  'completedAt',
] as const

type ThreadTaskRecord = Record<string, unknown>

interface ThreadTaskRead {
  tasks: Task[]
  sourceQueueRevision: number
  sourceProjectRevision: number
}

interface FullThreadProjectionSource {
  tasks: Task[]
  boundedChatSessions: Awaited<ReturnType<typeof listBoundedChatSessionsAsync>>
  pressureTestIntakes: Awaited<ReturnType<typeof listPressureTestIntakesAsync>>
  projectCheckInSummary: ReturnType<typeof summarizeProjectCheckIn>
}

/**
 * Read compact task rows first, then hydrate only the bounded task set whose
 * details can affect the current Thread window. The compact rows remain in
 * the input so queue ordering and current indexed state are preserved.
 *
 * undefined means this project has no compact database yet. null means a
 * compact read was attempted but could not be made revision-stable.
 */
function readThreadTasks(projectRoot: string, tasksPath: string): ThreadTaskRead | null | undefined {
  let sawCompactDatabase = false
  for (let attempt = 0; attempt < CURRENT_THREAD_READ_ATTEMPTS; attempt += 1) {
    const sourceQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)
    const sourceProjectRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)
    const compactQueue = readProjectStateDatabaseQueue(tasksPath)
    if (!compactQueue) {
      if (sawCompactDatabase) return null
      return undefined
    }
    sawCompactDatabase = true
    if (sourceQueueRevision === null || sourceProjectRevision === null) return null

    const compactTasks = compactQueue.tasks as ThreadTaskRecord[]
    const detailIds = boundedThreadTaskIds(compactTasks)
    const detailedTasks = readProjectStateDatabaseTasks(tasksPath, detailIds, {
      includeDefinitions: true,
    })
    if (!detailedTasks || detailedTasks.length !== detailIds.length) return null
    const evidenceRead = readProjectCurrentTaskEvidenceWithRevisionAtBoundary(projectRoot, detailIds)
    if (!evidenceRead) return null
    if (
      evidenceRead.queueRevision !== sourceQueueRevision ||
      evidenceRead.projectRevision !== sourceProjectRevision
    ) continue

    const currentQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)
    const currentProjectRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)
    if (currentQueueRevision !== sourceQueueRevision || currentProjectRevision !== sourceProjectRevision) continue

    const detailsById = new Map(detailedTasks.map(task => [task.id, task]))
    const fallbackAt = new Date().toISOString()
    return {
      tasks: compactTasks.map(task => {
        const detailed = detailsById.get(typeof task.id === 'string' ? task.id : '')
        const evidence = evidenceRead.records.get(typeof task.id === 'string' ? task.id : '')
        return threadTaskSummary(task, detailed, evidence, projectRoot, fallbackAt)
      }),
      sourceQueueRevision,
      sourceProjectRevision,
    }
  }
  return null
}

/**
 * Full Thread construction belongs to this projection boundary only. Current
 * Thread still uses the bounded task-detail read above; history uses the
 * revision-matched rich queue plus the bounded-chat/intake sources that the
 * old history route assembled on demand.
 */
async function readFullThreadProjectionSource(
  projectRoot: string,
  tasksPath: string,
  compactRead: ThreadTaskRead | null | undefined,
  legacyQueue: unknown,
): Promise<FullThreadProjectionSource | null> {
  const queue = compactRead === undefined
    ? legacyQueue
    : readProjectStateDatabaseQueueDefinition(tasksPath)
  const parsedQueue = TaskQueue.safeParse(queue)
  if (!parsedQueue.success) return null
  const memoryDir = getProjectStateDir(projectRoot)
  const [boundedChatSessions, pressureTestIntakes] = await Promise.all([
    listBoundedChatSessionsAsync(memoryDir).catch(() => []),
    listPressureTestIntakesAsync(memoryDir).catch(() => []),
  ])
  return {
    tasks: parsedQueue.data.tasks,
    boundedChatSessions,
    pressureTestIntakes,
    projectCheckInSummary: summarizeProjectCheckIn(memoryDir),
  }
}

function boundedThreadTaskIds(tasks: readonly ThreadTaskRecord[]): string[] {
  const ids = new Set<string>()
  const add = (task: ThreadTaskRecord): void => {
    if (typeof task.id === 'string' && task.id) ids.add(task.id)
  }

  tasks
    .filter(task => CURRENT_THREAD_CURRENT_STATUSES.has(String(task.status ?? '')))
    .slice(0, CURRENT_THREAD_CURRENT_TASK_WINDOW)
    .forEach(add)

  tasks
    .filter(task => hasVisibleQuestionSummary(task))
    .slice(0, DEFAULT_CURRENT_THREAD_PENDING_TURN_WINDOW)
    .forEach(add)

  tasks
    .filter(task => CURRENT_THREAD_TERMINAL_STATUSES.has(String(task.status ?? '')))
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))
    .slice(0, CURRENT_THREAD_TERMINAL_TASK_WINDOW)
    .forEach(add)

  return [...ids]
}

function hasVisibleQuestionSummary(task: ThreadTaskRecord): boolean {
  if (!Array.isArray(task.openQuestions)) return false
  return task.openQuestions.some(question =>
    Boolean(
      question &&
      typeof question === 'object' &&
      typeof (question as ThreadTaskRecord).answeredAt !== 'string',
    ),
  )
}

function taskTimestamp(task: ThreadTaskRecord): number {
  return Math.max(
    ...['completedAt', 'updatedAt'].map(key => {
      const value = task[key]
      const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
      return Number.isFinite(parsed) ? parsed : 0
    }),
  )
}

function threadTaskSummary(
  compactTask: ThreadTaskRecord,
  detailedTask: { definition: ThreadTaskRecord } | undefined,
  currentEvidence: { byKind?: Record<string, Array<{ payload?: unknown }>> } | undefined,
  projectRoot: string,
  fallbackAt: string,
): Task {
  const source = {
    ...(detailedTask?.definition ?? {}),
    ...compactTask,
  }
  const task: ThreadTaskRecord = {
    projectPath: projectRoot,
    createdAt: typeof source.createdAt === 'string'
      ? source.createdAt
      : typeof source.updatedAt === 'string'
        ? source.updatedAt
        : fallbackAt,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : fallbackAt,
  }
  for (const key of THREAD_TASK_FIELDS) {
    if (key in source) task[key] = source[key]
  }
  const evidenceNotes = (currentEvidence?.byKind?.note ?? [])
    .flatMap(entry => entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
      ? [entry.payload as ThreadTaskRecord]
      : [])
  if (evidenceNotes.length > 0) {
    const sourceNotes = Array.isArray(task.notes) ? task.notes as ThreadTaskRecord[] : []
    const seen = new Set<string>()
    task.notes = [...sourceNotes, ...evidenceNotes].filter(note => {
      const key = JSON.stringify([note.agentId, note.role, note.content, note.timestamp])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }) as Task['notes']
  }
  return task as Task
}

/**
 * Rebuilds the bounded current Thread only at a write/startup projection
 * boundary. Ordinary Thread reads must consume the persisted row and never
 * call this function.
 */
export async function refreshCurrentThreadProjection(
  projectRoot: string,
  options: RefreshCurrentThreadProjectionOptions = {},
): Promise<CurrentThreadProjection | null> {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  for (let attempt = 0; attempt < CURRENT_THREAD_READ_ATTEMPTS; attempt += 1) {
    const compactRead = readThreadTasks(projectRoot, tasksPath)
    let tasks: Task[]
    let legacyQueue: unknown = null
    let sourceQueueRevision: number | null = null
    let sourceProjectRevision: number | null = null
    let sourceRevision: string | number

    if (compactRead !== undefined) {
      if (compactRead === null) return null
      tasks = compactRead.tasks
      sourceQueueRevision = compactRead.sourceQueueRevision
      sourceProjectRevision = compactRead.sourceProjectRevision
      sourceRevision = sourceProjectRevision
    } else {
      const queueRead = readProjectStateDatabaseQueueWithRevision(tasksPath)
      const queue = queueRead?.definition ?? await readProjectTaskQueue(tasksPath).catch(() => null)
      legacyQueue = queue
      const parsedQueue = TaskQueue.safeParse(queue)
      if (!parsedQueue.success) return null
      tasks = parsedQueue.data.tasks
      sourceQueueRevision = queueRead?.revision ?? null
      sourceProjectRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)
      const summary = readProjectStateDatabaseSummary(tasksPath, { includeOrientation: false })
      sourceRevision = sourceProjectRevision ?? summary?.sourceQueueLastUpdated ?? 'legacy'
    }

    const [snapshot] = await Promise.all([buildSnapshotAsync({ projectPath: projectRoot })])
    const thread = buildThread({
      projectPath: projectRoot,
      snapshot,
      tasks,
      ...(options.runStatus !== undefined ? { runStatus: options.runStatus } : {}),
      ...(options.activeTaskId ? { activeTaskId: options.activeTaskId } : {}),
      ...(options.pausedTaskId ? { pausedTaskId: options.pausedTaskId } : {}),
      ...(options.recentEvents ? { recentEvents: options.recentEvents } : {}),
    })
    if (
      sourceQueueRevision !== null &&
      (readProjectStateDatabaseQueueRevision(tasksPath) !== sourceQueueRevision ||
        readProjectStateDatabaseRevisionFromTasksPath(tasksPath) !== sourceProjectRevision)
    ) {
      continue
    }

    const fullThreadSource = await readFullThreadProjectionSource(
      projectRoot,
      tasksPath,
      compactRead,
      legacyQueue,
    )
    const historyThread = fullThreadSource
      ? buildThread({
          projectPath: projectRoot,
          snapshot,
          tasks: fullThreadSource.tasks,
          boundedChatSessions: fullThreadSource.boundedChatSessions,
          pressureTestIntakes: fullThreadSource.pressureTestIntakes,
          projectCheckInSummary: fullThreadSource.projectCheckInSummary,
          ...(options.runStatus !== undefined ? { runStatus: options.runStatus } : {}),
          ...(options.activeTaskId ? { activeTaskId: options.activeTaskId } : {}),
          ...(options.pausedTaskId ? { pausedTaskId: options.pausedTaskId } : {}),
          ...(options.recentEvents ? { recentEvents: options.recentEvents } : {}),
        })
      : null
    if (
      sourceQueueRevision !== null &&
      (readProjectStateDatabaseQueueRevision(tasksPath) !== sourceQueueRevision ||
        readProjectStateDatabaseRevisionFromTasksPath(tasksPath) !== sourceProjectRevision)
    ) {
      continue
    }

    const projection = buildCurrentThreadProjection({
      thread,
      generatedAt: new Date().toISOString(),
      sourceRevision,
    })
    const history = historyThread ? buildThreadHistoryProjection({ thread: historyThread }) : null
    writeProjectStateDatabaseCurrentThread(projectRoot, {
      payload: projection,
      generatedAt: projection.generatedAt,
      sourceRevision: projection.sourceRevision,
      sourceQueueRevision,
      ...(history && sourceProjectRevision !== null
        ? {
            history: {
              turns: history.turns,
              generatedAt: projection.generatedAt,
              sourceRevision: sourceProjectRevision,
              sourceQueueRevision,
              truncated: history.truncated,
            },
          }
        : {}),
    })

    // The sessions writer does not yet accept an expected project revision.
    // Verify through the same atomic surface used by Thread before publishing
    // the projection watermark; a concurrent commit leaves this row stale and
    // lets the owning scheduler retry it.
    if (sourceProjectRevision !== null) {
      const committed = readProjectStateDatabaseThreadSurfaceState<CurrentThreadProjection>(projectRoot)
      if (
        committed?.projectRevision !== sourceProjectRevision ||
        committed.queueRevision !== sourceQueueRevision ||
        committed.thread?.sourceRevision !== String(sourceProjectRevision) ||
        committed.thread?.sourceQueueRevision !== sourceQueueRevision
      ) {
        continue
      }
      markProjectStateDatabaseProjectionCurrent(
        projectRoot,
        'thread',
        sourceProjectRevision,
        projection.generatedAt,
      )
      const published = readProjectStateDatabaseThreadSurfaceState<CurrentThreadProjection>(projectRoot)
      if (
        published?.projectRevision !== sourceProjectRevision ||
        published.queueRevision !== sourceQueueRevision ||
        published.thread?.sourceRevision !== String(sourceProjectRevision) ||
        published.thread?.sourceQueueRevision !== sourceQueueRevision
      ) {
        continue
      }
    }
    return projection
  }
  return null
}
