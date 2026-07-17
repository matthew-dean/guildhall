import { describe, expect, it } from 'vitest'

import { buildCurrentThreadProjection } from '../current-thread-projection.js'
import type { Thread, ThreadTurn } from '../thread.js'

function requestTurn(
  id: string,
  status: 'done' | 'active' | 'pending',
  extra: Record<string, unknown> = {},
): ThreadTurn {
  return {
    id,
    at: `2026-07-15T00:00:0${id.length}.000Z`,
    persona: 'coord',
    status,
    phase: status === 'done' ? 'done' : 'ready',
    kind: 'request',
    requestId: id,
    rawRequest: `Request ${id}`,
    title: id,
    requestStage: 'new_request',
    routingSummary: `Route ${id}`,
    ...extra,
  } as ThreadTurn
}

describe('buildCurrentThreadProjection', () => {
  it('keeps all actionable turns and only the latest completed window', () => {
    const thread: Thread = {
      turns: [
        requestTurn('done-1', 'done'),
        requestTurn('done-2', 'done'),
        requestTurn('active', 'active'),
        requestTurn('done-3', 'done'),
        requestTurn('pending', 'pending'),
        requestTurn('done-4', 'done'),
      ],
      activeTurnId: 'active',
      caughtUp: false,
    }

    const projection = buildCurrentThreadProjection({
      thread,
      completedTurnWindow: 2,
      generatedAt: '2026-07-15T12:00:00.000Z',
      sourceRevision: 'thread-revision-7',
    })

    expect(projection.turns.map(turn => turn.id)).toEqual(['active', 'done-3', 'pending', 'done-4'])
    expect(projection.activeTurnId).toBe('active')
    expect(projection.caughtUp).toBe(false)
    expect(projection.generatedAt).toBe('2026-07-15T12:00:00.000Z')
    expect(projection.sourceRevision).toBe('thread-revision-7')
  })

  it('bounds named oversized text fields without mutating the source Thread', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz'
    const sourceTurn = requestTurn('active', 'active', {
      taskDescription: long,
      sourceNote: { description: long, references: [] },
      details: long,
      spec: long,
      notes: long,
      rawRequest: long,
      summary: long,
    }) as ThreadTurn & Record<string, unknown>
    const thread: Thread = {
      turns: [sourceTurn],
      activeTurnId: 'active',
      caughtUp: false,
    }

    const projection = buildCurrentThreadProjection({
      thread,
      maxTextChars: 10,
      generatedAt: 'now',
      sourceRevision: 3,
    })
    const projectedTurn = projection.turns[0] as ThreadTurn & Record<string, unknown>

    expect(projectedTurn.taskDescription).toBe('abcdefg...')
    expect((projectedTurn.sourceNote as Record<string, unknown>).description).toBe('abcdefg...')
    expect(projectedTurn.details).toBe('abcdefg...')
    expect(projectedTurn.spec).toBe('abcdefg...')
    expect(projectedTurn.notes).toBe('abcdefg...')
    expect(projectedTurn.rawRequest).toBe('abcdefg...')
    expect(projectedTurn.summary).toBe('abcdefg...')
    expect(sourceTurn.taskDescription).toBe(long)
    expect(sourceTurn.details).toBe(long)
  })

  it('keeps the next pending window instead of serializing the whole queue', () => {
    const thread: Thread = {
      turns: [
        requestTurn('pending-1', 'pending'),
        requestTurn('pending-2', 'pending'),
        requestTurn('pending-3', 'pending'),
        requestTurn('active', 'active'),
      ],
      activeTurnId: 'active',
      caughtUp: false,
    }

    const projection = buildCurrentThreadProjection({
      thread,
      pendingTurnWindow: 2,
      generatedAt: 'now',
      sourceRevision: 1,
    })

    expect(projection.turns.map(turn => turn.id)).toEqual(['pending-1', 'pending-2', 'active'])
  })
})
