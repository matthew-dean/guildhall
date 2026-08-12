// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
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
      whyItMattersNow: 'Editors lose context when link creation leaves the document surface.',
      successMetric: 'Editors can create and remove links from the toolbar without opening another view.',
      nonGoals: ['Do not replace the full document editor.'],
      approvedAt: now,
    },
    spec: 'Build the link editor controls inside the existing editor toolbar.',
    acceptanceCriteria: [
      { id: 'ac-url-display', description: 'URL and display text controls are present.', verifiedBy: 'review' },
      { id: 'ac-remove-link', description: 'The editor can remove an existing link.', verifiedBy: 'review' },
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
    availability: { status: 'active', pausedAt: null, resumedAt: null },
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

function pausedDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return detail({
    availability: { status: 'paused', pausedAt: now, resumedAt: null },
    ...overrides,
  })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function installBrowserFakes() {
  const storage = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      setItem: vi.fn((key: string, value: string) => storage.set(key, String(value))),
    },
  })
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
    if (url.pathname === '/api/service') return json({ projects: [projectPayload] })
    if (url.pathname === '/api/project') return json(projectPayload)
    if (url.pathname === '/api/project/spine') return json({ spine: projectPayload.orientationSpine ?? null })
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
    if (url.pathname === '/api/project/migrations') {
      return json({
        projectRoot: '/workspace/looma-knit',
        pending: [{ id: '0.8.0/codex-agent-bridge', title: 'Install Codex Guildhall MCP bridge instructions', safety: 'prompt', summary: 'Adds AGENTS.md.', affectedPaths: ['AGENTS.md'] }],
        blocked: [],
        applied: [],
      })
    }
    if (url.pathname === '/api/project/migrations/apply') return json({ ok: true, result: { applied: [], skipped: [], failed: [] }, status: { pending: [], blocked: [], applied: [] } })
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
    if (url.pathname === '/api/project/release-readiness' || url.pathname === '/api/project/release-readiness/summary') {
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

function installFetchFakesWithPendingProject(projectPayload: ProjectDetail = detail()) {
  const pendingProject = deferredResponse()
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/project') return pendingProject.promise
    if (url.pathname === '/api/project/spine') return json({ spine: projectPayload.orientationSpine ?? null })
    if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
    if (url.pathname === '/api/project/events') return json({ events: [] })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, pendingProject }
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
  await waitFor(() => {
    const page = document.querySelector('.app-shell-page')
    expect(page).toBeTruthy()
    expect(page?.textContent).not.toContain('Loading project...')
  }, { timeout: 3000 })
}

async function renderProjectViewWithoutInitialDetail(
  view: ProjectViewName,
  sub: string | null = null,
  projectId: string | null = 'looma-knit',
) {
  project.detail = null
  project.error = null
  render(ProjectView, { initialView: view, initialSub: sub, projectId })
  await waitFor(() => expect(screen.queryByText('Loading project...')).toBeNull())
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
    await waitFor(() => {
      expect(screen.getAllByText('Which controls belong in the link editor?').length).toBeGreaterThan(0)
    })

    await user.click(screen.getByRole('button', { name: /url input only/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/project/task/task-link-editor/answer-questions'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the selected project identity in the shell while direct Thread routes load detail', async () => {
    project.detail = null
    project.error = null
    render(ProjectView, { initialView: 'thread', initialSub: null, projectId: 'looma-knit' })

    expect(screen.getByText('Looma knit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Looma + Knit')).toBeInTheDocument()
    })
  })

  it('does not let stale project detail rename a drawer-backed Thread route while detail refreshes', async () => {
    project.detail = detail({ id: 'jess', name: 'Jess', path: '/workspace/jess' })
    project.error = null

    render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })

    expect(screen.getByText('Looma knit')).toBeInTheDocument()
    expect(screen.queryByText('Jess')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Looma + Knit')).toBeInTheDocument()
    })
  })

  it.each([
    ['overview', 'What needs your attention'],
    ['inbox', 'Choose link editor scope'],
    ['work', 'Knit: add link editor controls'],
    ['planner', 'Knit: add link editor controls'],
    ['map', 'Project map'],
    ['timeline', 'Coordinator timeline'],
    ['release', 'Current counts'],
    ['settings', 'Settings'],
    ['workspace-import', 'Review existing project work'],
    ['facts', 'Project facts'],
  ] as Array<[ProjectViewName, string]>)('renders the %s project surface from the project shell', async (view, expectedText) => {
    await renderProjectView(view)

    expect(screen.getAllByText(expectedText).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Resume|Pause/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /notifications need you/i })).not.toBeInTheDocument()
  })

  it('loads project detail before rendering a cold direct Release route', async () => {
    await renderProjectViewWithoutInitialDetail('release')

    expect(await screen.findByText('Current counts')).toBeInTheDocument()
    expect(screen.queryByText('Loading project...')).not.toBeInTheDocument()
  })

  it('renders Release readiness when the broad project payload is still loading', async () => {
    const pendingProject = deferredResponse()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return pendingProject.promise
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      if (url.pathname === '/api/project/release-readiness' || url.pathname === '/api/project/release-readiness/summary') {
        return json({
          openEscalations: [],
          unapprovedBriefs: [],
          unapprovedSpecs: [],
          shelvedUnclaimed: [],
          blockedByAgent: [],
          designSystem: { drafted: true, approved: true, revision: 1 },
          statusCounts: { done: 3 },
          totals: { blockingCount: 0, tasks: 3, done: 3 },
        })
      }
      if (url.pathname === '/api/project/spine') return json({ spine: null })
      return json({})
    }))
    project.detail = null
    project.error = null

    render(ProjectView, { initialView: 'release', initialSub: null, projectId: 'looma-knit' })

    expect(await screen.findByText('Current counts')).toBeInTheDocument()
    expect(screen.getByText('Tasks done')).toBeInTheDocument()
    expect(screen.getByText('3/3')).toBeInTheDocument()
    pendingProject.resolve(json(detail()))
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

    await user.click(screen.getByRole('link', { name: /open project setup/i }))
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

    const attention = screen.getByRole('link', { name: /review drafts/i })
    expect(attention).toHaveTextContent(/Review drafts/i)
    await user.click(attention)
    expect(path.value).toBe('/projects/looma-knit/task/task-import-1')
  })

  it('keeps an owner-input blocker in the shared shell action on secondary pages', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Review the waiting spec before Guildhall can continue',
        actionHref: '/thread',
        focusKind: 'spec_review',
      },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('settings', 'ready', 'looma-knit', projectPayload)

    await screen.findAllByText('Review the waiting spec before Guildhall can continue')
    expect(screen.getAllByText('Review the waiting spec before Guildhall can continue')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /review spec/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Live project ticker')).not.toBeInTheDocument()
  })

  it('dedupes shell attention when spec approval blocks both start readiness and idle summary', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '2 specs are waiting for review before work can start. Start with "Spec A".',
        actionHref: '/thread',
        focusTaskId: 'task-spec-a',
        focusTaskTitle: 'Spec A',
        focusKind: 'spec_review',
        count: 2,
      },
      tasks: [
        task({ id: 'task-spec-a', title: 'Spec A', status: 'spec_review' }),
        task({ id: 'task-spec-b', title: 'Spec B', status: 'spec_review' }),
      ],
      run: {
        status: 'stopped',
        mode: 'continuous',
        stopSummary: {
          stopReason: 'awaiting_human',
          stopMessage: 'Waiting on input.',
          idleSummary: { counts: { awaitingApproval: 2 } },
        },
      },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('overview', null, 'looma-knit', projectPayload)

    expect(screen.queryByRole('alert', { name: 'Needs you' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Spec A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open work' })).toBeInTheDocument()
  })

  it('lets focused Work own an owner-review decision instead of repeating it in shell chrome', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'owner_review_required',
        message: '10 specs are ready for your review before work can continue',
        actionHref: '/work?task=task-spec-a',
        focusTaskId: 'task-spec-a',
        focusTaskTitle: 'Spec A',
        focusKind: 'owner_review',
        count: 10,
      },
      actionModel: {
        primaryAction: {
          taskId: 'task-spec-a',
          label: 'Review Spec A',
          buttonLabel: 'Review spec',
          href: '/work?task=task-spec-a',
          tone: 'warn',
        },
      },
      tasks: [task({ id: 'task-spec-a', title: 'Spec A', status: 'spec_review' })],
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('work', null, 'looma-knit', projectPayload)

    expect(screen.getByRole('button', { name: 'Review spec' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: 'Needs you' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Live project ticker')).not.toBeInTheDocument()
  })

  it('surfaces required migrations as the primary setup action and can apply them intentionally', async () => {
    const user = userEvent.setup()
    const migrationBlocked = detail({
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'Run required Guildhall migration 0.8.0/project-state-layout before starting this project.',
        actionHref: '/migrations',
      },
    } as Partial<ProjectDetail>)
    const fetchMock = installFetchFakes(migrationBlocked)
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(migrationBlocked)
      if (url.pathname === '/api/project/inbox') return json({
        blockers: { bootstrap: true, workspaceImport: false },
        items: [
          {
            id: 'bootstrap',
            kind: 'bootstrap_blocked',
            severity: 'high',
            title: 'Bootstrap incomplete',
            detail: 'No verified install/gate commands in guildhall.yaml.',
            actionHref: '/settings/ready',
          },
        ],
      })
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      if (url.pathname === '/api/project/migrations') {
        return json({
          projectRoot: '/workspace/looma-knit',
          pending: [],
          blocked: [
            {
              id: '0.8.0/project-state-layout',
              title: 'Move legacy project memory into split project state',
              safety: 'prompt',
              requirement: 'required',
              summary: 'Moves old ./memory project notes into .guildhall and local Guildhall history.',
              affectedPaths: ['memory/', '.guildhall/'],
            },
          ],
          applied: [],
        })
      }
      if (url.pathname === '/api/project/migrations/apply') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          includePrompt: true,
          migrationId: '0.8.0/project-state-layout',
        })
        return json({
          ok: true,
          result: {
            applied: [{ id: '0.8.0/project-state-layout', title: 'Move legacy project memory into split project state' }],
            skipped: [],
            failed: [],
          },
          status: {
            pending: [],
            blocked: [
              {
                id: '0.10.0/task-open-questions-to-bounded-chat',
                title: 'Move task questions into owner-input bounded chat',
                safety: 'prompt',
                requirement: 'required',
                summary: 'Moves old task-local questions into owner input.',
                affectedPaths: ['.guildhall/TASKS.json'],
              },
            ],
            applied: [{ id: '0.8.0/project-state-layout' }],
          },
        })
      }
      return json({})
    })

    await renderProjectView('overview', null, 'looma-knit', migrationBlocked)

    expect(screen.getAllByRole('button', { name: /repair project/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Project update required' })).toBeInTheDocument()
    expect(screen.getByText('Guildhall needs to update this project before it can run.')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /repair project/i }).at(-1)!)
    await screen.findByRole('dialog', { name: /migrate project/i })
    expect(screen.getByText('Move legacy project memory into split project state')).toBeInTheDocument()
    expect(screen.getByText('memory/')).toBeInTheDocument()
    expect(screen.getByText('.guildhall/')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /apply required migration/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/project/migrations/apply?projectId=looma-knit'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByText('Migration complete.')).toBeInTheDocument()
    expect(screen.getByText('Move task questions into owner-input bounded chat')).toBeInTheDocument()
  })

  it('opens the shared migration repair modal when a task action routes back with repair intent', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/overview?repair=migration')
    path.value = '/projects/looma-knit/overview'
    path.href = '/projects/looma-knit/overview?repair=migration'

    await renderProjectView('overview')

    await screen.findByRole('dialog', { name: /migrate project/i })
    expect(screen.queryByText(/Run required Guildhall migration/i)).toBeNull()
  })

  it('keeps the migration modal blocking until apply and refreshes finish', async () => {
    const user = userEvent.setup()
    const migrationBlocked = detail({
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'Run required Guildhall migration 0.8.0/project-state-layout before starting this project.',
        actionHref: '/migrations',
      },
    } as Partial<ProjectDetail>)
    const apply = deferredResponse()
    const fetchMock = installFetchFakes(migrationBlocked)
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(migrationBlocked)
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      if (url.pathname === '/api/project/migrations') {
        return json({
          projectRoot: '/workspace/looma-knit',
          pending: [],
          blocked: [
            {
              id: '0.8.0/project-state-layout',
              title: 'Move legacy project memory into split project state',
              safety: 'prompt',
              requirement: 'required',
              summary: 'Moves old ./memory project notes into .guildhall and local Guildhall history.',
              affectedPaths: ['memory/', '.guildhall/'],
            },
          ],
          applied: [],
        })
      }
      if (url.pathname === '/api/project/migrations/apply') {
        expect(init?.method).toBe('POST')
        return apply.promise
      }
      return json({})
    })

    await renderProjectView('overview', null, 'looma-knit', migrationBlocked)

    await user.click(screen.getAllByRole('button', { name: /migrate project/i }).at(-1)!)
    await screen.findByRole('dialog', { name: /migrate project/i })
    await user.click(screen.getByRole('button', { name: /apply required migration/i }))

    expect(await screen.findByText('Applying migration')).toBeInTheDocument()
    expect(screen.getByText('Do not stop Guildhall until this finishes.')).toBeInTheDocument()
    expect(screen.queryByText('Migration complete.')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Close' }).every(button => button.hasAttribute('disabled'))).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: /migrate project/i })).toBeInTheDocument()

    apply.resolve(json({
      ok: true,
      result: {
        applied: [
          {
            id: '0.8.0/project-state-layout',
            title: 'Move legacy project memory into split project state',
            affectedPaths: ['memory/', '.guildhall/'],
          },
        ],
        skipped: [],
        failed: [],
      },
      status: {
        pending: [],
        blocked: [],
        applied: [{ id: '0.8.0/project-state-layout', title: 'Move legacy project memory into split project state' }],
      },
    }))

    expect(await screen.findByText('Migration complete.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Close' }).every(button => button.hasAttribute('disabled'))).toBe(false)
    expect(screen.getByLabelText('Migration changed paths')).toHaveTextContent('memory/')
    expect(screen.getByLabelText('Migration changed paths')).toHaveTextContent('.guildhall/')
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
    expect(screen.getAllByText('All tasks are already finished.').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'No tasks to start: No tasks to start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No tasks to start' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /readiness checks need attention/i })).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.queryByText('Setup')).toBeNull()
  })

  it('uses concise shipped release shell chrome without asking for more work', async () => {
    const projectPayload = pausedDetail({
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'A stale migration check says this project needs attention.',
      },
      actionModel: {
        primaryAction: {
          source: 'start_readiness',
          label: 'Required migration',
          buttonLabel: 'Migrate project',
          href: '/migrations',
          tone: 'danger',
        },
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: true, pauseEnabled: false },
        ownerInput: { active: true, label: 'Answer stale question', href: '/thread' },
        setup: { state: 'blocked', freshIntakeNeeded: false },
      },
      releaseReadiness: {
        release: { id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'shipped', source: 'release_plan' },
        scope: { id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'shipped', source: 'release_plan' },
        ready: true,
        totals: { tasks: 15, done: 15 },
      },
      tasks: [task({ id: 'task-done-a', title: 'Done A', status: 'done' })],
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('overview', null, 'looma-knit', projectPayload)

    expect(screen.getByRole('heading', { name: 'Current release' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shipped' })).toBeInTheDocument()
    expect(screen.queryByText('A stale migration check says this project needs attention.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /migrate/i })).not.toBeInTheDocument()
  })

  it('does not show stale stop-requested chrome when the selected scope is complete', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1: Fixture And Evaluation Harness is complete.',
      },
      actionModel: {
        primaryAction: null,
        secondaryActions: [],
        runControl: {
          label: 'No runnable tasks',
          startEnabled: false,
          disabledReason: 'Stage 1: Fixture And Evaluation Harness is complete.',
        },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
      run: {
        status: 'stopped',
        mode: 'continuous',
        stopSummary: {
          stopReason: 'stop_requested',
          stopMessage: 'Stop requested after tick 4.',
        },
      },
      recentEvents: [
        {
          at: now,
          event: {
            type: 'supervisor_stopped',
            reason: 'stop_requested',
            message: 'Stop requested after tick 4.',
          },
        },
      ],
      tasks: [
        task({ id: 'task-stage-1', title: 'Stage 1 proof', status: 'done' }),
        task({ id: 'task-later', title: 'Later release feature', status: 'ready' }),
      ],
      totals: { blockingCount: 0, tasks: 2, done: 1 },
      statusCounts: { done: 1, ready: 1 },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('map', null, 'looma-knit', projectPayload)

    expect(screen.getAllByText('Stage 1: Fixture And Evaluation Harness is complete.').length).toBeGreaterThan(0)
    expect(screen.queryByText('Stop requested after tick 4.')).toBeNull()
  })

  it('does not show complete shell chrome when all-terminal readiness hides orientation gaps', async () => {
    const conflictMessage = 'Possible duplicate work is split across scopes.'
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1: Headless Drafting And Evaluation MVP is complete.',
      },
      orientationSpine: {
        summary: {
          headline: 'Stage 1 Headless Drafting And Evaluation MVP has source conflicts to review.',
          purpose: 'Headless proof scope.',
          selectedScopeLabel: 'Stage 1 Headless Drafting And Evaluation MVP',
          selectedReleaseLabel: 'Stage 1 Headless Drafting And Evaluation MVP',
          includedCount: 1,
          includedWorkCount: 1,
          deferredCount: 1,
          deferredWorkCount: 1,
          pinnedNow: [],
          topBlocker: conflictMessage,
          nextAction: 'Review source conflicts before treating the scope as settled.',
          progress: { scopeId: 'stage-1', total: 2, done: 1, deferred: 1 },
        },
        gaps: [{ kind: 'source_conflict', label: conflictMessage, severity: 'warn', refs: ['docs:narrative-harness'] }],
        sourceHealth: { inferred: 1, conflicts: 1, gaps: 1 },
        scopeRows: [],
        releases: [],
        charter: { goal: 'Headless proof scope.', targetAudience: null, currentReleaseTarget: null, successDefinition: null, nonGoals: [], source: 'inferred' },
        executionBoundary: { label: 'Headless proof', mode: 'headless', proofStyle: 'script_only', detail: 'Script proof.', source: { kind: 'inferred', refs: [], confidence: 'medium', freshness: 'fresh', inferred: true, refreshedAt: now } },
        proofContracts: [],
        roots: [],
        nodes: {},
        activePins: [],
        release: { state: 'ready', blockers: [] },
        projectId: 'looma-knit',
        updatedAt: now,
      } as any,
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('map', null, 'looma-knit', projectPayload)

    expect(screen.queryByText('Stage 1: Headless Drafting And Evaluation MVP is complete.')).toBeNull()
    expect(screen.getAllByText('Stage 1 Headless Drafting And Evaluation MVP has source conflicts to review.').length).toBeGreaterThan(0)
    expect(screen.getAllByText(conflictMessage).length).toBeGreaterThan(0)
  })

  it('does not surface stale proof gaps as a shell blocker after release readiness is complete', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1 is complete.',
      },
      releaseReadiness: {
        ready: true,
        releaseCounts: { total: 1, done: 1, unfinished: 0, proofBlocked: 0 },
        releaseBlockers: [],
      },
      orientationSpine: {
        summary: {
          headline: 'Stage 1 is waiting on proof.',
          purpose: 'Headless proof scope.',
          selectedScopeLabel: 'Stage 1',
          selectedReleaseLabel: 'Stage 1',
          includedCount: 1,
          includedWorkCount: 1,
          deferredCount: 0,
          deferredWorkCount: 0,
          pinnedNow: [],
          topBlocker: 'Proof needed: Stage 1.',
          nextAction: 'Attach proof.',
          progress: { scopeId: 'stage-1', total: 1, done: 1 },
        },
        gaps: [{ kind: 'proof_needed', label: 'Proof needed: Stage 1.', severity: 'warn', refs: ['task:task-stage-1'] }],
        sourceHealth: { inferred: 1, conflicts: 0, gaps: 2 },
        scopeRows: [],
        releases: [],
        charter: { goal: 'Headless proof scope.', targetAudience: null, currentReleaseTarget: null, successDefinition: null, nonGoals: [], source: 'inferred' },
        executionBoundary: { label: 'Headless proof', mode: 'headless', proofStyle: 'script_only', detail: 'Script proof.', source: { kind: 'inferred', refs: [], confidence: 'medium', freshness: 'fresh', inferred: true, refreshedAt: now } },
        proofContracts: [],
        roots: [],
        nodes: {},
        activePins: [],
        release: { state: 'ready', blockers: [] },
        projectId: 'looma-knit',
        updatedAt: now,
      } as any,
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('map', null, 'looma-knit', projectPayload)

    expect(screen.queryByRole('alert', { name: 'Review current scope' })).toBeNull()
  })

  it('does not let deferred blocked work override completed current-scope chrome', async () => {
    const projectPayload = detail({
      startReadiness: { canStart: true, message: 'Ready' },
      actionModel: {
        primaryAction: null,
        secondaryActions: [],
        runControl: {
          label: 'No runnable tasks',
          startEnabled: false,
          disabledReason: 'Stage 1 is complete.',
        },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
      orientationSpine: {
        summary: {
          headline: 'Stage 1 is complete.',
          purpose: 'Headless proof scope.',
          selectedScopeLabel: 'Stage 1',
          selectedReleaseLabel: 'Stage 1',
          includedCount: 1,
          includedWorkCount: 1,
          deferredCount: 1,
          deferredWorkCount: 1,
          pinnedNow: [],
          topBlocker: null,
          nextAction: 'Review completed scope.',
          progress: {
            scopeId: 'stage-1',
            total: 2,
            briefed: 0,
            specced: 1,
            sliced: 0,
            ready: 0,
            active: 0,
            proven: 1,
            done: 1,
            blocked: 0,
            deferred: 1,
          },
        },
        selectedRelease: { id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'ready', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: [] },
        selectedTaskScope: { id: 'stage-1', label: 'Stage 1', kind: 'release', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: ['work:task-later-blocked'] },
        scope: { id: 'stage-1', label: 'Stage 1', kind: 'release', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: ['work:task-later-blocked'] },
        scopeRows: [
          { taskId: 'task-stage-1', nodeId: 'work:task-stage-1', title: 'Stage 1 proof', scope: 'included', eligibilityReason: 'included', hierarchyRole: 'root', status: 'done', handoffState: 'done', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: ['task:task-stage-1'] },
          { taskId: 'task-later-blocked', nodeId: 'work:task-later-blocked', title: 'Later blocked proof', scope: 'deferred', eligibilityReason: 'deferred', hierarchyRole: 'root', status: 'blocked', handoffState: 'deferred', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: ['task:task-later-blocked'] },
        ],
        releases: [],
        charter: { goal: 'Headless proof scope.', targetAudience: null, currentReleaseTarget: null, successDefinition: null, nonGoals: [], source: 'inferred' },
        executionBoundary: { label: 'Headless proof', mode: 'headless', proofStyle: 'script_only', detail: 'Script proof.', source: { kind: 'inferred', refs: [], confidence: 'medium', freshness: 'fresh', inferred: true, refreshedAt: now } },
        proofContracts: [],
        roots: [],
        nodes: {},
        activePins: [],
        gaps: [],
        release: { state: 'ready', blockers: [] },
        sourceHealth: { inferred: 0, conflicts: 0, gaps: 0 },
        projectId: 'looma-knit',
        updatedAt: now,
      } as any,
      tasks: [
        task({ id: 'task-stage-1', title: 'Stage 1 proof', status: 'done' }),
        task({
          id: 'task-later-blocked',
          title: 'Later blocked proof',
          status: 'blocked',
          blockReason: 'Deferred proof cleanup.',
          escalations: [{ id: 'esc-later', summary: 'Deferred proof cleanup' }],
        }),
      ],
      run: { status: 'stopped', mode: 'continuous' },
      totals: { blockingCount: 1, tasks: 2, done: 1 },
      statusCounts: { done: 1, blocked: 1 },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('map', null, 'looma-knit', projectPayload)

    expect(screen.queryByText(/Blocked: 1 escalated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Blocked\./i)).not.toBeInTheDocument()
    expect(screen.getByText(/Run finished: 1 done\./i)).toBeInTheDocument()
  })

  it('uses one project request while the selected surface detail loads', async () => {
    const projectPayload = detail({
      startReadiness: { canStart: false, code: 'all_terminal', message: 'Stage 1 is complete.' },
      orientationSpine: {
        summary: {
          headline: 'Stage 1 is complete.',
          purpose: 'Headless proof scope.',
          selectedScopeLabel: 'Stage 1',
          selectedReleaseLabel: 'Stage 1',
          includedCount: 1,
          includedWorkCount: 1,
          deferredCount: 1,
          deferredWorkCount: 1,
          pinnedNow: [],
          topBlocker: null,
          nextAction: 'Review completed scope.',
          progress: {
            scopeId: 'stage-1',
            total: 2,
            done: 1,
            proven: 1,
            blocked: 0,
            deferred: 1,
          },
        },
        selectedRelease: { id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'ready', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: ['work:task-later'] },
        selectedTaskScope: { id: 'stage-1', label: 'Stage 1', kind: 'release', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: ['work:task-later'] },
        scope: { id: 'stage-1', label: 'Stage 1', kind: 'release', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: ['work:task-later'] },
        scopeRows: [
          { taskId: 'task-stage-1', nodeId: 'work:task-stage-1', title: 'Stage 1 proof', scope: 'included', status: 'done', handoffState: 'done', sourceRefs: ['task:task-stage-1'] },
          { taskId: 'task-later', nodeId: 'work:task-later', title: 'Later feature', scope: 'deferred', status: 'ready', handoffState: 'deferred', sourceRefs: ['task:task-later'] },
        ],
        releases: [{ id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'ready', source: 'release_plan', nodeIds: ['work:task-stage-1'], deferredNodeIds: ['work:task-later'] }],
        charter: { goal: 'Headless proof scope.', targetAudience: null, currentReleaseTarget: null, successDefinition: null, nonGoals: [], source: 'inferred' },
        executionBoundary: { label: 'Headless proof', mode: 'headless', proofStyle: 'script_only', detail: 'Script proof.', source: { kind: 'inferred', refs: [], confidence: 'medium', freshness: 'fresh', inferred: true, refreshedAt: now } },
        proofContracts: [],
        roots: [],
        nodes: {},
        activePins: [],
        gaps: [],
        release: { state: 'ready', blockers: [] },
        sourceHealth: { inferred: 1, gaps: 0 },
      },
    } as Partial<ProjectDetail>)
    const { fetchMock: overviewFetch, pendingProject: pendingOverview } = installFetchFakesWithPendingProject(projectPayload)
    project.detail = null
    project.error = null

    render(ProjectView, { initialView: 'overview', initialSub: null, projectId: 'looma-knit' })

    expect(screen.getByText('Loading project...')).toBeInTheDocument()
    expect(overviewFetch.mock.calls.map(([input]) => String(input)).some(input => input.startsWith('/api/service?projectId='))).toBe(false)
    expect(overviewFetch).not.toHaveBeenCalledWith('/api/project/spine?surface=overview&projectId=looma-knit', { cache: 'no-store' })
    pendingOverview.resolve(json(projectPayload))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Project overview' })).toBeInTheDocument())

    cleanup()
    const { fetchMock: mapFetch, pendingProject: pendingMapProject } = installFetchFakesWithPendingProject(projectPayload)
    project.detail = null
    project.error = null

    render(ProjectView, { initialView: 'map', initialSub: null, projectId: 'looma-knit' })

    expect(screen.getByText('Loading project...')).toBeInTheDocument()
    expect(mapFetch.mock.calls.map(([input]) => String(input)).some(input => input.startsWith('/api/service?projectId='))).toBe(false)
    expect(mapFetch).not.toHaveBeenCalledWith('/api/project/spine?projectId=looma-knit', { cache: 'no-store' })
    pendingMapProject.resolve(json(projectPayload))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Project map' })).toBeInTheDocument())
    expect(mapFetch).toHaveBeenCalledWith('/api/project?surface=map&compact=true&inventoryLimit=24&inventoryOffset=0&projectId=looma-knit', { cache: 'no-store' })
    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeInTheDocument()
    expect(screen.getAllByText('Stage 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 product boundary/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Loading project...')).toBeNull()
  })

  it('does not add a passive footer report to a terminal Thread route', async () => {
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

    expect(screen.queryByLabelText('Live project ticker')).not.toBeInTheDocument()
  })

  it('does not treat open escalation records on terminal shelved work as live blockers', async () => {
    const projectPayload = detail({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'No actionable tasks remain: 1 done, 0 blocked, 1 shelved.',
      },
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [
        task({ id: 'task-done', title: 'Done task', status: 'done' }),
        task({
          id: 'task-shelved',
          title: 'Shelved duplicate',
          status: 'shelved',
          escalations: [{ id: 'esc-old', reason: 'Old split loop', raisedAt: now }],
        }),
      ],
      recentEvents: [],
      totals: { blockingCount: 0, tasks: 2, done: 1 },
      statusCounts: { done: 1, shelved: 1 },
    } as Partial<ProjectDetail>)
    installFetchFakes(projectPayload)

    await renderProjectView('overview', null, 'looma-knit', projectPayload)

    expect(screen.getAllByText('No actionable tasks remain: 1 done, 0 blocked, 1 shelved.').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Blocked: 1 escalated/i)).not.toBeInTheDocument()
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
    const projectPayload = pausedDetail()
    const fetchMock = installFetchFakes(projectPayload)

    await renderProjectView('thread', null, 'looma-knit', projectPayload)
    const startButton = screen.getByRole('button', { name: /^resume$/i })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    expect(startButton).toHaveTextContent(/^Resume$/)
    expect(startButton.getAttribute('aria-label')).toBe('Resume')
    expect(`${startButton.textContent ?? ''} ${startButton.getAttribute('aria-label') ?? ''} ${startButton.getAttribute('title') ?? ''}`).not.toMatch(/ready work item/i)
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

  it('keeps secondary project statuses out of the top bar', async () => {
    await renderProjectView('thread')

    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()
    expect(topbar).toHaveTextContent('Projects')
    expect(topbar).toHaveTextContent('New thread')
    expect(topbar).toHaveTextContent('Resume')
    expect(topbar).not.toHaveTextContent('Open Thread')
    expect(topbar).not.toHaveTextContent('Runtime')
    expect(topbar).not.toHaveTextContent('Needs you')
    expect(topbar).not.toHaveTextContent('Stuck')
    expect(topbar).not.toHaveTextContent('Provider')
  })

  it('labels owner-input recovery blockers without saying answer', async () => {
    const recoveryDetail = detail({
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Choose a recovery path for the blocked task',
        actionHref: '/task/task-blocked',
        focusKind: 'blocked_work',
      },
    })
    installFetchFakes(recoveryDetail)
    await renderProjectView('thread', null, 'looma-knit', recoveryDetail)

    expect(screen.getByRole('button', { name: /choose a recovery path/i })).toHaveTextContent('Needs recovery')
    expect(screen.queryByRole('button', { name: /waiting on answer/i })).not.toBeInTheDocument()
  })

  it('labels brief-cleanup start blockers as review actions in the top bar', async () => {
    const cleanupDetail = detail({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '"Set FLL overhead charge policy" needs a clearer brief before unattended work can run.',
        actionHref: '/work?task=task-needs-brief',
        focusTaskId: 'task-needs-brief',
        focusTaskTitle: 'Set FLL overhead charge policy',
        focusKind: 'brief_cleanup',
        count: 1,
      },
      tasks: [
        task({
          id: 'task-needs-brief',
          title: 'Set FLL overhead charge policy',
          status: 'ready',
          productBrief: {
            approvedAt: '2026-06-02T12:00:00.000Z',
            userJob: '',
          },
          acceptanceCriteria: [],
          spec: '',
        }),
      ],
    })
    installFetchFakes(cleanupDetail)
    await renderProjectView('overview', null, 'looma-knit', cleanupDetail)

    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()
    expect(topbar).toHaveTextContent('Review brief')
    expect(topbar).not.toHaveTextContent('Resume')
  })

  it('uses the shared action model for provider blocker banner actions', async () => {
    const providerDetail = detail({
      startReadiness: {
        canStart: false,
        code: 'no_provider',
        message: 'No provider configured. Open Providers to choose one before starting Guildhall.',
        actionHref: '/providers',
      },
      actionModel: {
        primaryAction: {
          source: 'start_readiness',
          label: 'Provider unavailable',
          detail: 'No provider configured. Open Providers to choose one before starting Guildhall.',
          buttonLabel: 'Choose provider',
          href: '/providers',
          tone: 'warn',
          code: 'no_provider',
        },
        secondaryActions: [],
        runControl: {
          label: 'Needs provider',
          startEnabled: false,
          disabledReason: 'No provider configured. Open Providers to choose one before starting Guildhall.',
          href: '/providers',
        },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
    })
    installFetchFakes(providerDetail)
    await renderProjectView('overview', null, 'looma-knit', providerDetail)

    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()
    expect(topbar).toHaveTextContent('Needs provider')
    expect(screen.getByRole('button', { name: /choose provider/i })).toBeInTheDocument()
    expect(screen.getAllByText('Provider unavailable').length).toBeGreaterThan(0)
  })

  it('uses the shared action model to block Resume during first-spec setup', async () => {
    const setupDetail = detail({
      startReadiness: { canStart: true },
      tasks: [],
      actionModel: {
        primaryAction: {
          source: 'owner_input',
          label: 'Answer in Thread',
          detail: 'Guildhall needs setup direction before it creates work.',
          buttonLabel: 'Open Thread',
          href: '/thread',
          tone: 'warn',
        },
        secondaryActions: [],
        runControl: {
          label: 'Waiting on setup',
          startEnabled: false,
          disabledReason: 'Guildhall needs setup direction before it creates work.',
          href: '/thread',
        },
        ownerInput: {
          active: true,
          label: 'Answer in Thread',
          detail: 'Guildhall needs setup direction before it creates work.',
          href: '/thread',
        },
        setup: {
          state: 'blocked',
          freshIntakeNeeded: false,
          href: '/thread',
          detail: 'Guildhall needs setup direction before it creates work.',
        },
      },
    })
    installFetchFakes(setupDetail)
    await renderProjectView('overview', null, 'looma-knit', setupDetail)

    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()
    expect(topbar).toHaveTextContent('Waiting on setup')
    const start = screen.getByRole('button', { name: /guildhall needs setup direction/i })
    expect(start).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^resume$/i })).not.toBeInTheDocument()
  })

  it('collapses topbar labels before the project toolbar wraps', async () => {
    installViewportMatchMedia(680)

    await renderProjectView('thread')
    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()

    await waitFor(() => {
      expect(topbar).not.toHaveTextContent('Projects')
    })
    expect(topbar).not.toHaveTextContent('New thread')
    expect(topbar).not.toHaveTextContent('Resume')
    expect(topbar).not.toHaveTextContent('Needs you')
  })

  it('moves New thread into the overflow menu at narrow toolbar widths', async () => {
    const user = userEvent.setup()
    installViewportMatchMedia(600)

    project.detail = detail()
    project.error = null
    render(ProjectView, { initialView: 'thread', initialSub: null, projectId: 'looma-knit' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open actions menu' })).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'New thread' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open actions menu' }))
    expect(screen.getByRole('button', { name: 'New thread' })).toBeInTheDocument()
  })

  it('keeps the last good project view visible when a refresh returns 503', async () => {
    const user = userEvent.setup()
    await renderProjectView('overview')

    project.error = 'HTTP 503'

    const warning = await screen.findByRole('status', { name: 'Project refresh warning' })
    expect(warning).toHaveTextContent('Couldn’t refresh project. Showing the last known state.')
    expect(screen.getAllByText('Looma + Knit').length).toBeGreaterThan(0)
    expect(screen.queryByText('Error: HTTP 503')).not.toBeInTheDocument()

    await user.click(within(warning).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status', { name: 'Project refresh warning' })).not.toBeInTheDocument()
  })

  it('keeps repository follow-up separate from the project Pause command', async () => {
    const user = userEvent.setup()
    const blocked = detail({
      run: { status: 'stopped', mode: 'continuous' },
      availability: { status: 'active', pausedAt: null, resumedAt: null },
      providerStatus: null,
      startReadiness: {
        canStart: false,
        code: 'repository_followup_required',
        message: 'Release blocked by uncommitted changes.',
        actionHref: '/release',
        focusKind: 'repository_followup',
      },
      actionModel: {
        primaryAction: {
          source: 'start_readiness',
          label: 'Release blocked by uncommitted changes.',
          buttonLabel: 'Open release',
          href: '/release',
          tone: 'warn',
          code: 'repository_followup_required',
        },
        runControl: {
          label: 'Repo follow-up',
          startEnabled: false,
          pauseEnabled: true,
          disabledReason: 'Release blocked by uncommitted changes.',
          href: '/release',
        },
      },
      recentEvents: [],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project') return json(blocked)
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null })
      if (url.pathname === '/api/project/stop') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true, status: 'stopping' })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderProjectView('overview', null, 'looma-knit', blocked)

    expect(screen.queryByRole('alert', { name: 'Needs you' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open release' })).toBeInTheDocument()
    const pauseButton = screen.getByRole('button', { name: 'Pause project processing' })
    expect(pauseButton).toHaveTextContent('Pause')
    expect(pauseButton).toHaveClass('v-danger')
    expect(screen.queryByRole('button', { name: /repo follow-up/i })).not.toBeInTheDocument()

    await user.click(pauseButton)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(true)
    })
  })

  it('labels a running one-task pass as Pause 1 and pauses the scoped project run', async () => {
    const user = userEvent.setup()
    const running = detail({
      run: { status: 'running', mode: 'one_task' },
      startReadiness: { canStart: true, message: 'Ready' },
      recentEvents: [],
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
    expect(screen.getByRole('button', { name: /pause one-step run/i })).toHaveTextContent('Pause 1')
    await user.click(screen.getByRole('button', { name: /pause one-step run/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(true)
    })
    expect(screen.getByRole('button', { name: /pausing/i })).toBeDisabled()
  })

  it('does not add a second live feed below Work while a run is active', async () => {
    const running = detail({
      run: { status: 'running', mode: 'one_task' },
      startReadiness: { canStart: true, message: 'Ready' },
      recentEvents: [],
    })
    installFetchFakes(running)

    await renderProjectView('work', null, 'looma-knit', running)

    expect(screen.queryByLabelText('Live project ticker')).not.toBeInTheDocument()
  })

  it('acknowledges pause immediately while the project run is stopping', async () => {
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
    await user.click(screen.getByRole('button', { name: /^pause$/i }))

    await screen.findByRole('button', { name: /pausing/i })
    expect(screen.getByRole('button', { name: /pausing/i })).toBeDisabled()
  })

  it('surfaces provider start failures with a direct Providers action', async () => {
    const user = userEvent.setup()
    const providerReady = pausedDetail({ providerStatus: null })
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
    await user.click(screen.getByRole('button', { name: /^resume$/i }))

    await screen.findByText('Provider is not configured.')
    await user.click(screen.getByRole('link', { name: /open project providers/i }))
    expect(path.value).toBe('/projects/looma-knit/settings/providers')
  })

  it('renders thread shell while project detail is still loading, then keeps explicit error and uninitialized states honest', async () => {
    const user = userEvent.setup()
    const uninitialized = detail({ initializationNeeded: true })
    const pendingProject = new Promise<Response>(() => {})
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project' && url.searchParams.get('projectId') === 'looma-knit') return pendingProject
      if (url.pathname === '/api/project/thread') return json({ turns: [], activeTurnId: null, caughtUp: true })
      if (url.pathname === '/api/project/runtime') return json(null)
      if (url.pathname === '/api/project/runtime/dev-servers') return json({ devServers: [] })
      if (url.pathname === '/api/project/capability-requests') return json({ requests: [], activeGrants: [] })
      if (url.pathname === '/api/project/inbox') return json({ blockers: { bootstrap: false, workspaceImport: false }, items: [] })
      return json({})
    }))

    project.detail = null
    project.error = null
    const loading = render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })
    await screen.findByRole('button', { name: 'Project' })
    expect(screen.getByRole('complementary', { name: 'Project navigation' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading project...')).toBeNull())
    loading.unmount()

    project.detail = null
    project.error = 'Project failed to load'
    const failed = render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })
    expect(screen.getByText('Error: Project failed to load')).toBeInTheDocument()
    failed.unmount()

    project.detail = uninitialized
    project.error = null
    render(ProjectView, { initialView: 'thread', projectId: 'looma-knit' })
    expect(await screen.findByRole('heading', { name: /looma-knit is attached, but not initialized yet/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /initialize this project/i }))
    await waitFor(() => expect(path.value).toBe('/projects/looma-knit/setup'))
  })

  it('uses the fill-mode page shell for Threads instead of the padded document page', async () => {
    await renderProjectView('thread')

    expect(document.querySelector('.app-shell-page')).toHaveClass('page--surface-fill')
  })

  it('blocks project actions and points users at readiness when bootstrap fails', async () => {
    const user = userEvent.setup()
    const brokenBootstrap = detail({
      providerStatus: null,
      actionModel: {
        primaryAction: {
          source: 'inbox',
          label: 'Verify your bootstrap commands',
          detail: 'Fix the bootstrap failure before starting',
          buttonLabel: 'Open readiness checks',
          href: '/settings/ready',
          tone: 'danger',
          inboxKind: 'bootstrap_missing',
        },
        secondaryActions: [],
        runControl: {
          label: 'Waiting on setup',
          startEnabled: false,
          pauseEnabled: false,
          disabledReason: 'Fix the bootstrap failure before starting',
          href: '/settings/ready',
        },
        ownerInput: { active: false },
        setup: {
          state: 'blocked',
          freshIntakeNeeded: false,
          href: '/settings/ready',
          detail: 'Fix the bootstrap failure before starting',
        },
      },
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
    expect(screen.queryByRole('button', { name: /readiness checks need attention/i })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /^Project$/ })).toBeInTheDocument()

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
    await user.click(screen.getByRole('button', { name: /^Project$/ }))

    expect(path.value).toBe('/projects/looma-knit/overview')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /close project navigation/i })).not.toBeInTheDocument()
    })
  })

  it('waits before opening the collapsed rail preview on hover, but opens immediately on focus', async () => {
    vi.useFakeTimers()
    try {
      await renderProjectView('overview')
      const shell = document.querySelector('.app-shell')
      const rail = screen.getByRole('complementary', { name: 'Project navigation' })
      expect(shell).not.toHaveClass('rail-preview-open')

      rail.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(149)
      expect(shell).not.toHaveClass('rail-preview-open')

      await vi.advanceTimersByTimeAsync(1)
      expect(shell).toHaveClass('rail-preview-open')
      expect(within(rail).getByRole('button', { name: 'Project' })).toBeInTheDocument()
      expect(within(rail).queryByRole('button', { name: 'Facts' })).not.toBeInTheDocument()

      shell?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      expect(shell).toHaveClass('rail-preview-open')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expand and move collapsed rail targets during a pointer click', async () => {
    vi.useFakeTimers()
    try {
      await renderProjectView('overview')
      const shell = document.querySelector('.app-shell')
      const rail = screen.getByRole('complementary', { name: 'Project navigation' })

      rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      rail.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      expect(shell).not.toHaveClass('rail-preview-open')

      await vi.advanceTimersByTimeAsync(1)
      rail.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      expect(shell).toHaveClass('rail-preview-open')
    } finally {
      vi.useRealTimers()
    }
  })

  it('switches the topbar back action to Threads while compact thread detail is active', async () => {
    installMobileBrowserFakes()
    const threadBackSpy = vi.fn()
    window.addEventListener('guildhall:thread-show-list', threadBackSpy)

    await renderProjectView('thread')
    window.dispatchEvent(new CustomEvent('guildhall:set-nav-context', {
      detail: { surface: 'thread', mode: 'detail' },
    }))

    const backButton = await screen.findByRole('button', { name: /back to threads/i })
    expect(backButton).toHaveTextContent('Threads')

    await userEvent.click(backButton)
    expect(threadBackSpy).toHaveBeenCalledTimes(1)

    window.removeEventListener('guildhall:thread-show-list', threadBackSpy)
  })

  it('keeps collapsed rail navigation accessible by name', async () => {
    await renderProjectView('work')
    const rail = screen.getByRole('complementary', { name: 'Project navigation' })

    expect(within(rail).getByRole('button', { name: 'Project' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Threads' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Work' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Timeline' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Release' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Board' })).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Facts' })).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Project provider settings' })).not.toBeInTheDocument()
  })

  it('groups project orientation under Project with Structure visible by default', async () => {
    await renderProjectView('overview')
    const rail = screen.getByRole('complementary', { name: 'Project navigation' })
    await userEvent.click(within(rail).getByRole('button', { name: 'Pin project navigation open' }))

    expect(within(rail).getByRole('button', { name: 'Project' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Needs you' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Facts' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Structure' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Threads' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Work' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Timeline' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Release' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Inbox' })).not.toBeInTheDocument()
    expect(screen.queryByText('Project graph')).not.toBeInTheDocument()
  })

  it('keeps project children visible for any Project child route', async () => {
    await renderProjectView('facts')
    const rail = screen.getByRole('complementary', { name: 'Project navigation' })
    await userEvent.click(within(rail).getByRole('button', { name: 'Pin project navigation open' }))

    expect(within(rail).getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Needs you' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Facts' })).toHaveClass('active')
    expect(within(rail).getByRole('button', { name: 'Structure' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument()
  })

  it('shows only the active section children for Work and Release routes', async () => {
    await renderProjectView('release', 'criteria')
    let rail = screen.getByRole('complementary', { name: 'Project navigation' })
    await userEvent.click(within(rail).getByRole('button', { name: 'Pin project navigation open' }))

    expect(within(rail).getByRole('button', { name: 'Summary' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Checks' })).toHaveClass('active')
    expect(within(rail).queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()

    cleanup()
    installBrowserFakes()
    installFetchFakes()
    await renderProjectView('work')
    rail = screen.getByRole('complementary', { name: 'Project navigation' })
    await userEvent.click(within(rail).getByRole('button', { name: 'Pin project navigation open' }))

    expect(within(rail).getByRole('button', { name: 'Queue' })).toHaveClass('active')
    expect(within(rail).getByRole('button', { name: 'Board' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument()

    cleanup()
    installBrowserFakes()
    installFetchFakes()
    path.href = '/projects/looma-knit/work?view=board'
    path.value = '/projects/looma-knit/work'
    await renderProjectView('work')
    rail = screen.getByRole('complementary', { name: 'Project navigation' })
    await userEvent.click(within(rail).getByRole('button', { name: 'Pin project navigation open' }))

    expect(within(rail).getByRole('button', { name: 'Queue' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: 'Board' })).toHaveClass('active')
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

  it('does not expose Needs you as a top-bar shortcut from overview', async () => {
    await renderProjectView('overview')

    const topbar = document.querySelector('header.topbar')
    expect(topbar).not.toBeNull()
    expect(topbar).not.toHaveTextContent('Needs you')
    expect(screen.queryByRole('button', { name: /notifications need you/i })).not.toBeInTheDocument()
  })

  it('keeps Settings pinned in the rail utility section instead of expanding settings subsections there', async () => {
    await renderProjectView('settings', 'providers')

    const railBottom = document.querySelector('.rail-bottom')
    expect(railBottom).not.toBeNull()
    expect(railBottom).toContainElement(screen.getByRole('button', { name: 'Settings' }))
    expect(document.querySelector('.rail-subs')).toBeNull()
  })
})
