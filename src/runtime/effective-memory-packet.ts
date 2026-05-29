import type { Task } from '@guildhall/core'
import {
  listMemoryRecords,
  type MemoryEvidenceRef,
  type MemoryRecord,
  type MemoryStatus,
} from './memory-store.js'

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
  const all = await listMemoryRecords({ memoryDir: input.memoryDir })
  const relevant = all
    .filter((record) => isRelevant(record, {
      domain: input.task.domain,
      taskKinds,
      fileAreas,
      text: queryText,
    }))
  const included = relevant
    .filter((record) => record.status === 'active' || record.status === 'used')
    .filter((record) => record.risk !== 'high')
    .slice(0, input.maxRecords ?? 8)
  const includedIds = new Set(included.map((record) => record.id))
  const withheld = relevant
    .filter((record) => !includedIds.has(record.id))
    .map((record) => ({
      id: record.id,
      status: record.status,
      reason: withheldReason(record),
      summary: record.summary,
    }))
  const evidenceRefs = included.flatMap((record) => record.evidenceRefs)
  return {
    included,
    withheld,
    evidenceRefs,
    rendered: renderEffectiveMemory(included, withheld),
  }
}

export function renderEffectiveMemory(
  included: readonly MemoryRecord[],
  withheld: readonly WithheldMemory[],
): string {
  if (included.length === 0 && withheld.length === 0) return ''
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
  return clip(lines.join('\n').trim(), MAX_RENDERED_MEMORY_CHARS)
}

function withheldReason(record: MemoryRecord): string {
  if (record.status !== 'active' && record.status !== 'used') return `status:${record.status}`
  if (record.risk === 'high') return 'risk:high'
  return 'not-selected'
}

function isRelevant(record: MemoryRecord, input: {
  domain: string
  taskKinds: readonly string[]
  fileAreas: readonly string[]
  text: string
}): boolean {
  if (record.domains.length > 0 && !record.domains.includes(input.domain)) return false
  if (record.taskKinds.length > 0 && !record.taskKinds.some((kind) => input.taskKinds.includes(kind))) return false
  if (
    record.fileAreas.length > 0 &&
    input.fileAreas.length > 0 &&
    !input.fileAreas.some((file) => record.fileAreas.some((area) => file.includes(area) || area.includes(file)))
  ) return false
  if (record.tags.length === 0) return true
  const haystack = input.text.toLowerCase()
  return record.tags.some((tag) => haystack.includes(tag.toLowerCase())) ||
    record.summary.toLowerCase().split(/\s+/).some((word) => word.length > 4 && haystack.includes(word))
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
