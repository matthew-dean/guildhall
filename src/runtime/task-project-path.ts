import path from 'node:path'

export interface TaskPathCoordinator {
  domain: string
  path?: string
}

export interface TaskPathWorkspaceProject {
  id: string
  path: string
  coordinator?: string
}

export interface ResolveTaskProjectPathInput {
  workspaceProjectPath: string
  domain: string
  coordinators?: readonly TaskPathCoordinator[] | null
  projects?: readonly TaskPathWorkspaceProject[] | null
}

export function resolveTaskProjectPath(
  input: ResolveTaskProjectPathInput,
): string {
  const projectMatch = input.projects?.find((project) =>
    project.id === input.domain || project.coordinator === input.domain,
  )
  if (projectMatch?.path && projectMatch.path.trim().length > 0) {
    return path.isAbsolute(projectMatch.path)
      ? projectMatch.path
      : path.join(input.workspaceProjectPath, projectMatch.path)
  }

  const match = input.coordinators?.find((coord) => coord.domain === input.domain)
  if (!match?.path || match.path.trim().length === 0) return input.workspaceProjectPath
  return path.isAbsolute(match.path)
    ? match.path
    : path.join(input.workspaceProjectPath, match.path)
}

export function buildCoordinatorProjectPathMap(
  workspaceProjectPath: string,
  coordinators?: readonly TaskPathCoordinator[] | null,
  projects?: readonly TaskPathWorkspaceProject[] | null,
): Record<string, string> {
  const projectEntries = (projects ?? [])
    .flatMap((project) => [project.id, project.coordinator].filter((key): key is string => Boolean(key?.trim())))
    .map((domain) => [
      domain,
      resolveTaskProjectPath({
        workspaceProjectPath,
        domain,
        projects,
      }),
    ] as const)
  const coordinatorEntries = (coordinators ?? [])
    .filter((coord) => coord.domain.trim().length > 0)
    .filter((coord) => !projectEntries.some(([domain]) => domain === coord.domain))
    .map((coord) => [
      coord.domain,
      resolveTaskProjectPath({
        workspaceProjectPath,
        domain: coord.domain,
        coordinators: [coord],
        projects,
      }),
    ] as const)
  return Object.fromEntries([...projectEntries, ...coordinatorEntries])
}
