import type { Task } from '@guildhall/core'

export type DerivedWorkVisibility = {
  kind: 'primary' | 'supporting' | 'internal_step' | 'hidden'
  countInProjectTotals: boolean
}

type WorkVisibilityTask = Pick<Task, 'id' | 'workVisibility' | 'hierarchy' | 'workKind' | 'requestIntake' | 'notes'> &
  Partial<Pick<Task, 'title' | 'description' | 'references'>>

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

function normalizedImportRefs(task: Pick<WorkVisibilityTask, 'references' | 'requestIntake'>): string[] {
  const refs = [
    ...(task.references ?? []),
    ...(task.requestIntake?.evidenceRefs ?? []),
  ]
  return refs
    .map(ref => ref.replace(/^import:/, '').replaceAll('\\', '/').toLowerCase())
    .filter(Boolean)
}

function isImportedSpecFragment(task: WorkVisibilityTask): boolean {
  if (task.requestIntake?.createdBy !== 'workspace-importer') return false
  const refs = normalizedImportRefs(task)
  if (refs.some(ref => /(?:^|\/)_?template\.md$/.test(ref))) return true
  if (!refs.some(ref => /(?:^|\/)specs\/.+\.md$/.test(ref))) return false
  const title = task.title?.trim() ?? ''
  return /^AC(?:\d+|-error)?\s*:/i.test(title)
}

function hasGeneratedSplitFingerprint(
  task: Pick<WorkVisibilityTask, 'id' | 'hierarchy' | 'notes' | 'requestIntake'>,
  parent: Pick<Task, 'id'> | null | undefined,
): boolean {
  if (task.requestIntake?.createdBy === 'workspace-importer') return true
  if (parent && task.id.startsWith(`${parent.id}-split-`)) return true
  if (task.hierarchy?.relation === 'decomposes') return true
  return task.notes?.some(note => note.agentId === 'task-sizing') ?? false
}

function isImportedDecompositionChild(
  task: Pick<WorkVisibilityTask, 'id' | 'hierarchy' | 'notes' | 'requestIntake'>,
  parent: Pick<Task, 'id' | 'requestIntake'> | null | undefined,
): boolean {
  if (!task.hierarchy?.parentId) return false
  if (parent?.requestIntake?.createdBy !== 'workspace-importer') return false
  return hasGeneratedSplitFingerprint(task, parent)
}

export function deriveTaskWorkVisibility(
  task: WorkVisibilityTask,
  parent?: Pick<Task, 'id' | 'requestIntake'> | null,
): DerivedWorkVisibility {
  const explicit = explicitVisibility(task)
  if (explicit) return explicit
  if (isImportedSpecFragment(task)) {
    return { kind: 'hidden', countInProjectTotals: false }
  }
  if (isImportedDecompositionChild(task, parent)) {
    return { kind: 'internal_step', countInProjectTotals: false }
  }
  if (task.hierarchy?.parentId && (task.workKind === 'verification' || task.workKind === 'test')) {
    return { kind: 'internal_step', countInProjectTotals: false }
  }
  return { kind: 'primary', countInProjectTotals: true }
}
