import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskQueue, type Task, type TaskEvidenceEvent } from '@guildhall/core'
import { getLegacyProjectStatePath, getProjectMigrationSnapshotDir } from '@guildhall/sessions'
import {
  legacyEvidenceFromTask,
  legacyRuntimeFromTask,
  legacyWorkspaceFromTask,
  stripLegacyRuntimeFields,
} from './effective-task.js'
import {
  appendTaskEvidence,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
} from './task-state-store.js'
import { writeMigrationSnapshot } from './migration-snapshot.js'
import { writeProjectTaskQueueWithSummary } from './project-state-boundary.js'
import {
  assertLegacyCurrentStateMigrationAccess,
  legacyCurrentStateMigrationAvailable,
} from './runtime-compatibility.js'

export interface TaskStateMigrationInput {
  projectRoot: string
  apply?: boolean
}

export interface TaskStateMigrationResult {
  applied: boolean
  tasksInspected: number
  runtimeRecords: number
  workspaceRecords: number
  evidenceRecords: number
  taskDefinitionsRewritten: number
  backupPath?: string
  manifestPath?: string
}

function tasksPath(projectRoot: string): string {
  return getLegacyProjectStatePath(projectRoot, 'TASKS.json')
}

function backupPath(projectRoot: string): string {
  return path.join(
    getProjectMigrationSnapshotDir(projectRoot),
    'task-state',
    'TASKS.before-task-state-split.json',
  )
}

function hasLegacyRuntimeOrEvidenceFields(task: Task): boolean {
  const record = task as Record<string, unknown>
  const fields = [
    'assignedTo',
    'notes',
    'gateResults',
    'reviewVerdicts',
    'adjudications',
    'escalations',
    'agentIssues',
    'revisionCount',
    'retryWindow',
    'remediationAttempts',
    'handoffStep',
    'worktreePath',
    'branchName',
    'baseBranch',
    'mergeRecord',
  ]
  return fields.some((field) => Object.prototype.hasOwnProperty.call(record, field))
}

async function appendEvidenceBatch(
  projectRoot: string,
  taskId: string,
  events: TaskEvidenceEvent[],
): Promise<number> {
  let count = 0
  for (const event of events) {
    await appendTaskEvidence(projectRoot, taskId, event)
    count += 1
  }
  return count
}

export async function migrateTaskState(
  input: TaskStateMigrationInput,
): Promise<TaskStateMigrationResult> {
  if (!legacyCurrentStateMigrationAvailable(input.projectRoot)) {
    if (input.apply) assertLegacyCurrentStateMigrationAccess(input.projectRoot, '0.8.0/task-state-split')
    return {
      applied: false,
      tasksInspected: 0,
      runtimeRecords: 0,
      workspaceRecords: 0,
      evidenceRecords: 0,
      taskDefinitionsRewritten: 0,
    }
  }
  const file = tasksPath(input.projectRoot)
  const raw = await fs.readFile(file, 'utf-8')
  const queue = TaskQueue.parse(JSON.parse(raw))
  const runtimeStore = input.apply ? await readTaskRuntimeStore(input.projectRoot) : null
  const workspaceStore = input.apply ? await readTaskWorkspaceStore(input.projectRoot) : null

  let runtimeRecords = 0
  let workspaceRecords = 0
  let evidenceRecords = 0
  let taskDefinitionsRewritten = 0
  const strippedTasks: Array<Record<string, unknown>> = []

  for (const task of queue.tasks) {
    const runtime = legacyRuntimeFromTask(task)
    const workspace = legacyWorkspaceFromTask(task)
    const evidence = legacyEvidenceFromTask(task)
    const needsRewrite = hasLegacyRuntimeOrEvidenceFields(task)

    if (runtime) runtimeRecords += 1
    if (workspace) workspaceRecords += 1
    evidenceRecords += evidence.length
    if (needsRewrite) taskDefinitionsRewritten += 1

    if (input.apply) {
      if (runtime && !runtimeStore?.tasks[task.id]) {
        await upsertTaskRuntimeState(input.projectRoot, task.id, runtime)
      }
      if (workspace && !workspaceStore?.workspaces[task.id]) {
        await upsertTaskWorkspaceState(input.projectRoot, task.id, workspace)
      }
      if (evidence.length > 0) {
        evidenceRecords -= evidence.length
        evidenceRecords += await appendEvidenceBatch(input.projectRoot, task.id, evidence)
      }
    }
    strippedTasks.push(needsRewrite ? stripLegacyRuntimeFields(task) : task)
  }

  if (!input.apply) {
    return {
      applied: false,
      tasksInspected: queue.tasks.length,
      runtimeRecords,
      workspaceRecords,
      evidenceRecords,
      taskDefinitionsRewritten,
    }
  }

  const backup = backupPath(input.projectRoot)
  const snapshot = await writeMigrationSnapshot({
    projectRoot: input.projectRoot,
    migrationId: '0.8.0/task-state-split',
    sourcePath: file,
    snapshotPath: backup,
    sourceBytes: raw,
  })

  const rewritten = {
    version: queue.version,
    lastUpdated: new Date().toISOString(),
    tasks: strippedTasks,
  }
  writeProjectTaskQueueWithSummary(file, rewritten, { projectRoot: input.projectRoot, fullCompatibility: true })

  return {
    applied: true,
    tasksInspected: queue.tasks.length,
    runtimeRecords,
    workspaceRecords,
    evidenceRecords,
    taskDefinitionsRewritten,
    backupPath: backup,
    manifestPath: snapshot.manifestPath,
  }
}
