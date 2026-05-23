// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import WorkTab from '../WorkTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import type { ProjectDetail, Task } from '../../../lib/types.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 'task-a',
    title: overrides.title ?? 'Alpha task',
    status: overrides.status ?? 'ready',
    priority: overrides.priority ?? 'normal',
    domain: overrides.domain ?? 'knit',
    updatedAt: overrides.updatedAt ?? '2026-05-19T10:00:00.000Z',
    revisionCount: overrides.revisionCount ?? 0,
    ...overrides,
  } as Task
}

function detail(tasks: Task[]): ProjectDetail {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    run: { status: 'stopped', mode: 'continuous' },
    tasks,
    config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
  } as ProjectDetail
}

function installBrowserFakes(progress = 'Recent worker progress.') {
  window.history.replaceState({}, '', '/projects/looma-knit/work')
  path.value = '/projects/looma-knit/work'
  vi.stubGlobal('fetch', vi.fn(async () => json({ progress })))
}

describe('WorkTab', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('sorts tasks by user-selected columns and opens tasks from mouse and keyboard', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-beta',
            title: 'Beta task',
            status: 'blocked',
            priority: 'critical',
            domain: 'looma',
            updatedAt: '2026-05-19T11:00:00.000Z',
            blockReason: 'Blocked on missing credentials.',
            revisionCount: 2,
          }),
          task({
            id: 'task-alpha',
            title: 'Alpha task',
            status: 'done',
            priority: 'low',
            domain: 'knit',
            updatedAt: '2026-05-19T09:00:00.000Z',
            terminalSummary: { headline: 'Completed cleanly.' },
            revisionCount: 0,
          }),
          task({
            id: 'task-gamma',
            title: 'Gamma task',
            status: 'in_progress',
            priority: 'high',
            domain: 'project',
            updatedAt: 'not-a-date',
            latestCheckpoint: { nextPlannedAction: 'Rerun focused typecheck.' },
            revisionCount: 1,
          }),
        ]),
      },
    })

    await screen.findByText('Work list (3)')
    await userEvent.click(screen.getByRole('button', { name: /^task$/i }))
    expect(screen.getAllByRole('button', { name: /open task/i })[0]?.textContent).toContain('Alpha task')

    await userEvent.click(screen.getByRole('button', { name: /priority/i }))
    expect(screen.getAllByRole('button', { name: /open task/i })[0]?.textContent).toContain('Alpha task')

    await userEvent.click(screen.getByRole('button', { name: /priority/i }))
    expect(screen.getAllByRole('button', { name: /open task/i })[0]?.textContent).toContain('Beta task')

    expect(screen.getByText('Blocked on missing credentials.')).toBeTruthy()
    expect(screen.getByText('Completed cleanly.')).toBeTruthy()
    expect(screen.getByText('Rerun focused typecheck.')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /open task beta task/i }))
    expect(path.value).toBe('/projects/looma-knit/task/task-beta')

    path.value = '/projects/looma-knit/work'
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    const gammaRow = screen.getByRole('button', { name: /open task gamma task/i })
    await fireEvent.keyDown(gammaRow, { key: 'Enter' })
    expect(path.value).toBe('/projects/looma-knit/task/task-gamma')
  })

  it('uses explicit work summary labels instead of overloaded active/draft terms', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({ id: 'task-brief', title: 'Shape brief', status: 'exploring' }),
          task({ id: 'task-build', title: 'Build contracts', status: 'in_progress' }),
          task({ id: 'task-ready', title: 'Ready work', status: 'ready' }),
          task({ id: 'task-import', title: 'Imported note', status: 'import_draft' }),
        ]),
      },
    })

    expect(await screen.findByText('1 agent-active')).toBeTruthy()
    expect(screen.getByText('1 shaping')).toBeTruthy()
    expect(screen.getByText('1 ready for worker')).toBeTruthy()
    expect(screen.getByText('1 import draft')).toBeTruthy()
    expect(document.body.textContent).not.toContain('2 active')
    expect(document.body.textContent).not.toContain('1 imported drafts')
  })

  it('routes imported-draft review and view-mode controls through project-scoped links', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-import-first',
            title: 'First imported note',
            status: 'import_draft',
            updatedAt: '2026-05-19T12:00:00.000Z',
          }),
          task({
            id: 'task-import-second',
            title: 'Second imported note',
            status: 'import_draft',
            updatedAt: '2026-05-19T11:00:00.000Z',
          }),
        ]),
      },
    })

    await screen.findByText('Imported draft queue')
    expect(screen.getByText(/1 more drafts are queued behind it/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /review next draft/i }))
    expect(path.value).toBe('/projects/looma-knit/task/task-import-first')

    path.value = '/projects/looma-knit/work'
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    await userEvent.click(screen.getByRole('button', { name: /board/i }))
    expect(path.value).toBe('/projects/looma-knit/planner')
  })

  it('switches board mode back to the work list without depending on the details pane', async () => {
    render(WorkTab, {
      props: {
        mode: 'board',
        detail: detail([
          task({ id: 'task-board', title: 'Board task', status: 'ready' }),
        ]),
      },
    })

    await screen.findByText('Task board')
    expect(within(screen.getByText('Next focus').closest('.focus-strip') as HTMLElement).getByText('Board task')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /list/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
  })

  it('renders progress metadata with friendly labels instead of raw identifiers', async () => {
    cleanup()
    installBrowserFakes(`# Looma + Knit Progress

### 🏁 MILESTONE — 2026-05-21T18:30:00.000Z
**Agent:** spec-agent | **Domain:** _meta
**Task:** task-alpha

Drafted full blueprint spec and moved task to spec_review.

---`)

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-alpha',
            title: 'Shape merchant platform spec',
            description: 'Turn the commerce idea into a buildable spec.',
            status: 'spec_review',
            domain: '_meta',
          }),
        ]),
      },
    })

    await screen.findByText('Recent progress')
    await userEvent.click(screen.getByText('Recent progress'))

    expect(await screen.findByText('Spec writer')).toBeTruthy()
    expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
    expect(screen.getByText('Milestone')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /shape merchant platform spec/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/moved the task to awaiting approval/i)).toBeTruthy()
    expect(document.body.textContent).not.toContain('spec-agent')
    expect(document.body.textContent).not.toContain('_meta')
    expect(document.body.textContent).not.toContain('spec_review')
    expect(document.body.textContent).not.toContain('task-alpha')
  })

  it('reloads recent progress with the rendered project id when switching projects', async () => {
    cleanup()
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, 'http://localhost')
      const projectId = parsed.searchParams.get('projectId')
      return json({
        progress: projectId === 'font-something'
          ? 'Font project progress'
          : 'Looma project progress',
    })
  })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    path.value = '/projects/looma-knit/work'

    const rendered = render(WorkTab, {
      props: {
        detail: detail([]),
      },
    })
    expect(await screen.findByText('Looma project progress')).toBeTruthy()

    rendered.rerender({
      detail: {
        ...detail([]),
        id: 'font-something',
        name: 'Font something',
        path: '/repo/font-something',
      },
    })

    expect(await screen.findByText('Font project progress')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Looma project progress')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/project/progress?projectId=looma-knit',
      '/api/project/progress?projectId=font-something',
    ])
  })

  it('routes an empty setup project to the setup flow instead of leaving Work inert', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([]),
          config: { coordinators: [] },
        } as ProjectDetail,
      },
    })

    await screen.findByText('No tasks yet. Finish project setup first.')
    await userEvent.click(screen.getByRole('button', { name: /open setup/i }))
    expect(path.value).toBe('/projects/looma-knit/setup')
  })
})
