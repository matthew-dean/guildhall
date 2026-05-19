// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Header from '../Header.svelte'
import { path } from '../../lib/nav.svelte.js'

describe('Header', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/looma-knit/thread')
    path.value = '/projects/looma-knit/thread'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '0.5.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders brand, version, route-derived project title, and project nav toggle', async () => {
    const toggleSpy = vi.fn()
    window.addEventListener('guildhall:toggle-project-nav', toggleSpy)

    render(Header)

    expect(screen.getByRole('button', { name: /projects home/i })).toHaveTextContent('Guildhall')
    expect(screen.getByText('Looma knit')).toBeInTheDocument()
    await screen.findByText('v0.5.1')

    await userEvent.click(screen.getByRole('button', { name: /open project navigation/i }))
    expect(toggleSpy).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /projects home/i }))
    expect(window.location.pathname).toBe('/')

    window.removeEventListener('guildhall:toggle-project-nav', toggleSpy)
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
})
