/**
 * Durable task identity must come from an explicit source-owned or
 * deliverable-owned field. Display prose is intentionally absent from this
 * helper so callers cannot accidentally use a rewritten title as identity.
 */
export interface ExplicitTaskIdentityFields {
  sourceIdentity?: string
  deliverableName?: string
  producedArtifact?: string
}

export function explicitTaskStructuralIdentity(
  task: ExplicitTaskIdentityFields,
): string | null {
  for (const field of ['sourceIdentity', 'deliverableName', 'producedArtifact'] as const) {
    const value = task[field]?.trim()
    if (value) return `${field}:${value}`
  }
  return null
}

export function splitChildSourceIdentity(
  parent: { id: string; sourceIdentity?: string },
  childIdentity: string,
): string {
  return `${parent.sourceIdentity ?? parent.id}::split::${childIdentity}`
}
