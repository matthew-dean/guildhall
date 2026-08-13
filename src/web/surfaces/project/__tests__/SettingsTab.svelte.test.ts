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
  path.href = '/projects/looma-knit/settings'
  project.error = null
  project.detail = {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/workspace/looma-knit',
    tasks: [],
    config: {
      coordinators: [{
        id: 'editor-coordinator',
        name: 'Editor coordinator',
        domain: 'Editor',
        mandate: 'Keep editor work scoped.',
      }],
    },
  }
}

function lever(name: string, position: string, setBy = 'system-default', scope = 'project') {
  return {
    scope,
    name,
    position,
    defaultPosition: position,
    rationale: `${name} rationale`,
    setBy,
  }
}

function codebaseMapStatus(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    generatedAt: now,
    stale: null,
    counts: { files: 42, areas: 5, abstractions: 7 },
    project: {
      summary: 'Guildhall web runtime.',
      languages: ['TypeScript'],
      packageManagers: ['pnpm'],
      primaryFrameworks: ['Svelte'],
    },
    semantic: {
      modelId: 'text-embedding-3-small',
      corpusKind: 'code',
      confidence: 0.8,
      projectPurpose: 'Coordinate agent work.',
      currentTruth: ['Settings is now compact.'],
      readNext: [{ path: 'src/web/surfaces/project/SettingsTab.svelte', reason: 'Composition shell.' }],
      workerGuidance: [],
      needsBroaderRead: false,
    },
    ...overrides,
  }
}

function runtimeStatus(overrides: Record<string, unknown> = {}) {
  return {
    backend: 'podman',
    status: 'ready',
    message: 'Runtime is ready.',
    platform: 'darwin',
    supportedHost: true,
    dockerPath: null,
    dockerVersion: null,
    podmanPath: '/opt/homebrew/bin/podman',
    podmanVersion: 'podman version 5.0.0',
    homebrewPath: '/opt/homebrew/bin/brew',
    compatibilityModeLabel: 'Host-run compatibility',
    runtimes: {
      docker: { status: 'missing', path: null, version: null },
      podman: {
        status: 'ready',
        path: '/opt/homebrew/bin/podman',
        version: 'podman version 5.0.0',
        machine: { exists: true, name: 'guildhall', running: true },
      },
    },
    nonContainerExecution: { allowed: false, source: 'default' },
    machine: { exists: true, name: 'guildhall', running: true },
    actions: [],
    ...overrides,
  }
}

function installFetch(options: {
  initialized?: boolean
  levers?: Array<Record<string, unknown>>
  migrations?: Record<string, unknown>
  bootstrap?: Record<string, unknown>
  capability?: Record<string, unknown>
  runtime?: Record<string, unknown>
  worktreeIncludes?: Record<string, unknown>
  designSystem?: Record<string, unknown> | null
  designFeedback?: Record<string, unknown> | null
  reintakeStatus?: Record<string, unknown>
} = {}) {
  let currentBootstrap = options.bootstrap ?? {
    configured: true,
    needed: false,
    status: null,
    bootstrap: {
      commands: ['pnpm install'],
      successGates: ['pnpm test'],
      timeoutMs: 120000,
    },
    workspaceProjects: [],
  }
  let currentLevers = options.levers ?? [
    lever('landing_strategy', 'cherry_pick_local'),
    lever('task_origination', 'agent_proposed_coordinator_approved', 'system-default', 'domain:default'),
    lever('completion_approval', 'coordinator_sufficient', 'system-default', 'domain:default'),
  ]
  let currentWorktree = options.worktreeIncludes ?? {
    include: ['.env.local'],
    candidates: [
      { path: '.env.local', reason: 'Local env file', selected: true },
      { path: 'appsettings.local.yaml', reason: 'Local app settings', selected: false },
    ],
    scopes: [{
      projectId: 'looma-knit',
      label: 'Looma + Knit',
      rootPath: '/workspace/looma-knit',
      include: ['.env.local'],
      candidates: [{ path: 'appsettings.local.yaml', reason: 'Local app settings', selected: false }],
    }],
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'

    if (url.pathname === '/api/setup/status') {
      return json({
        initialized: options.initialized ?? true,
        name: 'Looma + Knit',
        id: 'looma-knit',
      })
    }
    if (url.pathname === '/api/project') return json(project.detail ?? {})
    if (url.pathname === '/api/setup/providers') {
      return json({
        preferredProvider: 'openai-api',
        providers: {
          'openai-api': {
            label: 'Remote OpenAI-compatible',
            detected: true,
            detail: 'Stored globally.',
            verifiedAt: now,
          },
        },
      })
    }
    if (url.pathname === '/api/project/bootstrap/status') return json(currentBootstrap)
    if (url.pathname === '/api/project/bootstrap/run') {
      expect(method).toBe('POST')
      currentBootstrap = {
        configured: true,
        needed: false,
        status: {
          success: true,
          lastRunAt: now,
          durationMs: 1200,
          steps: [],
        },
        bootstrap: {
          commands: ['pnpm install'],
          successGates: ['pnpm test'],
          timeoutMs: 120000,
        },
      }
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
    if (url.pathname === '/api/project/runtime/setup') return json(runtimeStatus(options.runtime ?? {}))
    if (url.pathname === '/api/project/capability-requests') {
      if (method === 'GET') {
        return json(options.capability ?? {
          requests: [{
            id: 'request-editor-fixture',
            taskId: 'task-1',
            reason: 'Need fixture data.',
            status: 'approved',
            grant: {
              id: 'grant-editor-fixture',
              kind: 'mount_directory',
              hostPath: '/Users/matthew/fixture',
              containerPath: '/workspace/fixture',
              access: 'read-only',
              duration: 'session',
              status: 'active',
              evidence: 'Approved for a focused test.',
            },
          }],
          activeGrants: [{
            id: 'grant-editor-fixture',
            kind: 'mount_directory',
            hostPath: '/Users/matthew/fixture',
            containerPath: '/workspace/fixture',
            access: 'read-only',
            duration: 'session',
            status: 'active',
            evidence: 'Approved for a focused test.',
          }],
        })
      }
    }
    if (url.pathname === '/api/project/capability-requests/request-editor-fixture/revoke') {
      expect(method).toBe('POST')
      return json({ ok: true })
    }
    if (url.pathname === '/api/project/migrations') {
      return json(options.migrations ?? {
        projectRoot: '/workspace/looma-knit',
        blocked: [],
        pending: [],
        applied: [],
      })
    }
    if (url.pathname === '/api/project/worktree-includes') {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        currentWorktree = { ...currentWorktree, include: String(body.includeText ?? '').split(/\r?\n/).filter(Boolean) }
        return json({ include: currentWorktree.include })
      }
      return json(currentWorktree)
    }
    if (url.pathname === '/api/setup/identity') {
      expect(method).toBe('POST')
      return json({ ok: true })
    }
    if (url.pathname === '/api/config/levers') {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        currentLevers = currentLevers.map(item => item.name === body.name && item.scope === body.scope
          ? { ...item, position: body.position ?? item.defaultPosition, setBy: body.position ? 'user-direct' : 'system-default' }
          : item)
      }
      return json({ levers: currentLevers })
    }
    if (url.pathname === '/api/config/levers/reset') {
      currentLevers = currentLevers.map(item => ({ ...item, setBy: 'system-default' }))
      return json({ levers: currentLevers })
    }
    if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
    if (url.pathname === '/api/project/codebase-map/refresh') return json({ status: codebaseMapStatus({ generatedAt: '2026-05-19T17:00:00.000Z' }) })
    if (url.pathname === '/api/project/design-system') {
      return json({ designSystem: options.designSystem ?? {
        revision: 2,
        authoredAt: now,
        primitives: [{ name: 'FrameCard', usage: 'Panel frame' }],
        tokens: { color: ['accent'], spacing: ['2'], typography: [], radius: [], shadow: [] },
        copyVoice: { tone: 'plain' },
      } })
    }
    if (url.pathname === '/api/project/design-system/approve') return json({ ok: true })
    if (url.pathname === '/api/project/design-feedback') {
      return json({ feedback: options.designFeedback ?? {
        findings: [{}],
        ownerFeedback: [{}],
        decisionPackets: [{}],
        candidates: [{ targetDesignSystem: 'packages/ui', summary: 'Promote compact setting rows.' }],
      } })
    }
    if (url.pathname === '/api/project/reintake/status') {
      return json(options.reintakeStatus ?? { draftExists: true, status: 'draft' })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('SettingsTab', () => {
  beforeEach(() => {
    installProjectState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    cleanup()
    project.detail = null
    project.error = null
  })

  it('keeps Settings as a small shell and routes obsolete graph subviews to Map', async () => {
    installFetch()
    render(SettingsTab, { subView: 'graph' })

    expect(await screen.findByText('Map review moved out of Settings')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open Map' }))

    expect(path.value).toBe('/projects/looma-knit/map')
  })

  it('shows initialization guidance before project setup is complete', async () => {
    installFetch({ initialized: false })
    render(SettingsTab, { subView: 'ready' })

    expect(await screen.findByText('Project not initialized yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open setup wizard' })).toBeInTheDocument()
  })

  it('runs readiness bootstrap and revokes active folder grants', async () => {
    const fetchMock = installFetch()
    render(SettingsTab, { subView: 'ready' })

    expect(await screen.findByRole('heading', { name: 'Ready to start?' })).toBeInTheDocument()
    expect(await screen.findByText('Remote OpenAI-compatible')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Run bootstrap' }))
    expect(await screen.findByText('Bootstrap verified (pnpm): test, build')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/bootstrap/run'))).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/request-editor-fixture/revoke'))).toBe(true))
  })

  it('does not show recovery actions when the local runtime is already ready', async () => {
    installFetch()
    render(SettingsTab, { subView: 'ready' })

    expect(await screen.findByRole('heading', { name: 'Local runtime' })).toBeInTheDocument()
    expect(await screen.findByText('podman version 5.0.0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use host-run compatibility' })).not.toBeInTheDocument()
    expect(screen.getByText('blocked by default')).toBeInTheDocument()
    expect(screen.queryByText(/available because config explicitly allows host execution/i)).not.toBeInTheDocument()
  })

  it('only mentions host-run compatibility when config explicitly allows it', async () => {
    installFetch({
      runtime: {
        backend: 'none',
        status: 'missing',
        message: 'No container runtime is ready. Host-run is allowed by config.',
        dockerPath: null,
        dockerVersion: null,
        podmanPath: null,
        podmanVersion: null,
        runtimes: {
          docker: { status: 'missing', path: null, version: null },
          podman: {
            status: 'missing',
            path: null,
            version: null,
            machine: { exists: false, name: null, running: false },
          },
        },
        nonContainerExecution: { allowed: true, source: 'project' },
        machine: { exists: false, name: null, running: false },
        actions: [
          {
            id: 'install-instructions',
            label: 'Install Docker or Podman',
            description: 'Install Docker Desktop or Podman, then check local runtime setup again.',
            mutatesHost: false,
            requiresApproval: false,
          },
          {
            id: 'retry-detection',
            label: 'Check again',
            description: 'Check local runtime setup again.',
            mutatesHost: false,
            requiresApproval: false,
          },
          {
            id: 'use-host-run-compatibility',
            label: 'Use host-run compatibility',
            description: 'Keep running commands directly on this Mac until the container runtime is ready.',
            mutatesHost: false,
            requiresApproval: false,
          },
        ],
      },
    })
    render(SettingsTab, { subView: 'ready' })

    expect(await screen.findByRole('heading', { name: 'Local runtime' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Install Docker or Podman' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use host-run compatibility' })).toBeInTheDocument()
    expect(screen.getByText(/available because config explicitly allows host execution/i)).toBeInTheDocument()
  })

  it('keeps coordinator routing as a focused settings panel', async () => {
    installFetch()
    render(SettingsTab, { subView: 'coordinators' })

    expect(await screen.findByRole('heading', { name: 'Coordinators' })).toBeInTheDocument()
    expect(screen.getByText('Editor coordinator')).toBeInTheDocument()
    expect(screen.getByText('Keep editor work scoped.')).toBeInTheDocument()
  })

  it('saves identity and task-worktree include settings from the identity panel', async () => {
    const fetchMock = installFetch()
    render(SettingsTab, { subView: 'identity' })

    const nameInput = await screen.findByLabelText('Workspace name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Looma Studio')
    await userEvent.click(screen.getByRole('button', { name: 'Save identity' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/setup/identity'))).toBe(true))
    const identityCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/setup/identity'))!
    expect(JSON.parse(String(identityCall[1]?.body))).toMatchObject({ name: 'Looma Studio', id: 'looma-knit' })

    await userEvent.click(screen.getByRole('button', { name: 'appsettings.local.yaml' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save worktree files' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/api/project/worktree-includes') && init?.method === 'POST')).toBe(true))
    const includeCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes('/api/project/worktree-includes') && init?.method === 'POST')!
    expect(JSON.parse(String(includeCall[1]?.body)).includeText).toContain('appsettings.local.yaml')
  })

  it('summarizes operating profiles and changed overrides', async () => {
    installFetch({
      levers: [
        lever('reviewer_fanout_policy', 'strict', 'system-default', 'domain:default'),
        lever('review_effort', 'release_critical', 'user-direct', 'domain:default'),
        lever('completion_approval', 'human_required', 'user-direct', 'domain:default'),
        lever('pre_rejection_policy', 'requeue_with_dampening', 'system-default', 'domain:default'),
      ],
    })

    render(SettingsTab, { subView: 'profile' })

    expect(await screen.findByRole('heading', { name: 'Operating profile' })).toBeInTheDocument()
    expect((await screen.findAllByText('Release hardening')).length).toBeGreaterThan(0)
    expect(screen.getByText('2 overrides')).toBeInTheDocument()
    expect(screen.getByText('Review Effort')).toBeInTheDocument()
  })

  it('contains developer-only levers, migrations, codebase map, design, and re-intake diagnostics', async () => {
    const onMigrate = vi.fn()
    const fetchMock = installFetch({
      migrations: {
        projectRoot: '/workspace/looma-knit',
        blocked: [{ id: '0.10.0/merge-policy-to-landing-strategy' }],
        pending: [],
        applied: [],
      },
      levers: [
        lever('landing_strategy', 'cherry_pick_local'),
        lever('review_effort', 'balanced', 'system-default', 'domain:default'),
      ],
    })
    render(SettingsTab, { subView: 'developer', onMigrate })

    expect(await screen.findByRole('heading', { name: 'Developer tools' })).toBeInTheDocument()
    expect(screen.getByText('Project migrations')).toBeInTheDocument()
    expect(screen.getByText('Raw behavior levers')).toBeInTheDocument()
    expect(screen.getByText('Codebase map')).toBeInTheDocument()
    expect(screen.getByText('Design feedback')).toBeInTheDocument()
    expect(screen.getByText('Re-intake status')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Review migrations' }))
    expect(onMigrate).toHaveBeenCalledTimes(1)

    await userEvent.selectOptions(await screen.findByLabelText('Landing Strategy setting'), 'manual_pr')
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/api/config/levers') && init?.method === 'POST')).toBe(true))
    const leverCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes('/api/config/levers') && init?.method === 'POST')!
    expect(JSON.parse(String(leverCall[1]?.body))).toMatchObject({
      scope: 'project',
      name: 'landing_strategy',
      position: 'manual_pr',
    })
  })
})
