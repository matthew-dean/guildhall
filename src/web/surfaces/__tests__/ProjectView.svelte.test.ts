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
    productBrief: {
      userJob: 'Let editors create links without leaving the writing flow.',
      approvedAt: now,
    },
    spec: 'Build the link editor controls inside the existing editor toolbar.',
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

function installFetchFakes(projectPayload: ProjectDetail = detail()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/project') return json(projectPayload)
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
  await waitFor(() => expect(screen.getAllByText(initialDetail.name ?? 'Project').length).toBeGreaterThan(0))
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

    await user.click(screen.getByRole('button', { name: /url input only/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/project/task/task-link-editor/answer-questions'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it.each([
    ['overview', 'Work mix'],
    ['inbox', 'Choose link editor scope'],
    ['work', 'Knit: add link editor controls'],
    ['planner', 'Knit: add link editor controls'],
    ['timeline', 'Coordinator timeline'],
    ['release', 'Closure'],
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
    path.value = '/project'
    window.history.replaceState({}, '', '/project')

    await renderProjectView('overview', null, null)

    await waitFor(() => expect(path.value).toBe('/projects/looma-knit/overview'))
  })

  it('does not foreground resolved git runtime errors in Overview', async () => {
    const projectPayload = detail({
      recentEvents: [
        {
          at: now,
          event: { type: 'supervisor_error', message: 'spawn git ENOENT' },
        },
      ],
      gitStory: {
        ready: true,
        state: 'clean',
        blockers: [],
        snapshots: [{ state: 'clean', reason: 'No local changes or unpublished branch work detected.' }],
      },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('overview', null, 'looma-knit', projectPayload)

    expect(screen.queryByText('Guildhall could not find git while inspecting this project.')).toBeNull()
    expect(screen.queryByText('spawn git ENOENT')).toBeNull()
  })

  it('routes setup blockers with a pending meta-intake task to the setup recovery surface', async () => {
    const user = userEvent.setup()
    const projectPayload = detail({
      startReadiness: { canStart: false, message: 'Resume project setup first' },
      tasks: [
        task({
          id: 'task-meta-intake',
          title: 'Inspect the repo',
          status: 'blocked',
          escalations: [{ id: 'esc-meta', summary: 'Human judgment required' }],
        }),
      ],
    })
    installFetchFakes(projectPayload)
    await renderProjectView(
      'thread',
      null,
      'looma-knit',
      projectPayload,
    )

    await user.click(screen.getByRole('button', { name: /project setup needs attention/i }))
    expect(path.value).toBe('/projects/looma-knit/setup')
  })

  it('routes imported-draft start blockers to the draft review surface', async () => {
    const user = userEvent.setup()
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'import_drafts_waiting',
        message: 'Review 6 imported drafts before starting.',
        actionHref: '/task/task-import-1',
      },
      tasks: [
        task({
          id: 'task-import-1',
          title: 'Imported draft',
          status: 'import_draft',
          escalations: [],
        }),
      ],
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)
    await renderProjectView('thread', null, 'looma-knit', projectPayload)

    const attention = screen.getByRole('button', { name: /imported drafts need review/i })
    expect(attention).toHaveTextContent(/Review drafts/i)
    await user.click(attention)
    expect(path.value).toBe('/projects/looma-knit/task/task-import-1')
  })

  it('does not present stable done-only projects as paused or needing setup attention', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'All tasks are already finished.',
      },
      tasks: [
        task({ id: 'task-done-a', title: 'Done A', status: 'done' }),
        task({ id: 'task-done-b', title: 'Done B', status: 'done' }),
      ],
      totals: { blockingCount: 0, tasks: 2, done: 2 },
      statusCounts: { done: 2 },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('thread', null, 'looma-knit', projectPayload)

    expect(screen.getByText('Stable')).toBeTruthy()
    expect(screen.getByText('All tasks are already finished.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No tasks to start: No tasks to start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No tasks to start' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /readiness checks need attention/i })).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.queryByText('Setup')).toBeNull()
  })

  it('shows all-terminal supervisor stop detail in the project ticker footer', async () => {
    const projectPayload = detail({
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [
        task({ id: 'task-done', title: 'Done task', status: 'done' }),
        task({ id: 'task-blocked', title: 'Blocked task', status: 'blocked' }),
      ],
      recentEvents: [
        {
          at: now,
          event: {
            type: 'supervisor_stopped',
            reason: 'all_terminal',
            message: 'No actionable tasks remain: 1 done, 1 blocked, 0 shelved.',
          },
        },
      ],
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('thread', null, 'looma-knit', projectPayload)

    expect(screen.getByLabelText('Live project ticker')).toHaveTextContent('Run finished')
    expect(screen.getByLabelText('Live project ticker')).toHaveTextContent('No actionable tasks remain')
  })

  it('does not show waiting-on-input for blocked work with only suppressed promise questions', async () => {
    const projectPayload = detail({
      tasks: [
        task({
          id: 'task-blocked-promise',
          title: 'Fix checkout recovery',
          status: 'blocked',
          blockReason: 'Recovery needs a clean checkout.',
          openQuestions: [
            {
              id: 'q-promise',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: now,
              prompt: 'Next, pick the output path:',
              selectionMode: 'single',
              choices: [
                'I will draft the blueprint',
                'I will update the product brief',
                'I will persist progress with tools',
              ],
            },
          ],
          escalations: [],
        }),
      ],
      run: {
        status: 'stopped',
        mode: 'continuous',
      },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('work', null, 'looma-knit', projectPayload)

    expect(screen.queryByText(/Waiting on input/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Blocked: 1 task/i)).toBeInTheDocument()
  })

  it('starts a continuous run and keeps the project id in the mutating request body', async () => {
    const user = userEvent.setup()
    const fetchMock = installFetchFakes()

    await renderProjectView('thread')
    const startButton = screen.getByRole('button', { name: /^start$/i })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    expect(startButton).toHaveTextContent(/^Start$/)
    expect(startButton).not.toHaveTextContent(/task/i)
    await user.click(startButton)

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

  it('collapses topbar labels before the project toolbar wraps', async () => {
    installViewportMatchMedia(680)

    await renderProjectView('thread')
    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()

    await waitFor(() => {
      expect(topbar).not.toHaveTextContent('Projects')
    })
    expect(topbar).not.toHaveTextContent('New request')
    expect(topbar).not.toHaveTextContent('Start')
    expect(topbar).not.toHaveTextContent('Needs you')
  })

  it('moves New request into the overflow menu at narrow toolbar widths', async () => {
    const user = userEvent.setup()
    installViewportMatchMedia(600)

    project.detail = detail()
    project.error = null
    render(ProjectView, { initialView: 'thread', initialSub: null, projectId: 'looma-knit' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open actions menu' })).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open actions menu' }))
    expect(screen.getByRole('button', { name: 'New request' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /stop one-step run/i })).toHaveTextContent('Stop 1')
    await user.click(screen.getByRole('button', { name: /stop one-step run/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(true)
    })
    expect(screen.getByRole('button', { name: /stopping/i })).toBeDisabled()
  })

  it('acknowledges stop immediately while the project run is stopping', async () => {
    const user = userEvent.setup()
    const running = detail({
      run: { status: 'running', mode: 'continuous' },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(running)
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      if (url.pathname === '/api/project/stop') {
        expect(init?.method).toBe('POST')
        return json({ ok: true, status: 'stopping' })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderProjectView('thread', null, 'looma-knit', running)
    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    await screen.findByRole('button', { name: /stopping/i })
    expect(screen.getByRole('button', { name: /stopping/i })).toBeDisabled()
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
    await user.click(screen.getByRole('link', { name: /open project providers/i }))
    expect(path.value).toBe('/projects/looma-knit/settings/providers')
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
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /readiness checks need attention/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fix the bootstrap failure before starting/i })).toBeDisabled()

    await user.click(screen.getByRole('link', { name: /open readiness checks/i }))
    expect(path.value).toBe('/projects/looma-knit/settings/ready')
  })

  it('opens the project rail on mobile and closes it after navigation or Escape', async () => {
    const user = userEvent.setup()
    installMobileBrowserFakes()

    await renderProjectView('thread')
    const shell = document.querySelector('.app-shell')
    const shellRail = document.querySelector('.app-shell-rail')
    expect(shell).toHaveClass('mobile-rail-mode')
    expect(shell).not.toHaveClass('rail-overlay-open')
    expect(shellRail).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Work$/ })).not.toBeInTheDocument()

    window.dispatchEvent(new Event('guildhall:toggle-project-nav'))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /close project navigation/i })).toHaveLength(1)
    })
    expect(shell).toHaveClass('rail-overlay-open')
    expect(shellRail).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('button', { name: /^Work$/ })).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()
    })
    expect(shell).not.toHaveClass('rail-overlay-open')
    expect(shellRail).toHaveAttribute('aria-hidden', 'true')

    window.dispatchEvent(new Event('guildhall:toggle-project-nav'))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /close project navigation/i })).toHaveLength(1)
    })
    await user.click(screen.getByRole('button', { name: /^Work$/ }))

    expect(path.value).toBe('/projects/looma-knit/work')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()
    })
  })

  it('keeps collapsed rail navigation accessible by name', async () => {
    await renderProjectView('work')

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thread' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Closure' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Project provider settings' })).not.toBeInTheDocument()
  })

  it('preserves the saved project-name casing in the app header', async () => {
    const fllDetail = detail({
      id: 'fair-labor-license',
      name: 'Fair Labor License',
      path: '/workspace/fair-labor-license',
    })
    installFetchFakes(fllDetail)
    await renderProjectView(
      'overview',
      null,
      'fair-labor-license',
      fllDetail,
    )

    expect(screen.getAllByText('Fair Labor License').length).toBeGreaterThan(0)
    expect(screen.queryByText('Fair labor license')).not.toBeInTheDocument()
  })

  it('routes the top-bar Needs you indicator to the project inbox, even from overview', async () => {
    await renderProjectView('overview')

    await userEvent.click(screen.getByRole('button', { name: /notifications need you/i }))

    expect(path.value).toBe('/projects/looma-knit/inbox')
  })

  it('keeps Settings pinned in the rail utility section instead of expanding settings subsections there', async () => {
    await renderProjectView('settings', 'providers')

    const railBottom = document.querySelector('.rail-bottom')
    expect(railBottom).not.toBeNull()
    expect(railBottom).toContainElement(screen.getByRole('button', { name: 'Settings' }))
    expect(document.querySelector('.rail-subs')).toBeNull()
  })
})
