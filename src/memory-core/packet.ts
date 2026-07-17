import { buildDeterministicCandidatePacket } from './adapters/deterministic.js'
import type { GuildhallMemoryScope, MemoryCandidatePacket } from './types.js'

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
  const deterministic = await buildDeterministicCandidatePacket(input)
  if (substrate === 'mastra') {
    return {
      ...deterministic,
      health: {
        ...deterministic.health,
        warnings: [
          ...deterministic.health.warnings,
          'Mastra retrieval is not wired into memory packets yet; the deterministic source index is the active reader.',
        ],
      },
    }
  }
  return deterministic
}

function configuredSubstrate(configured?: 'mastra' | 'deterministic'): 'mastra' | 'deterministic' {
  if (process.env.GUILDHALL_MEMORY_SUBSTRATE === 'deterministic') return 'deterministic'
  if (process.env.GUILDHALL_MEMORY_SUBSTRATE === 'mastra') return 'mastra'
  return configured ?? 'deterministic'
}
