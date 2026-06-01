// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import ThreadTab from '../ThreadTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import { project } from '../../../lib/project.svelte.js'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function selectedThread() {
  return within(
    ((screen.queryByRole('region', { name: 'Selected thread' }) as HTMLElement | null)
      ?? document.querySelector('.thread-detail')
      ?? document.querySelector('.thread')
      ?? document.body) as HTMLElement,
  )
}

function threadHistory() {
  return within(screen.getByLabelText('Thread history'))
}

function activeThreadDock() {
  return within(screen.getByLabelText('Active thread dock'))
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

const now = '2026-05-19T15:00:00.000Z'

function setupTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'setup_step',
    id: 'setup-identity',
    at: now,
    persona: 'intake',
    status: 'active',
    phase: 'setup',
    stepId: 'identity',
    title: 'Name this project',
    why: 'Guildhall needs a stable project identity before it can manage work.',
    skippable: false,
    affordance: 'inline-text',
    actionLabel: 'Save identity',
    submitEndpoint: '/api/setup/identity',
    currentValue: 'Looma + Knit',
    placeholder: 'Project name',
    ...overrides,
  }
}

function importedDraftTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'inflight',
    id: 'draft-link-controls',
    at: now,
    persona: 'spec',
    status: 'active',
    phase: 'intake',
    taskId: 'task-import-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'blueprint',
    taskStatus: 'import_draft',
    importedDraft: true,
    summary: 'Imported from your project notes.',
    taskDescription: 'Build URL input, display text, open-in-new-tab, and remove link controls.',
    sourceNote: {
      description: 'Roadmap mention',
      references: ['docs/roadmap.md', 'web/app/components/editor/toolbar.ts'],
    },
    ...overrides,
  }
}

function questionTurn(
  id: string,
  questionId: string,
  prompt: string,
  choices: string[],
  questionOverrides: Record<string, unknown> = {},
) {
  return {
    kind: 'agent_question',
    id,
    at: now,
    persona: 'coord',
    status: 'active',
    phase: 'blocked',
    taskId: 'task-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'change_order',
    taskDescription: 'Imported draft needs one narrowed answer before work starts.',
    sourceNote: {
      references: ['docs/roadmap.md'],
    },
    question: {
      kind: 'choice',
      id: questionId,
      askedBy: 'coordinator',
      askedAt: now,
      prompt,
      choices,
      selectionMode: 'single',
      ...questionOverrides,
    },
  }
}

function briefTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'brief_approval',
    id: 'brief-link-controls',
    at: now,
    persona: 'spec',
    status: 'active',
    phase: 'spec',
    taskId: 'task-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'blueprint',
    brief: {
      userJob: 'Edit links inline.',
      successMetric: 'The editor can create and remove links.',
      authoredBy: 'spec-agent',
    },
    ...overrides,
  }
}

function specReviewTurn(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'spec_review',
    id: `spec-${taskId}`,
    at: now,
    persona: 'spec',
    status: 'active',
    phase: 'spec',
    taskId,
    taskTitle: taskId === 'task-meta-intake' ? 'Inspect the repo' : 'Knit: add link editor controls',
    constructionMode: 'blueprint',
    spec: '## Summary\nBuild the focused link editor controls.\n\n## Acceptance Criteria\n- The focused controls exist.',
    ...overrides,
  }
}

function metaIntakeTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'inflight',
    id: 'meta-intake',
    at: now,
    persona: 'intake',
    status: 'active',
    phase: 'setup',
    taskId: 'task-meta-intake',
    taskTitle: 'Inspect the repo',
    constructionMode: 'survey',
    taskStatus: 'exploring',
    summary: 'Guildhall should infer the repo structure itself.',
    ...overrides,
  }
}

function workerTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'inflight',
    id: 'worker-link-controls',
    at: now,
    persona: 'worker',
    status: 'active',
    phase: 'inflight',
    taskId: 'task-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'build',
    taskStatus: 'in_progress',
    summary: 'Worker is implementing link controls.',
    ...overrides,
  }
}

function escalationTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'escalation',
    id: 'esc-link-controls',
    at: now,
    persona: 'worker',
    status: 'active',
    phase: 'blocked',
    taskId: 'task-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'change_order',
    escalationId: 'esc-1',
    summary: 'Worker is blocked on missing setup.',
    details: 'Install dependencies before continuing.',
    ...overrides,
  }
}

function reviewFeedbackTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'review_feedback',
    id: 'review-link-controls',
    at: now,
    persona: 'reviewer',
    status: 'pending',
    phase: 'intake',
    taskId: 'task-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'inspect',
    summary: 'Reviewer asked for a smaller follow-up.',
    verdict: 'revise',
    reviewer: 'component-designer',
    ...overrides,
  }
}

interface RequestTurnForTest {
  kind: 'request'
  id: string
  at: string
  persona: 'intake'
  status: 'done' | 'active' | 'pending'
  phase: 'intake'
  requestId: string
  title: string
  rawRequest: string
  routingSummary: string
}

interface PressureTestQuestionTurnForTest {
  kind: 'pressure_test_question'
  id: string
  at: string
  persona: 'intake'
  status: 'done' | 'active' | 'pending'
  phase: 'intake'
  intakeId: string
  targetTitle: string
  domainId: string
  domainTitle: string
  question: {
    id: string
    prompt: string
    why: string
    choices?: string[]
    evidence: string[]
  }
  answerEndpoint: string
}

function requestTurn(overrides: Partial<RequestTurnForTest> = {}): RequestTurnForTest {
  return {
    kind: 'request',
    id: 'request:pti-guildhall-0-8-0',
    at: now,
    persona: 'intake',
    status: 'done',
    phase: 'intake',
    requestId: 'pti-guildhall-0-8-0',
    title: 'Guildhall 0.8.0',
    rawRequest: '0.8.0 should prioritize pressure-test intake.',
    routingSummary: 'Pressure-test intake is checking the request before task split.',
    ...overrides,
  }
}

function pressureTestQuestionTurn(
  overrides: Partial<PressureTestQuestionTurnForTest> = {},
): PressureTestQuestionTurnForTest {
  return {
    kind: 'pressure_test_question',
    id: 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1',
    at: now,
    persona: 'intake',
    status: 'active',
    phase: 'intake',
    intakeId: 'pti-guildhall-0-8-0',
    targetTitle: 'Guildhall 0.8.0',
    domainId: 'product-goals',
    domainTitle: 'Product goals',
    question: {
      id: 'product-goals-q-1',
      prompt: 'For "Guildhall 0.8.0", what outcome should this request achieve?',
      why: 'This decides the release slice.',
      evidence: ['internal/plans/guildhall-0-8.md: release goals'],
    },
    answerEndpoint: '/api/project/pressure-test/pti-guildhall-0-8-0/answer',
    ...overrides,
  }
}

function installBrowserFakes(url = '/projects/looma-knit/thread') {
  window.history.replaceState({}, '', url)
  path.value = url
  project.detail = {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    run: { status: 'stopped', mode: 'continuous' },
    tasks: [],
    config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
    startReadiness: { canStart: true },
  }
  project.error = null
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.animate = vi.fn().mockReturnValue({
    cancel: vi.fn(),
    commitStyles: vi.fn(),
    finished: Promise.resolve(),
    onfinish: null,
    pause: vi.fn(),
    play: vi.fn(),
  } as unknown as Animation)
}

function installFetchFakes(
  turns: unknown[],
  activeTurnId: string | null,
  options: {
    answerQuestionsResponse?: Response
    sourceNoteResponse?: Response | (() => Response | Promise<Response>)
    capabilityRequests?: unknown[]
    runtime?: unknown
    caughtUp?: boolean
  } = {},
) {
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, init, body })
    if (url.startsWith('/api/project/thread')) {
      return json({ turns, activeTurnId, caughtUp: options.caughtUp ?? false })
    }
    if (url.startsWith('/api/project/source-note')) {
      if (options.sourceNoteResponse) {
        return typeof options.sourceNoteResponse === 'function'
          ? options.sourceNoteResponse()
          : options.sourceNoteResponse
      }
      return json({
        path: '/repo/looma-knit/docs/roadmap.md',
        displayPath: 'docs/roadmap.md',
        content: '# Roadmap source\n\nThis is the source note Guildhall used.',
        truncated: false,
      })
    }
    if (url.startsWith('/api/project/runtime/dev-servers')) {
      return json({ devServers: [] })
    }
    if (url.startsWith('/api/project/runtime')) {
      return json(options.runtime ?? null)
    }
    if (url.startsWith('/api/project/capability-requests')) {
      if (url.includes('/approve') || url.includes('/deny') || url.includes('/block')) return json({ ok: true })
      return json({ requests: options.capabilityRequests ?? [], activeGrants: [] })
    }
    if (url.startsWith('/api/project/task/') && url.endsWith('/shape-draft?projectId=looma-knit')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/mark-done')) {
      return json({ ok: true, status: 'done' })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/update-brief')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/resume')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/stage-answer')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/answer-questions')) {
      if (options.answerQuestionsResponse) return options.answerQuestionsResponse
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/pressure-test/') && url.includes('/answer')) {
      return json({ intake: { id: 'pti-guildhall-0-8-0', pendingQuestion: null } })
    }
    if (url.startsWith('/api/project/meta-intake/synthesize')) return json({ ok: true })
    if (url.startsWith('/api/setup/')) return json({ ok: true })
    if (url.startsWith('/api/project')) {
      return json({
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/repo/looma-knit',
        run: { status: 'running', mode: 'continuous' },
        ...(options.runtime ? { runtime: options.runtime } : {}),
        tasks: [],
      })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

describe('ThreadTab', () => {
  beforeEach(() => {
    vi.useRealTimers()
    installBrowserFakes()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    sessionStorage.clear()
  })

  it('submits setup turns through project-scoped inline controls', async () => {
    const { calls } = installFetchFakes([setupTurn()], 'setup-identity')

    render(ThreadTab)
    await selectedThread().findByText('Name this project')

    const input = screen.getByPlaceholderText('Project name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Looma + Knit Docs')
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('Looma + Knit Docs'))
    await userEvent.click(screen.getByRole('button', { name: /save identity/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/setup/identity'))).toBe(true)
    })
    const setupCall = calls.find(call => call.url.includes('/api/setup/identity'))
    expect(setupCall?.url).toContain('projectId=looma-knit')
    expect(setupCall?.body).toMatchObject({
      name: 'Looma + Knit Docs',
    })
  })

  it('renders capability requests with narrow approval controls', async () => {
    const { calls } = installFetchFakes([], null, {
      capabilityRequests: [{
        id: 'cap-task-fixtures-1',
        taskId: 'task-fixtures',
        kind: 'mount_directory',
        requestedBy: 'runtime-command',
        reason: 'Runtime command needs access to a sibling fixture folder.',
        duration: 'this task',
        fallback: 'Use copied fixtures.',
        status: 'pending',
        mount: {
          hostPath: '/Users/matthew/git/fixtures',
          containerPath: '/mnt/requested/fixtures',
          access: 'read-write',
        },
      }],
    })

    render(ThreadTab)

    await screen.findByText('Access requests')
    expect(screen.getByText(/Guildhall needs a decision before it can safely use this folder/)).toBeTruthy()
    expect(screen.getByText(/Runtime command needs access to a sibling fixture folder/)).toBeTruthy()
    const pathInput = screen.getByDisplayValue('/Users/matthew/git/fixtures')
    await userEvent.clear(pathInput)
    await userEvent.type(pathInput, '/Users/matthew/git/fixtures/screenshots')
    await userEvent.click(screen.getByRole('button', { name: /approve read-only/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/project/capability-requests/cap-task-fixtures-1/approve'))).toBe(true)
    })
    expect(calls.find(call => call.url.includes('/approve'))?.body).toMatchObject({
      access: 'read-only',
      hostPath: '/Users/matthew/git/fixtures/screenshots',
    })
  })

  it('renders runtime state in owner language', async () => {
    installFetchFakes([], null, {
      runtime: {
        status: 'stopped',
        health: { status: 'healthy' },
        migration: { mode: 'host-run' },
        backendSetup: { status: 'ready', selectedMode: 'host-run' },
      },
    })

    render(ThreadTab)

    await screen.findByText('Runtime')
    expect(screen.getByText('Runtime stopped')).toBeTruthy()
    expect(screen.getByText(/Compatibility mode/)).toBeTruthy()
  })

  it('renders request and active pressure-test question turns as owner input', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    installFetchFakes([
      requestTurn(),
      pressureTestQuestionTurn(),
    ], 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1')

    render(ThreadTab)

    await screen.findByText('New thread')
    expect(screen.queryByLabelText('Thread operations summary')).toBeNull()
    expect(selectedThread().getByText('0.8.0 should prioritize pressure-test intake.')).toBeTruthy()
    expect(selectedThread().getByText(/Guildhall 0\.8\.0 · Product goals/)).toBeTruthy()
    expect(selectedThread().getByText('What should Guildhall 0.8.0 accomplish?')).toBeTruthy()
    expect(selectedThread().getByText('This decides the release slice.')).toBeTruthy()
    expect(selectedThread().getByText('internal/plans/guildhall-0-8.md: release goals')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not move the viewport when a new active thread turn appears', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    installFetchFakes([
      workerTurn(),
    ], 'worker-link-controls')

    render(ThreadTab)

    await selectedThread().findByText('Work is paused. Start Guildhall when you want it to continue.')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('posts pressure-test answers, refreshes Thread and project, and clears the local answer', async () => {
    const { calls } = installFetchFakes([
      requestTurn(),
      pressureTestQuestionTurn(),
    ], 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1')

    render(ThreadTab)
    await selectedThread().findByText('What should Guildhall 0.8.0 accomplish?')

    const answer = screen.getByPlaceholderText('Answer with a sentence or short paragraph. Include constraints or success measures if they matter.')
    await userEvent.type(answer, 'Keep the request visible and ask one focused question at a time.')
    await userEvent.click(screen.getByRole('button', { name: /submit answer/i }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.includes('/api/project/pressure-test/pti-guildhall-0-8-0/answer') &&
        call.body?.questionId === 'product-goals-q-1' &&
        call.body?.answer === 'Keep the request visible and ask one focused question at a time.'
      ))).toBe(true)
    })
    expect(calls.filter(call => call.url.startsWith('/api/project/thread')).length).toBeGreaterThan(1)
    expect(calls.some(call => call.url.startsWith('/api/project?projectId=looma-knit'))).toBe(true)
    await waitFor(() => expect((answer as HTMLTextAreaElement).value).toBe(''))
  })

  it('routes free-form agent questions through the shared thread composer', async () => {
    const { calls } = installFetchFakes([
      questionTurn(
        'question-text',
        'q-text-1',
        'What constraint matters most before Guildhall shapes this task?',
        [],
        {
          kind: 'text',
          choices: [],
        },
      ),
    ], 'question-text')

    render(ThreadTab)

    await screen.findByLabelText('Active thread dock')
    expect(activeThreadDock().getByText('Reply in thread')).toBeTruthy()
    const composer = activeThreadDock().getByPlaceholderText('Answer this question or redirect Guildhall…')
    await userEvent.type(composer, 'Keep the first pass narrowly focused on owner-facing intake.')
    await userEvent.click(activeThreadDock().getByRole('button', { name: 'Send answer' }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.includes('/api/project/task/task-link-controls/answer-questions') &&
        Array.isArray(call.body?.answers) &&
        (call.body?.answers as Array<Record<string, unknown>>).some(answer => (
          answer.questionId === 'q-text-1' &&
          answer.answer === 'Keep the first pass narrowly focused on owner-facing intake.'
        ))
      ))).toBe(true)
    })
  })

  it('opens spec change requests in the shared thread composer', async () => {
    installFetchFakes([
      specReviewTurn('task-link-controls'),
    ], 'spec-task-link-controls')

    render(ThreadTab)

    await screen.findByLabelText('Active thread dock')
    expect(activeThreadDock().getByText('Review the spec draft')).toBeTruthy()
    await userEvent.click(activeThreadDock().getByRole('button', { name: 'Request changes' }))

    expect(screen.getByText('Request changes to the spec')).toBeTruthy()
    expect(screen.getByPlaceholderText('Correct the spec or ask Guildhall to revisit it…')).toBeTruthy()
  })

  it('renders pressure-test choices as direct answer buttons', async () => {
    const { calls } = installFetchFakes([
      pressureTestQuestionTurn({
        id: 'pressure-test:pti-narrative-harness:project-direction-priority',
        targetTitle: 'Narrative Harness',
        domainId: 'project-planner',
        domainTitle: 'Project direction',
        question: {
          id: 'project-direction-priority',
          prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
          why: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
          choices: [
            'Reviewer-lane MVPs',
            'Author-facing editor UX',
            'Story-memory/schema foundations',
            'Generation/evaluation loops',
          ],
          evidence: ['project-brief.md: Narrative Harness is fiction-writing software.'],
        },
        answerEndpoint: '/api/project/pressure-test/pti-narrative-harness/answer',
      }),
    ], 'pressure-test:pti-narrative-harness:project-direction-priority')

    render(ThreadTab)
    await screen.findByRole('button', { name: 'Reviewer-lane MVPs' })
    expect(screen.queryByPlaceholderText('Answer with a sentence or short paragraph. Include constraints or success measures if they matter.')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reviewer-lane MVPs' }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.includes('/api/project/pressure-test/pti-narrative-harness/answer') &&
        call.body?.questionId === 'project-direction-priority' &&
        call.body?.answer === 'Reviewer-lane MVPs'
      ))).toBe(true)
    })
  })

  it('keeps bulky task context and older activity behind progressive disclosure', async () => {
    const activity = [
      { label: 'Failed shell', detail: 'Shell command failed with a very long error detail.', tone: 'danger', at: now },
      { label: 'Finished a thought', tone: 'ok', at: now },
      { label: 'Started shell', tone: 'running', at: now },
      { label: 'Finished shell', detail: 'Shell command succeeded.', tone: 'ok', at: now },
      { label: 'Waiting for the local model to respond.', tone: 'warn', at: now },
    ]
    installFetchFakes([
      workerTurn({
        taskDescription: 'Wire up existing auth scaffolding to real Supabase auth with profile management and email confirmation.',
        sourceNote: {
          references: [
            'frontend/app/pages/auth',
            'frontend/app/composables/useAuth.ts',
            'database/supabase/migrations',
          ],
        },
        activity,
      }),
    ], 'worker-link-controls')

    render(ThreadTab)

    const contextSummary = await screen.findByText('Starting point and source notes')
    expect(contextSummary.closest('details')?.open).toBe(false)
    expect(screen.getByText('Failed shell')).toBeTruthy()
    expect(screen.getByText('Started shell')).toBeTruthy()
    const activitySummary = screen.getByText(/Show \d+ earlier update/)
    expect(activitySummary.closest('details')?.open).toBe(false)
  })

  it('clears the first spec shaping input after the idea is submitted', async () => {
    const { calls } = installFetchFakes([
      setupTurn({
        id: 'setup:firstTask',
        stepId: 'firstTask',
        title: 'Shape the first spec',
        why: 'Turn a rough idea into a product brief, focused questions, and the first buildable spec.',
        affordance: 'inline-text',
        actionLabel: 'Start shaping',
        submitEndpoint: '/api/project/intake',
        placeholder: 'Describe the product idea or first outcome',
        currentValue: '',
      }),
    ], 'setup:firstTask')

    render(ThreadTab)
    await selectedThread().findByText('Shape the first spec')

    const input = screen.getByPlaceholderText('Describe the product idea or first outcome')
    await userEvent.type(input, 'Amazon competitor seeded through merchant tools')
    await userEvent.click(screen.getByRole('button', { name: /start shaping/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/project/intake'))).toBe(true)
    })
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(calls.find(call => call.url.includes('/api/project/intake'))?.body).toMatchObject({
      ask: 'Amazon competitor seeded through merchant tools',
    })
  })

  it('lets the user mark a stale ready task done from Thread', async () => {
    project.detail = {
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/repo/looma-knit',
      run: { status: 'running', mode: 'continuous' },
      tasks: [],
      config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
      startReadiness: { canStart: true },
    }
    const { calls } = installFetchFakes([
      workerTurn({
        id: 'inflight-task-db-bootstrap',
        taskId: 'task-db-bootstrap',
        taskTitle: 'Bootstrap database — run migrations, verify schema',
        taskStatus: 'ready',
        summary: 'Approved and queued for work.',
      }),
    ], 'inflight-task-db-bootstrap')

    render(ThreadTab)
    await selectedThread().findByText('Bootstrap database — run migrations, verify schema')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.includes('/api/project/task/task-db-bootstrap/mark-done') &&
        call.body?.evidence === 'Confirmed from Thread by the user.'
      ))).toBe(true)
    })
  })

  it('loads thread turns through the explicit route project instead of the global selected project', async () => {
    installBrowserFakes('/projects/font-something/thread')
    project.detail = {
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/repo/looma-knit',
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [],
      config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
      startReadiness: { canStart: true },
    }
    const { calls } = installFetchFakes([
      setupTurn({
        id: 'setup:direction',
        stepId: 'direction',
        title: 'Give the project direction',
        affordance: 'inline-textarea',
        currentValue: 'AI-powered font generation desktop application.',
      }),
    ], 'setup:direction')

    render(ThreadTab, { projectId: 'font-something' })
    await selectedThread().findByText('Give the project direction')

    const threadCall = calls.find(call => call.url.startsWith('/api/project/thread'))
    expect(threadCall?.url).toContain('projectId=font-something')
  })

  it('renders setup context as a current snapshot, separate from the saved direction input', async () => {
    installFetchFakes([
      setupTurn({
        id: 'setup:direction',
        stepId: 'direction',
        title: 'Give the project direction',
        why: 'Confirm the owner direction before Guildhall shapes work.',
        affordance: 'inline-textarea',
        actionLabel: 'Save direction',
        submitEndpoint: '/api/setup/direction',
        currentValue: 'AI-powered font generation desktop application.',
        contextSummary: {
          intro: "This is Guildhall's current snapshot from local files and setup state, not permanent project truth.",
          facts: [
            'Project: Font Something (font-something).',
            'Current read: AI-powered font generation desktop application.',
            'Coordinator areas: Design.',
          ],
          uncertainty: 'If the goal, audience, architecture, priorities, or constraints have changed, add that here. The saved direction is the durable plan input, and it can be revised later as the project changes.',
        },
      }),
    ], 'setup:direction')

    render(ThreadTab, { projectId: 'font-something' })

    await screen.findByText('What Guildhall knows right now')
    expect(screen.getByText(/current snapshot from local files/i)).toBeTruthy()
    expect(screen.getByText('Coordinator areas: Design.')).toBeTruthy()
    expect(screen.getByText(/saved direction is the durable plan input/i)).toBeTruthy()
    expect(screen.getByDisplayValue('AI-powered font generation desktop application.')).toBeTruthy()
  })

  it('submits direction, coordinator, and bootstrap setup affordances without leaving Thread', async () => {
    const { calls } = installFetchFakes(
      [
        setupTurn({
          id: 'setup-direction',
          stepId: 'direction',
          title: 'Describe the project',
          affordance: 'inline-textarea',
          actionLabel: 'Save direction',
          submitEndpoint: '/api/setup/direction',
          currentValue: '',
          placeholder: 'What should Guildhall know?',
        }),
        setupTurn({
          id: 'setup-coordinator',
          stepId: 'coordinator',
          title: 'Choose a coordinator',
          affordance: 'inline-choice',
          actionLabel: 'Add coordinator',
          submitEndpoint: '/api/setup/coordinator',
          choices: [
            { value: 'frontend-engineer', label: 'Frontend engineer' },
            { value: 'project-manager', label: 'Project manager' },
          ],
        }),
        setupTurn({
          id: 'setup-bootstrap',
          stepId: 'bootstrap',
          title: 'Run setup checks',
          affordance: 'inline-button',
          actionLabel: 'Run checks',
          submitEndpoint: '/api/setup/bootstrap',
        }),
      ],
      'setup-direction',
    )

    render(ThreadTab)
    await selectedThread().findByText('Describe the project')

    await userEvent.type(screen.getByPlaceholderText('What should Guildhall know?'), 'Knit owns the editor UI.')
    await userEvent.click(screen.getByRole('button', { name: /save direction/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'project-manager')
    await userEvent.click(screen.getByRole('button', { name: /add coordinator/i }))
    const runChecksButton = screen.getByRole('button', { name: /run checks/i })
    expect(runChecksButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(runChecksButton)

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/setup/direction') && call.body?.content === 'Knit owns the editor UI.')).toBe(true)
      expect(calls.some(call => call.url.includes('/api/setup/coordinator') && Array.isArray(call.body?.archetypes))).toBe(true)
      expect(calls.some(call => call.url.includes('/api/setup/bootstrap'))).toBe(true)
    })
  })

  it('routes inactive setup cards to the dedicated setup recovery page', async () => {
    installFetchFakes(
      [
        setupTurn({
          id: 'setup-direction',
          stepId: 'direction',
          title: 'Describe the project',
          status: 'pending',
          affordance: 'inline-textarea',
          actionLabel: 'Save direction',
          submitEndpoint: '/api/setup/direction',
        }),
      ],
      'setup-direction',
    )

    render(ThreadTab)
    await selectedThread().findByText('Describe the project')
    await userEvent.click(screen.getByRole('button', { name: /open setup/i }))

    expect(path.value).toBe('/projects/looma-knit/setup')
  })

  it('lets inactive project check-in cards start the check-in instead of routing to setup', async () => {
    const { calls } = installFetchFakes(
      [
        setupTurn({
          id: 'setup:project-check-in',
          stepId: 'projectCheckIn',
          title: 'Project check-in needed',
          why: 'Start the first project-question pass so Guildhall can use current project context before it starts guessing.',
          status: 'pending',
          skippable: true,
          affordance: 'inline-button',
          actionLabel: 'Start project check-in',
          submitEndpoint: '/api/project/project-check-in',
        }),
      ],
      'other-turn',
    )

    render(ThreadTab)
    await selectedThread().findByText('Project check-in needed')
    const startCheckInButton = screen.getByRole('button', { name: /start project check-in/i })
    expect(startCheckInButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(startCheckInButton)

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/project/project-check-in'))).toBe(true)
    })
    expect(path.value).toBe('/projects/looma-knit/thread')
  })

  it('explains bootstrap failures with the first useful command output line', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/thread')) {
        return json({
          turns: [
            setupTurn({
              id: 'setup-bootstrap',
              stepId: 'bootstrap',
              title: 'Run setup checks',
              affordance: 'inline-button',
              actionLabel: 'Run checks',
              submitEndpoint: '/api/setup/bootstrap',
            }),
          ],
          activeTurnId: 'setup-bootstrap',
          caughtUp: false,
        })
      }
      if (url.startsWith('/api/setup/bootstrap')) {
        return json({
          success: false,
          status: {
            steps: [
              {
                result: 'fail',
                command: 'pnpm test',
                exitCode: 1,
                output: '> app test\nScope: workspace\nCannot find module ./Button.svelte\nELIFECYCLE',
              },
            ],
          },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ThreadTab)
    await selectedThread().findByText('Run setup checks')
    await userEvent.click(screen.getByRole('button', { name: /run checks/i }))

    await selectedThread().findByText('pnpm test exited 1: Cannot find module ./Button.svelte')
  })

  it('keeps imported draft source context and actions inline in Thread', async () => {
    const { calls } = installFetchFakes([importedDraftTurn()], 'draft-link-controls')

    render(ThreadTab)
    await selectedThread().findByText('Knit: add link editor controls')
    expect(selectedThread().getByText('Needs task brief')).toBeTruthy()
    expect(selectedThread().getByText(/Next step: turn this note into a task brief with scope, evidence, and acceptance criteria/)).toBeTruthy()
    expect(selectedThread().getByText('Build URL input, display text, open-in-new-tab, and remove link controls.')).toBeTruthy()
    expect(selectedThread().getByText('docs/roadmap.md')).toBeTruthy()
    expect(selectedThread().getByText('web/app/components/editor/toolbar.ts')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /open source note.*roadmap\.md/i }))
    await screen.findByRole('dialog', { name: 'Source note' })
    expect(screen.getByText('Roadmap source')).toBeTruthy()
    expect(screen.getByText('This is the source note Guildhall used.')).toBeTruthy()
    expect(calls.some(call => call.url.includes('/api/project/source-note') && call.url.includes('projectId=looma-knit'))).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: /draft task brief/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/shape-draft') && call.url.includes('projectId=looma-knit'))).toBe(true)
    })

    await userEvent.click(screen.getByRole('button', { name: /add optional note/i }))
    await screen.findByText('Add a thread note')
    await userEvent.type(screen.getByPlaceholderText('Add a note for Guildhall…'), 'Keep drag handles out of scope.')
    await userEvent.click(screen.getByRole('button', { name: 'Send note' }))
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.includes('/resume') &&
            call.body?.message === 'Keep drag handles out of scope.' &&
            call.body?.preserveStatus === true,
        ),
      ).toBe(true)
    })
  })

  it('shows unresolved git story state on task cards', async () => {
    installFetchFakes([
      importedDraftTurn({
        gitStory: {
          state: 'dirty_uncommitted',
          reason: '3 changed files are still uncommitted.',
          nextAction: 'Review the diff, then commit the scoped files or mark local-only/deferred.',
        },
      }),
    ], 'draft-link-controls')

    render(ThreadTab)
    await screen.findByText('Dirty tree')
    expect(screen.getByText('3 changed files are still uncommitted.')).toBeTruthy()
    expect(screen.getByText('Review the diff, then commit the scoped files or mark local-only/deferred.')).toBeTruthy()
  })

  it('does not show failed git inspection as an unresolved task-card chip', async () => {
    installFetchFakes([
      importedDraftTurn({
        gitStory: {
          state: 'UNKNOWN',
          reason: 'spawn git ENOENT',
          nextAction: 'Inspect git state manually; Guildhall could not read it.',
        },
      }),
    ], 'draft-link-controls')

    render(ThreadTab)
    await selectedThread().findByText('Knit: add link editor controls')
    expect(screen.queryByText('Unknown')).toBeNull()
    expect(screen.queryByText('spawn git ENOENT')).toBeNull()
  })

  it('keeps ready tasks with incomplete checklists out of worker-start actions', async () => {
    installFetchFakes([
      importedDraftTurn({
        id: 'turn-ready-incomplete',
        taskId: 'task-ready-incomplete',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'ready',
        importedDraft: false,
        phase: 'inflight',
        summary: 'Ready for work.',
        gitStory: {
          state: 'no_upstream',
          reason: 'guildhall/task-task-import-123 has no upstream branch',
          nextAction: 'Set an upstream branch or open a PR for this branch.',
        },
        checklist: {
          title: 'Task brief checklist',
          doneCount: 2,
          totalSteps: 4,
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'active' },
            { id: 'criteria', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
          ],
        },
      }),
    ], 'turn-ready-incomplete')

    render(ThreadTab)

    await selectedThread().findByText('Needs brief')
    const needsBriefChip = selectedThread().getByText('Needs brief')
    expect(needsBriefChip).toBeTruthy()
    expect(needsBriefChip.classList.contains('tone-agent-attention')).toBe(true)
    expect(selectedThread().getByText('Brief checklist')).toBeTruthy()
    expect(screen.queryByText('No upstream')).toBeNull()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
    expect(screen.queryByText('Guildhall next')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Finish task brief...' })).toBeNull()
    const noteButton = screen.getByRole('button', { name: 'Add optional note' })
    const startButton = screen.getByRole('button', { name: 'Start' })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    expect(noteButton.compareDocumentPosition(startButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('makes a one-field brief blocker start Guildhall cleanup instead of opening a user form', async () => {
    installFetchFakes([
      importedDraftTurn({
        id: 'turn-success-only',
        taskId: 'task-success-only',
        taskTitle: 'Add human-readable docs labels',
        taskStatus: 'ready',
        importedDraft: false,
        phase: 'inflight',
        summary: 'Ready for work.',
        gitStory: {
          state: 'no_upstream',
          reason: 'guildhall/task-task-import-qh97p0 has no upstream branch',
          nextAction: 'Set an upstream branch or open a PR for this branch.',
        },
        checklist: {
          title: 'Task brief checklist',
          doneCount: 3,
          totalSteps: 4,
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'active' },
            { id: 'criteria', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'done' },
          ],
        },
      }),
    ], 'turn-success-only')

    render(ThreadTab)

    await selectedThread().findByText('Needs brief')
    expect(screen.queryByText('No upstream')).toBeNull()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
    const startButton = screen.getByRole('button', { name: 'Start' })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(startButton)
    expect(screen.queryByText('What should be true when this is done?')).toBeNull()
    expect(screen.queryByText('How should Guildhall check it?')).toBeNull()
  })

  it('hides upstream branch copy whenever the task brief is still incomplete', async () => {
    installFetchFakes([
      importedDraftTurn({
        id: 'turn-import-incomplete',
        taskId: 'task-import-incomplete',
        taskTitle: 'HoverCard',
        taskStatus: 'import_draft',
        importedDraft: true,
        summary: 'Imported from your project notes.',
        gitStory: {
          state: 'no_upstream',
          reason: 'guildhall/task-task-import-1pgqco7 has no upstream branch',
          nextAction: 'Set an upstream branch or open a PR for this branch.',
        },
        checklist: {
          title: 'Task brief checklist',
          doneCount: 2,
          totalSteps: 4,
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'active' },
            { id: 'criteria', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
          ],
        },
      }),
    ], 'turn-import-incomplete')

    render(ThreadTab)

    await selectedThread().findByText('HoverCard')
    expect(selectedThread().getByText('Brief checklist')).toBeTruthy()
    expect(screen.queryByText('No upstream')).toBeNull()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
    expect(screen.queryByText(/Set an upstream branch/)).toBeNull()
  })

  it('starts Guildhall brief cleanup instead of asking the user to fill missing brief fields inline', async () => {
    const { calls } = installFetchFakes([
      importedDraftTurn({
        id: 'turn-ready-incomplete',
        taskId: 'task-ready-incomplete',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'ready',
        importedDraft: false,
        phase: 'inflight',
        summary: 'Ready for work.',
        checklist: {
          title: 'Task brief checklist',
          doneCount: 2,
          totalSteps: 4,
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'brief', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'pending' },
            { id: 'acceptance', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
          ],
        },
      }),
    ], 'turn-ready-incomplete')

    render(ThreadTab)

    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))

    await waitFor(() => {
      const call = calls.find(c => c.url.includes('/api/project/start'))
      expect(call?.body).toMatchObject({
        taskId: 'task-ready-incomplete',
        mode: 'continuous',
      })
    })
  })

  it('does not offer task-specific starts while the project run is already active', async () => {
    project.detail = {
      ...(project.detail as any),
      run: { status: 'running', mode: 'continuous' },
    }
    installFetchFakes([
      importedDraftTurn({
        id: 'turn-exploring',
        taskId: 'task-exploring',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'exploring',
        importedDraft: false,
        phase: 'spec',
        summary: 'Partial brief exists.',
      }),
    ], 'turn-exploring')

    render(ThreadTab)

    await screen.findByText('Spec revision queued')
    expect(screen.queryByRole('button', { name: /continue drafting spec/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Already queued' }).hasAttribute('disabled')).toBe(true)
  })

  it('opens source notes immediately and bounds large rendered previews', async () => {
    let resolveSourceNote: (response: Response) => void = () => {}
    const sourceNotePromise = new Promise<Response>(resolve => {
      resolveSourceNote = resolve
    })
    installFetchFakes([importedDraftTurn()], 'draft-link-controls', {
      sourceNoteResponse: () => sourceNotePromise,
    })

    render(ThreadTab)
    await selectedThread().findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByRole('button', { name: /open source note.*roadmap\.md/i }))

    await screen.findByRole('dialog', { name: 'Source note' })
    expect(screen.getByText('Opening source note...')).toBeTruthy()

    resolveSourceNote(json({
      path: '/repo/looma-knit/docs/roadmap.md',
      displayPath: 'docs/roadmap.md',
      content: `# Large source\n\n${'A'.repeat(40_000)}\n\nEnd marker that should not render.`,
      truncated: false,
    }))

    await screen.findByText('Large source')
    expect(screen.getByText('Preview truncated to keep Thread responsive.')).toBeTruthy()
    expect(screen.queryByText(/End marker that should not render/)).toBeNull()
  })

  it('renders source-note directory previews in the Thread modal', async () => {
    installFetchFakes([importedDraftTurn()], 'draft-link-controls', {
      sourceNoteResponse: json({
        path: '/repo/looma-knit/supabase/migrations',
        displayPath: 'supabase/migrations',
        kind: 'directory',
        content: '# Directory: supabase/migrations\n\n```text\nsupabase/migrations/\n  - 001_initial.sql\n```',
        truncated: false,
      }),
    })

    render(ThreadTab)
    await selectedThread().findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByRole('button', { name: /open source note.*roadmap\.md/i }))

    await screen.findByRole('dialog', { name: 'Source note' })
    expect(screen.getByText('Directory: supabase/migrations')).toBeTruthy()
    expect(screen.getByText(/001_initial\.sql/)).toBeTruthy()
  })

  it('renders missing source-note previews with nearby files instead of a dead modal', async () => {
    installFetchFakes([importedDraftTurn()], 'draft-link-controls', {
      sourceNoteResponse: json({
        path: '/repo/looma-knit/frontend/app/composables/useAuth.ts',
        displayPath: 'frontend/app/composables/useAuth.ts',
        missing: true,
        content: '# Source not found: useAuth.ts\n\nNearby files in `frontend/app/composables`:\n- useSupabase.ts',
        truncated: false,
      }),
    })

    render(ThreadTab)
    await selectedThread().findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByRole('button', { name: /open source note.*roadmap\.md/i }))

    await screen.findByRole('dialog', { name: 'Source note' })
    expect(screen.getByText('Source not found: useAuth.ts')).toBeTruthy()
    expect(screen.getByText(/useSupabase\.ts/)).toBeTruthy()
  })

  it('renders many parallel turns as a continuous list under the selected thread tab', async () => {
    const manyDrafts = Array.from({ length: 9 }, (_, index) =>
      importedDraftTurn({
        id: `draft-${index}`,
        taskId: `task-import-${index}`,
        taskTitle: `Knit draft ${index + 1}`,
        taskDescription: `Imported note ${index + 1} needs a task brief.`,
      }),
    )
    installFetchFakes(manyDrafts, 'draft-0')

    render(ThreadTab)

    await selectedThread().findByText('Knit draft 1')
    expect(selectedThread().getByText('Imported note 9 needs a task brief.')).toBeTruthy()
    expect(screen.queryByLabelText(/Compact .* operations/)).toBeNull()
    expect(screen.queryByText(/compact rows/i)).toBeNull()
  })

  it('renders completed turns in Archive without an extra Done section', async () => {
    const completedTurns = Array.from({ length: 8 }, (_, index) =>
      workerTurn({
        id: `done-compact-${index}`,
        phase: 'done',
        status: 'done',
        taskId: `task-done-${index}`,
        taskTitle: `Finished task ${index + 1}`,
        taskStatus: 'done',
        constructionMode: 'survey',
        liveAgent: {
          name: 'spec-agent',
          startedAt: now,
          lastEventLabel: 'No activity',
          silentMs: 120_000,
        },
        summary: 'Run finished.',
      }),
    )
    installFetchFakes(completedTurns, null, { caughtUp: true })

    render(ThreadTab)

    await userEvent.click(await screen.findByRole('tab', { name: /archive/i }))
    await selectedThread().findByText('Finished task 1')
    expect(screen.queryByLabelText(/Compact .* operations/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Done/i })).toBeNull()
  })

  it('treats stopped runtime in-progress and exploring turns as paused instead of agent-active', async () => {
    installFetchFakes(
      [
        workerTurn({
          id: 'stopped-worker',
          taskStatus: 'in_progress',
          liveAgent: {
            name: 'worker-agent',
            startedAt: now,
            lastEventLabel: 'No activity',
            silentMs: 129 * 60_000,
          },
          summary: 'Worker was stopped.',
        }),
        workerTurn({
          id: 'stopped-exploring',
          phase: 'spec',
          taskId: 'task-stopped-exploring',
          taskTitle: 'Basic project listing',
          taskStatus: 'exploring',
          liveAgent: undefined,
          summary: 'Spec draft is waiting.',
        }),
      ],
      'stopped-worker',
    )

    render(ThreadTab)

    expect(screen.queryByText(/No activity for 129m/)).toBeNull()
    expect((await screen.findAllByText('Paused')).length).toBe(1)
  })

  it('does not label stopped gate checks as live Guildhall work', async () => {
    installFetchFakes(
      [
        workerTurn({
          id: 'gate-check-stopped',
          taskStatus: 'gate_check',
          taskTitle: 'Narrative harness gate review',
          liveAgent: {
            name: 'gate-checker-agent',
            startedAt: now,
            lastEventLabel: 'Running gate checks',
            silentMs: 90_000,
          },
          summary: 'Gate check is waiting for the next run.',
        }),
      ],
      'gate-check-stopped',
    )

    render(ThreadTab)

    expect(await selectedThread().findByText('Gate checks are queued. Start Guildhall when you want it to continue.')).toBeTruthy()
  })

  it('summarizes and prioritizes high-volume thread operations', async () => {
    project.detail = {
      ...(project.detail as any),
      run: { status: 'running', mode: 'continuous' },
    }
    const crowded = [
      importedDraftTurn({ id: 'draft-a', taskId: 'task-import-a', taskTitle: 'Draft A' }),
      importedDraftTurn({ id: 'draft-b', taskId: 'task-import-b', taskTitle: 'Draft B' }),
      importedDraftTurn({ id: 'draft-c', taskId: 'task-import-c', taskTitle: 'Draft C' }),
      questionTurn('q-priority', 'priority', 'Which direction?', ['A', 'B']),
      workerTurn({
        id: 'live-spec',
        phase: 'intake',
        persona: 'spec',
        taskId: 'task-live-spec',
        taskTitle: 'Live spec task',
        taskStatus: 'exploring',
        liveAgent: { name: 'spec-agent', startedAt: now, lastEventLabel: 'Drafting task brief' },
      }),
      workerTurn({
        id: 'queued-ready',
        phase: 'intake',
        taskId: 'task-ready',
        taskTitle: 'Queued ready task',
        taskStatus: 'ready',
        liveAgent: undefined,
      }),
      workerTurn({
        id: 'queued-review',
        phase: 'intake',
        taskId: 'task-review',
        taskTitle: 'Queued review task',
        taskStatus: 'review',
        liveAgent: undefined,
      }),
      importedDraftTurn({ id: 'draft-d', taskId: 'task-import-d', taskTitle: 'Draft D' }),
      importedDraftTurn({ id: 'draft-e', taskId: 'task-import-e', taskTitle: 'Draft E' }),
      escalationTurn(),
    ]
    installFetchFakes(crowded, 'live-spec')

    render(ThreadTab)

    await selectedThread().findByText('Which direction?')
    const bodyText = document.body.textContent ?? ''
    expect(bodyText.indexOf('Which direction?')).toBeLessThan(bodyText.indexOf('Live spec task'))
    expect(bodyText.indexOf('Live spec task')).toBeLessThan(bodyText.indexOf('Queued ready task'))
    expect(screen.queryByLabelText('Thread operations summary')).toBeNull()
  })

  it('does not call paused in-progress worker state queued or agent-active', async () => {
    installFetchFakes(
      [
        workerTurn({
          liveAgent: undefined,
          taskStatus: 'in_progress',
          summary: 'Waiting between worker passes.',
        }),
      ],
      'worker-link-controls',
    )

    render(ThreadTab)

    expect((await screen.findAllByText('Paused')).length).toBe(1)
    expect(screen.queryByText(/^queued$/i, { selector: '.chip' })).toBeNull()
  })

  it('does not describe transcript-only escalation attempts as zero value progress', async () => {
    installFetchFakes(
      [
        escalationTurn({
          summary: 'Spec agent made no visible progress after 3 passes.',
          details: 'Task remained in exploring with no saved spec.',
        }),
      ],
      'esc-link-controls',
    )

    render(ThreadTab)
    await screen.findByText('Needs recovery')
    expect(screen.getByText('Guildhall found context but did not save the next draft.')).toBeTruthy()
    expect(screen.getByText(/transcript may contain useful observations/i)).toBeTruthy()
    expect(screen.queryByText('Worker is stuck')).toBeNull()
  })

  it('reshapes acceptance-criteria evidence blockers into a Guildhall-owned recovery action', async () => {
    const { calls } = installFetchFakes(
      [
        escalationTurn({
          escalationAgentId: 'worker-agent',
          summary: 'Cannot satisfy required AC-8 evidence command under current authoritative verification gate.',
          details: 'Coordinator scoped instructions require an AC-8 evidence block with the exact pnpm --dir frontend test result (timestamp + exit code) and concrete auth test specs.',
        }),
      ],
      'esc-link-controls',
    )

    render(ThreadTab)
    await screen.findByRole('button', { name: /Let Guildhall run the check/i })
    expect(selectedThread().getByText('Guildhall needs to run one missing check.')).toBeTruthy()
    expect(selectedThread().getByText(/not asking you to prove anything/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Let Guildhall run the check/i })).toBeTruthy()
    expect(screen.queryByText(/Technical note/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/\bAC-8\b/)
    await userEvent.click(screen.getByRole('button', { name: /Let Guildhall run the check/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/resolve-escalation'))).toBe(true)
      expect(calls.some(call => call.url.startsWith('/api/project/start') && call.body?.taskId === 'task-link-controls')).toBe(true)
    })
  })

  it('keeps queued task cards focused on owner state instead of competing stage chips', async () => {
    installFetchFakes(
      [
        importedDraftTurn({ id: 'draft-stage', taskId: 'task-draft-stage', constructionMode: 'blueprint' }),
        workerTurn({ id: 'worker-stage', taskId: 'task-worker-stage', constructionMode: 'build', taskStatus: 'ready' }),
      ],
      'draft-stage',
    )

    render(ThreadTab)

    await selectedThread().findByText('Needs you')
    expect(screen.getAllByText('Queued').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Guildhall next')).toBeNull()
    expect(screen.queryByText('Blueprint')).toBeNull()
    expect(screen.queryByText('Build')).toBeNull()
    expect(screen.getAllByRole('button', { name: /add optional note/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('submits each task question answer directly without a second submit step', async () => {
    const { calls } = installFetchFakes(
      [
        questionTurn('q-scope', 'scope', 'Should drag-and-drop be in scope?', [
          'Include drag handle',
          'Drag handle is out of scope',
        ]),
        questionTurn('q-link-ui', 'link-ui', 'Which link UI should be built?', [
          'URL input only',
          'URL input + Display text',
        ]),
      ],
      'q-scope',
    )

    render(ThreadTab)
    await selectedThread().findByText('Should drag-and-drop be in scope?')
    expect(selectedThread().queryByText('Which link UI should be built?')).toBeNull()
    expect(selectedThread().getByText(/1 more question will stay here/i)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /drag handle is out of scope/i }))
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.includes('/answer-questions') &&
            Array.isArray(call.body?.answers) &&
            call.body.answers.length === 1 &&
            call.body.answers[0]?.questionId === 'scope',
        ),
      ).toBe(true)
    })
    expect(screen.queryByText('Answers staged')).toBeNull()
    expect(screen.queryByRole('button', { name: /submit answers/i })).toBeNull()
    expect(calls.some(call => call.url.includes('/stage-answer'))).toBe(false)
  })

  it('commits preserved draft answers together so old staged answers are not re-asked one by one', async () => {
    const { calls } = installFetchFakes(
      [
        questionTurn('q-scope', 'scope', 'Should drag-and-drop be in scope?', [
          'Include drag handle',
          'Drag handle is out of scope',
        ], { draftAnswer: 'Drag handle is out of scope' }),
        questionTurn('q-link-ui', 'link-ui', 'Which link UI should be built?', [
          'URL input only',
          'URL input + Display text',
        ], { draftAnswer: 'URL input + Display text' }),
      ],
      'q-scope',
    )

    render(ThreadTab)
    await waitFor(() => expect(screen.getAllByText('Draft answer')).toHaveLength(2))

    await userEvent.click(screen.getAllByRole('button', { name: /send saved answers/i })[0])

    await waitFor(() => {
      const call = calls.find(candidate => candidate.url.includes('/answer-questions'))
      expect(call?.body?.answers).toMatchObject([
        { questionId: 'scope', answer: 'Drag handle is out of scope' },
        { questionId: 'link-ui', answer: 'URL input + Display text' },
      ])
    })
    expect(calls.some(call => call.url.includes('/stage-answer'))).toBe(false)
    expect(screen.queryByRole('button', { name: /submit answers/i })).toBeNull()
  })

  it('keeps the question visible and reports an error when answer saving fails', async () => {
    const { calls } = installFetchFakes(
      [
        questionTurn('q-scope', 'scope', 'Should drag-and-drop be in scope?', [
          'Include drag handle',
          'Drag handle is out of scope',
        ]),
      ],
      'q-scope',
      { answerQuestionsResponse: json({ error: 'disk is full' }, { status: 500 }) },
    )

    render(ThreadTab)
    await selectedThread().findByText('Should drag-and-drop be in scope?')

    await userEvent.click(screen.getByRole('button', { name: /drag handle is out of scope/i }))

    await waitFor(() => expect(selectedThread().getByText('disk is full')).toBeTruthy())
    expect(selectedThread().getByText('Should drag-and-drop be in scope?')).toBeTruthy()
    expect(calls.some(call => call.url.includes('/answer-questions'))).toBe(true)
  })

  it('lets the user ask for missing question context without answering the question', async () => {
    const { calls } = installFetchFakes(
      [
        questionTurn('q-context', 'context', 'Pick one: what is the single source of truth for migration status?', [
          'PROJECT_STATE.md',
          'GitHub issues',
        ]),
      ],
      'q-context',
    )

    render(ThreadTab)
    await selectedThread().findByText('Pick one: what is the single source of truth for migration status?')
    expect(selectedThread().getByText('Missing context is expected.')).toBeTruthy()
    expect(selectedThread().getByText(/Ask Guildhall to explain project terms, source notes, or assumptions before you answer/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /ask guildhall to explain/i }))
    await screen.findByText('Ask Guildhall to explain first')
    await userEvent.type(
      screen.getByPlaceholderText('Ask what Guildhall means, what evidence it used, or what context is missing…'),
      'Which migration status are you asking about?',
    )
    await userEvent.click(screen.getAllByRole('button', { name: /ask for context/i }).at(-1)!)

    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.includes('/resume') &&
            call.body?.preserveStatus === true &&
            String(call.body?.message ?? '').includes('Before I answer the open question') &&
            String(call.body?.message ?? '').includes('Which migration status are you asking about?'),
        ),
      ).toBe(true)
    })
    expect(calls.some(call => call.url.includes('/answer-questions'))).toBe(false)
  })

  it('surfaces workspace-import handoff without requiring the details pane', async () => {
    sessionStorage.setItem(
      'guildhall:workspace-import-handoff',
      JSON.stringify({ tasksAdded: 2, sourceCount: 3 }),
    )
    installFetchFakes([importedDraftTurn()], 'draft-link-controls')

    render(ThreadTab)
    await screen.findByText('Import complete.')
    expect(screen.getByText(/Guildhall created 2 draft tasks from 3 selected sources/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText('Import complete.')).toBeNull()
  })

  it('approves briefs and spec reviews through the inline thread card', async () => {
    const { calls } = installFetchFakes(
      [
        briefTurn(),
        specReviewTurn('task-link-controls'),
        specReviewTurn('task-meta-intake'),
        specReviewTurn('task-workspace-import'),
      ],
      'brief-link-controls',
    )

    render(ThreadTab)
    await screen.findByText('Edit links inline.')

    await userEvent.click(screen.getByRole('button', { name: /yes, that's right/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /approve spec/i })[0]!)
    await userEvent.click(screen.getByRole('button', { name: /yes, use this split/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /approve spec/i })[1]!)

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/approve-brief'))).toBe(true)
      expect(calls.some(call => call.url.includes('/task/task-link-controls/approve-spec'))).toBe(true)
      expect(calls.some(call => call.url.includes('/meta-intake/approve'))).toBe(true)
      expect(calls.some(call => call.url.includes('/workspace-import/approve'))).toBe(true)
    })
  })

  it('keeps pending spec drafts approvable when the card is visible inline', async () => {
    const { calls } = installFetchFakes(
      [
        specReviewTurn('task-link-controls', {
          status: 'pending',
          phase: 'ready',
          taskTitle: 'Stripe Connect -- payment flow for licensed projects',
          spec: '## Summary\nAdd Stripe Connect payments for licensed projects.',
        }),
      ],
      'spec-task-link-controls',
    )

    render(ThreadTab)
    await selectedThread().findByText('Stripe Connect -- payment flow for licensed projects')

    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/approve-spec'))).toBe(true)
    })
  })

  it('uses the shared secondary-left and primary-right brief decision buttons', async () => {
    installFetchFakes([briefTurn()], 'brief-link-controls')

    render(ThreadTab)
    await screen.findByText('Edit links inline.')

    const noButton = screen.getByRole('button', { name: /no, change it/i })
    const yesButton = screen.getByRole('button', { name: /yes, that's right/i })

    expect(noButton.classList.contains('v-secondary')).toBe(true)
    expect(yesButton.classList.contains('v-primary')).toBe(true)
    expect(noButton.compareDocumentPosition(yesButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders brief approvals as human-facing task briefs and hides operational receipt text', async () => {
    installFetchFakes([
      briefTurn({
        taskTitle: 'Bootstrap database — run migrations, verify schema',
        brief: {
          userJob: 'Done — I persisted concrete progress with tools:',
          successMetric: 'Migrations run cleanly and the schema matches the current application expectations.',
          authoredBy: 'spec-agent',
        },
      }),
    ], 'brief-link-controls')

    render(ThreadTab)
    await selectedThread().findByText('Review this task brief')

    expect(screen.queryByText('Is this what you want?')).toBeNull()
    expect(screen.queryByText('What it thinks you want')).toBeNull()
    expect(screen.queryByText('Done — I persisted concrete progress with tools:')).toBeNull()
    expect(screen.getByText('Scope')).toBeTruthy()
    expect(screen.getAllByText('Bootstrap database — run migrations, verify schema').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Done when')).toBeTruthy()
    expect(screen.getByText('Migrations run cleanly and the schema matches the current application expectations.')).toBeTruthy()
  })

  it('blocks brief and spec approval until task questions are answered', async () => {
    installFetchFakes(
      [
        questionTurn('q-scope', 'scope', 'Should drag-and-drop be in scope?', [
          'Include drag handle',
          'Drag handle is out of scope',
        ]),
        briefTurn(),
        specReviewTurn('task-link-controls'),
      ],
      'brief-link-controls',
    )

    render(ThreadTab)
    await selectedThread().findByText('Review this task brief')
    expect(selectedThread().getByText(/Answer 1 open question in Thread before approving/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /yes, that's right/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /approve spec/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps meta-intake setup resumable from Thread and can synthesize the split proposal', async () => {
    const { calls } = installFetchFakes(
      [
        setupTurn({
          id: 'setup-provider',
          stepId: 'provider',
          title: 'Connect provider',
          status: 'done',
        }),
        metaIntakeTurn({
          checklist: {
            title: 'Repo inspection',
            doneCount: 2,
            totalSteps: 2,
            activeStepId: null,
            steps: [
              { id: 'read', title: 'Read repo', why: 'Find structure', status: 'done' },
              { id: 'draft', title: 'Draft split', why: 'Route work', status: 'done' },
            ],
          },
        }),
      ],
      'meta-intake',
    )

    render(ThreadTab)
    await selectedThread().findByText('Repo inspection')
    const splitProposalButton = screen.getAllByRole('button', { name: /create split proposal/i })[0]!
    expect(splitProposalButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(splitProposalButton)

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/project/meta-intake/synthesize'))).toBe(true)
    })
  })

  it('surfaces live and stalled worker activity on collapsed-looking work cards', async () => {
    project.detail = {
      ...(project.detail as any),
      run: { status: 'running', mode: 'continuous' },
    }
    installFetchFakes(
      [
        workerTurn({
          liveAgent: {
            name: 'worker-agent',
            startedAt: '2026-05-19T14:58:00.000Z',
            lastEventLabel: 'Waiting for the local model to respond.',
            silentMs: 90_000,
          },
          activity: [
            {
              at: '2026-05-19T14:59:30.000Z',
              label: 'Started write checkpoint',
              detail: 'Writing implementation notes',
              tone: 'running',
            },
          ],
        }),
      ],
      'worker-link-controls',
    )

    render(ThreadTab)
    await screen.findAllByText(/Still waiting for the local model/)
    expect(screen.getByText('Started write checkpoint')).toBeTruthy()
    expect(screen.getByText('Writing implementation notes')).toBeTruthy()
  })

  it('labels partial durable progress as recovery work instead of queued work', async () => {
    installFetchFakes(
      [
        workerTurn({
          liveAgent: undefined,
          activity: [
            {
              at: '2026-05-19T14:59:30.000Z',
              label: 'Finished write file',
              detail: 'Wrote docs/specs/story-memory-schemas.md',
              tone: 'ok',
            },
            {
              at: '2026-05-19T14:59:45.000Z',
              label: 'Agent worker-agent failed on task-link-controls: worker-agent timed out after 120000ms of inactivity',
              tone: 'danger',
            },
          ],
        }),
      ],
      'worker-link-controls',
    )

    render(ThreadTab)
    expect((await screen.findAllByText('Needs recovery')).length).toBeGreaterThan(0)
    expect(screen.getByText(/partial progress/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inspect recovery' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add recovery note' })).toBeTruthy()
    const resumeWorkButton = screen.getByRole('button', { name: 'Resume work' })
    expect(resumeWorkButton).toBeTruthy()
    expect(resumeWorkButton.classList.contains('v-agent')).toBe(true)
    expect(screen.queryAllByText(/^Queued$/)).toHaveLength(0)
  })

  it('can resume a recovery task directly from Thread', async () => {
    const { calls } = installFetchFakes(
      [
        workerTurn({
          liveAgent: undefined,
          activity: [
            {
              at: '2026-05-19T14:59:30.000Z',
              label: 'Finished write file',
              detail: 'Wrote docs/specs/story-memory-schemas.md',
              tone: 'ok',
            },
            {
              at: '2026-05-19T14:59:45.000Z',
              label: 'Agent worker-agent failed on task-link-controls: worker-agent timed out after 120000ms of inactivity',
              tone: 'danger',
            },
          ],
        }),
      ],
      'worker-link-controls',
    )

    render(ThreadTab)
    await selectedThread().findByText(/partial progress/i)
    await userEvent.click(screen.getByRole('button', { name: 'Resume work' }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.startsWith('/api/project/start') &&
        call.body?.taskId === 'task-link-controls' &&
        call.body?.mode === 'continuous'
      ))).toBe(true)
    })
  })

  it('counts exploring imported drafts as Guildhall shaping after drafting starts', async () => {
    installFetchFakes(
      [
        importedDraftTurn({
          taskStatus: 'exploring',
          summary: 'Imported draft has a task brief in progress.',
        }),
      ],
      'draft-link-controls',
    )

    render(ThreadTab)
    await selectedThread().findByText('Guildhall shaping')
    expect(selectedThread().getByText('Guildhall shaping')).toBeTruthy()
    expect(screen.queryByLabelText('Thread operations summary')).toBeNull()
  })

  it('surfaces all-terminal readiness without a start affordance when caught up', async () => {
    project.detail = {
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/repo/looma-knit',
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [
        {
          id: 'task-done',
          title: 'Done task',
          status: 'done',
          openQuestions: [],
          escalations: [],
        },
      ],
      config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'All tasks are already finished.',
      },
    }
    installFetchFakes([], null, { caughtUp: true })

    render(ThreadTab)

    await screen.findByText('All tasks are already finished.')
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
  })

  it('shows start failures inline when a queued task cannot resume', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/thread')) {
        return json({
          turns: [workerTurn({ liveAgent: undefined, taskStatus: 'exploring', summary: 'Ready for work.' })],
          activeTurnId: 'worker-link-controls',
          caughtUp: false,
        })
      }
      if (url.startsWith('/api/project/start')) {
        return json({ error: 'Provider model is not loaded.' }, { status: 409 })
      }
      if (url.startsWith('/api/project')) return json({ id: 'looma-knit', run: { status: 'stopped' }, tasks: [] })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ThreadTab)
    await selectedThread().findByText(/Guildhall has started shaping this task/)
    await userEvent.click(screen.getByRole('button', { name: /continue drafting spec/i }))

    await screen.findByText('Provider model is not loaded.')
  })

  it('docks the selected active shaping turn above the composer controls', async () => {
    installFetchFakes([
      importedDraftTurn({
        id: 'draft-docked-shaping',
        taskId: 'task-docked-shaping',
        taskTitle: 'Knit: add link editor controls',
        importedDraft: false,
        taskStatus: 'exploring',
        phase: 'inflight',
        summary: 'Guildhall has started shaping this task, but the brief is not ready yet. The checklist shows what is still missing.',
        checklist: {
          title: 'Task brief checklist',
          doneCount: 2,
          totalSteps: 4,
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'active' },
            { id: 'criteria', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
          ],
        },
      }),
    ], 'draft-docked-shaping')

    render(ThreadTab)

    await screen.findByLabelText('Active thread dock')
    expect(activeThreadDock().getByText('Knit: add link editor controls')).toBeTruthy()
    expect(activeThreadDock().getByText(/Guildhall has started shaping this task/)).toBeTruthy()
    expect(activeThreadDock().getByText('Brief checklist')).toBeTruthy()
    expect(activeThreadDock().getByRole('button', { name: /inspect details/i })).toBeTruthy()
    expect(activeThreadDock().getByRole('button', { name: /add optional note/i })).toBeTruthy()
    expect(activeThreadDock().getByRole('button', { name: /continue shaping brief/i })).toBeTruthy()
    expect(threadHistory().queryByText(/Guildhall has started shaping this task/)).toBeNull()
  })

  it('uses compact list-detail navigation instead of stacking panes', async () => {
    installViewportMatchMedia(640)
    installFetchFakes([
      importedDraftTurn({
        id: 'draft-compact-nav',
        taskId: 'task-compact-nav',
        taskTitle: 'Knit: add compact nav behavior',
        importedDraft: false,
        taskStatus: 'exploring',
        phase: 'inflight',
        summary: 'Guildhall has started shaping this task, but the brief is not ready yet.',
      }),
    ], 'draft-compact-nav')

    render(ThreadTab)

    await screen.findByRole('button', { name: /knit: add compact nav behavior/i })
    expect(screen.queryByLabelText('Selected thread')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /knit: add compact nav behavior/i }))
    await screen.findByLabelText('Selected thread')
    expect(screen.getByLabelText('Thread list').getAttribute('inert')).not.toBeNull()

    window.dispatchEvent(new CustomEvent('guildhall:thread-show-list'))
    await screen.findByLabelText('Thread list')
    expect(screen.getByLabelText('Selected thread').getAttribute('inert')).not.toBeNull()
  })

  it('strips compact list view down to the mailbox surface', async () => {
    installViewportMatchMedia(640)
    installFetchFakes([
      importedDraftTurn({
        id: 'draft-compact-mailbox',
        taskId: 'task-compact-mailbox',
        taskTitle: 'Knit: compact mailbox cleanup',
        importedDraft: false,
        taskStatus: 'exploring',
        phase: 'inflight',
        summary: 'Guildhall has started shaping this task, but the brief is not ready yet.',
      }),
    ], 'draft-compact-mailbox', {
      runtime: {
        status: 'stopped',
        mode: 'compatibility',
        health: { status: 'unknown' },
        setup: { status: 'unknown-error' },
      },
    })

    render(ThreadTab)

    await screen.findByLabelText('Thread list')
    expect(screen.queryByRole('heading', { name: 'Threads' })).toBeNull()
    expect(screen.queryByText('Decisions, questions, and live task updates.')).toBeNull()
    expect(screen.queryByText('Runtime')).toBeNull()
    expect(screen.getByRole('button', { name: /knit: compact mailbox cleanup/i })).toBeTruthy()
  })

  it('renders thread content before runtime side-loaders finish', async () => {
    installViewportMatchMedia(1280)
    const pending = new Promise<Response>(() => {})
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/thread/extras')) {
        return pending
      }
      if (url.startsWith('/api/project/thread')) {
        return json({
          turns: [
            importedDraftTurn({
              id: 'draft-nonblocking-load',
              taskId: 'task-nonblocking-load',
              taskTitle: 'Knit: do not block thread rendering on runtime fetches',
              importedDraft: false,
              taskStatus: 'exploring',
              phase: 'inflight',
              summary: 'Guildhall has started shaping this task, but the brief is not ready yet.',
            }),
          ],
          activeTurnId: 'draft-nonblocking-load',
          caughtUp: false,
        })
      }
      if (
        url.startsWith('/api/project/runtime') ||
        url.startsWith('/api/project/runtime/dev-servers') ||
        url.startsWith('/api/project/capability-requests')
      ) {
        return pending
      }
      if (url.startsWith('/api/project')) {
        return json({
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          run: { status: 'running', mode: 'continuous' },
          tasks: [],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ThreadTab)

    await screen.findByRole(
      'button',
      { name: /knit: do not block thread rendering on runtime fetches/i },
      { timeout: 400 },
    )
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/thread/extras'))).toBe(true)
  })

  it('shows a retryable load error when the thread endpoint fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/thread')) {
        return json({ error: 'boom' }, { status: 500 })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ThreadTab)
    await screen.findByText('Thread unavailable')
    expect(screen.getByText(/HTTP 500/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/project/thread')).length).toBeGreaterThan(1)
    })
  })
})
