// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Header from '../Header.svelte'
import { path } from '../../lib/nav.svelte.js'
import { project } from '../../lib/project.svelte.js'

function installViewportMatchMedia(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const max = query.match(/max-width:\s*(\d+)px/)
      const min = query.match(/min-width:\s*(\d+)px/)
      const matches = Boolean(
        (max && width <= Number(max[1])) ||
        (min && width >= Number(min[1])),
      )
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    }),
  })
}

describe('Header', () => {
  beforeEach(() => {
    project.detail = null
    window.history.replaceState({}, '', '/projects/looma-knit/thread')
    path.value = '/projects/looma-knit/thread'
    installViewportMatchMedia(640)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '0.5.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
  })

  afterEach(() => {
    project.detail = null
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders brand, version, route-derived project title, and compact project nav toggle', async () => {
    const toggleSpy = vi.fn()
    window.addEventListener('guildhall:toggle-project-nav', toggleSpy)

    render(Header)

    expect(screen.getByRole('button', { name: /projects home/i })).toHaveTextContent('Guildhall')
    expect(document.querySelector('.brand-mark img')).not.toBeInTheDocument()
    expect(document.querySelector('.brand-glyph')).toHaveTextContent('G')
    expect(screen.getByText('Looma knit')).toBeInTheDocument()
    await screen.findByText('v0.5.1')

    await userEvent.click(screen.getByRole('button', { name: /open project navigation/i }))
    expect(toggleSpy).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /projects home/i }))
    expect(window.location.pathname).toBe('/')

    window.removeEventListener('guildhall:toggle-project-nav', toggleSpy)
  })

  it('hides the project-nav hamburger while compact thread detail is active', async () => {
    render(Header)
    expect(screen.getByRole('button', { name: /open project navigation/i })).toBeInTheDocument()

    window.dispatchEvent(new CustomEvent('guildhall:set-nav-context', {
      detail: { surface: 'thread', mode: 'detail' },
    }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /open project navigation/i })).toBeNull()
    })
  })

  it('lets project surfaces override the centered title and tolerates version fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    render(Header)
    expect(screen.getByText('Looma knit')).toBeInTheDocument()

    window.dispatchEvent(new CustomEvent('guildhall:set-project-title', {
      detail: { title: 'Looma + Knit' },
    }))
    await screen.findByText('Looma + Knit')

    window.dispatchEvent(new CustomEvent('guildhall:set-project-title', {
      detail: { title: '' },
    }))
    await waitFor(() => {
      expect(screen.getByText('Looma knit')).toBeInTheDocument()
    })
  })

  it('preserves the saved project name instead of re-humanizing the slug', async () => {
    window.history.replaceState({}, '', '/projects/fair-labor-license/settings/advanced')
    path.value = '/projects/fair-labor-license/settings/advanced'
    project.detail = {
      id: 'fair-labor-license',
      name: 'Fair Labor License',
      path: '/repo/fair-labor-license',
      tasks: [],
    }

    render(Header)

    expect(screen.getByText('Fair Labor License')).toBeInTheDocument()
    expect(screen.queryByText('Fair labor license')).not.toBeInTheDocument()
  })

  it('hides the project event-stream status on global pages', async () => {
    window.history.replaceState({}, '', '/providers')
    path.value = '/providers'

    render(Header)

    expect(screen.queryByText(/connecting|connected|reconnecting/i)).toBeNull()
    await screen.findByText('v0.5.1')
  })

  it('does not keep a stale project connection label on the projects page', async () => {
    window.history.replaceState({}, '', '/projects')
    path.value = '/projects/looma-knit/overview'

    render(Header)

    expect(screen.queryByText(/connecting|connected|reconnecting/i)).toBeNull()
  })
})
