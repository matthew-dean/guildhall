export function friendlyDomain(domain: string | undefined): string {
  if (!domain) return ''
  if (domain === '_meta') return 'Setup'
  if (domain === '_workspace_import') return 'Workspace import'
  return domain
    .replace(/^_+/, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
