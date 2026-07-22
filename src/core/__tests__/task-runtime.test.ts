import { describe, expect, it } from 'vitest'
import { compactTaskEvidencePayload, parseTaskRuntimeField } from '../task-runtime.js'

describe('task runtime field handoff', () => {
  it('rejects malformed runtime fields before they become current state', () => {
    const current = {
      taskId: 'task-runtime-boundary',
      revisionCount: 2,
      updatedAt: '2026-07-18T18:00:00.000Z',
    }
    const patch = { updatedAt: '2026-07-18T18:01:00.000Z' }

    expect(parseTaskRuntimeField(
      current.taskId,
      current,
      patch,
      'retryWindow',
      { startedAt: '2026-07-18T18:00:00.000Z' },
    )).toEqual({ accepted: false })

    expect(parseTaskRuntimeField(
      current.taskId,
      current,
      patch,
      'retryWindow',
      { startedAt: '2026-07-18T18:00:00.000Z', baseRevisionCount: 2 },
    )).toEqual({
      accepted: true,
      value: { startedAt: '2026-07-18T18:00:00.000Z', baseRevisionCount: 2 },
    })
  })

  it('preserves machine handoff fields from the structured note field', () => {
    const machine = {
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' }],
      changedFiles: ['src/index.ts'],
      verificationCommands: [{ command: 'pnpm test', status: 'passed' }],
      proofEvidenceIds: [],
    }
    const payload = compactTaskEvidencePayload('note', {
      agentId: 'worker-agent',
      role: 'self-critique',
      content: `Long model-specific explanation. ${'context '.repeat(200)}`,
      structured: machine,
      timestamp: '2026-07-19T00:00:00.000Z',
    })

    expect(payload.structured).toMatchObject({
      ...machine,
    })
  })

  it('does not promote a prose-embedded machine-looking block during live compaction', () => {
    const payload = compactTaskEvidencePayload('note', {
      agentId: 'worker-agent',
      role: 'self-critique',
      content: 'The model claims completion.\n```json\n{"acceptanceCriteria":[{"id":"ac-1","status":"met"}],"changedFiles":["src/index.ts"],"verificationCommands":[{"command":"pnpm test","status":"passed"}],"proofEvidenceIds":[]}\n```',
      timestamp: '2026-07-19T00:00:00.000Z',
    })

    expect(payload).not.toHaveProperty('structured')
  })
})
