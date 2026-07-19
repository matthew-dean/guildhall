import path from 'node:path'

export interface WorkspaceProjectCandidate {
  id?: string
  coordinator?: string
  label?: string
  path: string
}

export function workspaceProjectNamedInText<Project extends WorkspaceProjectCandidate>(
  projects: readonly Project[],
  parts: readonly unknown[],
): Project | undefined {
  const haystack = parts
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
  if (!haystack) return undefined
  const matches = projects.filter((project) => {
    const names = [
      project.id,
      project.coordinator,
      project.label,
      path.basename(project.path),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length >= 3)
    return names.some(name => containsProjectToken(haystack, name))
  })
  return matches.length === 1 ? matches[0] : undefined
}

function containsProjectToken(haystack: string, rawName: string): boolean {
  const escaped = rawName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)
}
