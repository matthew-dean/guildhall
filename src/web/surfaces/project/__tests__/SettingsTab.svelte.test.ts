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
    memoryHealth: {
      total: 3,
      active: 1,
      proposed: 1,
      used: 1,
      recentUse: [{ taskId: 'task-link-editor', included: 2, withheld: 1, at: now }],
    },
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

function codebaseMapStatus(overrides: Record<string, unknown> = {}) {
  return {
    configured: false,
    generatedAt: null,
    stale: null,
    counts: { files: 0, areas: 0, abstractions: 0 },
    designSystem: null,
    frameworks: [],
    packageManagers: [],
    ...overrides,
  }
}

function providersPayload(preferredProvider = 'openai-api') {
  return {
    preferredProvider,
    providers: {
      'openai-api': {
        label: 'Remote OpenAI-compatible',
        detected: true,
        detail: 'Stored globally.',
        verifiedAt: now,
      },
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
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
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
    expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Re-intake' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Providers' }))
    expect(path.value).toBe('/projects/looma-knit/settings/providers')

    const runBootstrapButton = screen.getByRole('button', { name: /^run bootstrap$/i })
    expect(runBootstrapButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(runBootstrapButton)

    await screen.findByText('Bootstrap verified (pnpm): test, build')
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/bootstrap/run'))).toBe(true)
  })

  it('routes section changes through the compact settings selector', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: true,
          needed: false,
          status: null,
          bootstrap: { commands: ['pnpm install'], successGates: ['pnpm test'], timeoutMs: 120000 },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    const selector = screen.getByRole('combobox', { name: /settings section/i })
    await userEvent.selectOptions(selector, 'providers')

    expect(path.value).toBe('/projects/looma-knit/settings/providers')
  })

  it('surfaces project graph domain assignment and inbound request actions', async () => {
    project.detail = {
      ...project.detail,
      structuralMapReview: {
        id: 'map-1',
        state: 'accepted',
        domains: [{ id: 'domain:editor', label: 'Editor' }],
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({ configured: true, needed: false, status: null, bootstrap: { commands: [], successGates: [], timeoutMs: 0 } })
      }
      if (url.pathname === '/api/project/project-graph' && init?.method !== 'POST') {
        return json({
          projectGraph: {
            currentProject: { id: 'looma-knit', label: 'Looma + Knit', path: '/workspace/looma-knit' },
            localProjects: [
              { id: 'looma-knit', label: 'Looma + Knit', role: 'current', path: '/workspace/looma-knit' },
              { id: 'looma', label: 'Looma', role: 'related', path: '/workspace/looma-knit/looma' },
            ],
            structuralDomains: [
              {
                id: 'domain:editor',
                label: 'Editor',
                kind: 'structural_domain',
                coordinatorId: 'editor-coordinator',
                coordinatorName: 'Editor coordinator',
              },
            ],
            domainResponsibilities: [
              {
                id: 'domain:editor:provider_capability',
                domainId: 'domain:editor',
                domainLabel: 'Editor',
                facet: 'provider_capability',
                facetLabel: 'Provider capability',
                description: 'Reusable editor components and APIs.',
                authority: 'provider',
                responsibleProjectId: 'looma-knit',
                responsibleProjectLabel: 'Looma + Knit',
                responsibleProjectPath: '/workspace/looma-knit',
                assignable: true,
                assigned: false,
              },
              {
                id: 'domain:editor:shared_contract',
                domainId: 'domain:editor',
                domainLabel: 'Editor',
                facet: 'shared_contract',
                facetLabel: 'Shared contract',
                description: 'Component API, config schema, and package boundary.',
                authority: 'shared',
                responsibleProjectId: 'looma-knit',
                responsibleProjectLabel: 'Looma + Knit',
                responsibleProjectPath: '/workspace/looma-knit',
                assignable: true,
                assigned: false,
              },
              {
                id: 'domain:editor:consumer_configuration',
                domainId: 'domain:editor',
                domainLabel: 'Editor',
                facet: 'consumer_configuration',
                facetLabel: 'Consumer configuration',
                description: 'Token values, product taste, and editor composition stay local.',
                authority: 'consumer',
                responsibleProjectId: 'looma-knit',
                responsibleProjectLabel: 'Looma + Knit',
                responsibleProjectPath: '/workspace/looma-knit',
                assignable: false,
                assigned: false,
              },
              {
                id: 'domain:editor:consumer_verification',
                domainId: 'domain:editor',
                domainLabel: 'Editor',
                facet: 'consumer_verification',
                facetLabel: 'Consumer verification',
                description: 'Looma + Knit verifies the delivered capability in its product context.',
                authority: 'consumer',
                responsibleProjectId: 'looma-knit',
                responsibleProjectLabel: 'Looma + Knit',
                responsibleProjectPath: '/workspace/looma-knit',
                assignable: false,
                assigned: false,
              },
            ],
            domainAuthorities: [],
            dependencyEdges: [{
              id: 'edge-knit-looma',
              state: 'submitted',
              consumerProjectId: 'knit',
              consumerProjectLabel: 'Knit',
              providerProjectId: 'looma-knit',
              providerProjectLabel: 'Looma + Knit',
              domainId: 'domain:editor',
              domainLabel: 'Editor',
              consumerNeed: 'Knit needs the Looma editor.',
              unresolved: true,
            }],
          },
        })
      }
      if (url.pathname === '/api/project/project-graph/domain-responsibility') {
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body ?? '{}'))
        expect(body).toEqual(expect.objectContaining({
          domainId: 'domain:editor',
          facet: 'provider_capability',
          responsibleProjectId: 'looma',
        }))
        return json({ projectGraph: { localProjects: [], domainResponsibilities: [] } })
      }
      if (url.pathname === '/api/project/project-graph/requests/edge-knit-looma/provider-accept') {
        expect(init?.method).toBe('POST')
        return json({ projectGraph: { localProjects: [], dependencyEdges: [] } })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'graph' })

    await screen.findByRole('heading', { name: 'Project graph' })
    expect(screen.getByRole('heading', { name: 'Domains' })).toBeInTheDocument()
    expect(screen.getByText('Detected here - routed by Editor coordinator')).toBeInTheDocument()
    expect(screen.queryByText('Provider capability')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /responsible project/i })).not.toBeInTheDocument()
    expect(screen.getByText('Available to assign')).toBeInTheDocument()
    expect(screen.getByText('Related local project')).toBeInTheDocument()
    expect(screen.getByText('Knit needs the Looma editor.')).toBeInTheDocument()
    expect(screen.getByText('Waiting on provider')).toBeInTheDocument()
    expect(screen.getByText('This project is provider')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /open editor domain/i }))
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.getByText('Reusable editor components and APIs.')).toBeInTheDocument()
    expect(screen.getByText('Token values, product taste, and editor composition stay local.')).toBeInTheDocument()
    expect(screen.queryByText('Shared contract')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Assign to Looma' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/domain-responsibility'))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'Accept request' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/provider-accept'))).toBe(true))
  })

  it('surfaces bootstrap run failures without marking the project ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json({ preferredProvider: null, providers: {} })
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({ configured: true, needed: true, status: null, bootstrap: { commands: [], successGates: [], timeoutMs: 0 } })
      }
      if (url.pathname === '/api/project/bootstrap/run') return json({ error: 'pnpm install failed' }, 500)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    await userEvent.click(screen.getByRole('button', { name: /^run bootstrap$/i }))

    await screen.findByText('Bootstrap failed: pnpm install failed')
    expect(screen.getByText('pnpm install failed')).toBeInTheDocument()
  })

  it('shows active capability grants and revokes them from project settings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({ configured: true, needed: false, status: null, bootstrap: { commands: [], successGates: [], timeoutMs: 0 } })
      }
      if (url.pathname === '/api/project/capability-requests') {
        return json({
          requests: [{
            id: 'cap-task-fixtures-1',
            taskId: 'task-fixtures',
            reason: 'Need fixture reads.',
            status: 'approved',
            grant: {
              id: 'grant-task-fixtures-1',
              kind: 'mount_directory',
              hostPath: '/Users/matthew/git/fixtures',
              containerPath: '/mnt/guildhall-grants/grant-task-fixtures-1',
              access: 'read-only',
              duration: 'this task',
              status: 'active',
              evidence: 'Granted read-only mount.',
            },
          }],
          activeGrants: [{
            id: 'grant-task-fixtures-1',
            kind: 'mount_directory',
            hostPath: '/Users/matthew/git/fixtures',
            containerPath: '/mnt/guildhall-grants/grant-task-fixtures-1',
            access: 'read-only',
            duration: 'this task',
            status: 'active',
            evidence: 'Granted read-only mount.',
          }],
        })
      }
      if (url.pathname === '/api/project/capability-requests/cap-task-fixtures-1/revoke') {
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByText('/Users/matthew/git/fixtures')
    expect(screen.getByText('/mnt/guildhall-grants/grant-task-fixtures-1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/capability-requests/cap-task-fixtures-1/revoke'))).toBe(true)
    })
  })

  it('shows Re-intake Project in Memory and starts a re-intake draft', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: true, needed: false, status: null })
      if (url.pathname === '/api/project/capability-requests') return json({ requests: [], activeGrants: [] })
      if (url.pathname === '/api/project/learning') return json({ project: { suggestedLearnings: [] }, user: { suggestedLearnings: [] }, effective: { productSuggestions: [] }, projectSkillProposals: [], projectContext: {} })
      if (url.pathname === '/api/project/reintake/status') return json({ draftExists: false, status: null, summary: null })
      if (url.pathname === '/api/project/reintake/rerun') {
        expect(init?.method).toBe('POST')
        return json({ ok: true, draft: { summary: { reframed: 1, created: 2, archived: 0, merged: 0, kept: 0, preservedDone: 0 } } })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'learning' })

    await screen.findByRole('heading', { name: /memory controls/i })
    expect(screen.getByRole('heading', { name: 'Re-intake Project' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^start re-intake$/i }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/reintake/rerun'))).toBe(true)
    })
  })

  it('renders the re-intake review route and applies selected groups', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: true, needed: false, status: null })
      if (url.pathname === '/api/project/capability-requests') return json({ requests: [], activeGrants: [] })
      if (url.pathname === '/api/project/learning') return json({ project: { suggestedLearnings: [] }, user: { suggestedLearnings: [] }, effective: { productSuggestions: [] }, projectSkillProposals: [], projectContext: {} })
      if (url.pathname === '/api/project/reintake/status') return json({ draftExists: true, status: 'draft', summary: { reframed: 1, created: 1, archived: 0, merged: 0, kept: 0, preservedDone: 0 } })
      if (url.pathname === '/api/project/reintake/draft') {
        return json({
          status: 'draft',
          summary: { reframed: 1, created: 1, archived: 0, merged: 0, kept: 0, preservedDone: 0 },
          groups: [{
            id: 'evidence-work-graph',
            title: 'Rebuild task graph from current evidence',
            rationale: 'Structured evidence.',
            changes: [
              { kind: 'reframe', taskId: 'task-039', reason: 'Current evidence.', before: { title: 'Build AlertDialog primitive' }, after: { title: 'Build AlertDialog' } },
            ],
          }],
        })
      }
      if (url.pathname === '/api/project/reintake/apply') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ groupIds: ['evidence-work-graph'] })
        return json({ success: true, appliedGroups: 1 })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'reintake' })

    await screen.findByRole('heading', { name: /review re-intake draft/i })
    expect(screen.getByText('Rebuild task graph from current evidence')).toBeInTheDocument()
    expect(document.body.textContent?.toLowerCase()).not.toContain('reset')
    await userEvent.click(screen.getByRole('button', { name: /^apply selected$/i }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/reintake/apply'))).toBe(true)
    })
  })

  it('lets users start re-intake from the direct review route when no draft exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: true, needed: false, status: null })
      if (url.pathname === '/api/project/capability-requests') return json({ requests: [], activeGrants: [] })
      if (url.pathname === '/api/project/learning') return json({ project: { suggestedLearnings: [] }, user: { suggestedLearnings: [] }, effective: { productSuggestions: [] }, projectSkillProposals: [], projectContext: {} })
      if (url.pathname === '/api/project/reintake/status') return json({ draftExists: false, status: null, summary: null })
      if (url.pathname === '/api/project/reintake/draft') return json({ error: 'No re-intake draft found.' }, 404)
      if (url.pathname === '/api/project/reintake/rerun') {
        expect(init?.method).toBe('POST')
        return json({
          ok: true,
          draft: {
            status: 'draft',
            summary: { reframed: 0, created: 0, archived: 0, merged: 0, kept: 0, preservedDone: 0 },
            groups: [],
          },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'reintake' })

    await screen.findByRole('heading', { name: /start re-intake/i })
    await userEvent.click(screen.getByRole('button', { name: /^start re-intake$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/reintake/rerun'))).toBe(true)
    })
    expect(screen.getByText(/no changes proposed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^apply selected$/i })).not.toBeInTheDocument()
  })

  it('marks a re-intake draft applied after a successful apply instead of leaving stale draft actions visible', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: true, needed: false, status: null })
      if (url.pathname === '/api/project/capability-requests') return json({ requests: [], activeGrants: [] })
      if (url.pathname === '/api/project/learning') return json({ project: { suggestedLearnings: [] }, user: { suggestedLearnings: [] }, effective: { productSuggestions: [] }, projectSkillProposals: [], projectContext: {} })
      if (url.pathname === '/api/project/reintake/status') return json({ draftExists: true, status: 'draft', summary: { reframed: 1, created: 0, archived: 0, merged: 0, kept: 0, preservedDone: 0 } })
      if (url.pathname === '/api/project/reintake/draft') {
        return json({
          status: 'draft',
          summary: { reframed: 1, created: 0, archived: 0, merged: 0, kept: 0, preservedDone: 0 },
          groups: [{ id: 'stale-task', title: 'Reframe stale task', changes: [{ kind: 'reframe', taskId: 'task-old' }] }],
        })
      }
      if (url.pathname === '/api/project/reintake/apply') {
        expect(JSON.parse(String(init?.body))).toMatchObject({ groupIds: ['stale-task'] })
        return json({ success: true, appliedGroups: 1 })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'reintake' })

    await screen.findByRole('heading', { name: /review re-intake draft/i })
    await userEvent.click(screen.getByRole('button', { name: /^apply selected$/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/re-intake applied/i).length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('button', { name: /^apply selected$/i })).not.toBeInTheDocument()
  })

  it('explains workspace child-project gates without treating the root shell as the only app', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: false,
          needed: false,
          status: null,
          workspaceProjects: [
            {
              id: 'looma',
              label: 'Looma',
              path: 'looma',
              bootstrap: { commands: ['pnpm install'], successGates: ['pnpm test'], timeoutMs: 120000 },
            },
            {
              id: 'knit',
              label: 'Knit',
              path: 'knit',
              bootstrap: { commands: ['pnpm install'], successGates: ['pnpm typecheck'], timeoutMs: 120000 },
            },
          ],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('2 child projects')).toBeInTheDocument()
    expect(screen.getByText('This workspace coordinates child projects')).toBeInTheDocument()
    expect(screen.getByText(/The root shell is the council layer/)).toBeInTheDocument()
    expect(screen.getByText('Looma')).toBeInTheDocument()
    expect(screen.getByText('Knit')).toBeInTheDocument()
    expect(screen.getAllByText('1 gate')).toHaveLength(2)
  })

  it('counts bootstrap as ready when the project does not need bootstrap commands', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Fair Labor License', id: 'fair-labor-license' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: false,
          needed: false,
          status: null,
          workspaceProjects: [],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('3/3 ready')).toBeInTheDocument()
    expect(screen.getByText('not required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run bootstrap$/i })).not.toBeInTheDocument()
  })

  it('does not present local readiness as project-start readiness when a migration blocks the project', async () => {
    project.detail = {
      ...project.detail,
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'Run required Guildhall migration 0.8.0/project-state-layout before starting this project.',
        actionHref: '/migrations',
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Font Something', id: 'font-something' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: false,
          needed: false,
          status: null,
          workspaceProjects: [],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.queryByText('3/3 ready')).toBeNull()
    expect(screen.queryByText('Run required Guildhall migration 0.8.0/project-state-layout before starting this project.')).toBeNull()
    expect(screen.queryByText('Migrate project')).toBeNull()
  })

  it('shows pending migrations even when owner input is the primary start blocker', async () => {
    project.detail = {
      ...project.detail,
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Choose a recovery path for the blocked task',
        actionHref: '/task/task-stripe-connect-account-setup',
      },
    }
    const onMigrate = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Fair Labor License', id: 'fair-labor-license' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({ configured: false, needed: false, status: null, workspaceProjects: [] })
      }
      if (url.pathname === '/api/project/migrations') {
        return json({
          pending: [{ id: '0.8.0/codex-agent-bridge', title: 'Install bridge instructions' }],
          blocked: [
            { id: '0.8.0/project-state-layout', title: 'Move legacy project memory into split project state' },
            { id: '0.8.0/task-state-layout', title: 'Move legacy task state' },
          ],
          applied: [],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready', onMigrate })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.queryByText('Choose a recovery path for the blocked task')).toBeNull()
    expect(screen.getByText('3 pending Guildhall migrations will need review after the current blocker.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /review migrations/i }))
    expect(onMigrate).toHaveBeenCalledTimes(1)
  })

  it('does not count bootstrap as ready when a previous pass succeeded but must be rerun', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Narrative Harness', id: 'narrative-harness' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: true,
          needed: true,
          status: {
            success: true,
            lastRunAt: now,
            durationMs: 120,
            steps: [],
          },
          bootstrap: {
            commands: ['pnpm install'],
            successGates: ['pnpm build'],
            timeoutMs: 120000,
          },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('2/3 ready')).toBeInTheDocument()
    expect(screen.getAllByText('re-run needed')).toHaveLength(2)
    const rerunBootstrapButton = screen.getByRole('button', { name: /^run bootstrap$/i })
    expect(rerunBootstrapButton).toBeInTheDocument()
    expect(rerunBootstrapButton.classList.contains('v-agent')).toBe(true)
  })

  it('saves advanced identity, resets lever errors, and approves a design-system draft', async () => {
    const refresh = vi.spyOn(project, 'refresh').mockResolvedValue()
    let leverOverride = false
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
                  name: 'worktree_isolation',
                  position: 'per_task',
                  defaultPosition: 'per_task',
                  setBy: leverOverride ? 'user-direct' : 'system-default',
                  rationale: 'Use one isolated worktree per task.',
                  scope: 'project',
                },
                {
                  name: 'review_effort',
                  position: 'balanced',
                  defaultPosition: 'balanced',
                  setBy: 'system-default',
                  rationale: 'Use balanced review depth while calibration data accumulates.',
                  scope: 'domain:default',
                },
              ]
            : undefined,
        })
      }
      if (url.pathname === '/api/config/levers/reset') {
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/config/levers' && init?.method === 'POST') {
        leverOverride = true
        expect(JSON.parse(String(init.body))).toMatchObject({
          scope: 'project',
          name: 'worktree_isolation',
          position: 'per_attempt',
        })
        return json({
          levers: [
            {
              name: 'worktree_isolation',
              position: 'per_attempt',
              defaultPosition: 'per_task',
              setBy: 'user-direct',
              rationale: 'Set from project settings.',
              scope: 'project',
            },
          ],
        })
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
      if (url.pathname === '/api/project/design-system/discovery') {
        return json({
          primarySystem: 'looma',
          preview: { adapter: 'storybook', summary: 'Storybook preview detected.' },
          libraries: [{ id: 'looma', label: 'Looma', role: 'foundation' }],
          tokenFiles: ['src/web/tokens.css'],
          componentFiles: ['src/web/lib/Button.svelte'],
          proofContract: { targetDesignSystem: 'looma', componentIntents: ['Button'] },
          recommendations: ['Looma is available as the project design-system foundation.'],
        })
      }
      if (url.pathname === '/api/project/design-feedback') {
        return json({
          feedback: {
            findings: [{ id: 'finding-filter-state' }],
            decisions: [],
            ownerFeedback: [{
              summary: 'Show all should read as a filter choice.',
              status: 'accepted',
            }],
            decisionPackets: [{
              summary: 'Accepted owner feedback ready for implementation/review.',
            }],
            candidates: [{
              summary: 'Segmented filter selected state is unclear in compact mobile layouts.',
              targetDesignSystem: 'looma',
              status: 'queued',
            }],
            loomaImprovements: [{
              summary: 'Segmented filter selected state is unclear in compact mobile layouts.',
              targetPackage: 'core',
              status: 'queued',
            }],
          },
          loomaHook: {
            enabled: false,
            status: 'inactive',
            reason: 'Experimental local Looma development is not configured.',
          },
        })
      }
      if (url.pathname === '/api/project/design-taste') {
        return json({
          summary: 'Interaction: mutually exclusive modes use segmented-control-or-tabs. palette semantic-oklch-roles with controlled saturation. Visual direction: warm-functional-polish.',
          taste: {
            opinions: {
              interactionSemantics: {
                mutuallyExclusiveModes: 'segmented-control-or-tabs',
                oneShotCommand: 'button',
              },
              paletteStrategy: {
                defaultMode: 'semantic-oklch-roles',
                saturationBudget: 'controlled',
                avoid: ['all-purple-gradient-app'],
              },
              visualDirection: {
                default: 'warm-functional-polish',
                avoid: ['tiny-unexplained-controls'],
              },
            },
            patternRecipes: {
              filterModes: { preferred: 'segmented-control' },
            },
          },
          layers: [
            { id: 'builtin', label: 'Guildhall defaults', applied: true },
            { id: 'user', label: 'User overrides', applied: false },
            { id: 'project', label: 'Project overrides', applied: true },
          ],
        })
      }
      if (url.pathname === '/api/project/design-system/catalog') {
        return json({
          previewAdapter: 'storybook',
          interactable: true,
          entries: [
            {
              id: 'storybook-src-web-lib-button-stories-ts',
              kind: 'component',
              title: 'Button',
              source: 'storybook',
              previewUrl: '/iframe.html?path=/story/button',
            },
          ],
          recommendations: ['Storybook is the preferred interactable catalog for this web project.'],
        })
      }
      if (url.pathname === '/api/project/design-intent-surrogate') {
        return json({
          platform: 'ios',
          previewMode: 'browser-surrogate',
          approximate: true,
          label: 'Preview approximation: this rendering proves design intent and state coverage.',
          warning: 'Native platform proof still needs simulator/device screenshots before release.',
          nativeProofRequired: true,
          detectedNativeTooling: ['swiftui-preview', 'xcodeproj'],
          componentIntents: ['segmented-filter'],
          recommendations: ['Use the browser surrogate for fast owner feedback on hierarchy, palette, spacing, states, and interaction semantics.'],
        })
      }
      if (url.pathname === '/api/project/design-system/approve') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/codebase-map/status') {
        return json(codebaseMapStatus({
          configured: true,
          generatedAt: now,
          counts: { files: 121, areas: 8, abstractions: 5 },
          project: {
            summary: 'Local project with Svelte workers and documentation.',
            languages: ['typescript', 'svelte'],
            packageManagers: ['pnpm'],
            primaryFrameworks: ['svelte'],
          },
          entrypoints: [
            { kind: 'readme', path: 'README.md', summary: 'Repository overview.' },
          ],
          areas: [
            {
              id: 'web-ui',
              title: 'Web UI',
              summary: 'Project view and task surfaces.',
              owns: ['src/web/**'],
              canonicalFiles: [{ path: 'src/web/surfaces/ProjectView.svelte', symbols: [], summary: 'Project shell.' }],
              conventions: ['Keep task cards readable.'],
              tests: ['src/web/surfaces/__tests__/ProjectView.svelte.test.ts'],
            },
          ],
          abstractions: [
            {
              id: 'button',
              title: 'Button',
              kind: 'component',
              canonicalPath: 'packages/ui/src/components/Button.svelte',
              useWhen: ['Use for click actions instead of local button styling.'],
              avoid: ['Do not invent one-off button treatments.'],
              related: ['src/web/lib/Button.svelte'],
            },
          ],
          semantic: {
            modelId: 'zai-org/GLM-4.6',
            corpusKind: 'documentation',
            confidence: 0.95,
            projectPurpose: 'Documentation-led product specification.',
            currentTruth: ['Thread cards should be readable without opening details.'],
            architectureAreas: [{
              name: 'Thread UI',
              purpose: 'Shows current work and user decisions.',
              canonicalFiles: ['src/web/surfaces/project/ThreadTab.svelte'],
            }],
            canonicalAbstractions: [{
              name: 'Task drawer',
              purpose: 'Details for one task.',
              canonicalFiles: ['src/web/surfaces/TaskDrawer.svelte'],
              reuseRule: 'Open the drawer for details; keep thread cards scannable.',
            }],
            gapsOrRisks: ['Some older tasks still use opaque internal wording.'],
            readNext: [{ path: 'docs/architecture.md', reason: 'Canonical architecture note.' }],
            workerGuidance: ['Read the semantic map before editing.'],
            needsBroaderRead: true,
          },
          designSystem: {
            maturity: 'thin',
            approved: true,
            tokenCounts: { color: 2, spacing: 2, typography: 0, radius: 1, shadow: 0 },
            primitives: 1,
            recommendations: ['UI surface area is larger than the captured token/primitive set.'],
          },
          frameworks: ['svelte'],
          packageManagers: ['pnpm'],
        }))
      }
      if (url.pathname === '/api/project/codebase-map/refresh') {
        expect(init?.method).toBe('POST')
        return json({
          ok: true,
          mode: 'full',
          status: codebaseMapStatus({
            configured: true,
            generatedAt: now,
            counts: { files: 122, areas: 8, abstractions: 6 },
          }),
        })
      }
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
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
    await screen.findByText(/Worktree isolation/i)
    await screen.findByText(/Review effort/i)
    expect(screen.getByRole('option', { name: /Release-critical/i })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /worktree isolation setting/i }), 'per_attempt')
    await screen.findByText(/Current: Per attempt/)

    await screen.findByRole('heading', { name: 'Codebase map' })
    expect(screen.getByText('121')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('thin')).toBeInTheDocument()
    expect(screen.getByText('documentation')).toBeInTheDocument()
    expect(screen.getByText('Local project with Svelte workers and documentation.')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('zai-org/GLM-4.6')).toBeInTheDocument()
    expect(screen.getByText('Documentation-led product specification.')).toBeInTheDocument()
    expect(screen.getByText('Thread cards should be readable without opening details.')).toBeInTheDocument()
    expect(screen.getByText('docs/architecture.md')).toBeInTheDocument()
    expect(screen.getByText(/Read the semantic map before editing/i)).toBeInTheDocument()
    expect(screen.getByText('Web UI')).toBeInTheDocument()
    expect(screen.getByText('Project view and task surfaces.')).toBeInTheDocument()
    expect(screen.getAllByText('Button').length).toBeGreaterThan(0)
    expect(screen.getByText('packages/ui/src/components/Button.svelte')).toBeInTheDocument()
    expect(screen.getByText('Thread UI')).toBeInTheDocument()
    expect(screen.getByText('Task drawer')).toBeInTheDocument()
    expect(screen.getByText('Some older tasks still use opaque internal wording.')).toBeInTheDocument()
    expect(screen.getByText('UI surface area is larger than the captured token/primitive set.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /refresh map/i }))
    await screen.findByText('122')

    await screen.findByText('Revision 2')
    expect(screen.getByText('Foundation')).toBeInTheDocument()
    expect(screen.getByText('storybook')).toBeInTheDocument()
    expect(screen.getByText('Looma is available as the project design-system foundation.')).toBeInTheDocument()
    expect(screen.getByText('Owner feedback')).toBeInTheDocument()
    expect(screen.getByText('Decision packets')).toBeInTheDocument()
    expect(screen.getByText('Reusable candidates')).toBeInTheDocument()
    expect(screen.getByText('Looma follow-ups')).toBeInTheDocument()
    expect(screen.getByText('Taste memory')).toBeInTheDocument()
    expect(screen.getByText('warm-functional-polish')).toBeInTheDocument()
    expect(screen.getByText('segmented-control-or-tabs')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 layers')).toBeInTheDocument()
    expect(screen.getByText('Catalog')).toBeInTheDocument()
    expect(screen.getByText('storybook · 1 item')).toBeInTheDocument()
    expect(screen.getByText('Intent preview')).toBeInTheDocument()
    expect(screen.getByText('ios · browser-surrogate')).toBeInTheDocument()
    expect(screen.getByText('Native proof')).toBeInTheDocument()
    expect(screen.getByText('required')).toBeInTheDocument()
    expect(screen.getByText('Native platform proof still needs simulator/device screenshots before release.')).toBeInTheDocument()
    expect(screen.getByText('looma follow-up')).toBeInTheDocument()
    expect(screen.getByText('Segmented filter selected state is unclear in compact mobile layouts.')).toBeInTheDocument()
    expect(screen.getByText('Local hook inactive')).toBeInTheDocument()
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
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
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
            workspaceImport: {
              approvedRuns: 2,
              dismissedRuns: 0,
              averageTaskAcceptanceRatio: 1,
              updatedAt: now,
            },
            suggestedLearnings: [
              {
                id: 'learn-1',
                summary: 'Run Knit typecheck from web root after API changes.',
                destination: 'project_memory',
                scope: 'project',
                confidence: 'high',
                risk: 'medium',
                status: accepted ? 'active' : 'suggested',
                evidence: [{
                  summary: 'The workspace members task failed until the scoped typecheck was rerun.',
                  links: [{
                    kind: 'task',
                    label: 'Open task evidence',
                    href: '/task/task-link-editor',
                    localHistoryRef: 'transcripts/exploring/task-link-editor.md',
                  }],
                }],
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
            workspaceImport: {
              approvedRuns: 2,
              dismissedRuns: 0,
              averageTaskAcceptanceRatio: 1,
              updatedAt: now,
            },
            productSuggestions: [
              {
                id: 'product-1',
                title: 'Make outline-first task shaping explicit',
                summary: 'Ask coordinators to draft structure before implementation.',
                evidence: ['Navigation work needed a stable outline before UI fill-in.'],
              },
            ],
          },
          projectContext: {
            projectBrief: { present: true, nonEmptyLines: 2 },
            workspaceGoals: { present: true, goalCount: 1 },
            decisions: { present: true, nonEmptyLines: 9 },
            projectNotes: { present: true, nonEmptyLines: 0 },
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

    await screen.findByRole('heading', { name: /memory controls/i })
    expect(screen.getByText('0 in use')).toBeInTheDocument()
    expect(screen.getByText('3 waiting')).toBeInTheDocument()
    expect(screen.getByText('Project context Guildhall already has')).toBeInTheDocument()
    expect(screen.getByText('Project brief')).toBeInTheDocument()
    expect(screen.getByText('Workspace goals')).toBeInTheDocument()
    expect(screen.getByText('Import choices')).toBeInTheDocument()
    expect(screen.getByText('Decision log')).toBeInTheDocument()
    expect(screen.getByText('Recent memory use')).toBeInTheDocument()
    expect(screen.getByText('task-link-editor')).toBeInTheDocument()
    expect(screen.getByText('2 included')).toBeInTheDocument()
    expect(screen.getByText('1 withheld')).toBeInTheDocument()
    expect(screen.getByText('2 approved')).toBeInTheDocument()
    expect(screen.getByText('1 goal')).toBeInTheDocument()
    expect(screen.getByText('Run Knit typecheck from web root after API changes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open task evidence/i })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-link-editor',
    )
    expect(screen.getByText('Project memory')).toBeInTheDocument()
    expect(screen.getByText('Strong signal')).toBeInTheDocument()
    expect(screen.getByText('Needs care')).toBeInTheDocument()
    expect(screen.getByText('Prefer sentence-case project titles.')).toBeInTheDocument()
    expect(screen.getByText('Workspace API repair playbook')).toBeInTheDocument()
    expect(screen.getByText('workspace')).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByText('Make outline-first task shaping explicit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /give product feedback/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /use this/i }))
    await screen.findByText('1 in use')
    expect(screen.getByText('2 waiting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /use playbook/i }))
    await screen.findByText('2 in use')
  })
})
