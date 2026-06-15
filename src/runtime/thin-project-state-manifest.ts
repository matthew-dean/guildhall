import { readManagedTextFile, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

import { readWorkspaceConfig } from '@guildhall/config'
import { getProjectLocalHistoryDir, getProjectStateDir } from '@guildhall/sessions'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimText(value: unknown, max = 1200): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}...` : trimmed
}

function readTasksFromQueue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.tasks)) return value.tasks
  return []
}

function compactTask(task: unknown): Record<string, unknown> | null {
  if (!isRecord(task) || typeof task.id !== 'string' || typeof task.title !== 'string') return null
  const status = typeof task.status === 'string' ? task.status : 'unknown'
  if (['done', 'shelved', 'cancelled', 'archived'].includes(status)) return null
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria
        .filter(isRecord)
        .slice(0, 12)
        .map(item => ({
          id: typeof item.id === 'string' ? item.id : undefined,
          description: trimText(item.description, 240),
          verifiedBy: typeof item.verifiedBy === 'string' ? item.verifiedBy : undefined,
          met: typeof item.met === 'boolean' ? item.met : undefined,
        }))
    : []
  const productBrief = isRecord(task.productBrief)
    ? {
        userJob: trimText(task.productBrief.userJob, 280),
        successMetric: trimText(task.productBrief.successMetric, 280),
        whyItMattersNow: trimText(task.productBrief.whyItMattersNow, 280),
      }
    : null
  const openEscalations = Array.isArray(task.openEscalations)
    ? task.openEscalations.filter(isRecord).slice(0, 8)
    : Array.isArray(task.escalations)
      ? task.escalations
          .filter(item => isRecord(item) && typeof item.resolvedAt !== 'string')
          .slice(0, 8)
          .map(item => ({
            id: typeof item.id === 'string' ? item.id : undefined,
            status: typeof item.status === 'string' ? item.status : undefined,
            summary: trimText(item.summary, 240),
            question: trimText(item.question, 240),
          }))
      : []

  return {
    id: task.id,
    title: task.title,
    status,
    domain: typeof task.domain === 'string' ? task.domain : undefined,
    priority: typeof task.priority === 'string' ? task.priority : undefined,
    projectPath: typeof task.projectPath === 'string' ? task.projectPath : undefined,
    description: trimText(task.description, 500),
    spec: trimText(task.spec, 1200),
    productBrief,
    acceptanceCriteria,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.filter(item => typeof item === 'string').slice(0, 20) : [],
    outOfScope: Array.isArray(task.outOfScope) ? task.outOfScope.filter(item => typeof item === 'string').slice(0, 12) : [],
    openEscalations,
  }
}

async function readThinTasks(stateDir: string): Promise<Array<Record<string, unknown>>> {
  try {
    const parsed = JSON.parse(await readManagedTextFile(path.join(stateDir, 'TASKS.json'), 'utf8')) as unknown
    return readTasksFromQueue(parsed)
      .map(compactTask)
      .filter((task): task is Record<string, unknown> => task !== null)
  } catch {
    return []
  }
}

export async function finalizeThinProjectStateManifest(projectRoot: string): Promise<string[]> {
  const stateDir = getProjectStateDir(projectRoot)
  await fs.mkdir(stateDir, { recursive: true })
  let projectId = path.basename(projectRoot)
  let projectName = projectId
  try {
    const config = readWorkspaceConfig(projectRoot)
    projectId = config.id ?? projectId
    projectName = config.name || projectName
  } catch {
    // Missing config falls back to path-derived thin manifest identity.
  }

  const artifactsPath = path.join(stateDir, 'artifacts.yaml')
  let artifactIds: string[] = []
  try {
    const parsed = parseYaml(await readManagedTextFile(artifactsPath, 'utf8')) as { artifacts?: Array<{ id?: unknown }> } | null
    artifactIds = (parsed?.artifacts ?? [])
      .map(artifact => artifact.id)
      .filter((id): id is string => typeof id === 'string')
  } catch {
    artifactIds = []
  }
  const activeTasks = await readThinTasks(stateDir)

  const removedLegacyPaths: string[] = []
  const entries = await fs.readdir(stateDir).catch(() => [] as string[])
  for (const entry of entries) {
    if (entry === 'artifacts.yaml' || entry === 'project-state-manifest.json') continue
    const source = path.join(stateDir, entry)
    const destination = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', entry)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.cp(source, destination, { recursive: true, force: true })
    await fs.rm(source, { recursive: true, force: true })
    removedLegacyPaths.push(entry)
  }

  const file = path.join(stateDir, 'project-state-manifest.json')
  const manifest = {
    version: 1,
    mode: 'thin',
    projectId,
    projectName,
    generatedAt: new Date().toISOString(),
    currentShape: {
      artifacts: artifactIds,
      activeTasks,
      openEscalationCount: activeTasks.reduce((count, task) => {
        const openEscalations = task.openEscalations
        return count + (Array.isArray(openEscalations) ? openEscalations.length : 0)
      }, 0),
    },
    exports: {
      artifactRegistry: artifactIds.length > 0
        ? {
            path: '.guildhall/artifacts.yaml',
            artifactIds,
          }
        : null,
      taskState: null,
      memory: null,
      progress: null,
      runtime: null,
      evidence: null,
    },
  }
  await writeManagedTextFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return [
    ...(artifactIds.length > 0 ? ['.guildhall/artifacts.yaml'] : []),
    '.guildhall/project-state-manifest.json',
    ...removedLegacyPaths.map(entry => `.guildhall/${entry}`),
  ]
}
