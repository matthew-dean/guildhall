// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import TaskDrawer from '../TaskDrawer.svelte'
import { path } from '../../lib/nav.svelte.js'
import { project } from '../../lib/project.svelte.js'
import type { DrawerPayload, ProjectDetail } from '../../lib/types.js'

const now = '2026-05-19T15:00:00.000Z'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function projectDetail(): ProjectDetail {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    run: { status: 'stopped', mode: 'continuous' },
    tasks: [],
  }
}

function drawerPayload(overrides: Partial<DrawerPayload> = {}): DrawerPayload {
  return {
    task: {
      id: 'task-link-editor',
      title: 'Knit: add link editor controls',
      description: 'Add the link editing controls to the selected text menu.',
      status: 'exploring',
      domain: 'frontend',
      priority: 'high',
      acceptanceCriteria: [{ description: 'URL and display text controls are available.' }],
      spec: '## Summary\nAdd link editor controls inside the existing editor toolbar.\n\n## Acceptance Criteria\n- URL and display text controls are available.',
      productBrief: { approvedAt: now, userJob: 'Edit links inline.' },
      notes: [{ role: 'coordinator', content: 'Confirmed this belongs to Knit.', timestamp: now }],
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-link-scope',
          askedBy: 'coordinator-agent',
          askedAt: now,
          prompt: 'Which controls belong in the link editor?',
          choices: ['URL input + Display text', 'URL input only'],
        },
      ],
    },
    threadTurns: [
      {
        id: 'turn-q',
        kind: 'agent_question',
        at: now,
        persona: 'coord',
        status: 'active',
        phase: 'blocked',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        question: {
          kind: 'choice',
          id: 'q-link-scope',
          askedBy: 'coordinator-agent',
          askedAt: now,
          prompt: 'Which controls belong in the link editor?',
          choices: ['URL input + Display text', 'URL input only'],
        },
      },
    ],
    recentEvents: [],
    contextDebug: [
      {
        id: 'ctx-1',
        at: now,
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        promptChars: 1200,
        sections: [{ key: 'task', label: 'Task', chars: 220, included: true }],
      },
    ],
    ...overrides,
  }
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor')
  path.value = '/projects/looma-knit/task/task-link-editor'
  project.detail = projectDetail()
  project.error = null
  vi.stubGlobal('confirm', vi.fn(() => true))
}

describe('TaskDrawer', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('answers current task questions from the drawer with the project id included', async () => {
    const payload = drawerPayload()
    payload.task.status = 'ready'
    payload.task.spec = ''
    payload.task.acceptanceCriteria = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/answer-questions')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({
          projectId: 'looma-knit',
          answers: [{ questionId: 'q-link-scope', answer: 'URL input only' }],
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Which controls belong in the link editor?')
    await userEvent.click(screen.getByRole('button', { name: /url input only/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/answer-questions'))).toBe(true)
    })
  })

  it('opens the Now tab when a question notification deep-links to the current surface', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=current')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const payload = drawerPayload()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Which controls belong in the link editor?')
    expect(screen.getByRole('tab', { name: 'Now' }).getAttribute('aria-selected')).toBe('true')
  })

  it('runs and manages the task from drawer controls without losing project scope', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'ready'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/pause')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/shelve')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/start')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          mode: 'continuous',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    await userEvent.click(screen.getByRole('button', { name: /run this task/i }))
    await userEvent.click(screen.getByText('More task actions'))
    await userEvent.click(screen.getByRole('button', { name: /pause task/i }))
    await userEvent.click(screen.getByRole('button', { name: /put aside/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/pause'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/shelve'))).toBe(true)
    })
  })

  it('does not expose run controls for a completed task but keeps copy link available', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'done'
    payload.task.terminalSummary = {
      headline: 'Task completed.',
      detail: 'DONE',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task completed.')

    expect(screen.queryByRole('button', { name: /run this task/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /pause task/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /put aside/i })).toBeNull()
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy()
  })

  it('approves a task spec with an optional note from the drawer footer flow', async () => {
    const payload = drawerPayload({
      threadTurns: [
        {
          id: 'turn-spec',
          kind: 'spec_review',
          at: now,
          persona: 'coord',
          status: 'active',
          phase: 'blocked',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          spec: '## Summary\nAdd link editor controls inside the existing editor toolbar.',
        } as any,
      ],
    })
    payload.task.status = 'ready'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({
          approvalNote: 'Ship the focused link editor controls first.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'Ship the focused link editor controls first.')
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/approve-spec'))).toBe(true)
    })
  })

  it('routes workspace-import approval through the dedicated import endpoint', async () => {
    const payload = drawerPayload({
      threadTurns: [
        {
          id: 'turn-spec',
          kind: 'spec_review',
          at: now,
          persona: 'coord',
          status: 'active',
          phase: 'blocked',
          taskId: 'task-workspace-import',
          taskTitle: 'Review existing project work',
          spec: '## Summary\nReview imported workspace notes.',
        } as any,
      ],
    })
    payload.task.id = 'task-workspace-import'
    payload.task.title = 'Review existing project work'
    payload.task.status = 'ready'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/workspace-import/approve')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-workspace-import')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-workspace-import',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Review existing project work')
    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/workspace-import/approve'))).toBe(true)
    })
  })

  it('re-runs the matching stage from review tasks without losing project scope', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/rerun-stage')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ stage: 'review' })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    await userEvent.click(screen.getByText('More task actions'))
    await userEvent.click(screen.getByRole('button', { name: /re-run review/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/rerun-stage'))).toBe(true)
    })
  })

  it('shows load failures and retries without dropping the project scope', async () => {
    let taskLoads = 0
    const payload = drawerPayload({ threadTurns: [] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) {
        taskLoads += 1
        expect(url).toContain('projectId=looma-knit')
        if (taskLoads === 1) {
          return json({ error: 'Task not found in selected project.' }, { status: 404 })
        }
        return json(payload)
      }
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Error: Task not found in selected project.')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    expect(taskLoads).toBeGreaterThanOrEqual(2)
  })

  it('shapes an imported draft and starts the same task continuously from the current card', async () => {
    const payload = drawerPayload({
      threadTurns: [
        {
          id: 'turn-import',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'import_draft',
          summary: 'Imported from project notes.',
          importedDraft: true,
        },
      ],
    })
    payload.task.status = 'import_draft'

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/shape-draft')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({ projectId: 'looma-knit' })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/start')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          mode: 'continuous',
          taskId: 'task-link-editor',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText(/Next step: turn this note into a task brief with scope, evidence, and acceptance criteria/)
    await userEvent.click(screen.getByRole('button', { name: /draft task brief/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/shape-draft'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(true)
    })
  })

  it('adds acceptance criteria and follow-up notes from the optional drawer details path', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'exploring'
    payload.task.acceptanceCriteria = []
    payload.task.productBrief = {
      approvedAt: now,
      userJob: 'Edit links inline.',
      successMetric: 'The selected link can be changed without leaving the editor.',
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/add-acceptance')) {
        expect(url).toContain('projectId=looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          description: 'Reviewer verifies URL and display text editing from the toolbar.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/resume')) {
        expect(url).toContain('projectId=looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          message: 'Keep drag handles out of scope for this task.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add one concrete finish line the reviewer can verify.')
    await userEvent.type(
      screen.getByPlaceholderText(/round-trip tests cover variable declarations/i),
      'Reviewer verifies URL and display text editing from the toolbar.',
    )
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await userEvent.type(
      screen.getByPlaceholderText(/answer a question, add a requirement/i),
      'Keep drag handles out of scope for this task.',
    )
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/add-acceptance'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resume'))).toBe(true)
    })
  })

  it('separates retry and manual blocker resolution actions in the drawer footer', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'verification_failed: Build failed after implementation.'
    payload.task.escalations = [
      {
        id: 'esc-build',
        reason: 'verification_failed',
        summary: 'Build failed after implementation.',
        details: 'pnpm check reported a missing imported component.',
        agentId: 'worker-agent',
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/resolve-escalation')) {
        expect(url).toContain('projectId=looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          escalationId: 'esc-build',
          resolution: 'Use the existing shared button component and rerun checks.',
          nextStatus: 'review',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Build failed after implementation.')
    expect(screen.queryByRole('button', { name: /retry blocker/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /resolve blocker/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /mark resolved\.\.\./i }))
    await screen.findByText('Use this when you handled the blocker yourself or want to tell Guildhall exactly where to continue.')
    await userEvent.type(
      screen.getByLabelText(/resolution note/i),
      'Use the existing shared button component and rerun checks.',
    )
    await userEvent.selectOptions(screen.getByLabelText(/resume at/i), 'review')
    await userEvent.click(screen.getByRole('button', { name: /^mark resolved$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resolve-escalation'))).toBe(true)
    })
  })

  it('uses a reason-aware primary recovery action for open escalations', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'gate_hard_failure: Tests failed.'
    payload.task.escalations = [
      {
        id: 'esc-gates',
        reason: 'gate_hard_failure',
        summary: 'Tests failed.',
        details: 'pnpm test failed after implementation.',
        agentId: 'gate-checker',
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/resolve-escalation')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          escalationId: 'esc-gates',
          resolution: 'Retrying gates after addressing the failure.',
          nextStatus: 'gate_check',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Tests failed.')
    const footerRetry = screen.getAllByRole('button', { name: /^retry gates$/i }).at(-1)
    expect(footerRetry).toBeDefined()
    await userEvent.click(footerRetry!)
    await screen.findByText('Guildhall will close this blocker and try the task again from the selected step.')
    const modalRetry = screen.getAllByRole('button', { name: /^retry gates$/i }).at(-1)
    expect(modalRetry).toBeDefined()
    await userEvent.click(modalRetry!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resolve-escalation'))).toBe(true)
    })
  })

  it('closes from the backdrop without requiring the details path', async () => {
    const onClose = vi.fn()
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'ready'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose,
    })

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    await userEvent.click(screen.getByRole('button', { name: /close drawer/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('unshelves a task and presents starter specs with the generated summary title', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'shelved'
    payload.task.title = 'Draft a first starter task for Looma + Knit onboarding'
    payload.task.spec = '## Summary\nAdd a focused setup checklist for the editor shell.\n\n## Acceptance Criteria\n- The checklist renders.'
    payload.task.acceptanceCriteria = [{ description: 'The checklist renders.' }]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/unshelve')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Draft a first starter task for Looma + Knit onboarding')
    await userEvent.click(screen.getAllByRole('button', { name: /^unshelve$/i })[0]!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/unshelve'))).toBe(true)
    })
  })

  it('explains shelved and checkpointed outcomes without crowding the footer', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'shelved'
    payload.task.shelveReason = {
      code: 'duplicate',
      detail: 'Duplicate of the existing link editor task.',
      rejectedAt: now,
      rejectedBy: 'coordinator-agent',
    }
    payload.task.latestCheckpoint = {
      step: 3,
      agentId: 'worker-agent',
      intent: 'Verify focused toolbar tests',
      nextPlannedAction: 'Rerun the focused toolbar test and hand off to review.',
      filesTouched: ['web/app/components/editor/toolbar.ts'],
      writtenAt: now,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    expect(screen.getByText('This task is out of the active queue.')).toBeTruthy()
    expect(screen.getAllByText('Duplicate of the existing link editor task.').length).toBeGreaterThan(0)
    expect(screen.getByText('Latest checkpoint')).toBeTruthy()
    expect(screen.getByText(/Rerun the focused toolbar test/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /pause task/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^unshelve$/i }).length).toBeGreaterThan(0)
  })
})
