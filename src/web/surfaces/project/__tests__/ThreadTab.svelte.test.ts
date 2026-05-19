// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
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

function questionTurn(id: string, questionId: string, prompt: string, choices: string[]) {
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
}

function installFetchFakes(turns: unknown[], activeTurnId: string | null) {
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, init, body })
    if (url.startsWith('/api/project/thread')) {
      return json({ turns, activeTurnId, caughtUp: false })
    }
    if (url.startsWith('/api/project/task/') && url.endsWith('/shape-draft?projectId=looma-knit')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/resume')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/stage-answer')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/task/') && url.includes('/answer-questions')) {
      return json({ ok: true })
    }
    if (url.startsWith('/api/project/meta-intake/synthesize')) return json({ ok: true })
    if (url.startsWith('/api/setup/')) return json({ ok: true })
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
    await screen.findByText('Name this project')

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
    await screen.findByText('Describe the project')

    await userEvent.type(screen.getByPlaceholderText('What should Guildhall know?'), 'Knit owns the editor UI.')
    await userEvent.click(screen.getByRole('button', { name: /save direction/i }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'project-manager')
    await userEvent.click(screen.getByRole('button', { name: /add coordinator/i }))
    await userEvent.click(screen.getByRole('button', { name: /run checks/i }))

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/setup/direction') && call.body?.content === 'Knit owns the editor UI.')).toBe(true)
      expect(calls.some(call => call.url.includes('/api/setup/coordinator') && Array.isArray(call.body?.archetypes))).toBe(true)
      expect(calls.some(call => call.url.includes('/api/setup/bootstrap'))).toBe(true)
    })
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
    await screen.findByText('Run setup checks')
    await userEvent.click(screen.getByRole('button', { name: /run checks/i }))

    await screen.findByText('pnpm test exited 1: Cannot find module ./Button.svelte')
  })

  it('keeps imported draft source context and actions inline in Thread', async () => {
    const { calls } = installFetchFakes([importedDraftTurn()], 'draft-link-controls')

    render(ThreadTab)
    await screen.findByText('Knit: add link editor controls')
    expect(screen.getByText('Build URL input, display text, open-in-new-tab, and remove link controls.')).toBeTruthy()
    expect(screen.getByText('docs/roadmap.md')).toBeTruthy()
    expect(screen.getByText('web/app/components/editor/toolbar.ts')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /let guildhall shape this/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/shape-draft') && call.url.includes('projectId=looma-knit'))).toBe(true)
    })

    await userEvent.click(screen.getByRole('button', { name: /add context/i }))
    await userEvent.type(screen.getByPlaceholderText('Tell the agent what to do next'), 'Keep drag handles out of scope.')
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))
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

  it('shows construction stage chips on task turns', async () => {
    installFetchFakes(
      [
        importedDraftTurn({ id: 'draft-stage', taskId: 'task-draft-stage', constructionMode: 'blueprint' }),
        workerTurn({ id: 'worker-stage', taskId: 'task-worker-stage', constructionMode: 'build' }),
      ],
      'draft-stage',
    )

    render(ThreadTab)

    await screen.findByText('Blueprint')
    await userEvent.click(screen.getByRole('button', { name: /paused/i }))
    expect(screen.getByText('Build')).toBeTruthy()
  })

  it('stages multiple task questions and submits them as one answer batch', async () => {
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
    await waitFor(() => expect(screen.getAllByText('2 questions about this task')).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: /drag handle is out of scope/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/stage-answer') && call.body?.questionId === 'scope')).toBe(true)
    })
    expect(screen.getByText('1 of 2 answers ready so far')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /URL input \+ Display text/i }))
    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/stage-answer') && call.body?.questionId === 'link-ui')).toBe(true)
    })
    expect(screen.getByText('2 of 2 answers ready to submit')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /submit answers/i }))
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.includes('/answer-questions') &&
            Array.isArray(call.body?.answers) &&
            call.body.answers.length === 2,
        ),
      ).toBe(true)
    })
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
    await screen.findByText('Is this what you want?')
    expect(screen.getByText(/Answer 1 open question in Thread before approving/)).toBeTruthy()
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
    await screen.findByText('Repo inspection')
    await userEvent.click(screen.getAllByRole('button', { name: /create split proposal/i })[0]!)

    await waitFor(() => {
      expect(calls.some(call => call.url.includes('/api/project/meta-intake/synthesize'))).toBe(true)
    })
  })

  it('surfaces live and stalled worker activity on collapsed-looking work cards', async () => {
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
    await screen.findByText(/Still waiting for the local model/)
    expect(screen.getByText('Started write checkpoint')).toBeTruthy()
    expect(screen.getByText('Writing implementation notes')).toBeTruthy()
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
    await screen.findByText(/Guildhall drafted a first pass here/)
    await userEvent.click(screen.getByRole('button', { name: /continue drafting spec/i }))

    await screen.findByText('Provider model is not loaded.')
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
