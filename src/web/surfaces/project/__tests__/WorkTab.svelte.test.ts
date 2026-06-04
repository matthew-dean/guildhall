// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import '@testing-library/jest-dom/vitest'
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
    availability: { status: 'active', pausedAt: null, resumedAt: null },
    tasks,
    config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
  } as ProjectDetail
}

function pausedDetail(tasks: Task[]): ProjectDetail {
  return {
    ...detail(tasks),
    availability: { status: 'paused', pausedAt: '2026-05-19T10:00:00.000Z', resumedAt: null },
  } as ProjectDetail
}

function runningDetail(tasks: Task[]): ProjectDetail {
  return {
    ...detail(tasks),
    run: { status: 'running', mode: 'continuous' },
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

    await screen.findByText('1 shown · 3 total')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'all')
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

  it('does not show an empty new-request prompt when a zero-task project is blocked by migration', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([]),
          startReadiness: {
            canStart: false,
            code: 'required_migration_pending',
            message: 'Run the required Guildhall migration before Guildhall can update this project.',
            actionHref: '/migrations',
          },
          inbox: {
            items: [
              {
                kind: 'required_migration',
                severity: 'high',
                title: 'Required migration: Project state layout',
                detail: 'Move project state into the new layout before Guildhall can update it.',
                actionHref: '/migrations',
                status: 'open',
                id: 'migration:project-state-layout',
                createdAt: '2026-05-19T10:00:00.000Z',
                updatedAt: '2026-05-19T10:00:00.000Z',
              },
            ],
            history: [],
            blockers: { bootstrap: false, workspaceImport: false },
          },
        },
      },
    })

    expect(screen.getByText('Move project state into the new layout before Guildhall can update it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /migrate project/i })).toBeInTheDocument()
    expect(screen.queryByText(/No tasks yet.*New request/i)).not.toBeInTheDocument()
  })

  it('does not show an empty new-request prompt when a zero-task project has setup work', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([]),
          startReadiness: {
            canStart: false,
            code: 'setup_pending',
            message: 'Finish project setup first.',
            actionHref: '/setup',
          },
          inbox: {
            items: [
              {
                kind: 'setup_pending',
                severity: 'medium',
                stepId: 'direction',
                title: 'Add project direction',
                detail: 'Finish project setup first.',
                actionHref: '/setup',
                status: 'open',
                id: 'setup:direction',
                createdAt: '2026-05-19T10:00:00.000Z',
                updatedAt: '2026-05-19T10:00:00.000Z',
              },
            ],
            history: [],
            blockers: { bootstrap: false, workspaceImport: false },
          },
        },
      },
    })

    expect(screen.getByText('Finish project setup first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open setup/i })).toBeInTheDocument()
    expect(screen.queryByText(/No tasks yet.*New request/i)).not.toBeInTheDocument()
  })

  it('shows the opt-in column browser without selecting a default packet', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'feature-root',
            title: 'Interface design system',
            status: 'in_progress',
            description: 'Build the interface design system.',
            hierarchy: { childIds: ['task-button'], order: 0 },
          }),
          task({
            id: 'task-button',
            title: 'Button primitive',
            status: 'in_progress',
            description: 'Ship the reusable button primitive.',
            hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
          }),
        ]),
      },
    })

    expect((await screen.findAllByText('Columns')).length).toBeGreaterThan(0)
    const columns = screen.getByLabelText('Work hierarchy columns')
    expect(columns).toBeTruthy()
    expect(screen.getByLabelText('Selected deliverable packet').textContent).toContain('Select work to inspect')
    expect(within(columns).getAllByText('Interface design system').length).toBe(1)

    await userEvent.click(within(columns).getByRole('button', { name: /interface design system/i }))

    expect(screen.getByLabelText('Selected deliverable packet').textContent).toContain('Build the interface design system')
    expect(within(columns).getByText('Button primitive')).toBeTruthy()

    await userEvent.click(within(columns).getByRole('button', { name: /button primitive/i }))

    expect(screen.getByLabelText('Selected deliverable packet').textContent).toContain('Ship the reusable button primitive')
  })

  it('does not echo the selected title across every columns preview panel', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'feature-root',
            title: 'Interface design system',
            status: 'in_progress',
            description: 'Build the interface design system.',
            hierarchy: { childIds: ['task-button'], order: 0 },
          }),
          task({
            id: 'task-button',
            title: 'Button primitive',
            status: 'in_progress',
            description: 'Ship the reusable button primitive.',
            hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
          }),
        ]),
      },
    })

    const workbench = await screen.findByLabelText('Deliverable tree workbench')
    const columns = screen.getByLabelText('Work hierarchy columns')

    await userEvent.click(within(columns).getByRole('button', { name: /interface design system/i }))
    await userEvent.click(within(columns).getByRole('button', { name: /button primitive/i }))

    expect((workbench.textContent?.match(/Button primitive/g) ?? []).length).toBe(1)
    expect(within(workbench).getByText('Child work')).toBeTruthy()
    expect(within(workbench).getByText('Details')).toBeTruthy()
  })

  it('groups columns preview controls into one toolbar', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({ id: 'task-ready', title: 'Ready task', status: 'ready' }),
        ]),
      },
    })

    const toolbar = await screen.findByRole('toolbar', { name: /work view controls/i })
    expect(within(toolbar).getByText('Work view')).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: /^columns$/i }).getAttribute('aria-pressed')).toBe('true')
    expect(within(toolbar).getByRole('button', { name: /^list$/i }).getAttribute('aria-pressed')).toBe('false')
    expect(within(toolbar).getByRole('button', { name: /^board$/i }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toBeTruthy()
    expect(screen.queryByText(/Work list \(/)).toBeNull()

    await userEvent.click(within(toolbar).getByRole('button', { name: /^list$/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=list')
    expect(await screen.findByRole('heading', { name: 'Work list' })).toBeTruthy()
    expect(screen.queryByLabelText('Work hierarchy columns')).toBeNull()

    cleanup()
    path.value = '/projects/looma-knit/work?tree=preview'
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    render(WorkTab, {
      props: {
        detail: detail([
          task({ id: 'task-ready', title: 'Ready task', status: 'ready' }),
        ]),
      },
    })
    const nextToolbar = await screen.findByRole('toolbar', { name: /work view controls/i })
    await userEvent.click(within(nextToolbar).getByRole('button', { name: /^board$/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=board')
  })

  it('flags broad flat ready work as needing breakdown review in the columns preview', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'broad-ready',
            title: 'Build end-to-end interface system',
            status: 'ready',
            description: 'Deliver the whole interface system.',
            acceptanceCriteria: Array.from({ length: 7 }, (_, index) => ({
              description: `Requirement ${index + 1}`,
            })),
            hierarchy: { childIds: [], order: 0 },
          }),
        ]),
      },
    })

    const columns = await screen.findByLabelText('Work hierarchy columns')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')
    expect(within(columns).getByText('Review breakdown')).toBeTruthy()
    expect(within(columns).queryByText('Ready')).toBeNull()

    await userEvent.click(within(columns).getByRole('button', { name: /build end-to-end interface system/i }))

    expect(within(columns).getByText(/No child tasks or decomposition proposal exists yet/i)).toBeTruthy()
    const packet = screen.getByLabelText('Selected deliverable packet')
    expect(within(packet).getByText('Review breakdown')).toBeTruthy()
    expect(within(packet).getByText(/7 requirements; no child tasks or decomposition proposal yet/i)).toBeTruthy()
  })

  it('hides done and shelved work by default and reveals it on request', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-ready',
            title: 'Ready feature work',
            status: 'ready',
            spec: '## Summary\n\nBuild the ready feature work.',
            productBrief: {
              userJob: 'Use the ready feature.',
              whyItMattersNow: 'It is next in the execution queue.',
              successMetric: 'Ready feature works.',
              nonGoals: ['Do not change adjacent features.'],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            acceptanceCriteria: [{ description: 'Ready feature works.' }],
          }),
          task({ id: 'task-done', title: 'Completed feature proof', status: 'done' }),
          task({ id: 'task-shelved', title: 'Shelved idea', status: 'shelved' }),
        ]),
      },
    })

    await screen.findByText('1 shown · 3 total')
    expect(screen.getByText('Ready feature work')).toBeTruthy()
    expect(screen.queryByText('Completed feature proof')).toBeNull()
    expect(screen.queryByText('Shelved idea')).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'all')

    expect(screen.getByText('3 shown · 3 total')).toBeTruthy()
    expect(screen.getByText('Completed feature proof')).toBeTruthy()
    expect(screen.getByText('Shelved idea')).toBeTruthy()
  })

  it('shows flexible work hierarchy breadcrumbs and child rollups without parent-task wording', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'app-spec',
            title: 'Pantry Pulse app spec',
            status: 'ready',
            workKind: 'app_spec',
            hierarchy: { childIds: ['feature-inventory'], order: 0 },
          }),
          task({
            id: 'feature-inventory',
            title: 'Inventory tracking feature',
            status: 'ready',
            workKind: 'feature_spec',
            hierarchy: { parentId: 'app-spec', childIds: ['task-build-inventory'], order: 0 },
          }),
          task({
            id: 'task-build-inventory',
            title: 'Build inventory list',
            status: 'ready',
            workKind: 'implementation',
            hierarchy: { parentId: 'feature-inventory', childIds: [], order: 0 },
          }),
        ]),
      },
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'open')

    await screen.findByText('Pantry Pulse app spec')
    expect(screen.getAllByText('1 nested work item').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Pantry Pulse app spec / Inventory tracking feature')).toBeTruthy()
    expect(screen.getByText('Pantry Pulse app spec / Inventory tracking feature / Build inventory list')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/parent task/i)
  })

  it('uses explicit work summary labels instead of overloaded active/draft terms', async () => {
    render(WorkTab, {
      props: {
        detail: runningDetail([
          task({ id: 'task-brief', title: 'Shape brief', status: 'exploring' }),
          task({ id: 'task-build', title: 'Build contracts', status: 'in_progress' }),
          task({
            id: 'task-ready',
            title: 'Ready work',
            status: 'ready',
            spec: '## Summary\n\nBuild the ready work.',
            productBrief: {
              userJob: 'Use the ready work.',
              whyItMattersNow: 'Ready work is queued for the current run.',
              successMetric: 'Ready work functions.',
              nonGoals: ['Do not change adjacent contracts.'],
              approvedAt: '2026-05-23T12:00:00.000Z',
            },
            acceptanceCriteria: [{ description: 'Ready work functions.' }],
          }),
          task({ id: 'task-import', title: 'Imported note', status: 'import_draft' }),
        ]),
      },
    })

    expect(await screen.findByText('1 Working')).toBeTruthy()
    expect(screen.getByText('1 Ready')).toBeTruthy()
    expect(screen.queryByText('1 being shaped')).toBeNull()
    expect(screen.queryByText('1 import draft')).toBeNull()
    expect(document.body.textContent).not.toContain('agent-active')
    expect(document.body.textContent).not.toContain('ready for worker')
    expect(document.body.textContent).not.toContain('2 active')
    expect(document.body.textContent).not.toContain('1 imported drafts')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')

    expect(screen.getByText('Queued')).toBeTruthy()
    expect(screen.getByText('1 import draft')).toBeTruthy()
  })

  it('defaults to queued execution work and shows shaping/spec work only when Planning is selected', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-import-1y7kmp6',
            title: 'Block menu / block side menu',
            status: 'exploring',
            spec: '## Summary\n\nBuild the block menu.',
            acceptanceCriteria: [{ description: 'The block menu can be opened.' }],
            openQuestions: [],
          }),
          task({
            id: 'task-import-1aessks',
            title: 'Floating toolbar',
            status: 'exploring',
          }),
        ]),
      },
    })

    expect(await screen.findByText('0 shown · 2 total')).toBeTruthy()
    expect(screen.getByText('No queued work yet.')).toBeTruthy()
    expect(screen.getByText(/Use Planning to inspect intake and spec work/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /show planning/i })).toBeTruthy()
    expect(screen.getByRole('option', { name: /^planning$/i })).toBeTruthy()
    expect(screen.queryByText('Block menu / block side menu')).toBeNull()
    expect(screen.queryByText('Spec revision queued')).toBeNull()
    expect(screen.queryByText('Guildhall shaping')).toBeNull()
    expect(document.body.textContent).not.toContain('Intake')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')

    expect(await screen.findByText('2 shown · 2 total')).toBeTruthy()
    expect(screen.getByText('Block menu / block side menu')).toBeTruthy()
    expect(screen.getAllByText('Paused').length).toBeGreaterThanOrEqual(2)
  })

  it('labels inactive in-progress work as paused when no project run is active', async () => {
    render(WorkTab, {
      props: {
        detail: pausedDetail([
          task({ id: 'task-build', title: 'Build contracts', status: 'in_progress' }),
        ]),
      },
    })

    expect(await screen.findByText('1 paused task')).toBeTruthy()
    expect(screen.queryByText('1 agent-active')).toBeNull()
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.queryByText('In progress')).toBeNull()
  })

  it('keeps stopped gate checks labeled as gate work instead of paused work', async () => {
    render(WorkTab, {
      props: {
        detail: pausedDetail([
          task({ id: 'task-gates', title: 'Implement minimal harness orchestration skeleton', status: 'gate_check' }),
        ]),
      },
    })

    expect(await screen.findByText('Gates')).toBeTruthy()
    expect(screen.queryByText('Paused')).toBeNull()
  })

  it('separates spec-thin ready tasks from worker-ready tasks', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-worker-ready',
            title: 'Approved worker task',
            status: 'ready',
            description: 'Implement the approved path.',
            spec: '## Summary\n\nImplement the approved path.',
            productBrief: {
              userJob: 'Use the approved flow.',
              whyItMattersNow: 'The flow is release-blocking.',
              successMetric: 'Flow works.',
              nonGoals: ['Do not redesign adjacent flows.'],
              approvedAt: '2026-05-23T12:00:00.000Z',
            },
            acceptanceCriteria: [{ description: 'The approved flow works.' }],
          }),
          task({
            id: 'task-needs-brief',
            title: 'Needs brief cleanup',
            status: 'ready',
            description: 'Still needs acceptance criteria.',
            productBrief: { userJob: 'Use the incomplete flow.', successMetric: 'Flow works.' },
          }),
          task({
            id: 'task-needs-acceptance',
            title: 'Needs acceptance cleanup',
            status: 'ready',
            description: 'Brief is approved, but acceptance criteria are missing.',
            spec: '## Summary\n\nImplement the partially approved path.',
            productBrief: { userJob: 'Use the partial flow.', successMetric: 'Flow works.', approvedAt: '2026-05-23T12:00:00.000Z' },
            acceptanceCriteria: [],
          }),
        ]),
      },
    })

    expect(await screen.findByText('1 Ready')).toBeTruthy()
    expect(screen.queryByText('2 Needs brief')).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')

    expect(screen.getByText('2 Needs brief')).toBeTruthy()
    expect(screen.queryByText('3 ready for worker')).toBeNull()
  })

  it('keeps the wide work-list grid inside the clipped card at side-by-side widths', () => {
    const source = readFileSync('src/web/surfaces/project/WorkTab.svelte', 'utf8')
    const stackBlock = source.match(/:global\(\.work-list-stack\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const headBlock = source.match(/\.list-column-head\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const rowBlock = source.match(/:global\(\.work-list-row\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(stackBlock).toContain('minmax(220px, 1fr)')
    expect(stackBlock).toContain('minmax(108px, max-content)')
    expect(stackBlock).not.toContain('minmax(280px, 1fr)')
    expect(headBlock).toContain('gap: var(--gh-space-2)')
    expect(rowBlock).toContain('gap: var(--gh-space-2)')
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

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')
    await screen.findByText('Imported draft queue')
    expect(screen.getByText(/1 more drafts are queued behind it/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /draft task brief/i }))
    expect(path.value).toBe('/projects/looma-knit/task/task-import-first')

    path.value = '/projects/looma-knit/work'
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    await userEvent.click(screen.getByRole('button', { name: /board/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=board')
  })

  it('switches board mode back to the work list without depending on the details pane', async () => {
    render(WorkTab, {
      props: {
        mode: 'board',
        detail: detail([
          task({
            id: 'task-board',
            title: 'Board task',
            status: 'ready',
            productBrief: {
              userJob: 'Use the board task.',
              whyItMattersNow: 'The board task is the next runnable item.',
              successMetric: 'It appears as the next focus.',
              nonGoals: ['Do not change board layout.'],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            spec: 'Build the board task.',
            acceptanceCriteria: [{ description: 'Shows on the board.' }],
          }),
        ]),
      },
    })

    await screen.findByText('Next focus')
    expect(within(screen.getByText('Next focus').closest('.focus-strip') as HTMLElement).getByText('Board task')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^board$/i }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: /list/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=list')
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
