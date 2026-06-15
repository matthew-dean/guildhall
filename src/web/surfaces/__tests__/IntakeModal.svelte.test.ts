// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tick } from 'svelte'
import IntakeModal from '../IntakeModal.svelte'
import { path } from '../../lib/nav.svelte.js'
import { project } from '../../lib/project.svelte.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  })
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/projects/looma-knit/thread')
  path.href = '/projects/looma-knit/thread'
  path.value = '/projects/looma-knit/thread'
  project.detail = {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    tasks: [],
    run: { status: 'stopped', mode: 'continuous' },
  }
}

describe('IntakeModal', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  async function openBugForm() {
    await userEvent.click(screen.getByRole('button', { name: /file a bug instead/i }))
    await tick()
  }

  async function choosePriority(value: 'high' | 'critical' | 'normal' | 'low') {
    const select = screen.getByLabelText('Priority') as HTMLSelectElement
    select.value = value
    await fireEvent.input(select)
    await fireEvent.change(select)
    await tick()
  }

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    project.detail = null
  })

  it('creates a request from the thread without requiring the details pane', async () => {
    const onClose = vi.fn()
    const created = vi.fn()
    window.addEventListener('guildhall:request-created', created)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/request')) {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({
          ask: 'Add inline link controls.',
          title: 'Knit link controls',
          projectId: 'looma-knit',
        })
        return json({ boundedChat: { id: 'bc-new-thread-1' } })
      }
      if (url.startsWith('/api/project')) {
        return json({
          id: 'looma-knit',
          run: { status: 'stopped', mode: 'continuous' },
          tasks: [],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(IntakeModal, { onClose })
    expect(screen.getByRole('heading', { name: /new thread/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/Describe the request in plain language/i), 'Add inline link controls.')
    await userEvent.type(screen.getByPlaceholderText(/Short descriptive title/i), 'Knit link controls')
    await userEvent.click(screen.getByRole('button', { name: /start thread/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(created).toHaveBeenCalledTimes(1)
    expect(created.mock.calls[0]?.[0]).toMatchObject({
      detail: { boundedChatId: 'bc-new-thread-1' },
    })
    expect(path.href).toBe('/projects/looma-knit/thread?thread=bc-new-thread-1')
    expect(path.value).toBe('/projects/looma-knit/thread')
    window.removeEventListener('guildhall:request-created', created)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/project/request?projectId=looma-knit'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(false)
  })

  it('validates request intake before creating a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(IntakeModal, { onClose: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: /start thread/i }))

    expect(screen.getByText('Please describe the request.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('files a bug report with priority and optional stack trace', async () => {
    const onClose = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/bug-report')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          title: 'Thread card opened the wrong project',
          body: 'Clicking Open sent me to the project list.',
          priority: 'critical',
          stackTrace: 'TypeError: missing projectId',
          projectId: 'looma-knit',
        })
        return json({ ok: true })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(IntakeModal, { onClose })
    await openBugForm()
    await screen.findByPlaceholderText(/What went wrong/i)
    await userEvent.type(screen.getByPlaceholderText(/What went wrong/i), 'Thread card opened the wrong project')
    await userEvent.type(
      screen.getByPlaceholderText(/what happened, and what did you expect/i),
      'Clicking Open sent me to the project list.',
    )
    await userEvent.type(screen.getByPlaceholderText(/Paste the error/i), 'TypeError: missing projectId')
    await choosePriority('critical')
    await userEvent.click(screen.getByRole('button', { name: /file bug/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/project/bug-report?projectId=looma-knit'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps bug-report validation local and surfaces server errors', async () => {
    const fetchMock = vi.fn(async () => json({ error: 'routing failed' }))
    vi.stubGlobal('fetch', fetchMock)

    render(IntakeModal, { onClose: vi.fn() })
    await openBugForm()
    await screen.findByRole('button', { name: /file bug/i })
    await userEvent.click(screen.getByRole('button', { name: /file bug/i }))
    expect(screen.getByText('Please add a summary.')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/What went wrong/i), 'Broken setup')
    await userEvent.click(screen.getByRole('button', { name: /file bug/i }))
    expect(screen.getByText('Please describe what happened.')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/what happened, and what did you expect/i), 'It failed.')
    await userEvent.click(screen.getByRole('button', { name: /file bug/i }))
    await screen.findByText('Bug filing failed: routing failed')
  })

  it('closes from the cancel button and Escape key', async () => {
    const onClose = vi.fn()
    render(IntakeModal, { onClose })

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
