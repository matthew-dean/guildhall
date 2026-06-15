import type { MemoryCandidatePacket } from './types.js'

export function evaluateMemoryCandidatePacketGuarantees(packet: MemoryCandidatePacket, options: {
  maxBytes?: number
} = {}): {
  compactionStatus: 'active' | 'needs_attention'
  semanticValidity: 'valid' | 'needs_attention'
  warnings: string[]
} {
  const warnings: string[] = []
  const compactionWarnings: string[] = []
  if (options.maxBytes !== undefined && packet.byteEstimate > options.maxBytes) {
    compactionWarnings.push(`Memory packet exceeds byte budget: ${packet.byteEstimate} > ${options.maxBytes}.`)
  }
  for (const candidate of packet.candidates) {
    if (!candidate.summary.trim()) {
      warnings.push(`Memory candidate ${candidate.id} has no summary.`)
    }
    if (candidate.sourceRefs.length === 0) {
      warnings.push(`Memory candidate ${candidate.id} has no source refs.`)
    }
    for (const source of candidate.sourceRefs) {
      if (!source.uri.trim()) {
        warnings.push(`Memory candidate ${candidate.id} has an empty source uri.`)
      }
    }
  }
  for (const omitted of packet.omitted) {
    if (!omitted.summary.trim()) {
      warnings.push('Omitted memory item has no summary.')
    }
    if (omitted.sourceRefs.length === 0) {
      warnings.push(`Omitted memory item "${omitted.summary}" has no source refs.`)
    }
  }
  return {
    compactionStatus:
      Number.isFinite(packet.byteEstimate) && packet.byteEstimate >= 0 && compactionWarnings.length === 0
        ? 'active'
        : 'needs_attention',
    semanticValidity: warnings.length === 0 ? 'valid' : 'needs_attention',
    warnings: [...compactionWarnings, ...warnings],
  }
}
