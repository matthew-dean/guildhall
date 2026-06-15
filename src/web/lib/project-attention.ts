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
  const message = `${seed.code ?? ''} ${seed.reason ?? ''} ${seed.message ?? ''}`.toLowerCase()
  const href = seed.href?.trim() || ''
  if (seed.code === 'required_migration_pending') return 'setup:required_migration'
  if (seed.code === 'all_terminal' || seed.reason === 'all_terminal') return 'status:all_terminal'
  if (message.match(/\bspecs?\b|\bapproval\b|\bapprove\b/) && message.match(/\breview\b|\bwaiting\b|\bawaiting\b|\binput\b/)) {
    return 'owner:spec_approval'
  }
  if (message.match(/\bdrafts?\b|\bimport_draft\b|\bimport drafts?\b/)) return 'owner:draft_review'
  if (message.match(/\bbrief\b|\bacceptance criteria\b/)) return 'owner:brief_cleanup'
  if (seed.code === 'owner_input_required' || seed.reason === 'awaiting_human' || message.match(/\bquestion\b|\banswer\b|\binput\b|\bwaiting on you\b/)) {
    return href ? `owner:input:${href}` : 'owner:input'
  }
  if (seed.reason === 'blocked_only' || message.match(/\bblocked\b|\brecover\b|\bescalation\b/)) {
    return href ? `blocked:${href}` : 'blocked'
  }
  return href ? `notice:${href}:${message}` : `notice:${seed.id}:${message}`
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
