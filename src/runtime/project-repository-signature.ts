import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

import { readWorkspaceConfig } from '@guildhall/config'

import { discoverChildGitProjects, resolveWorkspaceProjectPathsOrDiscover } from './git-story-policy.js'

/**
 * A bounded Git observation for the projection freshness watcher. The branch
 * header carries ahead/behind state, which changes after a push even when the
 * working tree and HEAD stay the same.
 */
export function readProjectRepositorySignature(projectRoot: string): string | null {
  let childProjects = discoverChildGitProjects(projectRoot)
  try {
    const workspaceConfig = readWorkspaceConfig(projectRoot)
    childProjects = workspaceConfig.kind === 'workspace'
      ? resolveWorkspaceProjectPathsOrDiscover(projectRoot, workspaceConfig)
      : discoverChildGitProjects(projectRoot)
  } catch {
    // Standalone repositories have no Guildhall config to resolve.
  }
  const roots = childProjects.length > 0
    ? childProjects.map(child => ({ id: child.id, path: child.path }))
    : [{ id: 'workspace', path: projectRoot }]

  const signatures = roots.map(root => {
    try {
      const status = execFileSync('git', ['status', '--porcelain=v2', '--branch'], {
        cwd: root.path,
        encoding: 'utf8',
        timeout: 750,
        maxBuffer: 16 * 1024,
      })
      return `${root.id}:${status}`
    } catch {
      return `${root.id}:unavailable:${basename(root.path)}`
    }
  })

  return signatures.length > 0 ? signatures.join('\n') : null
}
