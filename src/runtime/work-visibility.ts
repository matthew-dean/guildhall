import type { Task } from '@guildhall/core'

export type DerivedWorkVisibility = {
  kind: 'primary' | 'supporting' | 'internal_step' | 'hidden'
  countInProjectTotals: boolean
}

function explicitVisibility(task: Pick<Task, 'workVisibility'>): DerivedWorkVisibility | null {
  const kind = task.workVisibility?.kind
  if (kind === 'primary' || kind === 'supporting' || kind === 'internal_step' || kind === 'hidden') {
    return {
      kind,
      countInProjectTotals: typeof task.workVisibility?.countInProjectTotals === 'boolean'
        ? task.workVisibility.countInProjectTotals
        : kind === 'primary' || kind === 'supporting',
    }
  }
  return null
}

function hasGeneratedSplitFingerprint(
  task: Pick<Task, 'id' | 'hierarchy' | 'notes' | 'requestIntake'>,
  parent: Pick<Task, 'id'> | null | undefined,
): boolean {
  if (task.requestIntake?.createdBy === 'workspace-importer') return true
  if (parent && task.id.startsWith(`${parent.id}-split-`)) return true
  if (task.hierarchy?.relation === 'decomposes') return true
  return task.notes?.some(note => note.agentId === 'task-sizing') ?? false
}

function isImportedDecompositionChild(
  task: Pick<Task, 'id' | 'hierarchy' | 'notes' | 'requestIntake'>,
  parent: Pick<Task, 'id' | 'requestIntake'> | null | undefined,
): boolean {
  if (!task.hierarchy?.parentId) return false
  if (parent?.requestIntake?.createdBy !== 'workspace-importer') return false
  return hasGeneratedSplitFingerprint(task, parent)
}

export function deriveTaskWorkVisibility(
  task: Pick<Task, 'id' | 'workVisibility' | 'hierarchy' | 'workKind' | 'requestIntake' | 'notes'>,
  parent?: Pick<Task, 'id' | 'requestIntake'> | null,
): DerivedWorkVisibility {
  const explicit = explicitVisibility(task)
  if (explicit) return explicit
  if (isImportedDecompositionChild(task, parent)) {
    return { kind: 'internal_step', countInProjectTotals: false }
  }
  if (task.hierarchy?.parentId && (task.workKind === 'verification' || task.workKind === 'test')) {
    return { kind: 'internal_step', countInProjectTotals: false }
  }
  return { kind: 'primary', countInProjectTotals: true }
}
