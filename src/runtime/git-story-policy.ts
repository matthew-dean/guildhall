import path from 'node:path'
import { existsSync, readdirSync, type Dirent } from 'node:fs'
import {
  readGlobalConfig,
  readProjectConfig,
  type GitStoryPolicyType,
  type ResolvedConfig,
  type WorkspaceYamlConfig,
} from '@guildhall/config'
import { workspaceProjectNamedInText } from './workspace-project-match.js'

type WorkspaceProject = NonNullable<ResolvedConfig['projects']>[number]
const IGNORED_CHILD_GIT_PROJECT_DIRS = new Set(['.git', '.guildhall', 'node_modules', 'dist', 'build', 'coverage'])

export interface GitStoryPolicyContext {
  workspacePath: string
  workspaceProjectPath: string
  workspaceGitStory?: GitStoryPolicyType
  workspaceProjects?: readonly WorkspaceProject[]
  task?: {
    domain?: string
    projectPath?: string
    worktreePath?: string
    title?: string
    description?: string
  } | Record<string, unknown>
}

function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? input
  if (input.startsWith('~/')) return path.join(process.env.HOME ?? '~', input.slice(2))
  return input
}

export function resolveWorkspaceBaseProjectPath(workspacePath: string, config: Pick<WorkspaceYamlConfig, 'projectPath'>): string {
  const raw = config.projectPath?.trim()
  if (!raw) return path.resolve(workspacePath)
  const expanded = expandHome(raw)
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspacePath, expanded)
}

export function resolveWorkspaceProjectPaths(
  workspacePath: string,
  config: Pick<WorkspaceYamlConfig, 'projectPath' | 'projects'>,
): WorkspaceProject[] {
  const base = resolveWorkspaceBaseProjectPath(workspacePath, config)
  return (config.projects ?? []).map(project => ({
    ...project,
    path: path.isAbsolute(project.path) ? path.resolve(project.path) : path.resolve(base, project.path),
  }))
}

export function discoverChildGitProjects(workspacePath: string): WorkspaceProject[] {
  const resolvedWorkspacePath = path.resolve(workspacePath)
  if (existsSync(path.join(resolvedWorkspacePath, '.git'))) return []
  let entries: Dirent[]
  try {
    entries = readdirSync(resolvedWorkspacePath, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isDirectory() && !IGNORED_CHILD_GIT_PROJECT_DIRS.has(entry.name))
    .map(entry => {
      const childPath = path.join(resolvedWorkspacePath, entry.name)
      return {
        id: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || entry.name,
        label: entry.name,
        path: childPath,
      }
    })
    .filter(child => existsSync(path.join(child.path, '.git')))
    .sort((left, right) => (left.label ?? left.id).localeCompare(right.label ?? right.id))
}

export function resolveWorkspaceProjectPathsOrDiscover(
  workspacePath: string,
  config: Pick<WorkspaceYamlConfig, 'projectPath' | 'projects'>,
): WorkspaceProject[] {
  const configured = resolveWorkspaceProjectPaths(workspacePath, config)
  return configured.length > 0 ? configured : discoverChildGitProjects(resolveWorkspaceBaseProjectPath(workspacePath, config))
}

function taskString(task: GitStoryPolicyContext['task'], key: string): string | undefined {
  if (!task) return undefined
  const value = (task as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isInside(parent: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function resolveGitStoryWorkspaceProject(input: GitStoryPolicyContext): WorkspaceProject | undefined {
  const taskProjectPath = taskString(input.task, 'projectPath')
  const taskDomain = taskString(input.task, 'domain')
  const taskWorktreePath = taskString(input.task, 'worktreePath')
  const projects = input.workspaceProjects ?? []

  if (taskProjectPath) {
    const resolvedTaskProject = path.resolve(taskProjectPath)
    const exact = projects.find(project => path.resolve(project.path) === resolvedTaskProject)
    if (exact) return exact
    const containing = projects
      .filter(project => isInside(project.path, resolvedTaskProject))
      .sort((a, b) => path.resolve(b.path).length - path.resolve(a.path).length)[0]
    if (containing) return containing
  }

  if (taskDomain) {
    const domainMatch = projects.find(project => project.id === taskDomain || project.coordinator === taskDomain)
    if (domainMatch) return domainMatch
  }

  const namedMatch = workspaceProjectNamedInTask(input.task, projects)
  if (namedMatch) return namedMatch

  if (taskWorktreePath) {
    const worktreeMatch = projects.find(project => isInside(taskWorktreePath, project.path))
    if (worktreeMatch) return worktreeMatch
  }

  return undefined
}

function workspaceProjectNamedInTask(
  task: GitStoryPolicyContext['task'],
  projects: readonly WorkspaceProject[],
): WorkspaceProject | undefined {
  if (!task) return undefined
  return workspaceProjectNamedInText(projects, [
    taskString(task, 'domain'),
    taskString(task, 'title'),
    taskString(task, 'description'),
  ])
}

export function effectiveGitStoryPolicy(input: GitStoryPolicyContext): GitStoryPolicyType & {
  copiedFromSystem: boolean
  policyRoot: string
  source: 'child-local' | 'workspace-project' | 'workspace-local' | 'workspace' | 'global'
} {
  const systemPolicy = readGlobalConfig().gitStory
  const workspaceLocalPolicy = readProjectConfig(input.workspacePath).gitStory
  const childProject = resolveGitStoryWorkspaceProject(input)
  const childLocalPolicy = childProject ? readProjectConfig(childProject.path).gitStory : undefined
  const policy =
    childLocalPolicy ??
    childProject?.gitStory ??
    workspaceLocalPolicy ??
    input.workspaceGitStory ??
    systemPolicy

  const source = childLocalPolicy
    ? 'child-local'
    : childProject?.gitStory
      ? 'workspace-project'
      : workspaceLocalPolicy
        ? 'workspace-local'
        : input.workspaceGitStory
          ? 'workspace'
          : 'global'

  return {
    ...systemPolicy,
    ...policy,
    copiedFromSystem: source === 'global',
    policyRoot: childLocalPolicy || childProject?.gitStory ? childProject!.path : input.workspacePath,
    source,
  }
}
