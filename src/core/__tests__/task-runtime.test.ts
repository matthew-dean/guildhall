import { describe, expect, it } from 'vitest'
import { parseTaskRuntimeField } from '../task-runtime.js'

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
})
