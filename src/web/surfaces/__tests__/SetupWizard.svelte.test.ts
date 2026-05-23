// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import SetupWizard from '../SetupWizard.svelte'
import { path } from '../../lib/nav.svelte.js'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function installBrowserFakes(url = '/projects/file-insurance/setup?step=1') {
  window.history.replaceState({}, '', url)
  path.value = url
  vi.stubGlobal('alert', vi.fn())
}

describe('SetupWizard', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('saves identity through a project-scoped setup request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        expect(url).toContain('projectId=file-insurance')
        return json({ suggestedName: 'File Insurance', suggestedId: 'file-insurance' })
      }
      if (url.startsWith('/api/setup/status')) {
        expect(url).toContain('projectId=file-insurance')
        return json({ initialized: false, providerConfigured: false, path: '/repo/file-insurance' })
      }
      if (url.startsWith('/api/setup/identity')) {
        expect(url).toContain('projectId=file-insurance')
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body))
        expect(body).toMatchObject({
          name: 'File Insurance Claim Helper',
          id: 'file-insurance-claim-helper',
        })
        return json({ id: 'file-insurance-claim-helper' })
      }
      if (url.startsWith('/api/setup/providers')) {
        return json({ preferredProvider: 'codex', providers: { codex: { label: 'Codex', detail: 'Local', detected: true } } })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'file-insurance' })
    await screen.findByText('Name this project')

    const [nameInput] = screen.getAllByRole('textbox')
    await userEvent.clear(nameInput!)
    await userEvent.type(nameInput!, 'File Insurance Claim Helper')
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/setup/identity'))).toBe(true)
    })
    expect(window.location.pathname).toBe('/projects/file-insurance-claim-helper/setup')
    expect(window.location.search).toBe('?step=2')
  })

  it('starts meta-intake with the active project id when launched from setup', async () => {
    installBrowserFakes('/projects/font-improvement/setup?step=3')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        return json({ suggestedName: 'Font Improvement', suggestedId: 'font-improvement' })
      }
      if (url.startsWith('/api/setup/status')) {
        return json({
          initialized: true,
          providerConfigured: true,
          name: 'Font Improvement',
          id: 'font-improvement',
          path: '/repo/font-improvement',
        })
      }
      if (url.startsWith('/api/project/meta-intake/draft')) {
        expect(url).toContain('projectId=font-improvement')
        return json({ status: 'no-task', taskExists: false })
      }
      if (url.startsWith('/api/project/meta-intake')) {
        expect(url).toContain('projectId=font-improvement')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/start')) {
        expect(url).toContain('projectId=font-improvement')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project')) {
        expect(url).toContain('projectId=font-improvement')
        return json({
          run: { status: 'stopped', mode: 'continuous' },
          tasks: [{ id: 'task-meta-intake', status: 'exploring', updatedAt: '2026-05-19T15:00:00.000Z', spec: '' }],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'font-improvement' })
    await screen.findByText("You're ready to bootstrap.")

    await userEvent.click(screen.getByRole('button', { name: /start meta-intake/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/meta-intake'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(true)
    })
  })

  it('saves provider configuration globally while preserving project-scoped setup navigation', async () => {
    installBrowserFakes('/projects/font-improvement/setup?step=2')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        return json({ suggestedName: 'Font Improvement', suggestedId: 'font-improvement' })
      }
      if (url.startsWith('/api/setup/status')) {
        return json({
          initialized: true,
          providerConfigured: false,
          name: 'Font Improvement',
          id: 'font-improvement',
          path: '/repo/font-improvement',
        })
      }
      if (url.startsWith('/api/setup/providers/config')) {
        expect(url).toContain('projectId=font-improvement')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ preferredProvider: 'codex' })
        return json({ ok: true })
      }
      if (url.startsWith('/api/setup/providers')) {
        expect(url).toContain('projectId=font-improvement')
        return json({
          preferredProvider: 'codex',
          providers: {
            codex: { label: 'Codex', detail: 'Local CLI session', detected: true },
            'openai-api': { label: 'OpenAI-compatible API', detail: 'Key based', detected: false, baseUrl: '' },
          },
        })
      }
      if (url.startsWith('/api/project/meta-intake/draft')) {
        expect(url).toContain('projectId=font-improvement')
        return json({ status: 'no-task', taskExists: false })
      }
      if (url.startsWith('/api/project')) {
        expect(url).toContain('projectId=font-improvement')
        return json({ run: { status: 'stopped', mode: 'continuous' }, tasks: [] })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'font-improvement' })
    await screen.findByText('How should agents call an LLM?')
    await screen.findByText('Codex')

    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/setup/providers/config'))).toBe(true)
    })
    expect(window.location.pathname).toBe('/projects/font-improvement/setup')
    expect(window.location.search).toBe('?step=3')
  })

  it('shows stopped meta-intake activity and resumes the coordinator in place', async () => {
    installBrowserFakes('/projects/font-improvement/setup?step=3')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        return json({ suggestedName: 'Font Improvement', suggestedId: 'font-improvement' })
      }
      if (url.startsWith('/api/setup/status')) {
        return json({
          initialized: true,
          providerConfigured: true,
          name: 'Font Improvement',
          id: 'font-improvement',
          path: '/repo/font-improvement',
        })
      }
      if (url.startsWith('/api/project/meta-intake/draft')) {
        expect(url).toContain('projectId=font-improvement')
        return json({ status: 'in-progress', taskExists: true, taskStatus: 'exploring' })
      }
      if (url.startsWith('/api/project/start')) {
        expect(url).toContain('projectId=font-improvement')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project')) {
        expect(url).toContain('projectId=font-improvement')
        return json({
          run: { status: 'stopped', mode: 'continuous' },
          tasks: [
            {
              id: 'task-meta-intake',
              status: 'exploring',
              updatedAt: '2026-05-19T15:00:00.000Z',
              spec: '',
            },
          ],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'font-improvement' })
    await screen.findByText('Meta-intake agent is working')
    await screen.findByText('Coordinator paused')

    await userEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(await screen.findByText('Coordinator restarted. Watching for the next setup update.')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(true)
    })
  })

  it('validates identity before mutating setup state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        return json({ suggestedName: 'File Insurance', suggestedId: 'file-insurance' })
      }
      if (url.startsWith('/api/setup/status')) {
        return json({ initialized: false, providerConfigured: false, path: '/repo/file-insurance' })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'file-insurance' })
    await screen.findByText('Name this project')

    const [nameInput, idInput] = screen.getAllByRole('textbox')
    await userEvent.clear(nameInput!)
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(screen.getByText('Workspace name is required')).toBeInTheDocument()

    await userEvent.type(nameInput!, 'Bad Slug Project')
    await userEvent.clear(idInput!)
    await userEvent.type(idInput!, 'Bad Slug!')
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(screen.getByText('ID must be lowercase letters, numbers, and dashes only')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/setup/identity'))).toBe(false)
  })

  it('surfaces provider save failures without advancing to launch', async () => {
    installBrowserFakes('/projects/font-improvement/setup?step=2')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        return json({ suggestedName: 'Font Improvement', suggestedId: 'font-improvement' })
      }
      if (url.startsWith('/api/setup/status')) {
        return json({
          initialized: true,
          providerConfigured: false,
          name: 'Font Improvement',
          id: 'font-improvement',
          path: '/repo/font-improvement',
        })
      }
      if (url.startsWith('/api/setup/providers/config')) {
        return json({ error: 'provider rejected key' })
      }
      if (url.startsWith('/api/setup/providers')) {
        return json({
          preferredProvider: 'codex',
          providers: { codex: { label: 'Codex', detail: 'Local CLI session', detected: true } },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'font-improvement' })
    await screen.findByText('How should agents call an LLM?')
    await userEvent.click(screen.getByRole('button', { name: /save and continue/i }))

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Save failed: provider rejected key')
    })
    expect(window.location.search).toBe('?step=2')
  })

  it('reviews inferred coordinator drafts inline and reports approval failures', async () => {
    installBrowserFakes('/projects/font-improvement/setup?step=3')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/setup/defaults')) {
        return json({ suggestedName: 'Font Improvement', suggestedId: 'font-improvement' })
      }
      if (url.startsWith('/api/setup/status')) {
        return json({
          initialized: true,
          providerConfigured: true,
          name: 'Font Improvement',
          id: 'font-improvement',
          path: '/repo/font-improvement',
        })
      }
      if (url.startsWith('/api/project/meta-intake/approve')) {
        expect(init?.method).toBe('POST')
        return json({ error: 'draft changed underneath approval' })
      }
      if (url.startsWith('/api/project/meta-intake/draft')) {
        return json({
          status: 'draft-ready',
          taskExists: true,
          taskStatus: 'spec_review',
          drafts: [
            {
              domain: 'editor',
              path: 'web/editor',
              mandate: 'Own the authoring surface.',
              concerns: [{ id: 'spacing' }, { id: 'keyboard-access' }],
            },
          ],
        })
      }
      if (url.startsWith('/api/project')) {
        return json({
          run: { status: 'stopped', mode: 'continuous' },
          tasks: [{ id: 'task-meta-intake', status: 'spec_review', updatedAt: '2026-05-19T15:00:00.000Z', spec: 'draft' }],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SetupWizard, { projectId: 'font-improvement' })

    await screen.findByText('Guildhall inferred 1 repo slice')
    expect(screen.getAllByText(/web\/editor/)).toHaveLength(2)
    expect(screen.getByText(/spacing, keyboard-access/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /looks right/i }))
    await screen.findByText('Failed: draft changed underneath approval')
  })
})
