// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectView from '../ProjectView.svelte'
import { path } from '../../lib/nav.svelte.js'
import { project } from '../../lib/project.svelte.js'
import type { ProjectDetail, ProjectView as ProjectViewName } from '../../lib/types.js'

const now = '2026-05-19T15:00:00.000Z'

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-link-editor',
    title: 'Knit: add link editor controls',
    description: 'Let editors create links without leaving the writing flow.',
    status: 'ready',
    domain: 'Editor',
    priority: 'high',
    acceptanceCriteria: [
      { description: 'URL and display text controls are present.' },
      { description: 'The editor can remove an existing link.' },
    ],
    openQuestions: [],
    escalations: [],
    notes: [],
    updatedAt: now,
    ...overrides,
  }
}

function detail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/workspace/looma-knit',
    config: {
      coordinators: [
        {
          id: 'editor-coordinator',
          name: 'Editor coordinator',
          domain: 'Editor',
          mandate: 'Keep authoring work coherent.',
          concerns: [{ id: 'scope', description: 'Scope stays clear.' }],
        },
      ],
    },
    tasks: [
      task(),
      task({
        id: 'task-blocked',
        title: 'Fix mobile toolbar',
        status: 'blocked',
        blockReason: 'Needs user decision',
        escalations: [{ id: 'esc-1', summary: 'Needs user decision' }],
      }),
      task({
        id: 'task-done',
        title: 'Document editor model',
        status: 'done',
        terminalSummary: { headline: 'Documented', detail: 'Model notes landed.' },
      }),
    ],
    run: {
      status: 'stopped',
      mode: 'continuous',
      stopSummary: {
        stopReason: 'awaiting_human',
        stopMessage: 'Waiting on input.',
        idleSummary: { counts: { waitingOnUser: 1, done: 1, blocked: 1 } },
      },
    },
    startReadiness: { canStart: true, message: 'Ready' },
    providerStatus: {
      fallback: true,
      health: {
        pooled: true,
        state: 'healthy',
        consecutiveFailures: 0,
        retryableFailures: 0,
        fatalFailures: 0,
      },
      decisions: [
        {
          code: 'fallback',
          severity: 'warn',
          basis: 'availability',
          message: 'Preferred provider unavailable; using fallback.',
        },
      ],
    },
    bootstrapStatus: { success: true, verifiedAt: now, steps: [] },
    recentEvents: [
      {
        at: now,
        event: {
          type: 'task_transition',
          task_id: 'task-link-editor',
          to_status: 'ready',
          agent_name: 'coordinator',
        },
      },
    ],
    ...overrides,
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installBrowserFakes() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  window.localStorage.clear()
  window.history.replaceState({}, '', '/projects/looma-knit/thread')
  path.value = '/projects/looma-knit/thread'
}

function installFetchFakes() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/project') return json(detail())
    if (url.pathname === '/api/project/inbox') {
      return json({
        blockers: { bootstrap: false, workspaceImport: false },
        items: [
          {
            id: 'inbox-question',
            kind: 'question',
            severity: 'high',
            title: 'Choose link editor scope',
            body: 'The coordinator needs a scope decision.',
            actionLabel: 'Open Thread',
            actionHref: '/projects/looma-knit/thread',
          },
        ],
      })
    }
    if (url.pathname === '/api/project/thread') {
      return json({
        turns: [
          {
            kind: 'agent_question',
            id: 'turn-question',
            at: now,
            persona: 'coord',
            status: 'active',
            phase: 'blocked',
            taskId: 'task-link-editor',
            taskTitle: 'Knit: add link editor controls',
            taskDescription: 'Let editors create links without leaving the writing flow.',
            question: {
              kind: 'choice',
              id: 'q-link-controls',
              askedBy: 'coordinator',
              askedAt: now,
              prompt: 'Which controls belong in the link editor?',
              choices: ['URL input + Display text input', 'URL input only'],
            },
          },
        ],
        activeTurnId: 'turn-question',
      })
    }
    if (url.pathname.includes('/stage-answer')) return json({ ok: true })
    if (url.pathname.includes('/answer-question')) return json({ ok: true })
    if (url.pathname === '/api/project/start') return json({ ok: true })
    if (url.pathname === '/api/project/stop') return json({ ok: true })
    if (url.pathname === '/api/project/local-config') {
      return json({
        config: {
          projectId: 'looma-knit',
          worktreeIsolation: 'worktree',
          concurrentTaskDispatch: 'sequential',
        },
        effective: {
          projectId: 'looma-knit',
          worktreeIsolation: 'worktree',
          concurrentTaskDispatch: 'sequential',
        },
      })
    }
    if (url.pathname === '/api/project/facts') {
      return json({
        identity: {
          name: 'Looma + Knit',
          id: 'looma-knit',
          path: '/workspace/looma-knit',
          editHref: '/projects/looma-knit/setup',
        },
        environment: {
          packageManagers: ['pnpm'],
          verifiedAt: now,
          install: {},
          gates: {
            test: { command: 'pnpm test', available: true },
            build: { command: 'pnpm build', available: true },
          },
          editHref: '/projects/looma-knit/settings',
        },
        workspace: {
          goals: { imported: true, dismissed: false, goalCount: 1, taskCount: 3, milestoneCount: 1 },
          reviewHref: '/projects/looma-knit/notifications',
        },
        coordinators: {
          count: 1,
          list: [{ id: 'editor-coordinator', domain: 'Editor' }],
          editHref: '/projects/looma-knit/settings',
        },
        designSystem: {
          summary: 'Tokens and editor controls are documented.',
          editHref: '/projects/looma-knit/settings',
        },
      })
    }
    if (url.pathname === '/api/project/workspace-import/review') {
      return json({
        detected: { review: { sourceGroups: [] } },
        learned: {},
      })
    }
    if (url.pathname === '/api/project/release-readiness') {
      return json({
        openEscalations: [],
        unapprovedBriefs: [],
        unapprovedSpecs: [],
        shelvedUnclaimed: [],
        blockedByAgent: [],
        designSystem: { drafted: true, approved: true, revision: 1 },
        statusCounts: { ready: 1, blocked: 1, done: 1 },
        totals: { blockingCount: 0, tasks: 3, done: 1 },
      })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function renderProjectView(
  view: ProjectViewName,
  sub: string | null = null,
  projectId: string | null = 'looma-knit',
  initialDetail: ProjectDetail = detail(),
) {
  project.detail = initialDetail
  project.error = null
  render(ProjectView, { initialView: view, initialSub: sub, projectId })
  await waitFor(() => expect(screen.getByText('Looma + Knit')).toBeInTheDocument())
}

function installMobileBrowserFakes() {
  let changeHandler: ((event: MediaQueryListEvent) => void) | null = null
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn((event: string, handler: (ev: MediaQueryListEvent) => void) => {
        if (event === 'change') changeHandler = handler
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
  return {
    setMatches(matches: boolean) {
      changeHandler?.({ matches } as MediaQueryListEvent)
    },
  }
}

describe('ProjectView', () => {
  beforeEach(() => {
    installBrowserFakes()
    installFetchFakes()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    project.detail = null
    project.error = null
  })

  it('keeps task questions inside Thread and answers without opening the details pane', async () => {
    const user = userEvent.setup()
    const fetchMock = installFetchFakes()

    await renderProjectView('thread')
    await screen.findByText('Which controls belong in the link editor?')

    await user.click(screen.getByRole('button', { name: 'URL input only' }))

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/project/task/task-link-editor/answer-questions'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it.each([
    ['inbox', 'Choose link editor scope'],
    ['work', 'Knit: add link editor controls'],
    ['planner', 'Knit: add link editor controls'],
    ['timeline', 'Coordinator timeline'],
    ['release', 'Release'],
    ['settings', 'Settings'],
    ['workspace-import', 'Review existing project work'],
    ['facts', 'Project facts'],
  ] as Array<[ProjectViewName, string]>)('renders the %s project surface from the project shell', async (view, expectedText) => {
    await renderProjectView(view)

    expect(screen.getAllByText(expectedText).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Start|Stop/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/notifications need you/i)).toBeInTheDocument()
  })

  it('canonicalizes legacy project routes to the explicit project slug', async () => {
    path.value = '/project/thread'
    window.history.replaceState({}, '', '/project/thread')

    await renderProjectView('thread', null, null)

    await waitFor(() => expect(path.value).toBe('/projects/looma-knit/thread'))
  })

  it('starts a continuous run and keeps the project id in the mutating request body', async () => {
    const user = userEvent.setup()
    const fetchMock = installFetchFakes()

    await renderProjectView('thread')
    await user.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/project/start?projectId=looma-knit'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mode: 'continuous', projectId: 'looma-knit' }),
        }),
      )
    })
  })

  it('offers one-task advancement from the overflow menu without changing project context', async () => {
    const user = userEvent.setup()
    const fetchMock = installFetchFakes()

    await renderProjectView('thread')
    await user.click(screen.getByRole('button', { name: /open actions menu/i }))
    await user.click(screen.getByRole('button', { name: /advance one task/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/project/start?projectId=looma-knit'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mode: 'one_task', projectId: 'looma-knit' }),
        }),
      )
    })
    expect(screen.queryByRole('button', { name: /advance one task/i })).not.toBeInTheDocument()
  })

  it('labels a running one-task pass as Stop 1 and stops the scoped project run', async () => {
    const user = userEvent.setup()
    const running = detail({
      run: { status: 'running', mode: 'one_task' },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(running)
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      if (url.pathname === '/api/project/stop') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderProjectView('thread', null, 'looma-knit', running)
    await user.click(screen.getByRole('button', { name: /stop one-step run/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(true)
    })
    expect(screen.getByRole('button', { name: /stop one-step run/i })).toHaveTextContent('Stop 1')
  })

  it('surfaces provider start failures with a direct Providers action', async () => {
    const user = userEvent.setup()
    const providerReady = detail({ providerStatus: null })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(providerReady)
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      if (url.pathname === '/api/project/start') {
        return json({ error: 'Provider is not configured.' }, 409)
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderProjectView('thread', null, 'looma-knit', providerReady)
    await user.click(screen.getByRole('button', { name: /^start$/i }))

    await screen.findByText('Provider is not configured.')
    await user.click(screen.getByRole('link', { name: /open providers/i }))
    expect(path.value).toBe('/providers')
  })

  it('renders loading, error, and uninitialized project states without a stale project shell', async () => {
    const user = userEvent.setup()
    const uninitialized = detail({ initializationNeeded: true })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(uninitialized)
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      return json({})
    }))

    project.detail = null
    project.error = null
    const loading = render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })
    expect(screen.getByText('Loading project...')).toBeInTheDocument()
    loading.unmount()

    project.detail = null
    project.error = 'Project failed to load'
    const failed = render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })
    expect(screen.getByText('Error: Project failed to load')).toBeInTheDocument()
    failed.unmount()

    project.detail = uninitialized
    project.error = null
    render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })
    expect(screen.getByRole('heading', { name: /looma-knit is attached, but not initialized yet/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /initialize this project/i }))
    await waitFor(() => expect(path.value).toBe('/setup'))
  })

  it('blocks project actions and points users at readiness when bootstrap fails', async () => {
    const user = userEvent.setup()
    const brokenBootstrap = detail({
      providerStatus: null,
      bootstrapStatus: {
        success: false,
        verifiedAt: now,
        steps: [
          {
            command: 'pnpm test',
            result: 'fail',
            exitCode: 1,
            output: '> test\nCannot find module ./Button.svelte\n ELIFECYCLE Command failed',
          },
        ],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(brokenBootstrap)
      if (url.pathname === '/api/project/inbox') {
        return json({ blockers: { bootstrap: true, workspaceImport: false }, items: [] })
      }
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      return json({})
    }))

    await renderProjectView('thread', null, 'looma-knit', brokenBootstrap)

    expect(screen.getByText('pnpm test exited 1: Cannot find module ./Button.svelte')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fix the bootstrap failure before adding tasks/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /fix the bootstrap failure before starting/i })).toBeDisabled()

    await user.click(screen.getByRole('link', { name: /open ready/i }))
    expect(path.value).toBe('/projects/looma-knit/settings/ready')
  })

  it('opens the project rail on mobile and closes it after navigation or Escape', async () => {
    const user = userEvent.setup()
    installMobileBrowserFakes()

    await renderProjectView('thread')
    expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()

    window.dispatchEvent(new Event('guildhall:toggle-project-nav'))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /close project navigation/i })).toHaveLength(2)
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()
    })

    window.dispatchEvent(new Event('guildhall:toggle-project-nav'))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /close project navigation/i })).toHaveLength(2)
    })
    await user.click(screen.getByRole('button', { name: /^Work$/ }))

    expect(path.value).toBe('/projects/looma-knit/work')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()
    })
  })
})
