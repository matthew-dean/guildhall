import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { guildhallHomeDir } from '@guildhall/config'
import { projectSkillProposalsPath } from '@guildhall/skills'
import { emitProjectSummaryInvalidation, getProjectSystemStatePathFromMemoryDir, inferProjectRootFromMemoryDir } from '@guildhall/sessions'

export const MemoryStatus = z.enum(['observed', 'proposed', 'active', 'used', 'retired'])
export type MemoryStatus = z.infer<typeof MemoryStatus>

export const MemoryType = z.enum([
  'project_fact',
  'project_habit',
  'user_preference',
  'project_skill',
  'codebase_knowledge',
  'product_idea',
])
export type MemoryType = z.infer<typeof MemoryType>

export const MemoryScope = z.enum(['project', 'user_global', 'guildhall_product'])
export type MemoryScope = z.infer<typeof MemoryScope>

export const Confidence = z.enum(['low', 'medium', 'high'])
export type Confidence = z.infer<typeof Confidence>

export const Risk = z.enum(['low', 'medium', 'high'])
export type Risk = z.infer<typeof Risk>

export const Freshness = z.enum(['fresh', 'recent', 'stale'])
export type Freshness = z.infer<typeof Freshness>

export const MemoryEvidenceRef = z.object({
  kind: z.string(),
  summary: z.string(),
  ref: z.string().optional(),
  path: z.string().optional(),
})
export type MemoryEvidenceRef = z.infer<typeof MemoryEvidenceRef>

export const MemoryRecord = z.object({
  id: z.string().min(1),
  scope: MemoryScope,
  type: MemoryType,
  status: MemoryStatus,
  summary: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  structuralScopes: z.array(z.string()).default([]),
  taskKinds: z.array(z.string()).default([]),
  fileAreas: z.array(z.string()).default([]),
  confidence: Confidence.default('medium'),
  risk: Risk.default('low'),
  freshness: Freshness.default('fresh'),
  evidenceRefs: z.array(MemoryEvidenceRef).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.string(),
})
export type MemoryRecord = z.output<typeof MemoryRecord>
export type MemoryRecordInput = z.input<typeof MemoryRecord>

const MemoryStore = z.object({
  version: z.literal(1).default(1),
  records: z.array(MemoryRecord).default([]),
})
type MemoryStore = z.infer<typeof MemoryStore>

export interface MemoryQuery {
  statuses?: readonly MemoryStatus[]
  scopes?: readonly MemoryScope[]
  types?: readonly MemoryType[]
  tags?: readonly string[]
  domains?: readonly string[]
  taskKinds?: readonly string[]
  fileAreas?: readonly string[]
  minConfidence?: Confidence
  maxRisk?: Risk
  freshness?: readonly Freshness[]
  text?: string
}

export function memoryStorePath(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'memory-store.json')
}

export async function recordMemoryObservation(input: {
  memoryDir: string
  record: MemoryRecordInput
}): Promise<MemoryRecord> {
  const store = readStore(input.memoryDir)
  const record = MemoryRecord.parse(input.record)
  const records = [
    ...store.records.filter((item) => item.id !== record.id),
    record,
  ].sort(memorySort)
  await writeStore(input.memoryDir, { version: 1, records })
  emitProjectSummaryInvalidation(inferProjectRootFromMemoryDir(input.memoryDir), 'memory-store-write', { domains: ['memory'] })
  return record
}

export async function updateMemoryStatus(input: {
  memoryDir: string
  id: string
  status: MemoryStatus
  updatedAt?: string
}): Promise<MemoryRecord> {
  const store = readStore(input.memoryDir)
  const index = store.records.findIndex((record) => record.id === input.id)
  if (index === -1) throw new Error(`Memory record not found: ${input.id}`)
  const next = MemoryRecord.parse({
    ...store.records[index],
    status: input.status,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  })
  store.records[index] = next
  await writeStore(input.memoryDir, { version: 1, records: store.records.sort(memorySort) })
  emitProjectSummaryInvalidation(inferProjectRootFromMemoryDir(input.memoryDir), 'memory-store-write', { domains: ['memory'] })
  return next
}

export async function listMemoryRecords(input: {
  memoryDir: string
  query?: MemoryQuery
}): Promise<MemoryRecord[]> {
  const records = [
    ...readStore(input.memoryDir).records,
    ...readMemoryMarkdown(input.memoryDir),
    ...readLearningAdapters(input.memoryDir, 'project'),
    ...readLearningAdapters(guildhallHomeDir(), 'user_global'),
    ...readProjectSkillAdapters(input.memoryDir),
  ]
  const deduped = new Map<string, MemoryRecord>()
  for (const record of records) deduped.set(`${record.scope}:${record.id}`, record)
  return [...deduped.values()]
    .filter((record) => matchesQuery(record, input.query ?? {}))
    .sort(memorySort)
}

function readStore(memoryDir: string): MemoryStore {
  const file = memoryStorePath(memoryDir)
  if (!existsSync(file)) return { version: 1, records: [] }
  try {
    return MemoryStore.parse(JSON.parse(readManagedTextFileSync(file, 'utf8')))
  } catch {
    return { version: 1, records: [] }
  }
}

async function writeStore(memoryDir: string, store: MemoryStore): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await writeManagedTextFile(memoryStorePath(memoryDir), `${JSON.stringify(MemoryStore.parse(store), null, 2)}\n`, 'utf8')
}

function readMemoryMarkdown(memoryDir: string): MemoryRecord[] {
  const file = getProjectSystemStatePathFromMemoryDir(memoryDir, 'MEMORY.md')
  if (!existsSync(file)) return []
  const raw = readManagedTextFileSync(file, 'utf8')
  const sections = raw.split(/^##\s+/m).slice(1)
  const now = '1970-01-01T00:00:00.000Z'
  return sections
    .map((section) => {
      const [heading = '', ...body] = section.split('\n')
      const content = body.join('\n').trim()
      if (!heading.trim() || !content) return null
      const title = heading.trim()
      return MemoryRecord.parse({
        id: `memory-md-${slug(title)}`,
        scope: 'project',
        type: inferType(`${title}\n${content}`),
        status: 'active',
        summary: firstSentence(content),
        content,
        tags: keywords(title),
        domains: keywords(title),
        taskKinds: [],
        fileAreas: fileAreaHints(content),
        confidence: 'medium',
        risk: 'low',
        freshness: 'recent',
        evidenceRefs: [{ kind: 'artifact', ref: 'MEMORY.md', summary: `MEMORY.md section: ${title}` }],
        createdAt: now,
        updatedAt: now,
        source: 'MEMORY.md',
      })
    })
    .filter((record): record is MemoryRecord => record !== null)
}

function readLearningAdapters(dir: string, scope: 'project' | 'user_global'): MemoryRecord[] {
  const file = scope === 'project'
    ? getProjectSystemStatePathFromMemoryDir(dir, 'learning.json')
    : path.join(dir, 'learning.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readManagedTextFileSync(file, 'utf8')) as {
      suggestedLearnings?: Array<Record<string, unknown>>
    }
    return (parsed.suggestedLearnings ?? []).flatMap((item) => {
      const id = typeof item.id === 'string' ? item.id : ''
      const summary = typeof item.summary === 'string' ? item.summary : ''
      if (!id || !summary) return []
      const destination = typeof item.destination === 'string' ? item.destination : ''
      return [MemoryRecord.parse({
        id: `learning-${id}`,
        scope,
        type: typeFromDestination(destination),
        status: statusFromLearning(item.status),
        summary,
        content: summary,
        tags: keywords(`${item.source ?? ''} ${destination}`),
        domains: preferenceDomains(item.preference),
        taskKinds: [],
        fileAreas: [],
        confidence: confidenceFromUnknown(item.confidence),
        risk: riskFromUnknown(item.risk),
        freshness: 'fresh',
        evidenceRefs: Array.isArray(item.evidence)
          ? item.evidence.map((evidence) => ({
              kind: typeof evidence?.kind === 'string' ? evidence.kind : 'learning',
              summary: typeof evidence?.summary === 'string' ? evidence.summary : summary,
              ...(typeof evidence?.ref === 'string' ? { ref: evidence.ref } : {}),
            }))
          : [],
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '1970-01-01T00:00:00.000Z',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '1970-01-01T00:00:00.000Z',
        source: `${scope}:learning.json`,
      })]
    })
  } catch {
    return []
  }
}

function readProjectSkillAdapters(memoryDir: string): MemoryRecord[] {
  const file = projectSkillProposalsPath(memoryDir)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readManagedTextFileSync(file, 'utf8')) as {
      proposals?: Array<Record<string, unknown>>
    }
    return (parsed.proposals ?? []).flatMap((proposal) => {
      const id = typeof proposal.id === 'string' ? proposal.id : ''
      const name = typeof proposal.name === 'string' ? proposal.name : ''
      const description = typeof proposal.description === 'string' ? proposal.description : ''
      const content = typeof proposal.content === 'string' ? proposal.content : ''
      if (!id || !name || !description || !content) return []
      return [MemoryRecord.parse({
        id: `skill-${id}`,
        scope: 'project',
        type: 'project_skill',
        status: statusFromLearning(proposal.status),
        summary: description,
        content,
        tags: Array.isArray(proposal.triggerKeywords)
          ? proposal.triggerKeywords.filter((value): value is string => typeof value === 'string')
          : [],
        domains: [],
        taskKinds: [],
        fileAreas: fileAreaHints(content),
        confidence: proposal.status === 'active' ? 'high' : 'medium',
        risk: riskFromUnknown(proposal.risk),
        freshness: 'fresh',
        evidenceRefs: [{ kind: 'artifact', ref: `project-skills.json#${id}`, summary: name }],
        createdAt: typeof proposal.createdAt === 'string' ? proposal.createdAt : '1970-01-01T00:00:00.000Z',
        updatedAt: typeof proposal.updatedAt === 'string' ? proposal.updatedAt : '1970-01-01T00:00:00.000Z',
        source: 'project-skills.json',
      })]
    })
  } catch {
    return []
  }
}

function matchesQuery(record: MemoryRecord, query: MemoryQuery): boolean {
  if (query.statuses && !query.statuses.includes(record.status)) return false
  if (query.scopes && !query.scopes.includes(record.scope)) return false
  if (query.types && !query.types.includes(record.type)) return false
  if (query.freshness && !query.freshness.includes(record.freshness)) return false
  if (query.minConfidence && confidenceRank(record.confidence) < confidenceRank(query.minConfidence)) return false
  if (query.maxRisk && riskRank(record.risk) > riskRank(query.maxRisk)) return false
  if (query.tags?.length && !containsAny(record.tags, query.tags)) return false
  if (query.domains?.length && record.domains.length > 0 && !containsAny(record.domains, query.domains)) return false
  if (query.taskKinds?.length && record.taskKinds.length > 0 && !containsAny(record.taskKinds, query.taskKinds)) return false
  if (query.fileAreas?.length && record.fileAreas.length > 0 && !query.fileAreas.some((file) => record.fileAreas.some((area) => file.includes(area) || area.includes(file)))) return false
  if (query.text) {
    const needle = query.text.toLowerCase()
    const haystack = `${record.summary}\n${record.content}\n${record.tags.join(' ')}\n${record.domains.join(' ')}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

function memorySort(a: MemoryRecord, b: MemoryRecord): number {
  return (
    statusRank(b.status) - statusRank(a.status) ||
    confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
    riskRank(a.risk) - riskRank(b.risk) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  )
}

function statusRank(status: MemoryStatus): number {
  return ({ active: 5, used: 4, observed: 3, proposed: 2, retired: 1 })[status]
}

function confidenceRank(value: Confidence): number {
  return ({ low: 1, medium: 2, high: 3 })[value]
}

function riskRank(value: Risk): number {
  return ({ low: 1, medium: 2, high: 3 })[value]
}

function containsAny(values: readonly string[], needles: readonly string[]): boolean {
  const haystack = values.map((value) => value.toLowerCase())
  return needles.some((needle) => haystack.includes(needle.toLowerCase()))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'memory'
}

function firstSentence(value: string): string {
  return value.trim().split(/\n\s*\n|(?<=\.)\s+/)[0]?.trim() || value.trim()
}

function keywords(value: string): string[] {
  return [...new Set((value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).slice(0, 8))]
}

function fileAreaHints(value: string): string[] {
  return [...new Set(value.match(/\b(?:src|docs|internal|packages|scripts)\/[A-Za-z0-9_./-]+/g) ?? [])]
    .map((hint) => hint.replace(/\/[^/]+\.[A-Za-z0-9]+$/, ''))
}

function inferType(text: string): MemoryType {
  if (/\b(prefer|avoid|do not|don't|style|habit)\b/i.test(text)) return 'project_habit'
  if (/\b(component|module|function|route|file|src\/)\b/i.test(text)) return 'codebase_knowledge'
  return 'project_fact'
}

function typeFromDestination(destination: string): MemoryType {
  switch (destination) {
    case 'user_preference': return 'user_preference'
    case 'project_skill': return 'project_skill'
    case 'product_suggestion': return 'product_idea'
    default: return 'project_fact'
  }
}

function statusFromLearning(value: unknown): MemoryStatus {
  if (value === 'active') return 'active'
  if (value === 'dismissed') return 'retired'
  if (value === 'used') return 'used'
  return 'proposed'
}

function confidenceFromUnknown(value: unknown): Confidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function riskFromUnknown(value: unknown): Risk {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

function preferenceDomains(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const subject = (value as { subject?: unknown }).subject
  if (!subject || typeof subject !== 'object') return []
  const domain = (subject as { domain?: unknown }).domain
  return typeof domain === 'string' ? [domain] : []
}
