export function sourceRefLabel(ref: string): string {
  const value = ref.startsWith('import:') ? ref.slice('import:'.length) : ref
  const parts = value.split('/').filter(Boolean)
  return parts.at(-1) ?? value
}

export function isSourceDocumentRef(ref: string): boolean {
  if (ref.startsWith('task:') || ref.startsWith('artifact:')) return false
  if (ref.startsWith('import:')) return true
  return /[/\\]/.test(ref) || /\.(md|mdx|txt|json|ya?ml)$/i.test(ref)
}

export function sourceRefsSummary(refs: string[], limit = 3): string | null {
  const labels = [...new Set(refs.filter(isSourceDocumentRef).map(sourceRefLabel).filter(Boolean))]
  if (labels.length === 0) return null
  const visible = labels.slice(0, limit).join(', ')
  const hidden = labels.length > limit ? ` +${labels.length - limit} more` : ''
  return `${visible}${hidden}`
}
