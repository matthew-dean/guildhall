import { describe, expect, it } from 'vitest'
import { assertShippedReleaseMutation } from '../release-lifecycle.js'

const shippedRelease = {
  id: 'release-1',
  state: 'shipped',
  nodeIds: ['work:task-done'],
  deferredNodeIds: [],
}

describe('shipped release lifecycle', () => {
  it('rejects adding membership to an already shipped release', () => {
    expect(() => assertShippedReleaseMutation({
      currentReleases: [shippedRelease],
      nextReleases: [{ ...shippedRelease, nodeIds: ['work:task-done', 'work:task-late'] }],
      currentTasks: [{ id: 'task-done', status: 'done' }],
      nextTasks: [{ id: 'task-late', status: 'ready' }],
    })).toThrow('Cannot change membership of shipped release release-1')
  })

  it('rejects reopening completed work inside a shipped release', () => {
    expect(() => assertShippedReleaseMutation({
      currentReleases: [shippedRelease],
      nextReleases: [shippedRelease],
      currentTasks: [{ id: 'task-done', status: 'done' }],
      nextTasks: [{ id: 'task-done', status: 'ready' }],
    })).toThrow('Cannot reopen completed work task-done')
  })

  it('rejects removing work from a shipped release', () => {
    expect(() => assertShippedReleaseMutation({
      currentReleases: [shippedRelease],
      nextReleases: [shippedRelease],
      currentTasks: [{ id: 'task-done', status: 'done' }],
      nextTasks: [],
    })).toThrow('Cannot remove work task-done')
  })

  it('treats omitted tasks as unchanged for a partial task mutation', () => {
    expect(() => assertShippedReleaseMutation({
      currentReleases: [shippedRelease],
      nextReleases: [shippedRelease],
      currentTasks: [{ id: 'task-done', status: 'done' }],
      nextTasks: [],
      nextTasksComplete: false,
    })).not.toThrow()
  })

  it('allows ordinary edits that preserve shipped membership and completion', () => {
    expect(() => assertShippedReleaseMutation({
      currentReleases: [shippedRelease],
      nextReleases: [shippedRelease],
      currentTasks: [{ id: 'task-done', status: 'done' }],
      nextTasks: [{ id: 'task-done', status: 'done' }],
    })).not.toThrow()
  })
})
