import { describe, expect, it } from 'vitest'
import type { ProjectRelease } from '@guildhall/core'
import { closeReleaseIfReady } from '../release-lifecycle.js'

const release: ProjectRelease = {
  id: 'release-1',
  label: 'First release',
  kind: 'release',
  state: 'active',
  source: 'owner_approved',
  nodeIds: ['work:task-1'],
  deferredNodeIds: [],
  proofStyle: 'script_only',
}

describe('release lifecycle', () => {
  it('ships only a fully proven selected release', () => {
    const result = closeReleaseIfReady(release, {
      state: 'ready',
      counts: { total: 1, done: 1, unfinished: 0, blocked: 0, proofBlocked: 0 },
    }, '2026-07-18T06:00:00.000Z')

    expect(result).toMatchObject({ ok: true, release: { state: 'shipped', updatedAt: '2026-07-18T06:00:00.000Z' } })
  })

  it('keeps a release open when proof or work is incomplete', () => {
    const result = closeReleaseIfReady(release, {
      state: 'ready',
      counts: { total: 1, done: 1, unfinished: 0, blocked: 1, proofBlocked: 1 },
    }, '2026-07-18T06:00:00.000Z')

    expect(result).toMatchObject({ ok: false, code: 'not_ready', release: { state: 'active' } })
  })

  it('does not create another action for an already shipped release', () => {
    const result = closeReleaseIfReady({ ...release, state: 'shipped' }, null, '2026-07-18T06:00:00.000Z')

    expect(result).toMatchObject({ ok: true, code: 'already_shipped', release: { state: 'shipped' } })
  })
})
