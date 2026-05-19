export function formatUserPath(path: string | null | undefined): string {
  const normalized = path?.trim().replaceAll('\\', '/') ?? ''
  if (normalized.length === 0) return ''

  const homePatterns = [
    /^\/Users\/[^/]+(?=\/|$)/i,
    /^\/home\/[^/]+(?=\/|$)/i,
    /^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/i,
  ]
  for (const pattern of homePatterns) {
    if (pattern.test(normalized)) {
      const suffix = normalized.replace(pattern, '')
      return suffix.length > 0 ? `~${suffix}` : '~'
    }
  }
  return normalized
}
