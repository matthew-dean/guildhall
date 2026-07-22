import type { Checkpoint, ReviewVerdict } from '@guildhall/core'
import type { CommandEvidence } from '../policy.js'

export function touchedFiles(...files: string[]): string[] {
  return files
}

export function commandEvidence(overrides: Partial<CommandEvidence> = {}): CommandEvidence {
  return {
    command: 'pnpm test',
    passed: true,
    observedAt: '2026-05-18T20:00:00.000Z',
    ...overrides,
  }
}

export function reviewVerdict(overrides: Partial<ReviewVerdict> = {}): ReviewVerdict {
  return {
    verdict: 'approve',
    reviewerPath: 'deterministic',
    reason: 'No substantive issues found.',
    failingSignals: [],
    recordedAt: '2026-05-18T20:00:00.000Z',
    ...overrides,
  }
}

export function checkpointEvidence(
  overrides: Partial<Omit<Checkpoint, 'resumeContext'>> & {
    verification?: CommandEvidence[]
    companionFiles?: string[]
    workingHypothesis?: string
    safeNextMutationSurface?: string[]
  } = {},
): Checkpoint {
  const {
    verification = [],
    companionFiles = [],
    workingHypothesis,
    safeNextMutationSurface = [],
    ...checkpointOverrides
  } = overrides

  return {
    taskId: 'task-001',
    agentId: 'worker-agent',
    step: 1,
    intent: 'Continue implementation with durable evidence.',
    filesTouched: [],
    nextPlannedAction: 'Resume from the last verified task-local evidence.',
    writtenAt: '2026-05-18T20:05:00.000Z',
    ...checkpointOverrides,
    resumeContext: {
      verification: verification.map((entry) => ({
        command: entry.command,
        passed: entry.passed,
        observedAt: entry.observedAt ?? '2026-05-18T20:00:00.000Z',
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(entry.files ? { files: [...entry.files] } : {}),
      })),
      companionFiles,
      ...(workingHypothesis ? { workingHypothesis } : {}),
      safeNextMutationSurface,
    },
  }
}
