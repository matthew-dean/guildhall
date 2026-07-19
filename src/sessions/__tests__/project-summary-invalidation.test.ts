import { describe, expect, it, vi } from 'vitest'

import {
  emitProjectSummaryInvalidation,
  subscribeProjectSummaryInvalidations,
} from '../project-summary-invalidation.js'

describe('project summary invalidation', () => {
  it('delivers a write-boundary event after the current call stack', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectSummaryInvalidations(listener)

    emitProjectSummaryInvalidation('/tmp/example', 'evidence-write', {
      revision: 7,
      domains: ['evidence'],
    })
    expect(listener).not.toHaveBeenCalled()
    await Promise.resolve()

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: '/tmp/example',
      reason: 'evidence-write',
      revision: 7,
      domains: ['evidence'],
    }))
    unsubscribe()
  })

  it('removes listeners without affecting other subscribers', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = subscribeProjectSummaryInvalidations(first)
    const unsubscribeSecond = subscribeProjectSummaryInvalidations(second)
    unsubscribe()

    emitProjectSummaryInvalidation('/tmp/example')
    await Promise.resolve()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    unsubscribeSecond()
  })
})
