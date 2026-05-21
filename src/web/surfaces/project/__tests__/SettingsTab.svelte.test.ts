// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsTab from '../SettingsTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import { project } from '../../../lib/project.svelte.js'

const now = '2026-05-19T16:00:00.000Z'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installProjectState() {
  window.history.replaceState({}, '', '/projects/looma-knit/settings')
  path.value = '/projects/looma-knit/settings'
  project.error = null
  project.detail = {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/workspace/looma-knit',
    tasks: [],
    config: {
      coordinators: [
        {
          id: 'editor-coordinator',
          name: 'Editor coordinator',
          domain: 'Editor',
          mandate: 'Keep editor work scoped.',
        },
      ],
    },
  }
}

describe('SettingsTab', () => {
  beforeEach(() => {
    installProjectState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    project.detail = null
    project.error = null
  })

  it('runs bootstrap from readiness and reports the detected gates in the toast', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') {
        return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      }
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/providers/status') return json({ configured: true, active: 'OpenAI-compatible API' })
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: true,
          needed: false,
          status: null,
          bootstrap: {
            commands: ['pnpm install'],
            successGates: ['pnpm test'],
            timeoutMs: 120000,
          },
        })
      }
      if (url.pathname === '/api/project/bootstrap/run') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({
          detected: {
            packageManager: 'pnpm',
            gates: {
              test: { available: true },
              build: { available: true },
              lint: { available: false },
            },
          },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    await userEvent.click(screen.getAllByRole('button', { name: /configure/i })[0]!)

    await screen.findByText('Bootstrap verified (pnpm): test, build')
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/bootstrap/run'))).toBe(true)
  })

  it('surfaces bootstrap run failures without marking the project ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/providers/status') return json({ configured: false })
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({ configured: true, needed: true, status: null, bootstrap: { commands: [], successGates: [], timeoutMs: 0 } })
      }
      if (url.pathname === '/api/project/bootstrap/run') return json({ error: 'pnpm install failed' }, 500)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    await userEvent.click(screen.getAllByRole('button', { name: /configure/i })[0]!)

    await screen.findByText('Bootstrap failed: pnpm install failed')
    expect(screen.getByText('pnpm install failed')).toBeInTheDocument()
  })

  it('saves advanced identity, resets lever errors, and approves a design-system draft', async () => {
    const refresh = vi.spyOn(project, 'refresh').mockResolvedValue()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') {
        return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      }
      if (url.pathname === '/api/config/levers' && init?.method !== 'POST') {
        return json({
          error: fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/config/levers/reset'))
            ? undefined
            : 'Lever file is malformed.',
          levers: fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/config/levers/reset'))
            ? [
                {
                  name: 'worker.autonomy',
                  position: 'high',
                  setBy: 'defaults',
                  rationale: 'Let workers inspect nearby context before escalating.',
                  scope: 'default',
                },
              ]
            : undefined,
        })
      }
      if (url.pathname === '/api/config/levers/reset') {
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/design-system') {
        return json({
          designSystem: {
            revision: 2,
            authoredBy: 'design-agent',
            authoredAt: now,
            primitives: [{ name: 'Button', usage: 'Primary actions' }],
            tokens: { color: [{ name: 'accent' }], spacing: [{ name: 'sm' }] },
            copyVoice: { tone: 'plain' },
            a11y: { minContrastRatio: 4.5 },
            approvedAt: fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/project/design-system/approve'))
              ? now
              : undefined,
          },
        })
      }
      if (url.pathname === '/api/project/design-system/approve') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/providers/status') return json({ configured: true, active: 'OpenAI-compatible API' })
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: false, needed: true, status: null })
      if (url.pathname === '/api/setup/identity') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: 'Looma and Knit',
          id: 'looma-and-knit',
        })
        return json({ ok: true })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'advanced' })

    await screen.findByRole('heading', { name: /advanced settings/i })
    await userEvent.clear(screen.getByLabelText(/workspace name/i))
    await userEvent.type(screen.getByLabelText(/workspace name/i), 'Looma and Knit')
    await userEvent.clear(screen.getByLabelText(/workspace id/i))
    await userEvent.type(screen.getByLabelText(/workspace id/i), 'looma-and-knit')
    await userEvent.click(screen.getByRole('button', { name: /save identity/i }))

    await screen.findByText('Saved')
    expect(refresh).toHaveBeenCalled()

    await screen.findByText('Lever file is malformed.')
    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }))
    await screen.findByText('Worker Autonomy')

    await screen.findByText('Revision 2')
    await userEvent.click(screen.getByRole('button', { name: /approve current draft/i }))
    await screen.findByText('approved')
  })

  it('reviews learned project habits, preferences, playbooks, and product ideas', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') {
        return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      }
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/providers/status') return json({ configured: true, active: 'OpenAI-compatible API' })
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: false, needed: true, status: null })
      if (url.pathname === '/api/project/learning/action') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          kind: 'accept',
          scope: 'project',
          id: 'learn-1',
        })
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/skill-proposals/action') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          kind: 'activate',
          id: 'skill-1',
          approved: true,
        })
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/learning') {
        const accepted = fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/project/learning/action'))
        const skillActivated = fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/project/skill-proposals/action'))
        return json({
          project: {
            suggestedLearnings: [
              {
                id: 'learn-1',
                summary: 'Run Knit typecheck from web root after API changes.',
                destination: 'project_memory',
                scope: 'project',
                confidence: 'high',
                risk: 'medium',
                status: accepted ? 'active' : 'suggested',
                evidence: [{ summary: 'The workspace members task failed until the scoped typecheck was rerun.' }],
              },
            ],
          },
          user: {
            suggestedLearnings: [
              {
                id: 'user-1',
                summary: 'Prefer sentence-case project titles.',
                destination: 'user_preference',
                scope: 'user_global',
                confidence: 'medium',
                risk: 'low',
                status: 'suggested',
              },
            ],
          },
          effective: {
            productSuggestions: [
              {
                id: 'product-1',
                title: 'Make outline-first task shaping explicit',
                summary: 'Ask coordinators to draft structure before implementation.',
                evidence: ['Navigation work needed a stable outline before UI fill-in.'],
              },
            ],
          },
          projectSkillProposals: [
            {
              id: 'skill-1',
              name: 'Workspace API repair playbook',
              description: 'Read the API route, run the scoped typecheck, then patch the narrow handler.',
              status: skillActivated ? 'active' : 'suggested',
              triggerKeywords: ['workspace', 'api'],
            },
          ],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'learning' })

    await screen.findByRole('heading', { name: /memory and habits/i })
    expect(screen.getByText('0 in use')).toBeInTheDocument()
    expect(screen.getByText('3 waiting')).toBeInTheDocument()
    expect(screen.getByText('Run Knit typecheck from web root after API changes.')).toBeInTheDocument()
    expect(screen.getByText('Project memory')).toBeInTheDocument()
    expect(screen.getByText('Strong signal')).toBeInTheDocument()
    expect(screen.getByText('Needs care')).toBeInTheDocument()
    expect(screen.getByText('Prefer sentence-case project titles.')).toBeInTheDocument()
    expect(screen.getByText('Workspace API repair playbook')).toBeInTheDocument()
    expect(screen.getByText('workspace')).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByText('Make outline-first task shaping explicit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /give product feedback/i })).toHaveAttribute(
      'href',
      expect.stringContaining('Make+outline-first+task+shaping+explicit'),
    )

    await userEvent.click(screen.getByRole('button', { name: /use this/i }))
    await screen.findByText('1 in use')
    expect(screen.getByText('2 waiting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /use playbook/i }))
    await screen.findByText('2 in use')
  })
})
