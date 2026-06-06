import { createHash } from 'node:crypto'
import path from 'node:path'

import type { GuildhallMemoryScope, MastraScopeIds } from './types.js'

export function scopeToMastraIds(scope: GuildhallMemoryScope): MastraScopeIds {
  if (scope.kind === 'task_thread') {
    return {
      resourceId: `project:${scope.projectId}:task:${scope.taskId}`,
      threadId: `agent:${scope.agentRole}:thread:${scope.threadId}`,
    }
  }
  if (scope.kind === 'project') {
    return {
      resourceId: `project:${scope.projectId}`,
      threadId: `project:${scope.projectId}:memory`,
    }
  }
  return {
    resourceId: `user:${scope.userId}`,
    threadId: `user:${scope.userId}:guildhall`,
  }
}

export function projectMemoryKey(projectRoot: string): string {
  const resolved = path.resolve(projectRoot)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return `${slug(path.basename(resolved) || 'project')}-${digest}`
}

export function scopeKey(scope: GuildhallMemoryScope): string {
  if (scope.kind === 'task_thread') return `task-${slug(scope.projectId)}-${slug(scope.taskId)}-${slug(scope.agentRole)}-${slug(scope.threadId)}`
  if (scope.kind === 'project') return `project-${slug(scope.projectId)}`
  return `user-${slug(scope.userId)}`
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scope'
}
