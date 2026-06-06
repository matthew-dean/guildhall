import type { Task } from '@guildhall/core'
import { readProjectConfig } from '@guildhall/config'
import { inferProjectRootFromMemoryDir } from '@guildhall/sessions'
import path from 'node:path'
import {
  buildMemoryCoreCandidatePacket,
  type MemoryCandidatePacket,
} from '@guildhall/memory-core'
import {
  listMemoryRecords,
  type MemoryEvidenceRef,
  type MemoryRecord,
  type MemoryStatus,
} from './memory-store.js'
import { readAcceptedStructuralMap, routeTaskWithStructuralMap } from './structural-map.js'

export interface WithheldMemory {
  id: string
  status: MemoryStatus
  reason: string
  summary: string
}

export interface EffectiveMemoryPacket {
  included: MemoryRecord[]
  withheld: WithheldMemory[]
  evidenceRefs: MemoryEvidenceRef[]
  memoryCorePacket?: MemoryCandidatePacket
  rendered: string
}

const MAX_MEMORY_RECORD_CHARS = 700
const MAX_RENDERED_MEMORY_CHARS = 2600

export async function buildEffectiveMemoryPacket(input: {
  memoryDir: string
  task: Task
  maxRecords?: number
}): Promise<EffectiveMemoryPacket> {
  const queryText = [
    input.task.title,
    input.task.description,
    input.task.spec ?? '',
    input.task.domain,
    input.task.projectPath,
  ].join('\n')
  const taskKinds = inferTaskKinds(queryText)
  const fileAreas = fileAreaHints(queryText)
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const memoryConfig = readProjectConfig(projectRoot).memory
  const structuralScopeIds = structuralScopesForTask(input.memoryDir, input.task, fileAreas)
  const all = await listMemoryRecords({ memoryDir: input.memoryDir })
  const relevant = all
    .filter((record) => isRelevant(record, {
      domain: input.task.domain,
      taskKinds,
      fileAreas,
      structuralScopeIds,
      text: queryText,
    }))
  const included = relevant
    .filter((record) => record.status === 'active' || record.status === 'used')
    .filter((record) => record.risk !== 'high')
    .filter((record) => structuralScopeMatches(record, structuralScopeIds))
    .slice(0, input.maxRecords ?? 8)
  const includedIds = new Set(included.map((record) => record.id))
  const withheld = relevant
    .filter((record) => !includedIds.has(record.id))
    .map((record) => ({
      id: record.id,
      status: record.status,
      reason: withheldReason(record, structuralScopeIds),
      summary: record.summary,
    }))
  const evidenceRefs = included.flatMap((record) => record.evidenceRefs)
  const memoryCorePacket = await buildMemoryCoreCandidatePacket({
    projectRoot,
    scope: {
      kind: 'task_thread',
      projectId: projectIdFor(projectRoot),
      taskId: input.task.id,
      agentRole: 'worker',
      threadId: input.task.id,
    },
    purpose: 'next_worker_context',
    maxBytes: 4096,
    substrate: memoryConfig?.substrate,
    semanticRecall: memoryConfig?.semanticRecall,
  }).catch(() => undefined)
  const memoryCoreEvidenceRefs = (memoryCorePacket?.candidates ?? [])
    .flatMap(candidate => candidate.sourceRefs)
    .map(ref => ({
      kind: ref.sourceKind,
      summary: ref.uri,
      ref: ref.uri,
      ...(ref.path ? { path: ref.path } : {}),
    }))
  return {
    included,
    withheld,
    evidenceRefs: [...evidenceRefs, ...memoryCoreEvidenceRefs],
    ...(memoryCorePacket ? { memoryCorePacket } : {}),
    rendered: renderEffectiveMemory(included, withheld, memoryCorePacket),
  }
}

export function renderEffectiveMemory(
  included: readonly MemoryRecord[],
  withheld: readonly WithheldMemory[],
  memoryCorePacket?: MemoryCandidatePacket,
): string {
  if (included.length === 0 && withheld.length === 0 && (memoryCorePacket?.candidates.length ?? 0) === 0) return ''
  const lines = ['## Effective Memory', '']
  if (included.length > 0) {
    for (const record of included) {
      lines.push(`### ${record.summary}`)
      lines.push(`- id: ${record.id}`)
      lines.push(`- scope/type: ${record.scope}/${record.type}`)
      lines.push(`- confidence/risk: ${record.confidence}/${record.risk}`)
      lines.push(clip(record.content, MAX_MEMORY_RECORD_CHARS))
      lines.push('')
    }
  } else {
    lines.push('No active matching memory was included.')
    lines.push('')
  }
  if (withheld.length > 0) {
    lines.push('### Withheld Memory')
    for (const record of withheld) {
      lines.push(`- ${record.id}: ${record.reason}`)
    }
  }
  if (memoryCorePacket && memoryCorePacket.candidates.length > 0) {
    lines.push('', '## Memory-Core Candidate Packet')
    lines.push(`- adapter: ${memoryCorePacket.health.adapter}${memoryCorePacket.health.fallbackUsed ? ' (fallback)' : ''}`)
    for (const candidate of memoryCorePacket.candidates.slice(0, 6)) {
      lines.push(`- ${candidate.summary}`)
      for (const source of candidate.sourceRefs.slice(0, 2)) {
        lines.push(`  - source: ${source.uri}${source.path ? ` (${source.path})` : ''}`)
      }
    }
  }
  return clip(lines.join('\n').trim(), MAX_RENDERED_MEMORY_CHARS)
}

function withheldReason(record: MemoryRecord, structuralScopeIds: readonly string[]): string {
  if (!structuralScopeMatches(record, structuralScopeIds)) return 'structural-scope:mismatch'
  if (record.status !== 'active' && record.status !== 'used') return `status:${record.status}`
  if (record.risk === 'high') return 'risk:high'
  return 'not-selected'
}

function isRelevant(record: MemoryRecord, input: {
  domain: string
  taskKinds: readonly string[]
  fileAreas: readonly string[]
  structuralScopeIds: readonly string[]
  text: string
}): boolean {
  if (record.domains.length > 0 && !record.domains.includes(input.domain)) return false
  if (record.taskKinds.length > 0 && !record.taskKinds.some((kind) => input.taskKinds.includes(kind))) return false
  if (
    record.fileAreas.length > 0 &&
    input.fileAreas.length > 0 &&
    !input.fileAreas.some((file) => record.fileAreas.some((area) => file.includes(area) || area.includes(file)))
  ) return false
  if (
    record.structuralScopes.length > 0 &&
    input.structuralScopeIds.length > 0 &&
    !structuralScopeMatches(record, input.structuralScopeIds)
  ) return true
  if (record.tags.length === 0) return true
  const haystack = input.text.toLowerCase()
  return record.tags.some((tag) => haystack.includes(tag.toLowerCase())) ||
    record.summary.toLowerCase().split(/\s+/).some((word) => word.length > 4 && haystack.includes(word))
}

function structuralScopeMatches(record: MemoryRecord, structuralScopeIds: readonly string[]): boolean {
  if (record.structuralScopes.length === 0 || structuralScopeIds.length === 0) return true
  return record.structuralScopes.some(scope => structuralScopeIds.includes(scope))
}

function structuralScopesForTask(memoryDir: string, task: Task, fileAreas: readonly string[]): string[] {
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const map = readAcceptedStructuralMap(projectRoot)
  if (!map) return []
  try {
    const route = routeTaskWithStructuralMap({
      map,
      task: {
        id: task.id,
        title: task.title,
        files: [...fileAreas],
        text: `${task.description}\n${task.spec ?? ''}`,
      },
    })
    return [...new Set([
      route.primaryDomainId,
      ...route.packageIds,
      ...route.executableUnitIds,
      ...route.crossCuttingDomainIds,
    ].filter((value): value is string => Boolean(value)))]
  } catch {
    return []
  }
}

function inferTaskKinds(text: string): string[] {
  const kinds: string[] = []
  if (/\b(ui|drawer|component|button|screen|view|svelte|react|vue)\b/i.test(text)) kinds.push('ui')
  if (/\b(api|route|server|backend|runtime)\b/i.test(text)) kinds.push('api')
  if (/\b(migration|migrate|legacy|persistence)\b/i.test(text)) kinds.push('migration')
  if (/\b(docs|documentation|guide)\b/i.test(text)) kinds.push('docs')
  return [...new Set(kinds)]
}

function fileAreaHints(value: string): string[] {
  return [...new Set(value.match(/\b(?:src|docs|internal|packages|scripts)\/[A-Za-z0-9_./-]+/g) ?? [])]
    .map((hint) => hint.replace(/\/[^/]+\.[A-Za-z0-9]+$/, ''))
}

function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 32).trimEnd()}\n[truncated ${text.length - max + 32} chars]`
}

function projectIdFor(projectRoot: string): string {
  return path.basename(projectRoot) || 'project'
}
