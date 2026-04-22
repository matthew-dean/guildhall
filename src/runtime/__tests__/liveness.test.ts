import { describe, it, expect } from 'vitest'

import {
  LivenessTracker,
  STALL_THRESHOLD_MS,
  thresholdMs,
} from '../liveness.js'

// ---------------------------------------------------------------------------
// FR-30 liveness tracker tests.
//
// These pin the threshold math against the spec values (45s / 2min / 5min)
// so a future refactor to LevelSetting positions cannot silently change
// the stall boundary. The tracker itself is a thin Map wrapper — we test
// the contract (touch resets, scan flags stale, register refreshes) rather
// than implementation details like the internal storage shape.
// ---------------------------------------------------------------------------

describe('FR-30 threshold math', () => {
  it('matches the spec (45s / 2min / 5min)', () => {
    expect(STALL_THRESHOLD_MS.strict).toBe(45_000)
    expect(STALL_THRESHOLD_MS.standard).toBe(120_000)
    expect(STALL_THRESHOLD_MS.lax).toBe(300_000)
  })

  it('thresholdMs helper agrees with the table', () => {
    expect(thresholdMs('strict')).toBe(45_000)
    expect(thresholdMs('standard')).toBe(120_000)
    expect(thresholdMs('lax')).toBe(300_000)
  })
})

describe('LivenessTracker — basic lifecycle', () => {
  it('registers an agent with the current clock time', () => {
    const t = new LivenessTracker({ strictness: 'strict', now: () => 1_000 })
    t.register('worker-1', 'task-001')
    const snap = t.snapshot()
    expect(snap).toEqual([
      { agentId: 'worker-1', taskId: 'task-001', lastEventAt: 1_000 },
    ])
  })

  it('unregister removes the entry and is idempotent', () => {
    const t = new LivenessTracker({ strictness: 'strict', now: () => 1_000 })
    t.register('w', 't')
    t.unregister('w')
    t.unregister('w')
    expect(t.snapshot()).toEqual([])
  })

  it('register() of an already-tracked agent resets the clock', () => {
    // An agent is re-registered (e.g. handed a new task) → liveness clock
    // starts fresh. Without this guarantee a brand-new agent could be
    // flagged stalled because its predecessor went silent.
    let clock = 0
    const t = new LivenessTracker({ strictness: 'strict', now: () => clock })
    t.register('w', 't1')
    clock = 60_000
    t.register('w', 't2')
    expect(t.snapshot()[0]!.lastEventAt).toBe(60_000)
    expect(t.snapshot()[0]!.taskId).toBe('t2')
  })
})

describe('LivenessTracker — stall detection', () => {
  it('flags an agent silent past the strict threshold', () => {
    let clock = 0
    const t = new LivenessTracker({ strictness: 'strict', now: () => clock })
    t.register('w', 't1')

    clock = 45_000 // exactly at threshold — treated as stalled
    const flags = t.scanStalls()
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({
      agentId: 'w',
      taskId: 't1',
      silentMs: 45_000,
      strictness: 'strict',
    })
  })

  it('does NOT flag an agent under the threshold', () => {
    let clock = 0
    const t = new LivenessTracker({ strictness: 'strict', now: () => clock })
    t.register('w', 't1')
    clock = 44_999
    expect(t.scanStalls()).toEqual([])
  })

  it('touch() resets the liveness clock', () => {
    let clock = 0
    const t = new LivenessTracker({ strictness: 'strict', now: () => clock })
    t.register('w', 't1')
    clock = 30_000
    t.touch('w')
    clock = 60_000
    // silent window since touch = 30s — still under 45s threshold
    expect(t.scanStalls()).toEqual([])
    clock = 75_001
    expect(t.scanStalls()).toHaveLength(1)
  })

  it('touch() on an unregistered agent is a no-op (not an auto-register)', () => {
    const t = new LivenessTracker({ strictness: 'strict', now: () => 1_000 })
    t.touch('ghost')
    expect(t.snapshot()).toEqual([])
  })

  it('scanStalls does not mutate state — stall persists until coordinator acts', () => {
    // The spec says stall flags are INPUTS to the coordinator remediation
    // loop. If scanStalls cleared flags on read, a coordinator that
    // scanned after an observability subscriber would see nothing. Stall
    // flags are sticky until the caller explicitly unregisters or the
    // agent touches itself.
    let clock = 0
    const t = new LivenessTracker({ strictness: 'strict', now: () => clock })
    t.register('w', 't1')
    clock = 60_000
    expect(t.scanStalls()).toHaveLength(1)
    expect(t.scanStalls()).toHaveLength(1)
  })

  it('flags multiple stalled agents independently', () => {
    let clock = 0
    const t = new LivenessTracker({ strictness: 'strict', now: () => clock })
    t.register('w1', 'ta')
    t.register('w2', 'tb')

    clock = 50_000 // w1 registered at 0 → stalled
    t.touch('w2') // w2 touched at 50s → still live

    clock = 60_000
    const flags = t.scanStalls()
    expect(flags.map((f) => f.agentId).sort()).toEqual(['w1'])
  })

  it('honors a nowOverride so callers can scan at a specific instant', () => {
    const t = new LivenessTracker({ strictness: 'strict', now: () => 0 })
    t.register('w', 't1')
    expect(t.scanStalls(50_000)).toHaveLength(1)
    expect(t.scanStalls(10_000)).toHaveLength(0)
  })
})

describe('LivenessTracker — strictness changes', () => {
  it('setStrictness changes the threshold applied by scanStalls', () => {
    let clock = 0
    const t = new LivenessTracker({ strictness: 'lax', now: () => clock })
    t.register('w', 't')
    clock = 90_000
    expect(t.scanStalls()).toEqual([]) // under lax (5min)

    t.setStrictness('strict')
    expect(t.scanStalls()).toHaveLength(1) // over strict (45s)
  })

  it('stall flag records the strictness in effect at scan time', () => {
    let clock = 0
    const t = new LivenessTracker({ strictness: 'standard', now: () => clock })
    t.register('w', 't')
    clock = 121_000
    const [flag] = t.scanStalls()
    expect(flag!.strictness).toBe('standard')

    t.setStrictness('strict')
    expect(t.scanStalls()[0]!.strictness).toBe('strict')
  })
})

describe('LivenessTracker — all three lever positions', () => {
  const cases: Array<{ strictness: 'lax' | 'standard' | 'strict'; boundary: number }> = [
    { strictness: 'lax', boundary: 5 * 60 * 1000 },
    { strictness: 'standard', boundary: 2 * 60 * 1000 },
    { strictness: 'strict', boundary: 45 * 1000 },
  ]

  for (const { strictness, boundary } of cases) {
    it(`${strictness}: flags at boundary, clean at boundary-1ms`, () => {
      let clock = 0
      const t = new LivenessTracker({ strictness, now: () => clock })
      t.register('w', 't')

      clock = boundary - 1
      expect(t.scanStalls()).toEqual([])

      clock = boundary
      expect(t.scanStalls()).toHaveLength(1)
    })
  }
})
