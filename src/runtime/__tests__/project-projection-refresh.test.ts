import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createProjectProjectionRefreshScheduler,
  shouldRefreshProjectAtStartup,
  type ProjectProjectionInvalidation,
  type ProjectProjectionRefreshResult,
} from '../project-projection-refresh.js'

const schedulers: Array<{ dispose(): void }> = []

afterEach(() => {
  for (const scheduler of schedulers.splice(0)) scheduler.dispose()
  vi.useRealTimers()
})

describe('project projection refresh scheduler', () => {
  beforeEach(() => vi.useFakeTimers())

  it.each([
    [{ authority: 'database', summaryFreshness: 'current' }, false],
    [{ authority: 'database', summaryFreshness: 'stale' }, true],
    [{ authority: 'database', summaryFreshness: 'missing' }, true],
    [{ authority: 'legacy', summaryFreshness: 'current' }, true],
    [{ authority: 'database', summaryFreshness: 'current', threadFreshness: 'missing' }, true],
    [{ authority: 'database', summaryFreshness: 'current', threadFreshness: 'stale' }, true],
    [{ authority: 'database', summaryFreshness: 'current', threadFreshness: 'current' }, false],
    [{ authority: 'database', summaryFreshness: 'current', blockedTaskCount: 1 }, true],
  ] as const)('refreshes startup only when the saved boundary needs it', (input, expected) => {
    expect(shouldRefreshProjectAtStartup(input)).toBe(expected)
  })

  it('coalesces a burst of writes for one project', async () => {
    const refresh = vi.fn(async () => {})
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 5)
    schedulers.push(scheduler)

    scheduler.schedule({ projectRoot: '/tmp/project' })
    scheduler.schedule({ projectRoot: '/tmp/project' })
    await vi.advanceTimersByTimeAsync(15)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('/tmp/project', expect.objectContaining({ projectRoot: '/tmp/project' }))
  })

  it('refreshes projects independently', async () => {
    const refresh = vi.fn(async (_projectRoot: string, _event: ProjectProjectionInvalidation) => {})
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 5)
    schedulers.push(scheduler)

    scheduler.schedule({ projectRoot: '/tmp/one' })
    scheduler.schedule({ projectRoot: '/tmp/two' })
    await vi.advanceTimersByTimeAsync(15)

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['/tmp/one', '/tmp/two']))
  })

  it('retains the latest revision and merges domains while coalescing', async () => {
    const refresh = vi.fn(async () => {})
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 5)
    schedulers.push(scheduler)

    scheduler.schedule({ projectRoot: '/tmp/project', revision: 3, domains: ['runtime'] })
    scheduler.schedule({ projectRoot: '/tmp/project', revision: 4, domains: ['availability'] })
    await vi.advanceTimersByTimeAsync(15)

    expect(refresh).toHaveBeenCalledWith('/tmp/project', {
      projectRoot: '/tmp/project',
      revision: 4,
      domains: ['runtime', 'availability'],
    })
  })

  it('does not overlap refreshes for one project when a new invalidation arrives mid-refresh', async () => {
    let releaseFirst!: () => void
    const firstRefresh = new Promise<void>(resolve => { releaseFirst = resolve })
    const refresh = vi.fn()
      .mockImplementationOnce(async () => firstRefresh)
      .mockResolvedValueOnce(undefined)
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 5)
    schedulers.push(scheduler)

    scheduler.schedule({ projectRoot: '/tmp/project', revision: 1, domains: ['queue'] })
    await vi.advanceTimersByTimeAsync(5)
    expect(refresh).toHaveBeenCalledTimes(1)

    scheduler.schedule({ projectRoot: '/tmp/project', revision: 2, domains: ['attention'] })
    await vi.advanceTimersByTimeAsync(10)
    expect(refresh).toHaveBeenCalledTimes(1)

    releaseFirst()
    await vi.advanceTimersByTimeAsync(5)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenLastCalledWith('/tmp/project', {
      projectRoot: '/tmp/project',
      revision: 2,
      domains: ['attention'],
    })
  })

  it('cancels pending refreshes on dispose', async () => {
    const refresh = vi.fn(async () => {})
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 10)

    scheduler.schedule({ projectRoot: '/tmp/project' })
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(20)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('reports a bounded failure and stops after one retry', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('x'.repeat(700))
    })
    const results: ProjectProjectionRefreshResult[] = []
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 5, {
      onResult: result => results.push(result),
    })
    schedulers.push(scheduler)

    scheduler.schedule({ projectRoot: '/tmp/project', revision: 7 })
    await vi.advanceTimersByTimeAsync(5)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(results[0]).toMatchObject({
      status: 'error',
      attempt: 1,
      retryCount: 0,
      retryScheduled: true,
      error: `${'x'.repeat(497)}...`,
    })

    await vi.advanceTimersByTimeAsync(5)

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(results[1]).toMatchObject({
      status: 'error',
      attempt: 2,
      retryCount: 1,
      retryScheduled: false,
    })
    expect(scheduler.getStatus('/tmp/project')).toEqual(results[1])
  })

  it('reports recovery when the bounded retry succeeds', async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('temporary projection failure'))
      .mockResolvedValueOnce(undefined)
    const results: Array<{ status: string; retryScheduled: boolean }> = []
    const scheduler = createProjectProjectionRefreshScheduler(refresh, 5, {
      onResult: result => results.push(result),
    })
    schedulers.push(scheduler)

    scheduler.schedule({ projectRoot: '/tmp/project' })
    await vi.advanceTimersByTimeAsync(10)

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(results.map(result => result.status)).toEqual(['error', 'success'])
    expect(results.map(result => result.retryScheduled)).toEqual([true, false])
    expect(scheduler.getStatus('/tmp/project')?.status).toBe('success')
  })
})
