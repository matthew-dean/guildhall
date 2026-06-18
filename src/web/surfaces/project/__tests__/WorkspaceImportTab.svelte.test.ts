// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import WorkspaceImportTab from '../WorkspaceImportTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import { project } from '../../../lib/project.svelte.js'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const detectedDraft = {
  taskExists: false,
  specReady: false,
  dismissed: false,
  anchors: [],
  detected: {
    goals: [
      {
        id: 'goal-editor',
        title: 'Make editor linking production-ready',
        rationale: 'Roadmap calls this out.',
        source: 'docs/roadmap.md',
        confidence: 'high',
      },
    ],
    tasks: [
      {
        suggestedId: 'task-link-editor',
        title: 'Knit: add link editor controls',
        description: 'Build URL input, display text, open-in-new-tab, and remove link controls.',
        domain: 'editor',
        priority: 'high',
        source: 'docs/roadmap.md',
        references: ['docs/roadmap.md', 'web/app/components/editor/toolbar.ts'],
        confidence: 'high',
      },
      {
        suggestedId: 'task-link-preview',
        title: 'Knit: preview saved links',
        description: 'Show a compact preview after inserting a link.',
        domain: 'editor',
        priority: 'normal',
        source: 'docs/notes.md',
        references: ['docs/notes.md'],
        confidence: 'medium',
      },
    ],
    milestones: [
      {
        title: 'Ship editor beta',
        evidence: 'Milestone table',
        source: 'docs/roadmap.md',
      },
    ],
    context: [
      {
        label: 'Existing toolbar pattern',
        excerpt: 'Toolbar actions emit custom events.',
        source: 'web/app/components/editor/toolbar.ts',
      },
    ],
    stats: { inputSignals: 4, drafted: 2, deduped: 0 },
    review: {
      areaGroups: [
        {
          key: 'knit',
          label: 'Knit',
          taskCount: 2,
          milestoneCount: 1,
          goalCount: 1,
          contextCount: 1,
          sourceCount: 2,
          sourceKeys: ['roadmap', 'notes'],
          summary: 'Editor planning and implementation notes.',
        },
        {
          key: 'looma',
          label: 'Looma',
          taskCount: 0,
          milestoneCount: 0,
          goalCount: 0,
          contextCount: 1,
          sourceCount: 1,
          sourceKeys: ['looma-notes'],
          summary: 'Reference notes only.',
        },
      ],
      sourceGroups: [
        {
          key: 'roadmap',
          label: 'Roadmap',
          path: '/repo/looma-knit/docs/roadmap.md',
          areaKey: 'knit',
          areaLabel: 'Knit',
          taskCount: 1,
          milestoneCount: 1,
          goalCount: 1,
          contextCount: 0,
          existingOverlapCount: 0,
          kind: 'mixed',
          summary: 'Roadmap items for editor linking.',
          taskIds: ['task-link-editor'],
        },
        {
          key: 'notes',
          label: 'Editor notes',
          path: '/repo/looma-knit/docs/notes.md',
          areaKey: 'knit',
          areaLabel: 'Knit',
          taskCount: 1,
          milestoneCount: 0,
          goalCount: 0,
          contextCount: 1,
          existingOverlapCount: 0,
          kind: 'tasks',
          summary: 'Follow-up link preview notes.',
          taskIds: ['task-link-preview'],
        },
        {
          key: 'looma-notes',
          label: 'Looma reference',
          path: '/repo/looma-knit/docs/looma.md',
          areaKey: 'looma',
          areaLabel: 'Looma',
          taskCount: 0,
          milestoneCount: 0,
          goalCount: 0,
          contextCount: 1,
          existingOverlapCount: 0,
          kind: 'reference',
          summary: 'Reference-only product notes.',
          taskIds: [],
        },
      ],
      totalTaskCandidates: 2,
      totalMilestones: 1,
      totalGoals: 1,
    },
    learning: {
      defaults: {
        selectedAreaKeys: ['knit', 'looma'],
        selectedSourceKeys: ['roadmap', 'notes', 'looma-notes'],
        selectedTaskIds: ['task-link-editor', 'task-link-preview'],
        taskSelectionMode: 'all',
        note: 'Guildhall remembers where you focused last time, but starts from the full current import so no project context is dropped.',
      },
      coordinatorSuggestions: [],
      productSuggestions: [],
    },
  },
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/projects/looma-knit/workspace-import')
  path.value = '/projects/looma-knit/workspace-import'
  project.detail = null
  project.error = null
}

function installFetchFakes(draftPayload = detectedDraft) {
  const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, init, body })
    if (url.startsWith('/api/project/workspace-import/draft')) return json(draftPayload)
    if (url.startsWith('/api/project/workspace-import/approve')) {
      return json({ ok: true, tasksAdded: 2, goalsRecorded: 1, milestonesLogged: 1 })
    }
    if (url.startsWith('/api/project/workspace-import/dismiss')) return json({ ok: true })
    if (url.startsWith('/api/project/workspace-import/rerun')) return json({ ok: true })
    if (url.startsWith('/api/project')) {
      return json({
        project: { id: 'looma-knit', name: 'Looma + Knit', path: '/repo/looma-knit' },
        tasks: [],
        run: { status: 'stopped', mode: 'continuous' },
      })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

describe('WorkspaceImportTab', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('walks imported planning notes into scoped draft-task creation', async () => {
    const { calls } = installFetchFakes()

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes in 2 project parts/)
    expect(screen.getByText(/starts from the full current import/)).toBeTruthy()
    expect(screen.getByText(/Nothing is saved until the final step/)).toBeTruthy()
    expect(screen.getByText(/You can resume this review later/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /choose parts to review/i }))
    await screen.findByText('Choose the parts for this pass')

    await userEvent.click(screen.getByRole('button', { name: /review 2 selected parts/i }))
    await screen.findByText('Review notes in Knit')

    await userEvent.click(screen.getByRole('button', { name: /review looma next/i }))
    await screen.findByText('Review notes in Looma')

    await userEvent.click(screen.getByRole('button', { name: /review selected tasks/i }))
    await screen.findByText('Review tasks from Roadmap')

    await userEvent.click(screen.getAllByRole('button', { name: /review next source/i }).at(-1)!)
    await screen.findByText('Review tasks from Editor notes')

    await userEvent.click(screen.getByRole('button', { name: /review final task list/i }))
    await screen.findByText('Create 2 draft tasks?')

    await userEvent.click(screen.getByRole('button', { name: /^create tasks$/i }))
    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.startsWith('/api/project/workspace-import/approve') &&
            call.url.includes('projectId=looma-knit') &&
            call.body?.projectId === 'looma-knit' &&
            Array.isArray(call.body?.areaKeys) &&
            Array.isArray(call.body?.sourceKeys) &&
            Array.isArray(call.body?.taskIds),
        ),
      ).toBe(true)
    })
    expect(screen.getByText(/Created 2 draft tasks/)).toBeTruthy()
  })

  it('opens extra details without making the drawer a required path', async () => {
    installFetchFakes()

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes/)

    await userEvent.click(screen.getAllByRole('button', { name: /details/i })[0]!)
    expect(screen.getByRole('complementary', { name: 'Knit' })).toBeTruthy()
    expect(screen.getByText('Editor planning and implementation notes.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    await userEvent.click(screen.getByRole('button', { name: /choose parts to review/i }))
    expect(screen.getByText('Choose the parts for this pass')).toBeTruthy()
  })

  it('lets users inspect source summaries from a part details drawer', async () => {
    installFetchFakes()

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes in 2 project parts/)

    await userEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]!)

    expect(await screen.findByText('Sources in this part')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Roadmap/ })).toBeTruthy()
    expect(screen.getByText('Roadmap items for editor linking.')).toBeTruthy()
  })

  it('does not reserve blank summary space when every found part is reference-only', async () => {
    const referenceOnlyDraft = structuredClone(detectedDraft)
    referenceOnlyDraft.detected.tasks = []
    referenceOnlyDraft.detected.stats = { inputSignals: 4, drafted: 0, deduped: 0 }
    referenceOnlyDraft.detected.review.totalTaskCandidates = 0
    referenceOnlyDraft.detected.review.areaGroups = referenceOnlyDraft.detected.review.areaGroups.map(area => ({
      ...area,
      taskCount: 0,
    }))
    referenceOnlyDraft.detected.review.sourceGroups = referenceOnlyDraft.detected.review.sourceGroups.map(group => ({
      ...group,
      taskCount: 0,
      kind: 'reference',
      taskIds: [],
    }))
    referenceOnlyDraft.detected.learning.defaults = {
      selectedAreaKeys: [],
      selectedSourceKeys: [],
      selectedTaskIds: [],
      taskSelectionMode: 'all',
      note: null,
    }
    installFetchFakes(referenceOnlyDraft)

    const { container } = render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes in 2 project parts/)

    expect(container.querySelectorAll('ul.source-summary:not(.nested)')).toHaveLength(0)
    expect(screen.getByText('Show reference-only parts')).toBeTruthy()
  })

  it('can import reference-only project context without creating draft tasks', async () => {
    const { calls } = installFetchFakes()

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes/)

    await userEvent.click(screen.getByRole('button', { name: /choose parts to review/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /^exclude$/i })[0]!)
    await userEvent.click(screen.getByText('Included project context'))
    await userEvent.click(screen.getAllByRole('button', { name: /^include$/i })[1]!)
    await userEvent.click(screen.getByRole('button', { name: /review 1 selected part/i }))

    await screen.findByText('Review notes in Looma')
    expect(screen.queryByRole('button', { name: /use this source/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /review import summary/i }))

    await screen.findByText('Import the project notes and goals?')
    await userEvent.click(screen.getByRole('button', { name: /save import/i }))

    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.startsWith('/api/project/workspace-import/approve') &&
            Array.isArray(call.body?.areaKeys) &&
            (call.body.areaKeys as string[]).includes('looma') &&
            Array.isArray(call.body?.sourceKeys) &&
            (call.body.sourceKeys as string[]).includes('looma-notes') &&
            Array.isArray(call.body?.taskIds) &&
            (call.body.taskIds as string[]).length === 0,
        ),
      ).toBe(true)
    })
  })

  it('shows a completed import repair path without reopening the wizard', async () => {
    const completedDraft = structuredClone(detectedDraft)
    completedDraft.taskStatus = 'done'
    completedDraft.parsed = {
      goals: [{ id: 'goal-fll', title: 'Launch the license workflow', rationale: 'Project brief' }],
      tasks: [
        {
          id: 'task-auth-complete',
          title: 'Complete authentication flow',
          description: 'Finish registration, login, profile management, and email confirmation.',
          domain: 'auth',
          priority: 'high',
          references: ['docs/brief.md'],
        },
        {
          id: 'task-listings-basic',
          title: 'Build basic listing submission',
          description: '',
          domain: 'core',
          priority: 'normal',
          references: [],
        },
      ],
      milestones: [],
    }
    const { calls } = installFetchFakes(completedDraft)

    render(WorkspaceImportTab)

    await screen.findByText('This project import has already been approved.')
    expect(screen.queryByText(/Found planning notes/)).toBeNull()
    expect(screen.getByText('2 proposed tasks')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /restore 2 missing drafts/i }))

    await waitFor(() => {
      const repairCall = calls.find(call => call.url.startsWith('/api/project/workspace-import/approve'))
      expect(repairCall).toBeDefined()
      expect(repairCall?.body).toEqual({ projectId: 'looma-knit' })
    })
    await screen.findByText(/Created 2 draft tasks/)
  })

  it('explains restore versus re-run when completed import drafts are missing', async () => {
    const completedDraft = structuredClone(detectedDraft)
    completedDraft.taskStatus = 'done'
    completedDraft.parsed = {
      goals: [],
      tasks: [
        {
          id: 'task-auth-complete',
          title: 'Complete authentication flow',
          description: 'Finish registration, login, profile management, and email confirmation.',
          domain: 'auth',
          priority: 'high',
          references: ['docs/brief.md'],
        },
      ],
      milestones: [],
    }
    installFetchFakes(completedDraft)

    render(WorkspaceImportTab)

    await screen.findByText('This project import has already been approved.')
    expect(screen.getByText(/Use Restore to add the missing drafts from the approved import/)).toBeTruthy()
    expect(screen.getByText(/Use Re-read only if the project notes changed or this import looks stale/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /restore 1 missing draft/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /re-read project notes/i })).toBeTruthy()
  })

  it('does not offer restore when completed import tasks already exist in Work', async () => {
    const completedDraft = structuredClone(detectedDraft)
    completedDraft.taskStatus = 'done'
    completedDraft.parsed = {
      goals: [],
      tasks: [
        {
          id: 'task-link-editor',
          title: 'Knit: add link editor controls',
          description: '',
          domain: 'editor',
          priority: 'high',
          references: [],
        },
        {
          id: 'task-link-preview',
          title: 'Knit: preview saved links',
          description: '',
          domain: 'editor',
          priority: 'normal',
          references: [],
        },
      ],
      milestones: [],
    }
    project.detail = {
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/repo/looma-knit',
      tasks: [
        { id: 'task-link-editor', title: 'Knit: add link editor controls', status: 'ready' },
        { id: 'task-link-preview', title: 'Knit: preview saved links', status: 'import_draft' },
      ],
    } as never
    installFetchFakes(completedDraft)

    render(WorkspaceImportTab)

    await screen.findByText('This project import has already been approved.')
    expect(screen.getByText('All proposed tasks from this completed import already exist in Work.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull()
  })

  it('lets users narrow sources and individual imported tasks before creating drafts', async () => {
    const { calls } = installFetchFakes()

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes/)

    await userEvent.click(screen.getByRole('button', { name: /choose parts to review/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /^exclude$/i })[1]!)
    await userEvent.click(screen.getByRole('button', { name: /review 1 selected part/i }))
    await screen.findByText('Review notes in Knit')

    await userEvent.click(screen.getAllByRole('button', { name: /^exclude$/i })[0]!)
    await userEvent.click(screen.getByRole('button', { name: /review selected tasks/i }))
    await screen.findByText('Review tasks from Editor notes')
    expect(screen.queryByText('Review tasks from Roadmap')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /skip this source/i }))
    expect((screen.getByRole('button', { name: /review final task list/i }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /keep this source/i }))
    await userEvent.click(screen.getByRole('button', { name: /review final task list/i }))

    await screen.findByText('Create 1 draft task?')
    await userEvent.click(screen.getByRole('button', { name: /^create tasks$/i }))

    await waitFor(() => {
      expect(
        calls.some(
          call =>
            call.url.startsWith('/api/project/workspace-import/approve') &&
            Array.isArray(call.body?.sourceKeys) &&
            (call.body.sourceKeys as string[]).includes('notes') &&
            !(call.body.sourceKeys as string[]).includes('roadmap') &&
            Array.isArray(call.body?.taskIds) &&
            (call.body.taskIds as string[]).length === 1 &&
            (call.body.taskIds as string[])[0] === 'task-link-preview',
        ),
      ).toBe(true)
    })
  })

  it('lets users continue task review from an open task details drawer', async () => {
    installFetchFakes()

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes/)

    await userEvent.click(screen.getByRole('button', { name: /choose parts to review/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /^exclude$/i })[1]!)
    await userEvent.click(screen.getByRole('button', { name: /review 1 selected part/i }))
    await userEvent.click(screen.getByRole('button', { name: /review selected tasks/i }))
    await screen.findByText('Review tasks from Roadmap')

    await userEvent.click(screen.getByRole('button', { name: /Knit: add link editor controls/i }))
    expect(await screen.findByRole('complementary', { name: /Knit: add link editor controls/i })).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: /review next source/i }).at(-1)!)

    await screen.findByText('Review tasks from Editor notes')
    expect(screen.queryByRole('complementary', { name: /Knit: add link editor controls/i })).toBeNull()
  })

  it('surfaces draft, approve, dismiss, and rerun failures without changing context', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith('/api/project/workspace-import/draft')) {
        return calls.filter(call => call.startsWith('/api/project/workspace-import/draft')).length === 1
          ? json({ error: 'import detector failed' })
          : json(detectedDraft)
      }
      if (url.startsWith('/api/project/workspace-import/approve')) return json({ error: 'approve failed' }, { status: 500 })
      if (url.startsWith('/api/project/workspace-import/dismiss')) return json({}, { status: 500 })
      if (url.startsWith('/api/project/workspace-import/rerun')) return json({ error: 'rerun failed' }, { status: 500 })
      if (url.startsWith('/api/project')) return json({ project: { id: 'looma-knit', name: 'Looma + Knit' }, tasks: [] })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(WorkspaceImportTab)
    await screen.findByText(/import detector failed/)

    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText(/Found planning notes/)
    await userEvent.click(screen.getByRole('button', { name: /shelve import review/i }))
    await userEvent.click(screen.getByRole('button', { name: /choose parts to review/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /^exclude$/i })[1]!)
    await userEvent.click(screen.getByRole('button', { name: /review 1 selected part/i }))
    await userEvent.click(screen.getByRole('button', { name: /review selected tasks/i }))
    await userEvent.click(screen.getByRole('button', { name: /review next source/i }))
    await userEvent.click(screen.getByRole('button', { name: /review final task list/i }))
    await userEvent.click(screen.getByRole('button', { name: /^create tasks$/i }))

    await waitFor(() => {
      expect(calls.some(call => call.startsWith('/api/project/workspace-import/approve'))).toBe(true)
      expect(calls.some(call => call.startsWith('/api/project/workspace-import/dismiss'))).toBe(true)
    })
  })

  it('shows a clear dismissed state after skipping import review', async () => {
    const dismissedDraft = { ...detectedDraft, dismissed: true }
    let dismissed = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/workspace-import/draft')) {
        return json(dismissed ? dismissedDraft : detectedDraft)
      }
      if (url.startsWith('/api/project/workspace-import/dismiss')) {
        dismissed = true
        return json({ ok: true })
      }
      if (url.startsWith('/api/project')) return json({ project: { id: 'looma-knit', name: 'Looma + Knit' }, tasks: [] })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(WorkspaceImportTab)
    await screen.findByText(/Found planning notes/)

    await userEvent.click(screen.getByRole('button', { name: /shelve import review/i }))

    expect(await screen.findByText(/import review shelved/i)).toBeTruthy()
    expect(screen.queryByText(/Found planning notes/)).toBeNull()
  })

  it('handles empty import findings with rerun and dismiss actions', async () => {
    const { calls } = installFetchFakes({
      taskExists: false,
      specReady: false,
      dismissed: false,
      detected: null,
      anchors: [],
    })

    render(WorkspaceImportTab)
    await screen.findByText('No importable planning material was found yet.')

    const rereadButton = screen.getByRole('button', { name: /re-read project notes/i })
    expect(rereadButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(rereadButton)
    await waitFor(() => {
      expect(calls.some(call => call.url.startsWith('/api/project/workspace-import/rerun'))).toBe(true)
    })
  })
})
