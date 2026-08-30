import { TaskWorkspaceState, type Task } from '@guildhall/core'
import { readProjectStateDatabaseCurrentAuthorityFromTasksPath } from '@guildhall/sessions'

import { writePromotedTaskDetailMutation } from './project-state-boundary.js'
import { upsertTaskWorkspaceState } from './task-state-store.js'
import {
  ensureWorktreeForDispatch,
  type EnsureWorktreeInput,
  type EnsureWorktreeResult,
} from './worktree-manager.js'

export interface EnsureAndRegisterTaskWorkspaceInput extends EnsureWorktreeInput {
  tasksPath: string
  stateProjectRoot: string
  now: () => string
}

export interface EnsureAndRegisterTaskWorkspaceResult extends EnsureWorktreeResult {
  workspace: TaskWorkspaceState
}

/** Allocate and register one dispatch workspace before an agent can use it. */
export async function ensureAndRegisterTaskWorkspace(
  input: EnsureAndRegisterTaskWorkspaceInput,
): Promise<EnsureAndRegisterTaskWorkspaceResult> {
  const ensured = await ensureWorktreeForDispatch(input)
  const persistedWorkspace = (input.task as Task & { workspace?: TaskWorkspaceState }).workspace
  const workspaceAttemptId = (!ensured.created ? persistedWorkspace?.workspaceAttemptId : undefined) ??
    `${ensured.branchName}:${input.now()}`
  const syncRecovery = ensured.mergeRecovery
    ? {
        kind: 'base_merge_conflict' as const,
        workspaceAttemptId,
        baseBranch: ensured.mergeRecovery.baseBranch,
        baseSha: ensured.mergeRecovery.baseSha,
        headSha: ensured.mergeRecovery.headSha,
        conflictPaths: ensured.mergeRecovery.conflictPaths,
        detectedAt: input.now(),
      }
    : undefined
  const updatedAt = input.now()
  const workspace = TaskWorkspaceState.parse({
    ...(persistedWorkspace ?? {}),
    taskId: input.task.id,
    worktreePath: ensured.worktreePath,
    branchName: ensured.branchName,
    baseBranch: ensured.baseBranch,
    workspaceAttemptId,
    mode: input.mode,
    ...(syncRecovery ? { syncRecovery } : {}),
    ...(!persistedWorkspace?.createdAt ? { createdAt: updatedAt } : {}),
    updatedAt,
  })

  try {
    if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(input.tasksPath) === 'database') {
      const mutation = writePromotedTaskDetailMutation(input.tasksPath, input.task.id, {
        projectRoot: input.stateProjectRoot,
        mutate: current => current,
        mutateWorkspace: current => ({ ...current, ...workspace }),
      })
      if (!mutation) throw new Error(`Could not register promoted workspace for ${input.task.id}`)
    } else {
      await upsertTaskWorkspaceState(input.stateProjectRoot, input.task.id, workspace)
    }
  } catch (error) {
    if (ensured.created) {
      try {
        await input.gitDriver.removeWorktree(input.projectPath, ensured.worktreePath)
      } catch (rollbackError) {
        throw new Error(
          `Workspace registration failed for ${input.task.id}, and cleanup also failed: ` +
          `${error instanceof Error ? error.message : String(error)}; ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        )
      }
    }
    throw error
  }

  return { ...ensured, workspace }
}
