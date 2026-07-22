import { describe, expect, it } from 'vitest'
import { projectStateWriteLockHeld, withProjectStateWriteLock } from '../project-state-write-lock.js'

describe('project-state write lock', () => {
  it('serializes async read-modify-write operations and permits re-entry', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstReady = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = withProjectStateWriteLock('project-a', async () => {
      order.push('first:start')
      await firstReady
      await withProjectStateWriteLock('project-a', async () => {
        order.push('first:reentered')
      })
      order.push('first:end')
    })
    const second = withProjectStateWriteLock('project-a', async () => {
      order.push('second:start')
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:reentered', 'first:end', 'second:start'])
  })

  it('does not serialize different projects', async () => {
    const order: string[] = []
    const first = withProjectStateWriteLock('project-a', async () => {
      order.push('a')
    })
    const second = withProjectStateWriteLock('project-b', async () => {
      order.push('b')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['a', 'b'])
  })

  it('reports ownership only inside the current async lock scope', async () => {
    expect(projectStateWriteLockHeld('project-a')).toBe(false)
    await withProjectStateWriteLock('project-a', async () => {
      expect(projectStateWriteLockHeld('project-a')).toBe(true)
      expect(projectStateWriteLockHeld('project-b')).toBe(false)
    })
    expect(projectStateWriteLockHeld('project-a')).toBe(false)
  })
})
