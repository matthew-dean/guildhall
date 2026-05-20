// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StaleServerBanner from '../StaleServerBanner.svelte'

describe('StaleServerBanner', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    document.documentElement.style.removeProperty('--app-banner-h')
  })

  it('shows stale build info, restart steps, and dismisses cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pid: 1234,
      processStartedAt: '2026-05-19T16:00:00.000Z',
      bootBuildMtimeMs: 1000,
      currentBuildMtimeMs: 181000,
      stale: true,
      distPath: '/repo/dist/cli.js',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    render(StaleServerBanner)

    await screen.findByText('Guildhall needs a restart to show recent code changes.')
    expect(screen.getByText('This local server is 3 min behind the code on disk.')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Show restart steps'))
    expect(screen.getByText('kill 1234')).toBeInTheDocument()
    expect(screen.getByText('guildhall serve')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText('Guildhall needs a restart to show recent code changes.')).toBeNull()
  })

  it('stays hidden for fresh builds and ignores failed polls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pid: 1234,
        processStartedAt: '2026-05-19T16:00:00.000Z',
        bootBuildMtimeMs: 181000,
        currentBuildMtimeMs: 181000,
        stale: false,
        distPath: '/repo/dist/cli.js',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    render(StaleServerBanner)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(screen.queryByText(/Guildhall needs a restart/)).toBeNull()
  })
})
