import type { Task } from '@guildhall/core'

/**
 * Provider proof is an explicit task contract. Rendered task prose may
 * explain the lane, but it cannot create one or change whether it is required.
 */
export function requiresRealProviderProof(task: Pick<Task, 'proofPaths'>): boolean {
  const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
  return proofPaths.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const path = value as Record<string, unknown>
    if (path.kind === 'provider') return true
    if (!Array.isArray(path.expectedEvidence)) return false
    return path.expectedEvidence.some((item) =>
      Boolean(item) &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).kind === 'provider',
    )
  })
}

/**
 * A provider-proof artifact must declare simulation in structured metadata.
 * Phrases in scripts, summaries, reasons, or model output are audit material
 * only and cannot invalidate an otherwise typed artifact.
 */
export function simulatedProviderProofArtifact(content: string, file: string): string | null {
  if (!/(?:^|[\\/])proof-results[\\/]/i.test(file) || !/\.json$/i.test(file)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const summary = record.summary && typeof record.summary === 'object' && !Array.isArray(record.summary)
    ? record.summary as Record<string, unknown>
    : record
  const simulated = record.simulated === true || summary.simulated === true ||
    record.executionMode === 'simulated' || summary.executionMode === 'simulated'
  return simulated ? 'structured simulation flag' : null
}
