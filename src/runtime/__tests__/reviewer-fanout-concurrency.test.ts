import { describe, it, expect } from 'vitest'
import { boundedConcurrency } from '../reviewer-fanout.js'

// ---------------------------------------------------------------------------
// Verify boundedConcurrency: the pool backing the reviewer fan-out runner.
// Uses a fake in-flight counter + max-observed watermark to assert that
// `concurrency=N` never allows more than N workers active at once.
// ---------------------------------------------------------------------------

function trackedWork(delayMs: number): {
  work: (n: number, i: number) => Promise<number>
  maxInFlight: () => number
} {
  let inFlight = 0
  let maxInFlight = 0
  return {
    work: async (n: number, _i: number) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, delayMs))
      inFlight--
      return n * 2
    },
    maxInFlight: () => maxInFlight,
  }
}

describe('boundedConcurrency', () => {
  it('preserves item order in the output', async () => {
    const items = [1, 2, 3, 4, 5]
    const result = await boundedConcurrency(items, 3, async (n) => n * 10)
    expect(result).toEqual([10, 20, 30, 40, 50])
  })

  it('concurrency=1 is strictly sequential (max-in-flight=1)', async () => {
    const tracker = trackedWork(5)
    await boundedConcurrency([1, 2, 3, 4, 5, 6], 1, tracker.work)
    expect(tracker.maxInFlight()).toBe(1)
  })

  it('concurrency=3 caps parallelism at 3', async () => {
    const tracker = trackedWork(10)
    await boundedConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, tracker.work)
    expect(tracker.maxInFlight()).toBeLessThanOrEqual(3)
    // With 10 items × 10ms each at concurrency 3, we should actually observe 3
    // simultaneous workers, not just 1.
    expect(tracker.maxInFlight()).toBeGreaterThanOrEqual(2)
  })

  it('concurrency > items falls back to items.length workers', async () => {
    const tracker = trackedWork(5)
    await boundedConcurrency([1, 2], 10, tracker.work)
    expect(tracker.maxInFlight()).toBeLessThanOrEqual(2)
  })

  it('concurrency=0 / negative / fractional clamps to sequential', async () => {
    for (const c of [0, -4, 0.5]) {
      const tracker = trackedWork(1)
      await boundedConcurrency([1, 2, 3], c, tracker.work)
      expect(tracker.maxInFlight()).toBe(1)
    }
  })

  it('empty items returns empty array', async () => {
    expect(await boundedConcurrency([], 4, async (n) => n)).toEqual([])
  })

  it('propagates thrown errors from work', async () => {
    await expect(
      boundedConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom on 2')
        return n
      }),
    ).rejects.toThrow(/boom on 2/)
  })
})
