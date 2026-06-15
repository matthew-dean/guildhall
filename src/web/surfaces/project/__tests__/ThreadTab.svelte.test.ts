// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
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
      ?? (screen.queryByLabelText('Thread history') as HTMLElement | null)
      ?? document.querySelector('.thread-detail-scroll')
      ?? (document.querySelector('.thread-detail-scroll .stack') as HTMLElement | null)
      ?? document.querySelector('.thread')
      ?? document.body) as HTMLElement,
  )
}

function threadHistory() {
  return within(
    ((screen.queryByLabelText('Thread history') as HTMLElement | null)
      ?? document.querySelector('.thread-detail-scroll')
      ?? (screen.queryByRole('region', { name: 'Selected thread' }) as HTMLElement | null)
      ?? document.querySelector('.thread-detail')
      ?? document.body) as HTMLElement,
  )
}

function activeThreadDock() {
  return within(screen.getByLabelText('Active thread dock'))
}

function threadComposer() {
  return within(
    ((screen.queryByLabelText('Thread composer') as HTMLElement | null)
      ?? document.querySelector('.thread-composer-shell')
      ?? document.querySelector('.thread-footer')
      ?? document.body) as HTMLElement,
  )
}

async function openThreadRow(pattern: RegExp | string) {
  const label = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern
  const row = await screen.findByRole('button', { name: label })
  await userEvent.click(row)
  return row
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

function historyNoteTurn(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'history_note',
    id: 'history-link-controls',
    at: now,
    persona: 'system',
    status: 'done',
    phase: 'done',
    taskId: 'task-link-controls',
    taskTitle: 'Knit: add link editor controls',
    constructionMode: 'blueprint',
    category: 'system',
    label: 'Recovery history',
    summary: 'Guildhall preserved the latest durable draft before retrying.',
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
  requestStage?: 'new_request' | 'task_brief_cleanup'
  routingSummary: string
  logicalWorkCount?: number
  deliveryStepCount?: number
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
    selectionMode?: 'single' | 'multiple'
    evidence: string[]
  }
  answerEndpoint: string
}

interface BoundedChatTurnForTest {
  kind: 'bounded_chat'
  id: string
  at: string
  persona: 'intake'
  status: 'done' | 'active' | 'pending'
  phase: 'intake'
  sessionId: string
  subObjectiveId: string
  targetTitle: string
  domainTitle: string
  actionHref: string
  question: {
    id: string
    prompt: string
    why: string
    choices?: string[]
    selectionMode?: 'single' | 'multiple'
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

function boundedChatTurn(
  overrides: Partial<BoundedChatTurnForTest> = {},
): BoundedChatTurnForTest {
  return {
    kind: 'bounded_chat',
    id: 'bounded-chat:bc-new-thread-1:request-scope',
    at: now,
    persona: 'intake',
    status: 'active',
    phase: 'intake',
    sessionId: 'bc-new-thread-1',
    subObjectiveId: 'request-scope',
    targetTitle: 'Looma + Knit',
    domainTitle: 'New request',
    actionHref: '/thread?thread=bc-new-thread-1',
    question: {
      id: 'request-scope',
      prompt: 'Should Guildhall shape this as a task or keep it as a project question?',
      why: 'This decides whether Guildhall creates work or answers in Thread.',
      choices: ['Shape a task', 'Answer in Thread'],
      evidence: [],
    },
    answerEndpoint: '/api/project/bounded-chat/bc-new-thread-1/answer',
    ...overrides,
  }
}

function installBrowserFakes(url = '/projects/looma-knit/thread') {
  window.history.replaceState({}, '', url)
  path.href = url
  path.value = url.split('?')[0]?.split('#')[0] ?? url
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
    approveSpecResponse?: Response
    onApproveSpec?: (taskId: string) => void
    sourceNoteResponse?: Response | (() => Response | Promise<Response>)
    capabilityRequests?: unknown[]
    runtime?: unknown
    projectRunStatus?: string
    startReadiness?: unknown
    projectAvailability?: { status: string; pausedAt?: string | null; resumedAt?: string | null }
    caughtUp?: boolean
    threadState?: () => { turns: unknown[]; activeTurnId: string | null; caughtUp?: boolean }
    onSetupSubmit?: (url: string, body: Record<string, unknown> | undefined) => void
    boundedChatAnswerResponse?: Response | (() => Response | Promise<Response>)
  } = {},
) {
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, init, body })
    if (url.startsWith('/api/project/thread')) {
      const state = options.threadState?.()
      if (state) return json({ turns: state.turns, activeTurnId: state.activeTurnId, caughtUp: state.caughtUp ?? false })
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
    if (url.startsWith('/api/project/task/') && url.includes('/continue')) {
      return json({ ok: true, status: 'exploring', continuation: { status: 'started', runStatus: 'running' } })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/enrich-task')) {
      return json({ ok: true, status: 'exploring' })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/resume')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/stage-answer')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/approve-spec')) {
      if (options.approveSpecResponse) return options.approveSpecResponse
      const taskId = decodeURIComponent(url.split('/api/project/task/')[1]?.split('/approve-spec')[0] ?? '')
      options.onApproveSpec?.(taskId)
      return json({ ok: true, status: 'ready' })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/answer-questions')) {
      if (options.answerQuestionsResponse) return options.answerQuestionsResponse
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/pressure-test/') && url.includes('/answer')) {
      return json({ intake: { id: 'pti-guildhall-0-8-0', pendingQuestion: null } })
    }
    if (url.startsWith('/api/project/bounded-chat/') && url.includes('/answer')) {
      if (options.boundedChatAnswerResponse) {
        return typeof options.boundedChatAnswerResponse === 'function'
          ? options.boundedChatAnswerResponse()
          : options.boundedChatAnswerResponse
      }
      return json({ boundedChat: { id: 'bc-new-thread-1', status: 'coordinator_review' } })
    }
    if (url.startsWith('/api/project/meta-intake/synthesize')) return json({ ok: true })
    if (url.startsWith('/api/setup/')) {
      options.onSetupSubmit?.(url, body)
      return json({ ok: true })
    }
    if (url.startsWith('/api/project')) {
      return json({
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/repo/looma-knit',
        run: { status: options.projectRunStatus ?? 'running', mode: 'continuous' },
        availability: options.projectAvailability ?? { status: 'active', pausedAt: null, resumedAt: null },
        startReadiness: options.startReadiness ?? { canStart: true },
        ...(options.runtime ? { runtime: options.runtime } : {}),
        ...(project.detail?.taskRoutingContexts ? { taskRoutingContexts: project.detail.taskRoutingContexts } : {}),
        ...(project.detail?.deliverySpine ? { deliverySpine: project.detail.deliverySpine } : {}),
        tasks: [],
      })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

function markProjectPaused() {
  project.detail = {
    ...(project.detail as any),
    run: { status: 'stopped', mode: 'continuous' },
    availability: { status: 'paused', pausedAt: now, resumedAt: null },
  }
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
    await selectedThread().findByPlaceholderText('Project name')

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
    expect(screen.getByText(/A decision is needed before this folder can be used safely/)).toBeTruthy()
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

  it('keeps capability request decisions visible alongside an active bounded-chat thread', async () => {
    const { calls } = installFetchFakes([
      boundedChatTurn({
        targetTitle: 'Approve fixture access',
        question: {
          id: 'request-scope',
          prompt: 'Should Guildhall inspect the sibling fixture folder?',
          why: 'The worker needs one folder decision before it can continue.',
          choices: ['Approve the folder', 'Use the snapshot'],
          evidence: [],
        },
      }),
    ], 'bounded-chat:bc-new-thread-1:request-scope', {
      capabilityRequests: [{
        id: 'cap-fixture-alpha-1',
        taskId: 'task-fixture-alpha',
        kind: 'mount_directory',
        requestedBy: 'runtime-command',
        reason: 'Telemetry Bridge needs read access to ../fixtures/packets.',
        duration: 'this task',
        fallback: 'Use the committed packet snapshot.',
        status: 'pending',
        mount: {
          hostPath: '/Users/matthew/git/fixtures/packets',
          containerPath: '/mnt/requested/packets',
          access: 'read-write',
        },
      }],
    })

    render(ThreadTab)

    expect(await screen.findByText('Access requests')).toBeTruthy()
    expect(screen.getByText('Telemetry Bridge needs read access to ../fixtures/packets.')).toBeTruthy()
    expect(screen.getAllByText('Approve fixture access').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /approve read-only/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve read-write/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /use fallback/i })).toBeTruthy()
    expect(selectedThread().getByText('Should Guildhall inspect the sibling fixture folder?')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /use fallback/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/project/capability-requests/cap-fixture-alpha-1/deny'))).toBe(true)
    })
    expect(calls.find(call => call.url.includes('/deny'))?.body).toMatchObject({
      fallback: 'Use the committed packet snapshot.',
    })
  })

  it('does not render runtime state inside Threads', async () => {
    installFetchFakes([], null, {
      runtime: {
        status: 'stopped',
        health: { status: 'healthy' },
        migration: { mode: 'host-run' },
        backendSetup: { status: 'ready', selectedMode: 'host-run' },
      },
    })

    render(ThreadTab)

    await waitFor(() => expect(screen.queryByText('Runtime')).toBeNull())
    expect(screen.queryByText('Runtime stopped')).toBeNull()
    expect(screen.queryByText(/Compatibility mode/)).toBeNull()
  })

  it('renders request and active pressure-test question turns as owner input', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    const { calls } = installFetchFakes([
      requestTurn(),
      pressureTestQuestionTurn(),
    ], 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1')

    render(ThreadTab)

    await screen.findByText('New thread')
    expect(screen.queryByLabelText('Thread operations summary')).toBeNull()
    expect(selectedThread().getByText('0.8.0 should prioritize pressure-test intake.')).toBeTruthy()
    expect(selectedThread().getByText('Question')).toBeTruthy()
    expect(selectedThread().queryByText(/Guildhall 0\.8\.0 · Product goals/)).toBeNull()
    expect(selectedThread().getByText('What should Guildhall 0.8.0 accomplish?')).toBeTruthy()
    expect(selectedThread().getByText('This decides the release slice.')).toBeTruthy()
    expect(selectedThread().getByText('internal/plans/guildhall-0-8.md: release goals')).toBeTruthy()
    expect(screen.getAllByText('Needs you').length).toBeGreaterThan(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('selects a bounded-chat thread from the route query', async () => {
    installBrowserFakes('/projects/looma-knit/thread?thread=bc-new-thread-1')
    installFetchFakes([
      workerTurn({
        id: 'worker-cleanup',
        taskId: 'task-cleanup',
        taskTitle: 'Clean up task intake',
        at: '2026-05-19T15:10:00.000Z',
        summary: 'Guildhall is cleaning up task intake.',
      }),
      boundedChatTurn(),
    ], 'worker-cleanup')

    render(ThreadTab)

    await selectedThread().findByText('Should Guildhall shape this as a task or keep it as a project question?')
    expect(selectedThread().queryByText('Guildhall is cleaning up task intake.')).toBeNull()
  })

  it('opens a routed bounded-chat prompt directly on compact Thread even when many threads exist', async () => {
    installViewportMatchMedia(640)
    installBrowserFakes('/projects/looma-knit/thread?thread=bc-new-thread-1')
    const manyDrafts = Array.from({ length: 14 }, (_, index) =>
      importedDraftTurn({
        id: `draft-hidden-${index}`,
        taskId: `task-hidden-${index}`,
        taskTitle: `Knit backlog item ${index + 1}`,
        taskDescription: `Old imported note ${index + 1} should stay in the thread list.`,
      }),
    )
    installFetchFakes([
      ...manyDrafts,
      boundedChatTurn({
        question: {
          id: 'request-scope',
          prompt: 'What should Guildhall shape first for Looma + Knit?',
          why: 'This answer starts the bounded setup conversation.',
          evidence: [],
        },
      }),
    ], 'draft-hidden-0')

    render(ThreadTab)

    const selected = await screen.findByRole('region', { name: 'Selected thread' })
    expect(within(selected).getByText('What should Guildhall shape first for Looma + Knit?')).toBeTruthy()
    expect(within(selected).getByPlaceholderText('Answer with a sentence or short paragraph. Include constraints or success measures if they matter.')).toBeTruthy()
    expect(document.querySelector('.thread-compact-detail')).toBeTruthy()
  })

  it('renders first-spec setup with fresh setup copy and no impossible age', async () => {
    installFetchFakes([
      setupTurn({
        id: 'setup:firstTask',
        stepId: 'firstTask',
        at: '1970-01-01T00:00:00.000Z',
        title: 'Name this project',
        why: 'Guildhall needs a stable project identity before it can manage work.',
        affordance: 'inline-text',
        actionLabel: 'Start shaping',
        submitEndpoint: '/api/project/intake',
        placeholder: 'Describe the product idea or first outcome',
        currentValue: '',
      }),
      pressureTestQuestionTurn({
        id: 'pressure-test:pti-commerce-old-setup:old-success-question',
        intakeId: 'pti-commerce-old-setup',
        targetTitle: 'Commerce Project project setup',
        question: {
          id: 'old-success-question',
          prompt: 'What outcome would make this old pressure test successful?',
          why: 'This stale question predates first-spec setup.',
          evidence: [],
        },
      }),
    ], 'setup:firstTask')

    render(ThreadTab)

    await selectedThread().findByPlaceholderText('Describe the product idea or first outcome')
    expect(selectedThread().getByText('Shape the first spec')).toBeTruthy()
    expect(selectedThread().queryByText('Name this project')).toBeNull()
    expect(screen.queryByText(/\b20\d{3}d\b/)).toBeNull()
  })

  it('renders only the current setup step inside the setup thread', async () => {
    installBrowserFakes('/projects/looma-knit/thread?thread=setup')
    installFetchFakes([
      setupTurn({
        id: 'setup:identity',
        stepId: 'identity',
        at: '1970-01-01T00:00:00.000Z',
        status: 'done',
        phase: 'done',
        title: 'Name this project',
        why: 'Guildhall needs a workspace id and human name.',
      }),
      setupTurn({
        id: 'setup:direction',
        stepId: 'direction',
        at: '2026-05-19T15:02:00.000Z',
        status: 'active',
        phase: 'setup',
        title: 'Give the project direction',
        why: 'Start with a short brief you can edit.',
        skippable: true,
        affordance: 'inline-textarea',
        actionLabel: 'Save',
        submitEndpoint: '/api/setup/direction',
        currentValue: '',
        placeholder: 'What should Guildhall know?',
      }),
      setupTurn({
        id: 'setup:project-check-in',
        stepId: 'projectCheckIn',
        at: '1970-01-01T00:03:00.000Z',
        status: 'pending',
        phase: 'setup',
        title: 'Run project check-in',
        why: 'Guildhall has not generated the first project questions yet.',
        skippable: true,
        affordance: 'inline-button',
        actionLabel: 'Start project check-in',
      }),
      setupTurn({
        id: 'setup:import',
        stepId: 'import',
        at: '1970-01-01T00:04:00.000Z',
        status: 'pending',
        phase: 'setup',
        title: 'Review existing work',
        why: 'Turn the real work hiding in notes into backlog tasks.',
        skippable: true,
        affordance: 'link',
        actionLabel: 'Open setup',
      }),
      setupTurn({
        id: 'setup:firstTask',
        stepId: 'firstTask',
        at: '2026-05-19T15:03:00.000Z',
        status: 'pending',
        phase: 'setup',
        title: 'Shape the first spec',
        why: 'Turn a rough idea into a product brief.',
        affordance: 'inline-text',
        actionLabel: 'Start shaping',
      }),
    ], 'setup:direction')

    render(ThreadTab)

    await screen.findByPlaceholderText('What should Guildhall know?')
    expect(screen.getByRole('button', { name: /Give the project direction/i })).toBeTruthy()
    const detail = within(document.querySelector('.thread-detail') as HTMLElement)
    expect(detail.getByText('Give the project direction')).toBeTruthy()
    expect(detail.queryByText('Name this project')).toBeNull()
    expect(detail.queryByText('Run project check-in')).toBeNull()
    expect(detail.queryByText('Review existing work')).toBeNull()
    expect(detail.queryByText('Shape the first spec')).toBeNull()
    expect(document.querySelectorAll('.setup-title')).toHaveLength(1)
  })

  it('renders bounded-chat turns as a flat question section instead of a nested card', async () => {
    const { calls } = installFetchFakes([
      boundedChatTurn({
        domainTitle: 'Project question',
        question: {
          id: 'project-question-context',
          prompt: 'Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?',
          why: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
          choices: ['Use current blocker evidence', 'Use project docs', 'No extra context'],
          evidence: [],
        },
      }),
    ], 'bounded-chat:bc-new-thread-1:request-scope')

    render(ThreadTab)

    await selectedThread().findByText('Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?')
    const question = document.querySelector('.thread-active-question-flat')
    expect(question).toBeTruthy()
    expect(within(question as HTMLElement).getByText('Question')).toBeTruthy()
    expect(within(question as HTMLElement).queryByText(/Project question/)).toBeNull()
    expect(document.querySelector('.thread-active-dock .bounded-chat-panel')).toBeNull()
    expect(document.querySelector('.thread-active-question-flat .question-card-heading')).toBeNull()
  })

  it('submits bounded-chat text answers through the shared composer', async () => {
    const { calls } = installFetchFakes([
      boundedChatTurn({
        domainTitle: 'Project question',
        question: {
          id: 'project-question-context',
          prompt: 'What source should Guildhall use before it answers this in Thread?',
          why: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
          evidence: [],
        },
      }),
    ], 'bounded-chat:bc-new-thread-1:request-scope')

    render(ThreadTab)

    const composer = threadComposer()
    const input = await composer.findByPlaceholderText(/answer with a sentence/i)
    await userEvent.type(input, 'Use the current blocker evidence.')
    await userEvent.click(composer.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      expect(calls.some(call =>
        call.url.includes('/api/project/bounded-chat/bc-new-thread-1/answer') &&
        call.body?.questionId === 'project-question-context' &&
        call.body?.answer === 'Use the current blocker evidence.',
      )).toBe(true)
    })
    expect(screen.queryByText(/bounded chat objective is not supported/i)).toBeNull()
  })

  it('sends the shared composer with Enter and preserves newlines with Shift+Enter', async () => {
    const user = userEvent.setup()
    const { calls } = installFetchFakes([
      boundedChatTurn({
        question: {
          id: 'project-question-context',
          prompt: 'What source should Guildhall use before it answers this in Thread?',
          why: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
          evidence: [],
        },
      }),
    ], 'bounded-chat:bc-new-thread-1:request-scope')

    render(ThreadTab)

    const input = await threadComposer().findByPlaceholderText(/answer with a sentence/i)
    await user.type(input, 'First line{Shift>}{Enter}{/Shift}Second line')
    expect((input as HTMLTextAreaElement).value).toBe('First line\nSecond line')

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(calls.some(call =>
        call.url.includes('/api/project/bounded-chat/bc-new-thread-1/answer') &&
        call.body?.answer === 'First line\nSecond line',
      )).toBe(true)
    })
  })

  it('selects the current cleanup work instead of the saved request routing event', async () => {
    installFetchFakes([
      requestTurn({
        id: 'request:fll-overhead-policy',
        status: 'done',
        phase: 'done',
        requestId: 'fll-overhead-policy',
        taskId: 'task-fll-overhead-policy',
        title: 'Set FLL overhead charge policy',
        rawRequest: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
        requestStage: 'task_brief_cleanup',
        routingSummary: 'Guildhall saved this cleanup request and queued the task brief in Thread.',
      }),
      {
        kind: 'history_note',
        id: 'request:task-fll-overhead-policy:brief-cleanup',
        at: now,
        persona: 'intake',
        status: 'done',
        phase: 'done',
        taskId: 'task-fll-overhead-policy',
        taskTitle: 'Set FLL overhead charge policy',
        constructionMode: 'blueprint',
        category: 'request',
        label: 'Brief cleanup requested',
        summary: 'Guildhall was asked to clean up this task brief before worker execution.',
      },
      importedDraftTurn({
        id: 'turn-fll-overhead-cleanup',
        taskId: 'task-fll-overhead-policy',
        taskTitle: 'Set FLL overhead charge policy',
        taskStatus: 'exploring',
        importedDraft: false,
        requestStage: 'task_brief_cleanup',
        phase: 'intake',
        summary: 'Guildhall queued task brief cleanup before worker handoff.',
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
    ], 'turn-fll-overhead-cleanup')

    render(ThreadTab)

    expect((await selectedThread().findAllByText('Brief cleanup')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Routed to Task Intake')).toBeNull()
    expect(selectedThread().queryByText('New thread')).toBeNull()
    expect(threadHistory().getByText('Brief cleanup requested')).toBeTruthy()
    expect(selectedThread().getByText(/Task brief cleanup is queued/)).toBeTruthy()
    expect(selectedThread().getByRole('button', { name: /clean up brief/i })).toBeTruthy()
  })

  it('does not tell users to resume workspace import while owner input blocks the project', async () => {
    project.detail = {
      ...(project.detail as any),
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Review the project map needs your answer before work can continue',
        actionHref: '/thread?thread=bc-jess-structural_review',
      },
    }
    installFetchFakes([
      importedDraftTurn({
        id: 'workspace-import-review',
        taskId: 'task-workspace-import',
        taskTitle: 'Review existing project work',
        taskStatus: 'exploring',
        importedDraft: false,
        summary: 'Review existing project work.',
      }),
    ], 'workspace-import-review', {
      projectRunStatus: 'stopped',
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Review the project map needs your answer before work can continue',
        actionHref: '/thread?thread=bc-jess-structural_review',
      },
    })

    render(ThreadTab)

    expect((await selectedThread().findAllByText(/answer the current blocker before project notes can keep moving/i)).length).toBeGreaterThan(0)
    expect(selectedThread().queryByText(/resume Guildhall to keep turning your project notes/i)).toBeNull()
  })

  it('does not move the viewport when a new active thread turn appears', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    installFetchFakes([
      workerTurn(),
    ], 'worker-link-controls')

    render(ThreadTab)

    await threadComposer().findByPlaceholderText('Add a note…')
    expect(selectedThread().getByText('Work is paused. Resume when you want it to continue.')).toBeTruthy()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls the selected thread list item into view when the active turn is deep in the list', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    const crowded = Array.from({ length: 12 }, (_, index) =>
      importedDraftTurn({
        id: `draft-scroll-${index}`,
        taskId: `task-scroll-${index}`,
        taskTitle: `Scroll candidate ${index + 1}`,
      }),
    )
    installFetchFakes(crowded, 'draft-scroll-10')

    render(ThreadTab)

    const row = await screen.findByRole('button', { name: /Scroll candidate 11/i })
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('defaults to the spec thread targeted by start readiness instead of the setup thread', async () => {
    installFetchFakes([
      setupTurn({
        id: 'setup-workspace-import',
        stepId: 'workspaceImport',
        title: 'Review existing work',
        why: 'Review sources and possible backlog tasks Guildhall found.',
        actionLabel: 'Open import review',
        actionHref: '/workspace-import',
      }),
      specReviewTurn('task-spec-a', {
        taskTitle: 'Approve the first waiting spec',
      }),
    ], 'setup-workspace-import')

    render(ThreadTab)

    await screen.findByRole('button', { name: /Review existing work/i })
    project.detail = {
      ...(project.detail as any),
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: 'Review 1 waiting spec before starting.',
        actionHref: '/thread?thread=task%3Atask-spec-a',
      },
    }

    const row = await screen.findByRole('button', { name: /Approve the first waiting spec/i })
    await waitFor(() => expect(row.getAttribute('aria-current')).toBe('true'))
    expect(selectedThread().getByText('Open the full spec before you approve it or redirect it.')).toBeTruthy()
    expect(selectedThread().getByRole('button', { name: /view spec/i })).toBeTruthy()
    expect(selectedThread().queryByRole('button', { name: /open import review/i })).toBeNull()
  })

  it('keeps the composer bottom-anchored when a single active card has a footer composer', async () => {
    installFetchFakes([
      importedDraftTurn({
        id: 'draft-empty-chat-layout',
        taskId: 'task-empty-chat-layout',
        taskTitle: 'Empty chat layout',
      }),
    ], 'draft-empty-chat-layout')

    render(ThreadTab)

    await selectedThread().findByText('Starting point and source notes')
    const detailFlow = document.querySelector('.thread-detail-flow')
    const threadList = document.querySelector('.thread-list')
    expect(detailFlow?.classList.contains('thread-detail-flow-single')).toBe(false)
    expect(threadList?.classList.contains('thread-list-single')).toBe(false)
    expect(document.querySelector('.thread-footer')).toBeTruthy()
  })

  it('centers a single setup card only when there is no footer composer', async () => {
    installFetchFakes([
      setupTurn({
        id: 'setup-workspace-import',
        stepId: 'workspaceImport',
        title: 'Review existing work',
        why: 'Review sources and possible backlog tasks Guildhall found.',
        affordance: 'link',
        actionLabel: 'Open import review',
        actionHref: '/workspace-import',
      }),
    ], 'setup-workspace-import')

    render(ThreadTab)

    await selectedThread().findByRole('button', { name: /open import review/i })
    const detailFlow = document.querySelector('.thread-detail-flow')
    const threadList = document.querySelector('.thread-list')
    expect(detailFlow?.classList.contains('thread-detail-flow-single')).toBe(true)
    expect(threadList?.classList.contains('thread-list-single')).toBe(true)
    expect(document.querySelector('.thread-footer')).toBeNull()
  })

  it('posts pressure-test answers, refreshes Thread and project, and clears the local answer', async () => {
    const { calls } = installFetchFakes([
      requestTurn(),
      pressureTestQuestionTurn(),
    ], 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1')

    render(ThreadTab)
    await selectedThread().findByText('What should Guildhall 0.8.0 accomplish?')

    const answer = threadComposer().getByPlaceholderText('Answer with a sentence or short paragraph. Include constraints or success measures if they matter.')
    await userEvent.type(answer, 'Keep the request visible and ask one focused question at a time.')
    await userEvent.click(threadComposer().getByRole('button', { name: 'Send' }))

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
    expect(threadComposer().getByText('Reply in thread')).toBeTruthy()
    const composer = threadComposer().getByPlaceholderText('Answer this question or redirect the thread…')
    await userEvent.type(composer, 'Keep the first pass narrowly focused on owner-facing intake.')
    await userEvent.click(threadComposer().getByRole('button', { name: 'Send' }))

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

    await selectedThread().findByRole('button', { name: 'View spec' })
    await userEvent.click(selectedThread().getByRole('button', { name: 'View spec' }))
    const dialog = await screen.findByRole('dialog', { name: /approve spec/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }))

    expect(threadComposer().getByPlaceholderText('Correct the spec or ask for another pass…')).toBeTruthy()
  })

  it('renders prior task-chain items as timeline events instead of repeating the task title as a mini task card', async () => {
    installFetchFakes([
      briefTurn({
        id: 'brief-history',
        status: 'done',
        phase: 'done',
      }),
      specReviewTurn('task-link-controls'),
    ], 'task:task-link-controls')

    render(ThreadTab)

    await selectedThread().findByRole('button', { name: 'View spec' })
    expect(threadHistory().getByText('Brief finalized')).toBeTruthy()
    expect(threadHistory().queryByText(/^Guildhall$/)).toBeNull()
    expect(threadHistory().queryByText(/^Completed /)).toBeNull()
    expect(threadHistory().queryByRole('button', { name: /knit: add link editor controls/i })).toBeNull()
  })

  it('clusters repeated historical review feedback without repeating the event header', async () => {
    installFetchFakes([
      reviewFeedbackTurn({
        id: 'review-link-controls-1',
        at: '2026-05-17T15:00:00.000Z',
        status: 'done',
        phase: 'done',
        revisionCount: 1,
        summary: 'First reviewer pass.',
        feedback: 'First reviewer pass.',
      }),
      reviewFeedbackTurn({
        id: 'review-link-controls-2',
        at: '2026-05-18T15:00:00.000Z',
        status: 'done',
        phase: 'done',
        revisionCount: 2,
        summary: 'Second reviewer pass.',
        feedback: 'Second reviewer pass.',
      }),
      reviewFeedbackTurn({
        id: 'review-link-controls-3',
        at: '2026-05-19T15:00:00.000Z',
        status: 'done',
        phase: 'done',
        revisionCount: 3,
        summary: 'Latest reviewer pass.',
        feedback: 'Latest reviewer pass.',
      }),
      specReviewTurn('task-link-controls'),
    ], 'task:task-link-controls')

    render(ThreadTab)

    await threadHistory().findByText('Latest reviewer pass.')
    expect(threadHistory().getAllByText('Review feedback')).toHaveLength(1)
    expect(threadHistory().getByText('First reviewer pass.')).toBeTruthy()
    expect(threadHistory().getByText('Second reviewer pass.')).toBeTruthy()
    expect(threadHistory().getByText('Show 2 earlier reviewer notes')).toBeTruthy()
  })

  it('renders answered historical questions as left/right chat bubbles instead of dark task cards', async () => {
    installFetchFakes([
      {
        kind: 'agent_question',
        id: 'question-history',
        at: now,
        persona: 'coord',
        status: 'done',
        phase: 'done',
        taskId: 'task-link-controls',
        taskTitle: 'Knit: add link editor controls',
        constructionMode: 'change_order',
        question: {
          kind: 'choice',
          id: 'q-history-1',
          askedBy: 'coordinator',
          askedAt: now,
          answeredAt: '2026-05-19T15:10:00.000Z',
          answer: 'Drag-handle is out of scope for this task. Treat it as a separate follow-up.',
          prompt: 'Should drag-and-drop be in scope?',
          choices: ['Include drag handle', 'Drag handle is out of scope'],
          selectionMode: 'single',
        },
      },
      specReviewTurn('task-link-controls'),
    ], 'task:task-link-controls')

    render(ThreadTab)

    await selectedThread().findByRole('button', { name: 'View spec' })
    await threadComposer().findByRole('button', { name: 'Send' })
    expect(threadHistory().getByText('Guildhall')).toBeTruthy()
    expect(threadHistory().getByText('You')).toBeTruthy()
    expect(threadHistory().getByText('Should drag-and-drop be in scope?')).toBeTruthy()
    expect(threadHistory().getByText(/Drag-handle is out of scope for this task/i)).toBeTruthy()
    expect(threadHistory().queryByText('Question answered')).toBeNull()
  })

  it('renders pressure-test choices as immediate task-card answer buttons', async () => {
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
    const firstChoice = await screen.findByRole('button', { name: 'Reviewer-lane MVPs' })
    expect(screen.queryByPlaceholderText('Answer with a sentence or short paragraph. Include constraints or success measures if they matter.')).toBeNull()
    expect(firstChoice.classList.contains('pressure-choice-card')).toBe(true)
    expect(firstChoice.querySelector('.pressure-choice-arrow')).toBeTruthy()

    await userEvent.click(firstChoice)

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.includes('/api/project/pressure-test/pti-narrative-harness/answer') &&
        call.body?.questionId === 'project-direction-priority' &&
        call.body?.answer === 'Reviewer-lane MVPs'
      ))).toBe(true)
    })
  })

  it('renders multiple owner-input choices as selected checklist rows before submitting', async () => {
    const { calls } = installFetchFakes([
      boundedChatTurn({
        id: 'bounded-chat:bc-jess-setup:setup-steps',
        sessionId: 'bc-jess-setup',
        subObjectiveId: 'setup-steps',
        targetTitle: 'Jess',
        domainTitle: 'Setup',
        question: {
          id: 'setup-steps',
          prompt: 'This is a meta-intake task — I need to:',
          why: 'Jess needs these setup steps before Guildhall shapes future work.',
          choices: [
            "Infer the project's internal routing slices (coordinator domains)",
            'Infer lever positions from project evidence',
            'Bootstrap verification (try install + gates)',
            'Draft starter tasks',
          ],
          selectionMode: 'multiple',
          evidence: [],
        },
        answerEndpoint: '/api/project/bounded-chat/bc-jess-setup/answer',
      }),
    ], 'bounded-chat:bc-jess-setup:setup-steps')

    render(ThreadTab)
    const routing = await screen.findByRole('button', { name: /internal routing slices/i })
    const bootstrap = screen.getByRole('button', { name: /Bootstrap verification/i })

    expect(screen.getAllByText('Select every item that applies. The selected items become the setup plan.').length).toBeGreaterThan(0)
    expect(routing.classList.contains('multi')).toBe(true)
    expect(routing.querySelector('.pressure-choice-arrow')).toBeNull()
    expect((screen.getByRole('button', { name: 'Submit selected' }) as HTMLButtonElement).disabled).toBe(true)

    await userEvent.click(routing)
    await userEvent.click(bootstrap)
    expect(routing.getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Submit selected' }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.includes('/api/project/bounded-chat/bc-jess-setup/answer') &&
        call.body?.questionId === 'setup-steps' &&
        call.body?.answer === "Infer the project's internal routing slices (coordinator domains), Bootstrap verification (try install + gates)"
      ))).toBe(true)
    })
  })

  it('shows progress while submitting multiple owner-input choices', async () => {
    let resolveAnswer: ((response: Response) => void) | null = null
    installFetchFakes([
      boundedChatTurn({
        id: 'bounded-chat:bc-jess-setup:setup-steps',
        sessionId: 'bc-jess-setup',
        subObjectiveId: 'setup-steps',
        targetTitle: 'Jess',
        domainTitle: 'Setup',
        question: {
          id: 'setup-steps',
          prompt: 'This is a meta-intake task — I need to:',
          why: 'Jess needs these setup steps before Guildhall shapes future work.',
          choices: [
            'Bootstrap verification (try install + gates)',
            'Draft starter tasks',
          ],
          selectionMode: 'multiple',
          evidence: [],
        },
        answerEndpoint: '/api/project/bounded-chat/bc-jess-setup/answer',
      }),
    ], 'bounded-chat:bc-jess-setup:setup-steps', {
      boundedChatAnswerResponse: () => new Promise<Response>(resolve => {
        resolveAnswer = resolve
      }),
    })

    render(ThreadTab)
    await userEvent.click(await screen.findByRole('button', { name: /Bootstrap verification/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit selected' }))

    const submitting = await screen.findByRole('button', { name: 'Submitting...' })
    expect((submitting as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Submit selected' })).toBeNull()

    resolveAnswer?.(json({ boundedChat: { id: 'bc-jess-setup', status: 'coordinator_review' } }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Submitting...' })).toBeNull())
  })

  it('renders structural-review bounded chat without raw reason and target ids', async () => {
    const { calls } = installFetchFakes([
      boundedChatTurn({
        id: 'bounded-chat:bc-jess-structural-review:owner-input-1',
        sessionId: 'bc-jess-structural-review',
        subObjectiveId: 'owner-input-1',
        targetTitle: 'Jess',
        domainTitle: 'Review structural map structural-map-mpyrvqjg',
        question: {
          id: 'owner-input-1',
          prompt: 'Review the proposed domains, package graph, executable units, and Git authority before Guildhall uses this map for routing.',
          why: 'Reason: owner_review_required_before_routing_truth\nTargets: cross-cutting:accessibility, cross-cutting:parser-parity, domain:css, domain:less, domain:plugin',
          evidence: [],
        },
        answerEndpoint: '/api/project/bounded-chat/bc-jess-structural-review/answer',
      }),
    ], 'bounded-chat:bc-jess-structural-review:owner-input-1')

    render(ThreadTab)

    const row = await screen.findByRole('button', { name: /Review structural map/i })
    expect(within(row).getByText('Review structural map')).toBeTruthy()
    expect(within(row).getByText(/Review the proposed domains/i)).toBeTruthy()
    expect(screen.queryByText(/owner_review_required_before_routing_truth/)).toBeNull()
    expect(screen.queryByText(/cross-cutting:accessibility/)).toBeNull()
    expect(screen.queryByText(/domain:css/)).toBeNull()
    expect(selectedThread().getByText(/These project areas were already inferred/i)).toBeTruthy()
    const proposedMap = screen.getByLabelText('Proposed structural map')
    expect(within(proposedMap).getByText('Already found')).toBeTruthy()
    expect(within(proposedMap).getByText('5 proposed areas')).toBeTruthy()
    expect(within(proposedMap).getByRole('heading', { name: 'Domains' })).toBeTruthy()
    expect(within(proposedMap).getByText('css')).toBeTruthy()
    expect(within(proposedMap).getByText('less')).toBeTruthy()
    expect(within(proposedMap).getByText('plugin')).toBeTruthy()
    expect(within(proposedMap).getByRole('heading', { name: 'Cross-cutting areas' })).toBeTruthy()
    expect(within(proposedMap).getByText('accessibility')).toBeTruthy()
    expect(within(proposedMap).getByText('parser parity')).toBeTruthy()
    expect(selectedThread().getByText(/Use the map if these areas look good enough/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Something looks wrong' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Use this map' }))
    await waitFor(() => expect(calls.some(call => (
      call.url.includes('/api/project/bounded-chat/bc-jess-structural-review/answer') &&
      call.body?.questionId === 'owner-input-1' &&
      call.body?.answer === 'Use this structural map for routing.'
    ))).toBe(true))
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

  it('shows matched routing context where the user starts a task', async () => {
    project.detail = {
      ...(project.detail as any),
      taskRoutingContexts: {
        'task-link-controls': {
          taskId: 'task-link-controls',
          status: 'matched',
          summary: 'Guildhall will start with Editor UI and 1 likely check.',
          likelyArea: { id: 'package:editor-ui', label: 'Editor UI', path: 'packages/editor-ui' },
          primaryDomain: { id: 'domain:editor', label: 'Editor workflow' },
          checks: [{ id: 'exec:editor-ui:test', label: 'editor ui test', command: 'pnpm --filter editor-ui test' }],
          reasons: ['Matched files under packages/editor-ui.', 'Uses the Editor workflow work area.'],
          omittedCount: 4,
        },
      },
    }
    installFetchFakes([
      workerTurn({
        taskDescription: 'Build URL input, display text, open-in-new-tab, and remove link controls.',
        sourceNote: { references: ['docs/roadmap.md'] },
      }),
    ], 'worker-link-controls')

    render(ThreadTab)

    await screen.findByText('Starting context')
    expect(screen.getAllByText('Editor UI').length).toBeGreaterThan(0)
    expect(screen.getByText('packages/editor-ui')).toBeTruthy()
    expect(screen.getByText('pnpm --filter editor-ui test')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change this context' })).toBeTruthy()
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
    await selectedThread().findByPlaceholderText('Describe the product idea or first outcome')

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
    await selectedThread().findByRole('button', { name: /mark done/i })

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
    await selectedThread().findByPlaceholderText('Project name')

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

    await screen.findByText('Current setup context')
    expect(screen.getByText(/current snapshot from local files/i)).toBeTruthy()
    expect(screen.getByText('Coordinator areas: Design.')).toBeTruthy()
    expect(screen.getByText(/saved direction is the durable plan input/i)).toBeTruthy()
    expect(screen.getByDisplayValue('AI-powered font generation desktop application.')).toBeTruthy()
  })

  it('submits direction, coordinator, and bootstrap setup affordances without leaving Thread', async () => {
    let activeSetupStep: 'direction' | 'coordinator' | 'bootstrap' = 'direction'
    const setupTurnsForState = () => {
      const directionDone = activeSetupStep !== 'direction'
      const coordinatorDone = activeSetupStep === 'bootstrap'
      return [
        setupTurn({
          id: 'setup-direction',
          stepId: 'direction',
          status: directionDone ? 'done' : 'active',
          phase: directionDone ? 'done' : 'setup',
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
          status: directionDone && !coordinatorDone ? 'active' : coordinatorDone ? 'done' : 'pending',
          phase: coordinatorDone ? 'done' : 'setup',
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
          status: activeSetupStep === 'bootstrap' ? 'active' : 'pending',
          phase: 'setup',
          title: 'Run setup checks',
          affordance: 'inline-button',
          actionLabel: 'Run checks',
          submitEndpoint: '/api/setup/bootstrap',
        }),
      ]
    }
    const { calls } = installFetchFakes(setupTurnsForState(), 'setup-direction', {
      threadState: () => ({
        turns: setupTurnsForState(),
        activeTurnId: `setup-${activeSetupStep}`,
      }),
      onSetupSubmit: (url) => {
        if (url.includes('/direction')) activeSetupStep = 'coordinator'
        else if (url.includes('/coordinator')) activeSetupStep = 'bootstrap'
      },
    })

    markProjectPaused()
    render(ThreadTab)
    await screen.findByPlaceholderText('What should Guildhall know?')

    await userEvent.type(screen.getByPlaceholderText('What should Guildhall know?'), 'Knit owns the editor UI.')
    await userEvent.click(screen.getByRole('button', { name: /save direction/i }))
    await screen.findByRole('combobox')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'project-manager')
    await userEvent.click(screen.getByRole('button', { name: /add coordinator/i }))
    const runChecksButton = await screen.findByRole('button', { name: /run checks/i })
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

    markProjectPaused()
    render(ThreadTab)
    await screen.findByRole('button', { name: /open setup/i })
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

    markProjectPaused()
    render(ThreadTab)
    await screen.findByRole('button', { name: /start project check-in/i })
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
    await screen.findByRole('button', { name: /run checks/i })
    await userEvent.click(screen.getByRole('button', { name: /run checks/i }))

    await selectedThread().findByText('pnpm test exited 1: Cannot find module ./Button.svelte')
  })

  it('keeps imported draft source context and actions inline in Thread', async () => {
    const { calls } = installFetchFakes([importedDraftTurn()], 'draft-link-controls')

    render(ThreadTab)
    await threadHistory().findByText('Starting point and source notes')
    expect(selectedThread().getByText(/Next step: turn this note into a task brief with scope, evidence, and acceptance criteria/)).toBeTruthy()
    expect(selectedThread().getByText('Build URL input, display text, open-in-new-tab, and remove link controls.')).toBeTruthy()
    expect(selectedThread().getByText('docs/roadmap.md')).toBeTruthy()
    expect(selectedThread().getByText('web/app/components/editor/toolbar.ts')).toBeTruthy()
    await userEvent.click(selectedThread().getByRole('button', { name: /open source note.*roadmap\.md/i }))
    await screen.findByRole('dialog', { name: 'Source note' })
    expect(screen.getByText('Roadmap source')).toBeTruthy()
    expect(screen.getByText('This is the source note Guildhall used.')).toBeTruthy()
    expect(calls.some(call => call.url.includes('/api/project/source-note') && call.url.includes('projectId=looma-knit'))).toBe(true)

    await userEvent.click(selectedThread().getByRole('button', { name: /draft task brief/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/shape-draft') && call.url.includes('projectId=looma-knit'))).toBe(true)
    })

    await userEvent.type(threadComposer().getByPlaceholderText('Add a note…'), 'Keep drag handles out of scope.')
    await userEvent.click(threadComposer().getByRole('button', { name: /send/i }))
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
    await threadHistory().findByText('Starting point and source notes')
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

    await screen.findByRole('button', { name: 'Clean up brief' })
    const needsBriefChip = selectedThread()
      .getAllByText('Needs brief')
      .find(node => node.classList.contains('chip'))
    expect(needsBriefChip).toBeTruthy()
    expect(needsBriefChip?.classList.contains('tone-warn')).toBe(true)
    expect(selectedThread().getAllByText('Brief checklist').length).toBeGreaterThan(0)
    expect(screen.queryByText('No upstream')).toBeNull()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
    expect(screen.queryByText('Guildhall next')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume work' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Finish task brief...' })).toBeNull()
    const startButton = screen.getByRole('button', { name: 'Clean up brief' })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    expect(threadComposer().getByPlaceholderText('Add a note…')).toBeTruthy()
  })

  it('keeps ready tasks with complete checklists but incomplete worker handoff out of start actions', async () => {
    const { calls } = installFetchFakes([
      importedDraftTurn({
        id: 'turn-ready-handoff-incomplete',
        taskId: 'task-ready-handoff-incomplete',
        taskTitle: 'Set FLL overhead charge policy',
        taskStatus: 'ready',
        importedDraft: false,
        phase: 'inflight',
        summary: 'Queued, but the task brief or acceptance criteria still need cleanup before a worker should treat this as approved.',
        workerHandoff: {
          ready: false,
          cleanupNeeded: true,
        },
        checklist: {
          title: 'Task brief checklist',
          doneCount: 4,
          totalSteps: 4,
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'brief', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'done' },
            { id: 'acceptance', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'done' },
          ],
        },
      }),
    ], 'turn-ready-handoff-incomplete')

    render(ThreadTab)

    await screen.findAllByText('The starter checklist is complete, but a full product brief and spec handoff are still needed before a worker can start.')
    const needsBriefChip = selectedThread()
      .getAllByText('Needs brief')
      .find(node => node.classList.contains('chip'))
    expect(needsBriefChip).toBeTruthy()
    expect(needsBriefChip?.classList.contains('tone-warn')).toBe(true)
    expect(selectedThread().getByText('Handoff still needs cleanup')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clean up brief' }))
    expect(screen.queryByRole('button', { name: 'Resume work' })).toBeNull()
    await waitFor(() => {
      const continueCall = calls.find(c => c.url.includes('/api/project/task/task-ready-handoff-incomplete/continue'))
      expect(continueCall?.body).toMatchObject({
        action: 'brief_cleanup',
        mode: 'checklist',
      })
      expect(calls.some(c => c.url.includes('/api/project/task/task-ready-handoff-incomplete/enrich-task'))).toBe(false)
      expect(calls.some(c => c.url.includes('/api/project/start'))).toBe(false)
    })
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

    await screen.findByRole('button', { name: 'Clean up brief' })
    expect(screen.queryByText('No upstream')).toBeNull()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
    const startButton = screen.getByRole('button', { name: 'Clean up brief' })
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

    await screen.findByRole('button', { name: /draft task brief/i })
    expect(selectedThread().getAllByText('Brief checklist').length).toBeGreaterThan(0)
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

    await userEvent.click(await screen.findByRole('button', { name: 'Clean up brief' }))

    await waitFor(() => {
      const continueCall = calls.find(c => c.url.includes('/api/project/task/task-ready-incomplete/continue'))
      expect(continueCall?.body).toMatchObject({
        action: 'brief_cleanup',
        mode: 'checklist',
        instruction: expect.stringContaining('Complete this task for worker handoff'),
      })
      expect(calls.some(c => c.url.includes('/api/project/task/task-ready-incomplete/enrich-task'))).toBe(false)
      expect(calls.some(c => c.url.includes('/api/project/start'))).toBe(false)
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

    await screen.findByRole('button', { name: 'Already queued' })
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
    await threadHistory().findByText('Starting point and source notes')
    await userEvent.click(selectedThread().getByRole('button', { name: /open source note.*roadmap\.md/i }))

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
    await threadHistory().findByText('Starting point and source notes')
    await userEvent.click(selectedThread().getByRole('button', { name: /open source note.*roadmap\.md/i }))

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
    await threadHistory().findByText('Starting point and source notes')
    await userEvent.click(selectedThread().getByRole('button', { name: /open source note.*roadmap\.md/i }))

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

    await screen.findByRole('button', { name: /Knit draft 1/i })
    expect(screen.getByRole('button', { name: /Knit draft 9/i })).toBeTruthy()
    expect(screen.queryByLabelText(/Compact .* operations/)).toBeNull()
    expect(screen.queryByText(/compact rows/i)).toBeNull()
  })

  it('keeps completed-only threads out of the active mailbox without an extra Done section', async () => {
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

    await screen.findByText('No open questions, queued work, blockers, or active requests right now.')
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
      { projectRunStatus: 'stopped', projectAvailability: { status: 'paused', pausedAt: now, resumedAt: null } },
    )

    markProjectPaused()
    render(ThreadTab)

    expect(screen.queryByText(/No activity for 129m/)).toBeNull()
    expect((await screen.findAllByText('Paused')).length).toBeGreaterThan(0)
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

    expect((await screen.findAllByText('Gate checks are queued. Resume when you want them to continue.')).length).toBeGreaterThan(0)
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
      { projectRunStatus: 'stopped', projectAvailability: { status: 'paused', pausedAt: now, resumedAt: null } },
    )

    render(ThreadTab)

    expect((await screen.findAllByText('Work is paused. Resume when you want it to continue.')).length).toBeGreaterThan(0)
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
    await screen.findAllByText('Needs recovery')
    expect(screen.getAllByText('Context was found, but the next draft was not saved.').length).toBeGreaterThan(0)
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
    await screen.findByRole('button', { name: /Run the missing check/i })
    expect(selectedThread().getByText('One missing check needs to run.')).toBeTruthy()
    expect(selectedThread().getByText(/not asking you to prove anything/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Run the missing check/i })).toBeTruthy()
    expect(screen.queryByText(/Technical note/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/\bAC-8\b/)
    await userEvent.click(screen.getByRole('button', { name: /Run the missing check/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/resolve-escalation'))).toBe(true)
      expect(calls.some(call => (
        call.url.startsWith('/api/project/task/task-link-controls/start') &&
        call.body?.mode === 'one_task' &&
        call.body?.scope === 'work_item'
      ))).toBe(true)
    })
  })

  it('keeps pending blocked escalations actionable from the selected thread detail', async () => {
    const { calls } = installFetchFakes(
      [
        escalationTurn({
          id: 'esc-oauth-google',
          status: 'pending',
          taskId: 'task-oauth-google-provider-credentials',
          taskTitle: 'Create Google OAuth provider credentials',
          escalationReason: 'human_judgment_required',
          escalationAgentId: 'worker-agent',
          summary: 'Google OAuth credentials must be created outside the repo.',
          details: 'Guildhall cannot create or verify Google Cloud OAuth credentials without owner access to the Google Cloud project.',
        }),
      ],
      null,
    )

    render(ThreadTab)

    await screen.findByText('Needs recovery')
    const footer = within(screen.getByLabelText('Thread footer'))
    const dock = activeThreadDock()
    const listElement = document.querySelector('.thread-list') as HTMLElement | null

    expect(dock.getByText('Needs recovery')).toBeTruthy()
    expect(dock.getByRole('button', { name: 'Resume task' })).toBeTruthy()
    expect(dock.getByRole('button', { name: /^I handled this/i })).toBeTruthy()
    expect(footer.queryByText('Needs recovery')).toBeNull()
    expect(footer.getByPlaceholderText(/Add recovery guidance/i)).toBeTruthy()
    expect(listElement ? within(listElement).queryByText('Needs recovery') : null).toBeNull()

    await userEvent.click(dock.getByRole('button', { name: 'Resume task' }))
    expect(await screen.findByRole('dialog', { name: 'Resume task' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    const composer = threadComposer().getByPlaceholderText(/Add recovery guidance/i)
    await userEvent.type(composer, 'I created the Google OAuth client ID; use the Supabase callback URL.')
    await userEvent.click(threadComposer().getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      const resumeCall = calls.find(call => call.url.includes('/task/task-oauth-google-provider-credentials/resume'))
      expect(resumeCall?.body).toMatchObject({
        message: 'I created the Google OAuth client ID; use the Supabase callback URL.',
        preserveStatus: true,
      })
    })
  })

  it('keeps queued task cards focused on shared stage chips instead of construction chips', async () => {
    installFetchFakes(
      [
        importedDraftTurn({ id: 'draft-stage', taskId: 'task-draft-stage', constructionMode: 'blueprint' }),
        workerTurn({ id: 'worker-stage', taskId: 'task-worker-stage', constructionMode: 'build', taskStatus: 'ready' }),
      ],
      'draft-stage',
    )

    render(ThreadTab)

    await selectedThread().findAllByText('Needs you')
    expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Guildhall next')).toBeNull()
    expect(screen.queryByText('Blueprint')).toBeNull()
    expect(screen.queryByText('Build')).toBeNull()
    expect(threadComposer().getByPlaceholderText('Add a note…')).toBeTruthy()
  })

  it('uses the shared spec revision stage chip for exploring spec turns', async () => {
    installFetchFakes(
      [
        importedDraftTurn({
          id: 'inflight-task-import-1y7kmp6',
          taskId: 'task-import-1y7kmp6',
          taskTitle: 'Block menu / block side menu',
          taskStatus: 'exploring',
          importedDraft: false,
          phase: 'spec',
          constructionMode: 'blueprint',
          summary: 'Your answers and a spec draft are saved. Coordinator review is next.',
          checklist: undefined,
        }),
      ],
      'inflight-task-import-1y7kmp6',
    )

    render(ThreadTab)

    const blockMenuRow = await screen.findByRole('button', { name: /Block menu \/ block side menu/i })
    await within(blockMenuRow).findByText('Paused')
    expect(within(blockMenuRow).queryByText('Queued')).toBeNull()
    expect(screen.queryByText('Intake')).toBeNull()
  })

  it('keeps the thread rail focused on the current open turn instead of a newer done milestone', async () => {
    installFetchFakes(
      [
        specReviewTurn('task-active-spec'),
        importedDraftTurn({
          id: 'floating-toolbar-open',
          taskId: 'task-floating-toolbar',
          taskTitle: 'Floating toolbar',
          status: 'pending',
          phase: 'intake',
          taskStatus: 'exploring',
          importedDraft: false,
          at: '2026-05-19T14:30:00.000Z',
          summary: 'The spec author is shaping this task.',
        }),
        historyNoteTurn({
          id: 'floating-toolbar-history',
          taskId: 'task-floating-toolbar',
          taskTitle: 'Floating toolbar',
          at: '2026-05-19T14:45:00.000Z',
          summary: 'Guildhall preserved the latest shaping context.',
        }),
      ],
      'spec-task-active-spec',
    )

    render(ThreadTab)

    const floatingRow = await screen.findByRole('button', { name: /Floating toolbar/i })
    await within(floatingRow).findByText('Paused')
    expect(within(floatingRow).queryByText('done', { selector: '.chip' })).toBeNull()
    expect(within(floatingRow).getByText(/brief is not ready yet/i)).toBeTruthy()
  })

  it('keeps the selected shaping card inline even when another thread owns the global active turn', async () => {
    installFetchFakes(
      [
        specReviewTurn('task-active-spec'),
        importedDraftTurn({
          id: 'floating-toolbar-open',
          taskId: 'task-floating-toolbar',
          taskTitle: 'Floating toolbar',
          status: 'pending',
          phase: 'intake',
          taskStatus: 'exploring',
          importedDraft: false,
          at: '2026-05-19T14:30:00.000Z',
          summary: 'Guildhall has started shaping this task, but the brief is not ready yet. The checklist shows what is still missing.',
          sourceNote: {
            references: ['looma/docs/editor-roadmap.md', 'looma/apps/docs/docs/component-library-audit.md'],
          },
          checklist: {
            title: 'Task brief checklist',
            doneCount: 1,
            totalSteps: 4,
            steps: [
              { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
              { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'active' },
              { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'pending' },
              { id: 'criteria', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
            ],
          },
        }),
        historyNoteTurn({
          id: 'floating-toolbar-history',
          taskId: 'task-floating-toolbar',
          taskTitle: 'Floating toolbar',
          at: '2026-05-19T14:45:00.000Z',
          summary: 'Guildhall preserved the latest shaping context.',
        }),
      ],
      'spec-task-active-spec',
    )

    render(ThreadTab)

    const floatingRow = await screen.findByRole('button', { name: /Floating toolbar/i })
    await userEvent.click(floatingRow)

    await selectedThread().findByText('Starting point and source notes')
    expect(selectedThread().getAllByText('Brief checklist').length).toBeGreaterThan(0)
    expect(selectedThread().getByRole('button', { name: /continue shaping brief/i })).toBeTruthy()
    expect(threadComposer().getByPlaceholderText('Add a note…')).toBeTruthy()
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
    await screen.findByLabelText('Active thread dock')
    await activeThreadDock().findByRole('button', { name: /drag handle is out of scope/i })
    expect(selectedThread().queryByRole('button', { name: /url input only/i })).toBeNull()
    expect(selectedThread().getByText(/1 more question will stay here/i)).toBeTruthy()

    await userEvent.click(activeThreadDock().getByRole('button', { name: /drag handle is out of scope/i }))
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
    await screen.findByLabelText('Active thread dock')
    await activeThreadDock().findByRole('button', { name: /drag handle is out of scope/i })

    await userEvent.click(activeThreadDock().getByRole('button', { name: /drag handle is out of scope/i }))

    await waitFor(() => expect(screen.getByText('disk is full')).toBeTruthy())
    expect(activeThreadDock().getAllByText('Should drag-and-drop be in scope?').length).toBeGreaterThan(0)
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
    await screen.findByLabelText('Active thread dock')
    await activeThreadDock().findByRole('button', { name: 'PROJECT_STATE.md' })
    expect(activeThreadDock().getByText('Missing context is expected.')).toBeTruthy()
    expect(activeThreadDock().getByText(/Ask for project terms, source notes, or assumptions to be explained before you answer/)).toBeTruthy()

    await userEvent.click(activeThreadDock().getByRole('button', { name: /ask for explanation/i }))
    await screen.findByText('Ask for an explanation first')
    await userEvent.type(
      screen.getByPlaceholderText('Ask what this means, what evidence was used, or what context is missing…'),
      'Which migration status are you asking about?',
    )
    await userEvent.click(screen.getAllByRole('button', { name: /^Send$/i }).at(-1)!)

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
    expect(screen.getByText(/Created 2 draft tasks\s+from 3 selected sources/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText('Import complete.')).toBeNull()
  })

  it('approves active briefs from the document modal', async () => {
    const { calls } = installFetchFakes(
      [
        briefTurn(),
      ],
      'brief-link-controls',
    )

    render(ThreadTab)
    await screen.findByText('Edit links inline.')

    await userEvent.click(selectedThread().getByRole('button', { name: /view brief/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve brief/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /yes, that's right/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/approve-brief'))).toBe(true)
    })
  })

  it('approves meta-intake splits from the document modal', async () => {
    const { calls } = installFetchFakes(
      [
        specReviewTurn('task-meta-intake'),
      ],
      'spec-task-meta-intake',
    )

    render(ThreadTab)
    await screen.findByRole('button', { name: /view spec/i })

    await userEvent.click(screen.getByRole('button', { name: /view spec/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve split/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /yes, use this split/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/meta-intake/approve'))).toBe(true)
    })
  })

  it('keeps pending spec drafts approvable from the document modal', async () => {
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
    await screen.findByRole('button', { name: /view spec/i })

    await userEvent.click(screen.getByRole('button', { name: /view spec/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve spec/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /approve spec/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/approve-spec'))).toBe(true)
    })
  })

  it('advances the thread out of spec review after approving a valid task spec from the modal', async () => {
    let approved = false
    const specTurn = specReviewTurn('task-link-controls')
    const readyTurn = {
      kind: 'inflight',
      id: 'inflight-task-link-controls',
      at: now,
      persona: 'worker',
      status: 'active',
      phase: 'ready',
      taskId: 'task-link-controls',
      taskTitle: 'Knit: add link editor controls',
      constructionMode: 'blueprint',
      taskStatus: 'ready',
      summary: 'Approved and queued for work.',
      workerHandoff: { ready: true, cleanupNeeded: false },
    }
    const { calls } = installFetchFakes([specTurn], 'spec-task-link-controls', {
      onApproveSpec: () => { approved = true },
      threadState: () => approved
        ? { turns: [readyTurn], activeTurnId: 'inflight-task-link-controls' }
        : { turns: [specTurn], activeTurnId: 'spec-task-link-controls' },
    })

    render(ThreadTab)

    await screen.findByRole('button', { name: /view spec/i })
    await userEvent.click(screen.getByRole('button', { name: /view spec/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve spec/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /approve spec/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/task/task-link-controls/approve-spec'))).toBe(true)
      expect(screen.queryByRole('dialog', { name: /approve spec/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /view spec/i })).toBeNull()
      expect(screen.getByText('Ready for work')).toBeTruthy()
      expect(screen.getByRole('button', { name: /already queued/i })).toBeTruthy()
    })
  })

  it('shows approve-spec failures instead of silently leaving the review card unchanged', async () => {
    installFetchFakes([specReviewTurn('task-link-controls')], 'spec-task-link-controls', {
      approveSpecResponse: json({ error: 'Task is not in spec_review status.' }, { status: 400 }),
    })

    render(ThreadTab)

    await screen.findByRole('button', { name: /view spec/i })
    await userEvent.click(screen.getByRole('button', { name: /view spec/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve spec/i })
    await userEvent.click(within(dialog).getByRole('button', { name: /approve spec/i }))

    await waitFor(() => {
      const stillOpenDialog = screen.getByRole('dialog', { name: /approve spec/i })
      expect(within(stillOpenDialog).getByText('Task is not in spec_review status.')).toBeTruthy()
      expect(screen.getByRole('button', { name: /view spec/i })).toBeTruthy()
    })
  })

  it('uses View brief as the active brief primary action and moves approval into the modal', async () => {
    installFetchFakes([briefTurn()], 'brief-link-controls')

    render(ThreadTab)
    await screen.findByText('Edit links inline.')

    const viewBriefButton = screen.getByRole('button', { name: /view brief/i })

    expect(viewBriefButton.classList.contains('v-primary')).toBe(true)
    expect(screen.queryByRole('button', { name: /yes, that's right/i })).toBeNull()

    await userEvent.click(viewBriefButton)
    const dialog = await screen.findByRole('dialog', { name: /approve brief/i })
    expect(within(dialog).getByRole('button', { name: /yes, that's right/i }).classList.contains('v-primary')).toBe(true)
  })

  it('uses View spec as the active spec primary action and moves approval into the modal', async () => {
    installFetchFakes([
      specReviewTurn('task-link-controls'),
    ], 'spec-task-link-controls')

    render(ThreadTab)

    await screen.findByRole('button', { name: /view spec/i })
    expect(screen.getByRole('button', { name: /view spec/i }).classList.contains('v-primary')).toBe(true)
    expect(screen.queryByRole('button', { name: /approve spec/i })).toBeNull()
    expect(screen.getByRole('button', { name: /details\.\.\./i })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /view spec/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve spec/i })
    expect(within(dialog).getByText('Build the focused link editor controls.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /approve spec/i }).classList.contains('v-primary')).toBe(true)
    expect(within(dialog).getByRole('button', { name: /request changes/i })).toBeTruthy()
    expect(path.value).toContain('/thread')
  })

  it('renders normal spec_review component work as queued spec work instead of owner approval', async () => {
    const { calls } = installFetchFakes([
      {
        kind: 'inflight',
        id: 'inflight-task-combobox',
        at: now,
        persona: 'spec',
        status: 'active',
        phase: 'spec',
        taskId: 'task-combobox',
        taskTitle: 'Combobox',
        constructionMode: 'blueprint',
        taskStatus: 'spec_review',
        importedDraft: false,
        checklist: undefined,
        summary: 'Your answers and a spec draft are saved. Coordinator review is next.',
      },
    ], 'inflight-task-combobox', {
      projectRunStatus: 'stopped',
      projectAvailability: { status: 'paused', pausedAt: now, resumedAt: null },
    })

    render(ThreadTab)

    await screen.findByRole('button', { name: /combobox/i })
    expect(screen.queryByText(/awaiting approval/i)).toBeNull()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Coordinator review is next/i).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /resume spec work/i }))

    await waitFor(() => {
      const startCall = calls.find(call => call.url.includes('/api/project/task/task-combobox/start'))
      expect(startCall?.body).toMatchObject({
        mode: 'one_task',
        scope: 'work_item',
      })
    })
    expect(calls.some(call => call.url.includes('/api/project/start'))).toBe(false)
  })

  it('opens a thread-owned brief modal from the root card and keeps Details separate', async () => {
    installFetchFakes([
      briefTurn(),
    ], 'brief-link-controls')

    render(ThreadTab)

    await screen.findByRole('button', { name: /view brief/i })
    expect(screen.getByRole('button', { name: /view brief/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /details\.\.\./i })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /view brief/i }))
    const dialog = await screen.findByRole('dialog', { name: /approve brief/i })
    expect(within(dialog).getByText('Edit links inline.')).toBeTruthy()
    expect(path.value).toContain('/thread')
  })

  it('opens task details with Thread as the drawer background route', async () => {
    installFetchFakes([
      importedDraftTurn({
        id: 'draft-details-background',
        taskId: 'task-details-background',
        taskTitle: 'Open details without leaving Thread',
        importedDraft: false,
        taskStatus: 'exploring',
        phase: 'inflight',
        summary: 'Guildhall is shaping this task.',
      }),
    ], 'draft-details-background')

    render(ThreadTab)

    const detailsButton = await selectedThread().findByRole('button', { name: /details\.\.\./i })
    await userEvent.click(detailsButton)

    expect(path.value).toBe('/projects/looma-knit/task/task-details-background')
    expect(path.state).toEqual({ backgroundPath: '/projects/looma-knit/thread' })
  })

  it('separates created logical work from delivery steps in request shaping copy', async () => {
    installFetchFakes([
      requestTurn({
        routingSummary: 'Guildhall shaped the import review request.',
        logicalWorkCount: 3,
        deliveryStepCount: 8,
      }),
    ], 'request:pti-guildhall-0-8-0')

    render(ThreadTab)

    await selectedThread().findByText('Created 3 work items and 8 delivery steps.')
    expect(selectedThread().getByText('Checks, docs, and proof stay inside the relevant work item so the Work list stays focused.')).toBeTruthy()
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
    await selectedThread().findAllByText('Repo inspection')
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
    expect(screen.getAllByText(/Partial progress was saved/i).length).toBeGreaterThan(0)
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
    await screen.findByRole('button', { name: 'Resume work' })
    await userEvent.click(screen.getByRole('button', { name: 'Resume work' }))

    await waitFor(() => {
      expect(calls.some(call => (
        call.url.startsWith('/api/project/task/task-link-controls/start') &&
        call.body?.mode === 'one_task' &&
        call.body?.scope === 'work_item'
      ))).toBe(true)
    })
  })

  it('labels exploring imported drafts with a status chip while the project is running', async () => {
    project.detail = {
      ...(project.detail as any),
      run: { status: 'running', mode: 'continuous' },
    }
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
    expect((await screen.findAllByText('Queued')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Guildhall shaping')).toBeNull()
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
      if (url.startsWith('/api/project/task/') && url.includes('/start')) {
        return json({ error: 'Provider model is not loaded.' }, { status: 409 })
      }
      if (url.startsWith('/api/project')) return json({ id: 'looma-knit', run: { status: 'stopped' }, tasks: [] })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ThreadTab)
    await screen.findByRole('button', { name: /continue drafting spec/i })
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

    await selectedThread().findByText('Starting point and source notes')
    expect(selectedThread().getByText(/Task shaping has started/)).toBeTruthy()
    expect(selectedThread().getAllByText('Brief checklist').length).toBeGreaterThan(0)
    expect(selectedThread().getByText('Readable title')).toBeTruthy()
    expect(selectedThread().getByText('Acceptance criteria')).toBeTruthy()
    expect(selectedThread().getByRole('button', { name: /details\.\.\./i })).toBeTruthy()
    expect(selectedThread().getByRole('button', { name: /continue shaping brief/i })).toBeTruthy()
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

  it('renders compact thread rows through the shared card-list surface', async () => {
    installViewportMatchMedia(640)
    installFetchFakes([
      importedDraftTurn({
        id: 'draft-compact-card',
        taskId: 'task-compact-card',
        taskTitle: 'Knit: compact card spacing',
        importedDraft: false,
        taskStatus: 'exploring',
        phase: 'inflight',
        summary: 'Guildhall has started shaping this task, but the brief is not ready yet.',
      }),
    ], 'draft-compact-card')

    render(ThreadTab)

    const row = await screen.findByRole('button', { name: /knit: compact card spacing/i })
    expect(row.className).toContain('card-list-item')
    expect(row.className).toContain('utility-panel')
  })

  it('keeps compact thread list gutters when shell padding is unavailable', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')

    expect(source).toContain('var(--app-shell-page-padding-inline, var(--gh-space-2))')
  })

  it('keeps selected thread cards in scrollable flow while only the composer footer is sticky', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')
    const scrollBlock = source.match(/\.thread-detail-scroll\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const flowBlock = source.match(/\.thread-detail-flow\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const dockBlock = source.match(/\.thread-active-dock\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const footerBlock = source.match(/\.thread-footer\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const dockMarkupIndex = source.indexOf('<div\n                    class="thread-active-dock"')
    const footerMarkupIndex = source.indexOf('<div class="thread-footer" aria-label="Thread footer">')

    expect(source).toMatch(/<div class="thread-detail-flow"[\s>]/)
    expect(source).toMatch(/<div class="thread-list"[\s>]/)
    expect(source).not.toContain('<Stack gap="3" class="thread-list">')
    expect(source).not.toContain('<div class="thread-footer" aria-label="Thread footer">\n                    {#if activeDockTurn}')
    expect(dockMarkupIndex).toBeGreaterThan(-1)
    expect(footerMarkupIndex).toBeGreaterThan(-1)
    expect(dockMarkupIndex).toBeLessThan(footerMarkupIndex)
    expect(flowBlock).toContain('display: flex')
    expect(flowBlock).toContain('flex-direction: column')
    expect(flowBlock).toContain('min-height: 100%')
    expect(source).toMatch(/\.thread-list\s*{[^}]*margin-top:\s*auto/s)
    expect(scrollBlock).toContain('padding-top: var(--gh-space-1)')
    expect(footerBlock).toContain('position: sticky')
    expect(footerBlock).toContain('bottom: 0')
    expect(footerBlock).toContain('padding-bottom: var(--gh-layout-sticky-footer-padding-bottom)')
    expect(dockBlock).not.toMatch(/position:\s*(absolute|fixed)/)
    expect(footerBlock).not.toMatch(/position:\s*(absolute|fixed)/)
  })

  it('keeps the active Thread dock to one framed card with unboxed inner sections', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')
    const dockMarkupIndex = source.indexOf('<div\n                    class="thread-active-dock"')
    const footerMarkupIndex = source.indexOf('<div class="thread-footer" aria-label="Thread footer">')
    const dockMarkup = source.slice(dockMarkupIndex, footerMarkupIndex)
    const sectionBlock = source.match(/\.thread-active-section\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(dockMarkupIndex).toBeGreaterThan(-1)
    expect(footerMarkupIndex).toBeGreaterThan(dockMarkupIndex)
    expect(dockMarkup).not.toContain('<UtilityPanel')
    expect(dockMarkup).toContain('thread-active-section')
    expect(sectionBlock).toContain('border-top:')
    expect(sectionBlock).not.toMatch(/\bbackground\s*:/)
    expect(sectionBlock).not.toMatch(/\bborder-radius\s*:/)
    expect(sectionBlock).not.toMatch(/\bbox-shadow\s*:/)
  })

  it('keeps the sticky composer wrapper unframed instead of making the footer hold a card', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')
    const composerShellBlock = source.match(/\.thread-composer-shell\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const composerWorkingBlock = source.match(/\.thread-composer-working\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(composerShellBlock).toContain('display: grid')
    expect(composerShellBlock).toContain('gap: var(--gh-space-2)')
    expect(source).not.toMatch(/\.thread-composer-shell\s*\{[^}]*\bpadding\s*:/s)
    expect(composerShellBlock).not.toMatch(/\bpadding\s*:/)
    expect(composerShellBlock).not.toMatch(/\bborder\s*:/)
    expect(composerShellBlock).not.toMatch(/\bborder-radius\s*:/)
    expect(composerShellBlock).not.toMatch(/\bbackground\s*:/)
    expect(composerShellBlock).not.toMatch(/\bbox-shadow\s*:/)
    expect(composerShellBlock).not.toMatch(/\bbackdrop-filter\s*:/)
    expect(composerWorkingBlock).not.toMatch(/\bborder-color\s*:/)
  })

  it('uses the shared rounded button contract for the composer send action', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')

    const composerSendButton = source.match(/<Button[\s\S]*?ariaLabel=\{busyTurnId[\s\S]*?<\/Button>/)?.[0] ?? ''
    const composerSendClass = source.match(/\.thread-composer-send\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(composerSendButton).toContain('iconOnly')
    expect(composerSendButton).toContain('rounded')
    expect(composerSendButton).not.toContain('className="thread-composer-send"')
    expect(composerSendClass).not.toMatch(/\b(width|min-width|height|min-height|padding|border-radius)\s*:/)
  })

  it('keeps the composer textbox and send action on the same inset grid', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')
    const frameBlock = source.match(/\.thread-composer-frame\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const textareaBlock = source.match(/\.thread-composer-input-shell\s+:global\(\.textarea\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const actionsBlock = source.match(/\.thread-composer-actions\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(frameBlock).toContain('--thread-composer-action-inset: var(--gh-space-2)')
    expect(frameBlock).toContain('--thread-composer-action-size: 32px')
    expect(textareaBlock).toContain('display: block')
    expect(textareaBlock).toContain('background: var(--bg-raised)')
    expect(textareaBlock).toContain('border-color: color-mix(in srgb, var(--border) 72%, white 18%)')
    expect(textareaBlock).toContain('padding-right: calc(var(--thread-composer-action-inset) + var(--thread-composer-action-size) + var(--control-pad-x))')
    expect(textareaBlock).toContain('padding-bottom: calc(var(--thread-composer-action-inset) + var(--thread-composer-action-size) + var(--control-pad-y))')
    expect(actionsBlock).toContain('right: var(--thread-composer-action-inset)')
    expect(actionsBlock).toContain('bottom: var(--thread-composer-action-inset)')
  })

  it('shows a top chip for thread rows even when owner and fallback status chips would otherwise be suppressed', async () => {
    installFetchFakes([
      workerTurn({
        id: 'worker-chip-state',
        taskId: 'task-chip-state',
        taskTitle: 'Knit: shape the toolbar API',
        taskStatus: 'in_progress',
        summary: 'Guildhall paused while this task was in progress.',
      }),
    ], 'task:task-chip-state', {
      projectRunStatus: 'stopped',
      projectAvailability: { status: 'paused', pausedAt: now, resumedAt: null },
    })

    markProjectPaused()
    render(ThreadTab)

    const row = await screen.findByRole('button', { name: /knit: shape the toolbar api/i })
    expect(within(row).getByText('Paused')).toBeTruthy()
    expect((row.firstElementChild as HTMLElement | null)?.className).toContain('thread-index-row-chips')
  })

  it('shows delivery context and correction affordance on the active worker dock', async () => {
    project.detail = {
      ...(project.detail as any),
      deliverySpine: {
        contextPacket: {
          taskId: 'task-link-controls',
          whyThisNow: 'Knit is driving link editor controls now because the menu primitive is the blocking provider work.',
          deliveryIntent: {
            driver: { id: 'knit', label: 'Knit' },
            provider: { id: 'looma', label: 'Looma' },
            supports: ['task-context-menu'],
          },
          primitiveContext: {
            direct: [{ id: 'menu', label: 'Menu' }],
            ancestors: [],
            blockers: [{ id: 'menu-item', label: 'MenuItem' }],
          },
          proofContext: {
            proofKind: 'storybook',
            requiredProof: [{ primitiveId: 'menu-item', primitiveLabel: 'MenuItem', proof: 'storybook' }],
          },
          persona: { id: 'component-delivery', label: 'Component delivery', guardrails: [] },
          correctionHooks: [{ field: 'delivery.usesPrimitives', label: 'Change used primitives', current: ['menu'] }],
        },
      },
    }
    installFetchFakes([
      workerTurn({
        id: 'worker-link-controls',
        taskId: 'task-link-controls',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'in_progress',
        summary: 'Building link controls.',
      }),
    ], 'task:task-link-controls')

    render(ThreadTab)

    const dock = within(await screen.findByLabelText('Active thread dock'))
    expect(await dock.findByText('Why this next')).toBeTruthy()
    expect(dock.getByText(/Knit is driving link editor controls now/i)).toBeTruthy()
    expect(dock.getByText('Primitive blockers: MenuItem')).toBeTruthy()
    expect(dock.getByText('Proof expected: MenuItem')).toBeTruthy()
    expect(dock.getByRole('button', { name: 'Correct delivery context' })).toBeTruthy()
  })

  it('uses ownership, not selection, for thread mini-card rails', async () => {
    installFetchFakes([
      questionTurn('q-owner-choice', 'owner-choice', 'Which variant should Guildhall build?', ['Compact', 'Full']),
      workerTurn({
        id: 'queued-guildhall-card',
        taskId: 'task-queued-guildhall-card',
        taskTitle: 'Knit: queued Guildhall task',
        taskStatus: 'ready',
        summary: 'Guildhall can start this queued task.',
        liveAgent: undefined,
      }),
    ], 'q-owner-choice')

    render(ThreadTab)

    const humanRow = await screen.findByRole('button', { name: /which variant should guildhall build/i })
    const guildhallRow = await screen.findByRole('button', { name: /knit: queued guildhall task/i })

    expect(humanRow.className).toContain('rail-warn')
    expect(humanRow.className).not.toContain('rail-accent')
    expect(guildhallRow.className).toContain('rail-ok')
    expect(within(guildhallRow).getByText('Ready')).toBeTruthy()
  })

  it('keeps thread-list titles readable while chips stay compact and single-line', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')
    const threadBlock = source.match(/\.thread\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const rowPanelBlock = source.match(/:global\(\.thread-index-row\.utility-panel\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const titleRowBlock = source.match(/\.thread-index-row-top\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const titleBlock = source.match(/\.thread-index-row-top strong\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const summaryBlock = source.match(/:global\(\.thread-index-row\) p\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const chipRowBlock = source.match(/\.thread-index-row-chips\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(source).toContain('<Chip label={indexChip.label} tone={indexChip.tone} size="compact" />')
    expect(threadBlock).not.toContain('--thread-list-title-size')
    expect(threadBlock).not.toContain('--thread-list-summary-size')
    expect(threadBlock).toContain('--thread-fs-meta: var(--fs-1)')
    expect(threadBlock).toContain('--thread-fs-body: var(--fs-2)')
    expect(threadBlock).toContain('--thread-fs-title: var(--fs-2)')
    expect(threadBlock).toContain('--thread-lh-meta: 1.25')
    expect(threadBlock).toContain('--thread-lh-body: 1.4')
    expect(threadBlock).toContain('--thread-lh-title: var(--thread-lh-body)')
    expect(rowPanelBlock).toContain('gap: var(--s-1)')
    expect(titleRowBlock).toContain('display: grid')
    expect(titleRowBlock).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(titleRowBlock).toContain('align-items: start')
    expect(titleRowBlock).not.toContain('justify-content: space-between')
    expect(titleBlock).toContain('font-size: var(--thread-fs-title)')
    expect(titleBlock).toContain('line-height: var(--thread-lh-title)')
    expect(titleBlock).toContain('display: -webkit-box')
    expect(titleBlock).toContain('line-clamp: 3')
    expect(titleBlock).toContain('-webkit-line-clamp: 3')
    expect(titleBlock).toContain('-webkit-box-orient: vertical')
    expect(titleBlock).toContain('overflow: hidden')
    expect(summaryBlock).toContain('font-size: var(--thread-fs-body)')
    expect(summaryBlock).toContain('line-height: var(--thread-lh-body)')
    expect(chipRowBlock).toContain('flex-wrap: nowrap')
    expect(chipRowBlock).toContain('overflow: hidden')
    expect(chipRowBlock).toContain('margin-bottom: 0')
    expect(source).not.toMatch(/\.thread\s+:global\(\.chip\)/)
    expect(source).not.toMatch(/\.thread-index-row-chips\s+:global\(\.chip\)/)
  })

  it('routes Thread ownership chips through canonical chip tones', () => {
    const source = readFileSync('src/web/surfaces/project/ThreadTab.svelte', 'utf8')

    expect(source).toContain("if (label === 'Needs brief') return 'warn'")
    expect(source).toContain("if (label === 'Queued' || label === 'Working') return 'running'")
    expect(source).not.toMatch(/agent-attention|tone=\"agent|tone='agent'|return 'agent'/)
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
