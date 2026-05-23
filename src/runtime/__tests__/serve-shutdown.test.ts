import { describe, expect, it, vi } from 'vitest'
import { closeHttpServerForShutdown } from '../serve.js'

describe('serve shutdown', () => {
  it('does not wait forever when active HTTP connections keep server.close open', async () => {
    vi.useFakeTimers()
    try {
      const server = {
        close: vi.fn(),
        closeAllConnections: vi.fn(),
        closeIdleConnections: vi.fn(),
      }

      const closing = closeHttpServerForShutdown(server, {
        forceCloseAfterMs: 25,
        timeoutMs: 50,
      })

      await vi.advanceTimersByTimeAsync(25)
      expect(server.close).toHaveBeenCalledTimes(1)
      expect(server.closeIdleConnections).toHaveBeenCalledTimes(1)
      expect(server.closeAllConnections).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(25)
      await expect(closing).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
