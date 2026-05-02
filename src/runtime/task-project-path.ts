import path from 'node:path'

export interface TaskPathCoordinator {
  domain: string
  path?: string
}

export interface ResolveTaskProjectPathInput {
  workspaceProjectPath: string
  domain: string
  coordinators?: readonly TaskPathCoordinator[] | null
}

export function resolveTaskProjectPath(
  input: ResolveTaskProjectPathInput,
): string {
  const match = input.coordinators?.find((coord) => coord.domain === input.domain)
  if (!match?.path || match.path.trim().length === 0) return input.workspaceProjectPath
  return path.isAbsolute(match.path)
    ? match.path
    : path.join(input.workspaceProjectPath, match.path)
}

export function buildCoordinatorProjectPathMap(
  workspaceProjectPath: string,
  coordinators?: readonly TaskPathCoordinator[] | null,
): Record<string, string> {
  const entries = (coordinators ?? [])
    .filter((coord) => coord.domain.trim().length > 0)
    .map((coord) => [
      coord.domain,
      resolveTaskProjectPath({
        workspaceProjectPath,
        domain: coord.domain,
        coordinators: [coord],
      }),
    ] as const)
  return Object.fromEntries(entries)
}
