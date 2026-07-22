export interface ProjectAttentionSeed {
  id: string
  code?: string | null
  reason?: string | null
  message?: string | null
  href?: string | null
  priority?: number
}

export interface ProjectAttentionItem extends ProjectAttentionSeed {
  key: string
}

export function projectAttentionKey(seed: ProjectAttentionSeed): string {
  const href = seed.href?.trim() || ''
  if (seed.code === 'required_migration_pending') return 'setup:required_migration'
  if (seed.code === 'all_terminal' || seed.reason === 'all_terminal') return 'status:all_terminal'
  if (seed.code === 'no_unattended_progress' && seed.reason === 'spec_review') {
    return 'owner:spec_approval'
  }
  if (seed.code === 'import_drafts_waiting') return 'owner:draft_review'
  if (seed.code === 'no_unattended_progress' && seed.reason === 'brief_cleanup') return 'owner:brief_cleanup'
  if (seed.code === 'owner_input_required' || seed.reason === 'awaiting_human') {
    return href ? `owner:input:${href}` : 'owner:input'
  }
  if (seed.code === 'no_unattended_progress' && seed.reason === 'blocked_work') {
    return href ? `blocked:${href}` : 'blocked'
  }
  if (seed.reason === 'blocked_only') {
    return href ? `blocked:${href}` : 'blocked'
  }
  const semanticState = `${seed.code ?? 'notice'}:${seed.reason ?? 'unspecified'}`
  // An API notice without a stable semantic code is still distinct state.
  // Do not collapse unrelated alerts merely because they share a destination.
  return `notice:${seed.id}:${href}:${semanticState}`
}

export function dedupeProjectAttention<T extends ProjectAttentionSeed>(seeds: T[]): Array<T & ProjectAttentionItem> {
  const out: Array<T & ProjectAttentionItem> = []
  const byKey = new Map<string, T & ProjectAttentionItem>()
  for (const seed of seeds) {
    const item = { ...seed, key: projectAttentionKey(seed) } as T & ProjectAttentionItem
    const existing = byKey.get(item.key)
    if (!existing) {
      byKey.set(item.key, item)
      out.push(item)
      continue
    }
    if ((item.priority ?? 100) < (existing.priority ?? 100)) {
      const index = out.indexOf(existing)
      byKey.set(item.key, item)
      if (index >= 0) out[index] = item
    }
  }
  return out
}
