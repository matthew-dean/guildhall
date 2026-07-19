import { readMemoryEvents } from '../data-access.js'
import { evaluateMemoryCandidatePacketGuarantees } from '../guarantees.js'
import type {
  GuildhallMemoryScope,
  MemoryCandidate,
  MemoryCandidatePacket,
  MemoryEvent,
} from '../types.js'

export async function buildDeterministicCandidatePacket(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
  purpose: MemoryCandidatePacket['purpose']
  maxBytes: number
  now?: () => Date
}): Promise<MemoryCandidatePacket> {
  const events = await readMemoryEvents({ projectRoot: input.projectRoot, scope: input.scope })
  const candidates: MemoryCandidate[] = []
  const omitted: MemoryCandidatePacket['omitted'] = []

  for (const event of events.slice().reverse()) {
    const candidate = candidateFromEvent(event)
    const projected = byteEstimate({ candidates: [...candidates, candidate], omitted })
    if (projected > input.maxBytes) {
      omitted.push({
        reason: 'too_large',
        summary: event.content.summary,
        sourceRefs: event.sourceRefs,
      })
    } else {
      candidates.push(candidate)
    }
  }

  const packet: MemoryCandidatePacket = {
    scope: input.scope,
    purpose: input.purpose,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    byteEstimate: byteEstimate({ candidates, omitted }),
    candidates,
    omitted,
    health: {
      adapter: 'deterministic',
      // Deterministic is the selected source index, not a degraded fallback.
      fallbackUsed: false,
      warnings: [],
    },
  }
  const guarantees = evaluateMemoryCandidatePacketGuarantees(packet, { maxBytes: input.maxBytes })
  return {
    ...packet,
    health: {
      ...packet.health,
      warnings: guarantees.warnings,
      compactionStatus: guarantees.compactionStatus,
      semanticValidity: guarantees.semanticValidity,
    },
  }
}

function candidateFromEvent(event: MemoryEvent): MemoryCandidate {
  return {
    id: event.id,
    kind: 'deterministic_summary',
    summary: event.content.summary,
    relevance: relevanceFor(event),
    confidence: confidenceFor(event),
    freshness: 'current',
    sourceRefs: event.sourceRefs,
    reasonForInclusion: `Recent ${event.source.kind} event for scoped ${event.scope.kind} memory.`,
    risks: event.metadata.risk === 'high' ? ['high-risk-memory-event'] : [],
  }
}

function relevanceFor(event: MemoryEvent): MemoryCandidate['relevance'] {
  if (event.metadata.retention === 'task_lifecycle' || event.metadata.retention === 'durable_memory') return 'high'
  if (event.metadata.retention === 'debug') return 'medium'
  return 'low'
}

function confidenceFor(event: MemoryEvent): MemoryCandidate['confidence'] {
  if (event.metadata.risk === 'high') return 'low'
  if (event.metadata.risk === 'medium') return 'medium'
  return 'high'
}

function byteEstimate(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
