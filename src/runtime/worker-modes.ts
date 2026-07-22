import type { Task } from '@guildhall/core'

export type WorkerModeId = 'build' | 'diagnose' | 'tdd'

export interface SelectedWorkerMode {
  id: WorkerModeId
  reason: string
}

export function selectWorkerMode(task: Task): SelectedWorkerMode {
  const mode = task.executionMode ?? 'build'
  return {
    id: mode,
    reason: task.executionMode
      ? `Selected ${mode} from the structured task execution mode.`
      : 'Selected build because no alternate structured execution mode is declared.',
  }
}

export function renderWorkerMode(mode: SelectedWorkerMode): string {
  return [
    `## Worker Mode: ${mode.id === 'tdd' ? 'TDD' : titleCase(mode.id)}`,
    '',
    `**Selection reason:** ${mode.reason}`,
    '',
    ...modeLoop(mode.id),
  ].join('\n')
}

export function modeEvidenceChecklist(mode: WorkerModeId): string[] {
  if (mode === 'diagnose') {
    return [
      'Record the concrete failing command, log, or symptom.',
      'Name the root cause before changing code.',
      'Verify the regression path after the fix.',
    ]
  }
  if (mode === 'tdd') {
    return [
      'Capture red evidence from the failing test.',
      'Capture green evidence from the passing test.',
      'Keep implementation scoped to the tested behavior.',
    ]
  }
  return [
    'Describe the intended change.',
    'Run the relevant verification command.',
    'Leave notes for any follow-up that remains outside this task.',
  ]
}

function modeLoop(mode: WorkerModeId): string[] {
  if (mode === 'diagnose') {
    return [
      'Diagnose loop:',
      '- Reproduce the failure or identify the exact unavailable evidence.',
      '- Compare the expected path with the actual path.',
      '- Change the smallest code surface that explains the root cause.',
      '- Re-run the failing command or closest verification.',
    ]
  }
  if (mode === 'tdd') {
    return [
      'Red: write or update the failing test first and confirm the failure.',
      'Green: implement the smallest code change that makes that test pass.',
      'Refactor: clean up while keeping the focused test and nearby suite green.',
    ]
  }
  return [
    'Build loop:',
    '- Confirm the accepted spec and likely files.',
    '- Implement the smallest coherent change.',
    '- Verify with the task gate or closest local command.',
  ]
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
