import { buildDeterministicCandidatePacket } from './adapters/deterministic.js'
import { createMastraMemoryCoreAdapter } from './adapters/mastra.js'
import { evaluateMemoryCandidatePacketGuarantees } from './guarantees.js'
import type { GuildhallMemoryScope, MemoryCandidate, MemoryCandidatePacket } from './types.js'

export async function buildMemoryCoreCandidatePacket(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
  purpose: MemoryCandidatePacket['purpose']
  maxBytes: number
  now?: () => Date
  substrate?: 'mastra' | 'deterministic'
  semanticRecall?: boolean
  observationalMemory?: boolean
}): Promise<MemoryCandidatePacket> {
  const substrate = configuredSubstrate(input.substrate)
  if (substrate === 'deterministic') {
    return buildDeterministicCandidatePacket(input)
  }

  try {
    if (process.env.GUILDHALL_MEMORY_CORE_FORCE_MASTRA_FAILURE === '1') {
      throw new Error('forced Mastra memory-core failure')
    }
    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot: input.projectRoot,
      scope: input.scope,
      readOnly: true,
      semanticRecall: configuredSemanticRecall(input.semanticRecall),
      observationalMemory: configuredObservationalMemory(input.observationalMemory),
    })
    const deterministic = await buildDeterministicCandidatePacket(input)
    const candidates = deterministic.candidates.map(normalizeMastraCandidate)
    const guarantees = evaluateMemoryCandidatePacketGuarantees({
      ...deterministic,
      candidates,
      byteEstimate: byteEstimate({ candidates, omitted: deterministic.omitted }),
    }, { maxBytes: input.maxBytes })
    return {
      ...deterministic,
      candidates,
      byteEstimate: byteEstimate({ candidates, omitted: deterministic.omitted }),
      health: {
        adapter: 'mastra',
        fallbackUsed: false,
        warnings: [...adapter.health.warnings, ...guarantees.warnings],
        storagePath: adapter.health.storagePath,
        repoLocalWrites: adapter.health.repoLocalWrites,
        features: adapter.health.features,
        semanticRecallEnabled: adapter.health.semanticRecallEnabled,
        observationalMemoryEnabled: adapter.health.observationalMemoryEnabled,
        observationalProcessorReady: adapter.health.observationalProcessorReady,
        compactionStatus: guarantees.compactionStatus,
        semanticValidity: guarantees.semanticValidity,
      },
    }
  } catch (err) {
    const fallback = await buildDeterministicCandidatePacket(input)
    return {
      ...fallback,
      health: {
        ...fallback.health,
        warnings: [
          ...fallback.health.warnings,
          `Mastra memory-core unavailable; deterministic fallback used: ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
    }
  }
}

function normalizeMastraCandidate(candidate: MemoryCandidate): MemoryCandidate {
  return {
    ...candidate,
    kind: candidate.relevance === 'high' ? 'observation' : 'reflection',
    reasonForInclusion: `Mastra memory-core normalized ${candidate.sourceRefs.length} source-backed event(s) for this scope.`,
  }
}

function configuredSubstrate(configured?: 'mastra' | 'deterministic'): 'mastra' | 'deterministic' {
  if (process.env.GUILDHALL_MEMORY_SUBSTRATE === 'deterministic') return 'deterministic'
  if (process.env.GUILDHALL_MEMORY_SUBSTRATE === 'mastra') return 'mastra'
  return configured ?? 'mastra'
}

function configuredSemanticRecall(configured?: boolean): boolean {
  if (process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL === '1') return true
  if (process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL === '0') return false
  return configured ?? false
}

function configuredObservationalMemory(configured?: boolean): boolean {
  if (process.env.GUILDHALL_MEMORY_OBSERVATIONAL === '1') return true
  if (process.env.GUILDHALL_MEMORY_OBSERVATIONAL === '0') return false
  return configured ?? false
}

function byteEstimate(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
