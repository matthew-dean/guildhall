import { readProjectConfig } from '@guildhall/config'
import { buildMemoryCoreCandidatePacket, resolveMemoryPaths } from '@guildhall/memory-core'
import { getProjectStateDir } from '@guildhall/sessions'
import { basename } from 'node:path'

import { readContextDebugForTasks } from './context-observability.js'
import { listMemoryRecords } from './memory-store.js'

export interface ProjectMemoryHealth {
  total: number
  active: number
  proposed: number
  used: number
  retired: number
  project: number
  userGlobal: number
  guildhallProduct: number
  memoryCore: {
    adapter: 'mastra' | 'deterministic'
    fallbackUsed: boolean
    storagePath?: string
    repoLocalWrites: string[]
    semanticRecallEnabled: boolean
    observationalMemoryEnabled: boolean
    observationalProcessorReady: boolean
    compactionStatus: 'active' | 'needs_attention'
    semanticValidity: 'valid' | 'needs_attention'
    warnings: string[]
    features: string[]
  }
  recentUse: Array<{ taskId: string; included: number; withheld: number; at: string }>
}

/**
 * Build the memory-health payload for the asynchronous projector only.
 * Source files and context-debug are deliberately read here, never from an
 * ordinary project GET.
 */
export async function buildProjectMemoryHealthProjection(
  projectPath: string,
  tasks: Array<{ id: string }>,
): Promise<ProjectMemoryHealth> {
  const memoryDir = getProjectStateDir(projectPath)
  const records = await listMemoryRecords({ memoryDir })
  const count = (predicate: (record: typeof records[number]) => boolean) =>
    records.filter(predicate).length
  const recentUse: ProjectMemoryHealth['recentUse'] = []
  const taskIds = tasks.slice(0, 12).map(task => task.id)
  const contextDebugByTask = await readContextDebugForTasks(memoryDir, taskIds, 1)
  for (const task of tasks.slice(0, 12)) {
    const latest = (contextDebugByTask.get(task.id) ?? [])[0]
    if (!latest?.memoryPacket || !latest.at) continue
    recentUse.push({
      taskId: task.id,
      included: latest.memoryPacket.includedCount ?? latest.memoryPacket.included.length,
      withheld: latest.memoryPacket.withheldCount ?? latest.memoryPacket.withheld.length,
      at: latest.at,
    })
  }

  const projectId = basename(projectPath) || 'project'
  const memoryCoreScope = { kind: 'project' as const, projectId }
  const memoryConfig = readProjectConfig(projectPath).memory
  const memorySubstrate = process.env.GUILDHALL_MEMORY_SUBSTRATE === 'deterministic'
    ? 'deterministic'
    : process.env.GUILDHALL_MEMORY_SUBSTRATE === 'mastra'
      ? 'mastra'
      : memoryConfig?.substrate ?? 'deterministic'
  const semanticRecall = process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL === '1'
    ? true
    : process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL === '0'
      ? false
      : memoryConfig?.semanticRecall ?? false
  const observationalMemory = process.env.GUILDHALL_MEMORY_OBSERVATIONAL === '1'
    ? true
    : process.env.GUILDHALL_MEMORY_OBSERVATIONAL === '0'
      ? false
      : memoryConfig?.observationalMemory ?? false
  const memoryCorePacket = await buildMemoryCoreCandidatePacket({
    projectRoot: projectPath,
    scope: memoryCoreScope,
    purpose: 'handoff',
    maxBytes: 4096,
    substrate: memorySubstrate,
    semanticRecall,
    observationalMemory,
  })
  const memoryWarnings = [...memoryCorePacket.health.warnings]
  const memoryFeatures = new Set(memoryCorePacket.health.features ?? ['deterministic-events'])
  const memoryEngineGatePassed = process.env.GUILDHALL_MEMORY_ENGINE_GATE === 'passed' ||
    process.env.GUILDHALL_MEMORY_ENGINE_GATE === '1'
  if (semanticRecall && !memoryCorePacket.health.semanticRecallEnabled) {
    memoryFeatures.add(memoryEngineGatePassed ? 'semantic-recall-vector-unavailable' : 'semantic-recall-gated')
    if (!memoryEngineGatePassed) {
      memoryWarnings.push('Semantic recall requested but held behind the memory engine quality gate.')
    }
  }
  if (observationalMemory && !memoryCorePacket.health.observationalMemoryEnabled) {
    memoryFeatures.add('observational-memory-gated')
    if (!memoryEngineGatePassed) {
      memoryWarnings.push('Observational Memory requested but held behind the memory engine quality gate.')
    }
  }

  return {
    total: records.length,
    active: count(record => record.status === 'active'),
    proposed: count(record => record.status === 'observed' || record.status === 'proposed'),
    used: count(record => record.status === 'used'),
    retired: count(record => record.status === 'retired'),
    project: count(record => record.scope === 'project'),
    userGlobal: count(record => record.scope === 'user_global'),
    guildhallProduct: count(record => record.scope === 'guildhall_product'),
    memoryCore: {
      adapter: memoryCorePacket.health.adapter,
      fallbackUsed: memorySubstrate === 'deterministic' ? false : memoryCorePacket.health.fallbackUsed,
      storagePath: memoryCorePacket.health.storagePath ?? resolveMemoryPaths({ projectRoot: projectPath, scope: memoryCoreScope }).dbPath,
      repoLocalWrites: memoryCorePacket.health.repoLocalWrites ?? [],
      semanticRecallEnabled: memoryCorePacket.health.semanticRecallEnabled ?? false,
      observationalMemoryEnabled: memoryCorePacket.health.observationalMemoryEnabled ?? false,
      observationalProcessorReady: memoryCorePacket.health.observationalProcessorReady ?? false,
      compactionStatus: memoryCorePacket.health.compactionStatus ?? 'needs_attention',
      semanticValidity: memoryCorePacket.health.semanticValidity ?? 'needs_attention',
      warnings: memoryWarnings,
      features: [...memoryFeatures],
    },
    recentUse: recentUse
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, 5),
  }
}
