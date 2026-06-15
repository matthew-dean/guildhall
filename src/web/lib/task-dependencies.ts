export interface TaskDependencyLite {
  id?: string
  status?: string
  dependsOn?: string[]
}

const TERMINAL_WITHOUT_DEPENDENCY_BLOCK = new Set(['done', 'pending_pr', 'shelved'])

export function unmetDependencyIds(task: TaskDependencyLite, tasks: TaskDependencyLite[] = []): string[] {
  const dependencies = task.dependsOn ?? []
  if (dependencies.length === 0) return []
  const byId = new Map(tasks.map(candidate => [candidate.id, candidate]).filter((entry): entry is [string, TaskDependencyLite] => Boolean(entry[0])))
  return dependencies.filter((dependencyId) => byId.get(dependencyId)?.status !== 'done')
}

export function hasUnmetDependencies(task: TaskDependencyLite, tasks: TaskDependencyLite[] = []): boolean {
  if (TERMINAL_WITHOUT_DEPENDENCY_BLOCK.has(task.status ?? '')) return false
  return unmetDependencyIds(task, tasks).length > 0
}
