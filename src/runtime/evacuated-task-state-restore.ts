import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { getProjectLocalHistoryDir, getProjectSystemStatePath } from '@guildhall/sessions'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTasks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.tasks)) return value.tasks
  return []
}

function taskId(task: unknown): string | null {
  return isRecord(task) && typeof task.id === 'string' && task.id.length > 0 ? task.id : null
}

async function readJsonIfExists(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch (err) {
    if (String(err).includes('ENOENT')) return null
    throw err
  }
}

function queueVersion(value: unknown): number {
  return isRecord(value) && typeof value.version === 'number' ? value.version : 1
}

function queueLastUpdated(value: unknown): string | undefined {
  return isRecord(value) && typeof value.lastUpdated === 'string' ? value.lastUpdated : undefined
}

export interface RestoreEvacuatedTaskStateResult {
  needed: boolean
  restored: number
  restoredTaskStateFiles: number
  systemTaskCount: number
  evacuatedTaskCount: number
  affectedPaths: string[]
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch (err) {
    if (String(err).includes('ENOENT')) return false
    throw err
  }
}

async function collectMissingTaskStateFiles(projectRoot: string): Promise<Array<{ source: string; destination: string; affectedPath: string }>> {
  const evacuatedTasksDir = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks')
  const candidates = [
    { relativePath: 'tasks/index.json' },
  ]

  const archiveDir = path.join(evacuatedTasksDir, 'archive')
  try {
    const archiveEntries = await fs.readdir(archiveDir)
    for (const entry of archiveEntries) {
      if (entry.endsWith('.json')) {
        candidates.push({ relativePath: path.join('tasks', 'archive', entry) })
      }
    }
  } catch (err) {
    if (!String(err).includes('ENOENT')) throw err
  }

  const missing: Array<{ source: string; destination: string; affectedPath: string }> = []
  for (const candidate of candidates) {
    const source = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', candidate.relativePath)
    const destination = getProjectSystemStatePath(projectRoot, candidate.relativePath)
    if (await fileExists(source) && !await fileExists(destination)) {
      missing.push({ source, destination, affectedPath: `project-state/${candidate.relativePath}` })
    }
  }
  return missing
}

export async function restoreEvacuatedTaskState(projectRoot: string, apply: boolean): Promise<RestoreEvacuatedTaskStateResult> {
  const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
  const evacuatedQueue = await readJsonIfExists(evacuatedTasksPath)
  const systemQueue = await readJsonIfExists(systemTasksPath)
  const evacuatedTasks = readTasks(evacuatedQueue)
  const systemTasks = readTasks(systemQueue)
  const systemIds = new Set(systemTasks.map(taskId).filter((id): id is string => id !== null))
  const missing = evacuatedTasks.filter((task) => {
    const id = taskId(task)
    return id !== null && !systemIds.has(id)
  })
  const missingTaskStateFiles = await collectMissingTaskStateFiles(projectRoot)
  const needed = missing.length > 0 || missingTaskStateFiles.length > 0
  if (apply && needed) {
    if (missing.length > 0) {
      await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
      const next = {
        version: Math.max(queueVersion(evacuatedQueue), queueVersion(systemQueue)),
        lastUpdated: new Date().toISOString(),
        tasks: [...missing, ...systemTasks],
        restoredFromEvacuation: {
          restoredAt: new Date().toISOString(),
          source: evacuatedTasksPath,
          restoredTaskCount: missing.length,
          priorSystemTaskCount: systemTasks.length,
          evacuatedLastUpdated: queueLastUpdated(evacuatedQueue),
        },
      }
      await fs.writeFile(systemTasksPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    }
    for (const file of missingTaskStateFiles) {
      await fs.mkdir(path.dirname(file.destination), { recursive: true })
      await fs.copyFile(file.source, file.destination)
    }
  }
  const affectedPaths = new Set<string>()
  if (existsSync(evacuatedTasksPath)) {
    affectedPaths.add('project-state/TASKS.json')
    affectedPaths.add('project-state-evacuation/TASKS.json')
  }
  for (const file of missingTaskStateFiles) {
    affectedPaths.add(file.affectedPath)
  }
  return {
    needed,
    restored: apply && needed ? missing.length : 0,
    restoredTaskStateFiles: apply && needed ? missingTaskStateFiles.length : 0,
    systemTaskCount: systemTasks.length,
    evacuatedTaskCount: evacuatedTasks.length,
    affectedPaths: Array.from(affectedPaths),
  }
}
