import path from 'node:path'

import {
  appendJsonLine,
  directoryStats,
  readJsonLines,
  scopeStorageDir,
  writeJsonLines,
} from './storage.js'
import type {
  GuildhallMemory,
  MemoryAuditInput,
  MemoryAuditResult,
  MemoryCandidate,
  MemoryCandidatePacket,
  MemoryCandidatePacketInput,
  MemoryCompactionInput,
  MemoryCompactionResult,
  MemoryEventInput,
  MemoryObservationInput,
  MemorySourceRef,
  StoredMemoryEvent,
  StoredMemoryObservation,
} from './types.js'

export interface DeterministicGuildhallMemoryOptions {
  projectRoot?: string
  storageRoot?: string
}

export function createDeterministicGuildhallMemory(
  options: DeterministicGuildhallMemoryOptions = {},
): GuildhallMemory {
  return new DeterministicGuildhallMemory(options)
}

class DeterministicGuildhallMemory implements GuildhallMemory {
  readonly #storageRoot: string | undefined

  constructor(options: DeterministicGuildhallMemoryOptions) {
    this.#storageRoot = options.storageRoot
  }

  async recordEvent(input: MemoryEventInput): Promise<StoredMemoryEvent> {
    const event: StoredMemoryEvent = {
      id: memoryId('event', input.recordedAt),
      scope: input.scope,
      type: input.type,
      summary: clean(input.summary, 280),
      body: input.body.trim(),
      sourceRefs: [...input.sourceRefs ?? []],
      relevanceHints: [...input.relevanceHints ?? []],
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    }
    await appendJsonLine(path.join(storageDir(input.scope, this.#storageRoot), 'events.jsonl'), event)
    return event
  }

  async recordObservation(input: MemoryObservationInput): Promise<StoredMemoryObservation> {
    const observation: StoredMemoryObservation = {
      id: memoryId('observation', input.recordedAt),
      scope: input.scope,
      summary: clean(input.summary, 280),
      body: input.body.trim(),
      confidence: input.confidence ?? 'medium',
      risk: input.risk ?? 'low',
      freshness: input.freshness ?? 'fresh',
      sourceRefs: [...input.sourceRefs ?? []],
      tags: [...input.tags ?? []],
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      compactedFromEventIds: [],
    }
    await appendJsonLine(path.join(storageDir(input.scope, this.#storageRoot), 'observations.jsonl'), observation)
    return observation
  }

  async compact(input: MemoryCompactionInput): Promise<MemoryCompactionResult> {
    const dir = storageDir(input.scope, this.#storageRoot)
    const eventsFile = path.join(dir, 'events.jsonl')
    const observationsFile = path.join(dir, 'observations.jsonl')
    const events = await readJsonLines<StoredMemoryEvent>(eventsFile)
    const observations = await readJsonLines<StoredMemoryObservation>(observationsFile)
    const bytesBefore = estimateBytes(events) + estimateBytes(observations)
    if (events.length === 0) {
      return {
        scope: input.scope,
        reason: input.reason,
        rawEventsConsidered: 0,
        observationsCreated: 0,
        bytesBefore,
        bytesAfter: bytesBefore,
      }
    }

    const compacted = compactEvents(input, events)
    await writeJsonLines(observationsFile, [...observations, ...compacted])
    await writeJsonLines(eventsFile, [])
    const nextObservations = [...observations, ...compacted]
    const bytesAfter = estimateBytes(nextObservations)

    return {
      scope: input.scope,
      reason: input.reason,
      rawEventsConsidered: events.length,
      observationsCreated: compacted.length,
      bytesBefore,
      bytesAfter,
    }
  }

  async buildCandidatePacket(input: MemoryCandidatePacketInput): Promise<MemoryCandidatePacket> {
    const dir = storageDir(input.scope, this.#storageRoot)
    const events = await readJsonLines<StoredMemoryEvent>(path.join(dir, 'events.jsonl'))
    const observations = await readJsonLines<StoredMemoryObservation>(path.join(dir, 'observations.jsonl'))
    const candidates = [
      ...observations.map((observation): MemoryCandidate => ({
        id: observation.id,
        kind: 'observation',
        summary: observation.summary,
        body: clean(observation.body, 900),
        relevance: scoreCandidate(input.intent, observation.summary, observation.body, observation.tags),
        confidence: observation.confidence,
        risk: observation.risk,
        freshness: observation.freshness,
        sourceRefs: observation.sourceRefs.slice(0, 6),
        reasonForInclusion: `intent:${matchedTerms(input.intent, observation.summary, observation.body, observation.tags).join(',') || 'general-memory'}`,
      })),
      ...events.map((event): MemoryCandidate => ({
        id: event.id,
        kind: 'event',
        summary: event.summary,
        body: clean(event.body, 900),
        relevance: scoreCandidate(input.intent, event.summary, event.body, event.relevanceHints),
        confidence: 'medium',
        risk: 'low',
        freshness: 'fresh',
        sourceRefs: event.sourceRefs.slice(0, 6),
        reasonForInclusion: `intent:${matchedTerms(input.intent, event.summary, event.body, event.relevanceHints).join(',') || 'recent-event'}`,
      })),
    ].sort((a, b) => b.relevance - a.relevance || freshnessRank(b.freshness) - freshnessRank(a.freshness))

    const included: MemoryCandidate[] = []
    const omitted: MemoryCandidatePacket['omitted'] = []
    const maxBytes = input.maxBytes ?? 4_000
    let byteEstimate = 0
    for (const candidate of candidates) {
      const omission = omissionReason(candidate)
      if (omission) {
        omitted.push({ id: candidate.id, summary: candidate.summary, reason: omission })
        continue
      }
      const candidateBytes = estimateBytes(candidate)
      if (byteEstimate + candidateBytes > maxBytes) {
        omitted.push({ id: candidate.id, summary: candidate.summary, reason: 'budget:max-bytes' })
        continue
      }
      included.push(candidate)
      byteEstimate += candidateBytes
    }

    return {
      scope: input.scope,
      intent: input.intent,
      byteEstimate,
      included,
      omitted,
      generatedAt: new Date().toISOString(),
    }
  }

  async audit(input: MemoryAuditInput): Promise<MemoryAuditResult> {
    const dir = storageDir(input.scope, this.#storageRoot)
    const stats = await directoryStats(dir)
    return {
      scope: input.scope,
      storageDir: dir,
      totalBytes: stats.totalBytes,
      fileCount: stats.fileCount,
      writesProjectLocalState: dir.includes(`${path.sep}.guildhall${path.sep}`),
    }
  }
}

function storageDir(scope: MemoryEventInput['scope'], root: string | undefined): string {
  return scopeStorageDir(scope, root)
}

function compactEvents(input: MemoryCompactionInput, events: readonly StoredMemoryEvent[]): StoredMemoryObservation[] {
  const byType = new Map<string, StoredMemoryEvent[]>()
  for (const event of events) byType.set(event.type, [...byType.get(event.type) ?? [], event])
  return [...byType.entries()].map(([type, group]) => {
    const sourceRefs = uniqueSourceRefs(group.flatMap((event) => event.sourceRefs))
    const tags = [...new Set(group.flatMap((event) => event.relevanceHints))]
    const body = clean([
      `Compacted ${group.length} ${type} raw memory events because ${input.reason}.`,
      ...group.slice(0, 4).map((event) => `- ${event.summary}`),
    ].join('\n'), input.maxObservationBytes ?? 2_000)
    return {
      id: memoryId('observation'),
      scope: input.scope,
      summary: clean(representativeSummary(type, group), 280),
      body,
      confidence: 'medium',
      risk: 'low',
      freshness: 'fresh',
      sourceRefs,
      tags,
      recordedAt: new Date().toISOString(),
      compactedFromEventIds: group.map((event) => event.id),
    }
  })
}

function representativeSummary(type: string, events: readonly StoredMemoryEvent[]): string {
  if (events.length === 1) return events[0]?.summary ?? `Compacted ${type} event.`
  return `${type}: ${events.length} compacted project-state signals; largest/recent signal: ${events[0]?.summary ?? 'unknown'}.`
}

function omissionReason(candidate: MemoryCandidate): string | null {
  if (candidate.risk === 'high') return 'risk:high'
  if (candidate.freshness === 'stale') return 'freshness:stale'
  return null
}

function memoryId(prefix: string, seed = new Date().toISOString()): string {
  return `${prefix}-${seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 17)}-${Math.random().toString(36).slice(2, 8)}`
}

function scoreCandidate(intent: string, summary: string, body: string, tags: readonly string[]): number {
  const matches = matchedTerms(intent, summary, body, tags)
  return matches.length * 10 + tags.length + (summary.length > 0 ? 1 : 0)
}

function matchedTerms(intent: string, summary: string, body: string, tags: readonly string[]): string[] {
  const haystack = `${summary}\n${body}\n${tags.join(' ')}`.toLowerCase()
  return [...new Set(intent.toLowerCase().split(/[^a-z0-9.]+/).filter((word) => word.length > 3))]
    .filter((word) => haystack.includes(word))
}

function freshnessRank(value: string): number {
  if (value === 'fresh') return 3
  if (value === 'recent') return 2
  return 1
}

function clean(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, ' ')
  return text.length <= max ? text : `${text.slice(0, max - 16).trimEnd()} [truncated]`
}

function estimateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function uniqueSourceRefs(refs: readonly MemorySourceRef[]): MemorySourceRef[] {
  const keyed = new Map<string, MemorySourceRef>()
  for (const ref of refs) keyed.set(`${ref.kind}:${ref.path ?? ''}:${ref.ref ?? ''}`, ref)
  return [...keyed.values()]
}
