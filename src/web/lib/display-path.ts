export function formatUserPath(path: string | null | undefined): string {
  const normalized = path?.trim().replaceAll('\\', '/') ?? ''
  if (normalized.length === 0) return ''

  const homePatterns = [
    /^\/Users\/[^/]+(?=\/|$)/,
    /^\/home\/[^/]+(?=\/|$)/,
    /^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/,
  ]
  for (const pattern of homePatterns) {
    if (pattern.test(normalized)) {
      const suffix = normalized.replace(pattern, '')
      return suffix.length > 0 ? `~${suffix}` : '~'
    }
  }
  return normalized
}
