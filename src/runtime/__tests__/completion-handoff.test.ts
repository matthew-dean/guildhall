import { describe, expect, it } from 'vitest'

import {
  CompletionHandoff,
  buildCompletionHandoff,
  recordCompletionHandoff,
  reviewCompletionHandoff,
} from '../completion-handoff.js'
import { ProofPath } from '../proof-paths.js'

const proofPath = ProofPath.parse({
  id: 'task-1-proof-path',
  scope: { type: 'task', id: 'task-1' },
  title: 'Verify task 1',
  summary: 'Run tests and inspect the UI.',
  status: 'verified',
  launchSteps: [
    { id: 'test', kind: 'copy_command', title: 'Run tests', command: 'pnpm test -- task-1' },
    { id: 'ui', kind: 'open_url', title: 'Open UI', url: 'http://localhost:5173/task-1' },
  ],
  expectedEvidence: [
    { id: 'unit', kind: 'automated', description: 'Focused tests pass.', required: true },
    { id: 'browser', kind: 'manual', description: 'Journey renders proof handoff.', required: true },
    { id: 'preview', kind: 'provider', description: 'Preview deployment is healthy.', required: false },
  ],
  verificationRecords: [
    {
      id: 'unit-run',
      evidenceId: 'unit',
      kind: 'automated',
      status: 'passed',
      summary: 'Focused tests passed.',
      command: 'pnpm test -- task-1',
      recordedAt: '2026-05-27T12:00:00.000Z',
      recordedBy: 'worker-agent',
    },
    {
      id: 'browser-check',
      evidenceId: 'browser',
      kind: 'manual',
      status: 'passed',
      summary: 'Journey proof section rendered in browser.',
      url: 'http://localhost:5173/task-1',
      recordedAt: '2026-05-27T12:05:00.000Z',
      recordedBy: 'reviewer-agent',
    },
  ],
  createdAt: '2026-05-27T11:00:00.000Z',
  updatedAt: '2026-05-27T12:05:00.000Z',
  createdBy: 'spec-agent',
})

describe('completion handoff', () => {
  it('summarizes automated, manual, and provider proof without overclaiming provider evidence', () => {
    const handoff = buildCompletionHandoff({
      taskId: 'task-1',
      completedAt: '2026-05-27T12:10:00.000Z',
      completedBy: 'gate-checker-agent',
      summary: 'Task 1 is ready to inspect.',
      proofPaths: [proofPath],
      residualRisk: 'Provider preview was optional and not required for this slice.',
    })

    expect(handoff).toMatchObject({
      id: 'task-1-completion-handoff',
      taskId: 'task-1',
      proofPathIds: ['task-1-proof-path'],
      automatedProof: [expect.objectContaining({ evidenceId: 'unit', status: 'passed' })],
      manualProof: [expect.objectContaining({ evidenceId: 'browser', status: 'passed' })],
      providerProof: [],
      residualRisk: 'Provider preview was optional and not required for this slice.',
    })
    expect(handoff.verificationSummary).toContain('2 verification records')
    expect(handoff.verificationSummary).toContain('0 provider')
  })

  it('rejects missing proof paths and required evidence that has no passed record', () => {
    const missing = reviewCompletionHandoff({
      taskId: 'task-1',
      proofPaths: [],
      handoff: CompletionHandoff.parse({
        id: 'task-1-completion-handoff',
        taskId: 'task-1',
        completedAt: '2026-05-27T12:10:00.000Z',
        completedBy: 'gate-checker-agent',
        summary: 'Done.',
        proofPathIds: [],
        verificationSummary: 'Done.',
        automatedProof: [],
        manualProof: [],
        providerProof: [],
        residualRisk: 'None.',
      }),
    })

    expect(missing.ok).toBe(false)
    expect(missing.issues).toContain('Completion handoff is missing a task-scoped proof path.')

    const incompleteProof = ProofPath.parse({
      ...proofPath,
      verificationRecords: proofPath.verificationRecords.filter((record) => record.kind !== 'manual'),
    })
    const handoff = buildCompletionHandoff({
      taskId: 'task-1',
      completedAt: '2026-05-27T12:10:00.000Z',
      completedBy: 'gate-checker-agent',
      summary: 'Task 1 is ready.',
      proofPaths: [incompleteProof],
      residualRisk: 'None.',
    })

    const result = reviewCompletionHandoff({
      taskId: 'task-1',
      proofPaths: [incompleteProof],
      handoff,
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toContain('Required evidence "browser" has no passed verification record.')
  })

  it('records completion handoffs as committed user-visible project records compacted from proof paths', async () => {
    const writes: unknown[] = []
    const handoff = buildCompletionHandoff({
      taskId: 'task-1',
      completedAt: '2026-05-27T12:10:00.000Z',
      completedBy: 'gate-checker-agent',
      summary: 'Task 1 is ready.',
      proofPaths: [proofPath],
      residualRisk: 'No known residual risk.',
    })

    await recordCompletionHandoff({
      projectRoot: '/repo/product',
      handoff,
      proofPaths: [proofPath],
      persistence: {
        async writeRecord(input) {
          writes.push(input)
          return { payload: input.payload, ref: { path: '/x' } } as never
        },
      },
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      projectRoot: '/repo/product',
      collection: 'completion-handoffs',
      id: 'task-1-completion-handoff',
      schemaName: 'completion-handoff',
      schemaVersion: 1,
      sourceRefs: ['task:task-1', 'proof-path:task-1-proof-path'],
      placement: {
        scope: 'shared_project',
        retention: 'archive',
        visibility: 'user_visible',
        commitPolicy: 'committed',
      },
    })
  })
})
