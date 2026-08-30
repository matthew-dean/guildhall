import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createProjectProjectionFreshnessWatcher } from '../project-projection-freshness-watcher.js'

function metadata(revision: number, summaryRevision = revision, summaryFreshness: 'current' | 'stale' = 'current') {
  return {
    schemaVersion: 16,
    revision,
    updatedAt: `2026-07-15T00:00:0${revision}.000Z`,
    summaryRevision,
    summaryFreshness,
  }
}

const watchers: Array<{ dispose(): void }> = []

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.dispose()
  vi.useRealTimers()
})

describe('project projection freshness watcher', () => {
  it('baselines without scheduling and notices a later external revision', () => {
    const state = new Map([['/tmp/project', metadata(1)]])
    const schedule = vi.fn()
    const watcher = createProjectProjectionFreshnessWatcher({
      projectRoots: () => [...state.keys()],
      readMetadata: projectRoot => state.get(projectRoot) ?? null,
      schedule,
    })
    watchers.push(watcher)

    watcher.poll()
    expect(schedule).not.toHaveBeenCalled()
    state.set('/tmp/project', metadata(2))
    watcher.poll()

    expect(schedule).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      revision: 2,
      domains: ['legacy'],
    })
    watcher.dispose()
  })

  it('notices a stale marker even when the revision is unchanged', () => {
    const state = new Map([['/tmp/project', metadata(4)]])
    const schedule = vi.fn()
    const watcher = createProjectProjectionFreshnessWatcher({
      projectRoots: () => ['/tmp/project'],
      readMetadata: projectRoot => state.get(projectRoot) ?? null,
      schedule,
    })
    watchers.push(watcher)

    watcher.poll()
    state.set('/tmp/project', metadata(4, 4, 'stale'))
    watcher.poll()

    expect(schedule).toHaveBeenCalledTimes(1)
    watcher.dispose()
  })

  it('refreshes repository state on its first sample and when the signature changes', () => {
    let repositorySignature = 'head-1:clean'
    const schedule = vi.fn()
    const readRepositorySignature = vi.fn(() => repositorySignature)
    const watcher = createProjectProjectionFreshnessWatcher({
      projectRoots: () => ['/tmp/project'],
      readMetadata: () => metadata(7),
      readRepositorySignature,
      schedule,
    })
    watchers.push(watcher)

    watcher.poll()
    expect(schedule).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      revision: 7,
      domains: ['repository'],
    })
    schedule.mockClear()
    repositorySignature = 'head-2:dirty'
    watcher.poll()

    expect(readRepositorySignature).toHaveBeenCalledTimes(2)
    expect(schedule).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      revision: 7,
      domains: ['repository'],
    })
  })

  it('keeps metadata polling alive when repository signature reads fail', () => {
    const schedule = vi.fn()
    const readRepositorySignature = vi.fn(() => {
      throw new Error('git status should not escape the watcher')
    })
    const state = new Map([['/tmp/project', metadata(1)]])
    const watcher = createProjectProjectionFreshnessWatcher({
      projectRoots: () => ['/tmp/project'],
      readMetadata: projectRoot => state.get(projectRoot) ?? null,
      readRepositorySignature,
      schedule,
    })
    watchers.push(watcher)

    watcher.poll()
    state.set('/tmp/project', metadata(2))
    watcher.poll()

    expect(schedule).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      revision: 2,
      domains: ['legacy'],
    })
  })

  it('does not let one scheduler failure abort the rest of the fleet', () => {
    const state = new Map([
      ['/tmp/first', metadata(1)],
      ['/tmp/second', metadata(1)],
    ])
    const schedule = vi.fn((event: { projectRoot: string }) => {
      if (event.projectRoot === '/tmp/first') throw new Error('scheduler unavailable')
    })
    const watcher = createProjectProjectionFreshnessWatcher({
      projectRoots: () => [...state.keys()],
      readMetadata: projectRoot => state.get(projectRoot) ?? null,
      schedule,
    })
    watchers.push(watcher)

    watcher.poll()
    state.set('/tmp/first', metadata(2))
    state.set('/tmp/second', metadata(2))

    expect(() => watcher.poll()).not.toThrow()
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(schedule).toHaveBeenLastCalledWith({
      projectRoot: '/tmp/second',
      revision: 2,
      domains: ['legacy'],
    })
  })

  it('stops polling after disposal', async () => {
    const readMetadata = vi.fn(() => metadata(1))
    const watcher = createProjectProjectionFreshnessWatcher({
      projectRoots: () => ['/tmp/project'],
      readMetadata,
      schedule: vi.fn(),
    }, 5)
    watchers.push(watcher)

    watcher.start()
    watcher.dispose()
    const readsAfterDispose = readMetadata.mock.calls.length
    await vi.advanceTimersByTimeAsync(15)

    expect(readMetadata.mock.calls.length).toBe(readsAfterDispose)
  })
})
