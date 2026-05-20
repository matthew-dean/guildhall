// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import ProvidersPage from '../ProvidersPage.svelte'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const providersPayload = {
  providers: {
    'claude-oauth': {
      label: 'Claude OAuth',
      detail: 'Claude Code account',
      detected: true,
      verifiedAt: '2026-05-19T15:00:00.000Z',
    },
    codex: {
      label: 'Codex',
      detail: 'Codex CLI account',
      detected: false,
      verifiedAt: null,
    },
    'anthropic-api': {
      label: 'Anthropic API',
      detail: 'Pasted Anthropic API key',
      detected: false,
      verifiedAt: null,
    },
    'openai-api': {
      label: 'OpenAI-compatible API',
      detail: 'OpenAI or DeepInfra-compatible endpoint',
      detected: true,
      verifiedAt: null,
      baseUrl: 'https://api.deepinfra.com/v1/openai',
    },
    'llama-cpp': {
      label: 'Local OpenAI server',
      detail: 'LM Studio or llama.cpp',
      detected: true,
      verifiedAt: null,
      url: 'http://localhost:1234/v1',
    },
  },
}

const modelsPayload = {
  globalModels: {
    spec: 'qwen/qwen3.6-35b-a3b',
    coordinator: 'qwen/qwen3.6-35b-a3b',
    worker: 'qwen/qwen3.6-35b-a3b',
    reviewer: 'qwen/qwen3.6-35b-a3b',
    gateChecker: 'qwen/qwen3.6-35b-a3b',
  },
  effectiveModels: {},
  loadedModels: ['qwen/qwen3.6-35b-a3b'],
  missingModels: ['qwen/qwen3-coder'],
  catalog: [
    { id: 'qwen/qwen3.6-35b-a3b', provider: 'openai-api', notes: 'fast infra default' },
    { id: 'qwen/qwen3-coder', provider: 'openai-api', notes: 'coder candidate' },
  ],
}

function installFetchFakes() {
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, init, body })
    if (url === '/api/setup/providers') return json(providersPayload)
    if (url === '/api/config/models' && init?.method === 'POST') return json({ ok: true })
    if (url === '/api/config/models') return json(modelsPayload)
    if (url === '/api/setup/providers/config') return json({ ok: true })
    if (url === '/api/providers/test') return json({ ok: true, sample: 'ready' })
    if (url === '/api/providers/disconnect') return json({ ok: true, note: 'Removed provider' })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

describe('ProvidersPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('loads machine-scoped providers and global model defaults', async () => {
    installFetchFakes()

    render(ProvidersPage)

    await screen.findByText('Claude OAuth')
    expect(screen.getByText('OpenAI-compatible API')).toBeTruthy()
    expect(screen.getByText('Global model defaults')).toBeTruthy()
    expect(screen.getByText(/These defaults apply to every Guildhall project/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Model not loaded.')
  })

  it('saves provider credentials and tests configured providers', async () => {
    const { calls } = installFetchFakes()

    render(ProvidersPage)
    await screen.findByText('Anthropic API')

    await userEvent.type(screen.getByPlaceholderText('sk-ant-...'), ' sk-ant-test ')
    await userEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]!)
    await waitFor(() => {
      expect(calls.some(call => call.url === '/api/setup/providers/config' && call.body?.anthropicApiKey === 'sk-ant-test')).toBe(true)
    })

    await userEvent.click(screen.getAllByRole('button', { name: /^test$/i })[0]!)
    await waitFor(() => {
      expect(calls.some(call => call.url === '/api/providers/test' && call.body?.provider === 'claude-oauth')).toBe(true)
    })
    expect(screen.getByText(/Test ok/)).toBeTruthy()
  })

  it('disconnects providers and saves a global model role selection', async () => {
    const { calls } = installFetchFakes()

    render(ProvidersPage)
    await screen.findByText('Global model defaults')

    await userEvent.click(screen.getAllByRole('button', { name: /^disconnect$/i })[0]!)
    await waitFor(() => {
      expect(calls.some(call => call.url === '/api/providers/disconnect' && call.body?.provider === 'claude-oauth')).toBe(true)
    })

    const specSelect = screen.getAllByRole('combobox')[0]!
    await userEvent.selectOptions(specSelect, 'qwen/qwen3-coder')
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url === '/api/config/models' &&
            call.init?.method === 'POST' &&
            call.body?.scope === 'global' &&
            call.body?.role === 'spec' &&
            call.body?.model === 'qwen/qwen3-coder',
        ),
      ).toBe(true)
    })
  })
})
