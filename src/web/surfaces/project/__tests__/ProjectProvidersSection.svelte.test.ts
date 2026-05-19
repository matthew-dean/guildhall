// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectProvidersSection from '../ProjectProvidersSection.svelte'
import { path } from '../../../lib/nav.svelte.js'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const providersPayload = {
  preferredProvider: 'codex',
  providers: {
    codex: {
      label: 'Codex OAuth',
      detail: 'Signed in locally.',
      detected: true,
      verifiedAt: '2026-05-19T15:00:00.000Z',
    },
    'anthropic-api': {
      label: 'Anthropic API key',
      detail: 'Configured globally.',
      detected: true,
      verifiedAt: null,
    },
    'openai-api': {
      label: 'OpenAI-compatible API',
      detail: 'Needs API key.',
      detected: false,
      verifiedAt: null,
    },
  },
}

const modelsPayload = {
  globalModels: {
    spec: 'gpt-5.3-codex',
    coordinator: 'gpt-5.3-codex',
    worker: 'gpt-5.3-codex',
    reviewer: 'gpt-5.3-codex',
    gateChecker: 'gpt-5.3-codex',
  },
  projectModels: {
    worker: 'claude-sonnet-4-6',
  },
  effectiveModels: {
    spec: 'gpt-5.3-codex',
    coordinator: 'gpt-5.3-codex',
    worker: 'claude-sonnet-4-6',
    reviewer: 'gpt-5.3-codex',
    gateChecker: 'gpt-5.3-codex',
  },
  loadedModels: ['gpt-5.3-codex'],
  missingModels: ['claude-sonnet-4-6'],
  catalog: [
    { id: 'gpt-5.3-codex', provider: 'codex', notes: 'Default' },
    { id: 'claude-sonnet-4-6', provider: 'anthropic-api', notes: 'Large tasks' },
  ],
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/projects/looma-knit/settings')
  path.value = '/projects/looma-knit/settings'
}

describe('ProjectProvidersSection', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('saves a project-scoped provider preference without touching global credentials', async () => {
    const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      calls.push({ url, init, body })
      if (url.startsWith('/api/setup/providers/config')) return json({ ok: true })
      if (url.startsWith('/api/setup/providers')) return json(providersPayload)
      if (url.startsWith('/api/config/models')) return json(modelsPayload)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectProvidersSection)
    await screen.findByText('Codex OAuth')
    expect(screen.getByText(/Credentials are machine-scoped/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /OpenAI-compatible API/i })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Anthropic API key/i }))
    await userEvent.click(screen.getByRole('button', { name: /save selection/i }))

    await screen.findByText('Saved')
    const saveCall = calls.find(call => call.url.includes('/api/setup/providers/config'))
    expect(saveCall?.url).toContain('projectId=looma-knit')
    expect(saveCall?.body).toMatchObject({
      preferredProvider: 'anthropic-api',
    })
  })

  it('supports project model overrides and returning a role to the global default', async () => {
    const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      calls.push({ url, init, body })
      if (url.startsWith('/api/setup/providers')) return json(providersPayload)
      if (url.startsWith('/api/config/models')) return json(modelsPayload)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectProvidersSection)
    await screen.findByText('Model not loaded.')
    expect(screen.getByText(/Load claude-sonnet-4-6/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Spec author scope'), 'project')
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.includes('/api/config/models?projectId=looma-knit') &&
            call.body?.role === 'spec' &&
            call.body?.scope === 'project' &&
            call.body?.model === 'gpt-5.3-codex',
        ),
      ).toBe(true)
    })

    await userEvent.selectOptions(screen.getByLabelText('Worker scope'), 'global-default')
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.includes('/api/config/models?projectId=looma-knit') &&
            call.body?.role === 'worker' &&
            call.body?.scope === 'global-default' &&
            !('model' in call.body),
        ),
      ).toBe(true)
    })
  })

  it('surfaces provider and model load failures inline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/setup/providers')) return json({ error: 'provider config unreadable' })
      if (url.startsWith('/api/config/models')) return json({ error: 'models unavailable' }, { status: 500 })
      return json({})
    }))

    render(ProjectProvidersSection)
    await screen.findByText('provider config unreadable')
  })
})
