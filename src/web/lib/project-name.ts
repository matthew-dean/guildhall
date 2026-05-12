export function humanizeProjectName(name: string | null | undefined): string {
  const raw = String(name ?? '').trim()
  if (!raw) return 'Project'

  const withoutScope = raw.startsWith('@') && raw.includes('/')
    ? raw.split('/').slice(1).join('/')
    : raw

  const looksGenerated =
    /[-_/]/.test(withoutScope) ||
    (/^[a-z0-9\s]+$/.test(withoutScope) && /[a-z]/.test(withoutScope) && !/[A-Z]/.test(withoutScope))

  if (!looksGenerated) return withoutScope

  const collapsed = withoutScope
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!collapsed) return 'Project'
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1)
}
