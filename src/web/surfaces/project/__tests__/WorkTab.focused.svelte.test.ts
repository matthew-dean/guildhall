// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import WorkTab from '../WorkTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import type { ProjectDetail, Task } from '../../../lib/types.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}

function reviewTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-review-contract', displayKey: 'LOO-142', title: 'Review the acceptance contract',
    description: 'Confirm that the proof is complete before Guildhall continues.', status: 'spec_review',
    priority: 'high', domain: 'Looma', updatedAt: '2026-08-12T17:00:00.000Z', ...overrides,
  } as Task
}

function projectDetail(tasks: Task[], overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'looma-knit', name: 'Looma + Knit', path: '/repo/looma-knit',
    run: { status: 'stopped', mode: 'continuous' }, availability: { status: 'active', pausedAt: null, resumedAt: null },
    tasks, config: { coordinators: [{ id: 'looma', domain: 'Looma' }] },
    orientationSpine: { summary: { headline: 'Stage 1: Release hardening' } }, ...overrides,
  } as ProjectDetail
}

function setRoute(href = '/projects/looma-knit/work') {
  window.history.replaceState({}, '', href)
  path.value = href.split('?')[0]!
  path.href = href
}

describe('focused Work flow', () => {
  beforeEach(() => {
    setRoute()
    vi.stubGlobal('fetch', vi.fn(async () => json({ progress: 'ignored in focused Work' })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('opens on one shared owner decision instead of the queue dashboard', async () => {
    const review = reviewTask()
    render(WorkTab, { props: { detail: projectDetail([review], {
      startReadiness: { canStart: false, code: 'owner_review_required', focusTaskId: review.id, focusKind: 'spec_review', reviewTaskIds: [review.id] },
      actionModel: { primaryAction: { taskId: review.id, label: 'Review the acceptance contract', detail: 'Approve the spec so this work can continue.', buttonLabel: 'Review spec', href: `/work?task=${review.id}`, tone: 'warn' } },
    }) } })

    expect(await screen.findByRole('heading', { name: 'Current work', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Stage 1: Release hardening')).toBeInTheDocument()
    expect(screen.getByText('LOO-142')).toBeInTheDocument()
    expect(screen.getByText('Approve the spec so this work can continue.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review spec' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Work list' })).toBeNull()
    expect(screen.queryByText('Recent progress')).toBeNull()
  })

  it('takes the focused review directly to its visible Spec decision', async () => {
    const user = userEvent.setup()
    const review = reviewTask()
    render(WorkTab, { props: { detail: projectDetail([review], {
      startReadiness: { canStart: false, focusTaskId: review.id, focusKind: 'spec_review', reviewTaskIds: [review.id] },
      actionModel: { primaryAction: { taskId: review.id, href: `/work?task=${review.id}` } },
    }) } })

    await user.click(await screen.findByRole('button', { name: 'Review spec' }))
    expect(path.href).toBe('/projects/looma-knit/task/task-review-contract?tab=spec')
  })

  it('does not frame ready work as an owner-attention problem', async () => {
    const ready = reviewTask({ id: 'task-ready', displayKey: 'LOO-143', title: 'Resume the prepared work', status: 'ready' })
    setRoute(`/projects/looma-knit/work?task=${ready.id}`)
    render(WorkTab, { props: { detail: projectDetail([ready], {
      actionModel: { primaryAction: { taskId: ready.id, code: 'ready_work', buttonLabel: 'Open Work', href: `/work?task=${ready.id}` } },
    }) } })

    expect(await screen.findByRole('heading', { name: 'Ready to continue' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What needs your attention' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Work' })).toBeInTheDocument()
  })

  it('keeps the shared focused work item selected through a later refresh', async () => {
    const selected = reviewTask({ id: 'task-selected', displayKey: 'LOO-143', title: 'Keep this selected' })
    const other = reviewTask({ id: 'task-other', displayKey: 'LOO-144', title: 'Do not replace selection' })
    setRoute('/projects/looma-knit/work?task=task-selected')
    const rendered = render(WorkTab, { props: { detail: projectDetail([selected, other], {
      actionModel: { primaryAction: { taskId: selected.id, href: `/work?task=${selected.id}` } },
    }) } })

    expect(await screen.findByRole('heading', { name: 'Keep this selected' })).toBeInTheDocument()
    await rendered.rerender({ detail: projectDetail([{ ...selected, updatedAt: '2026-08-12T17:10:00.000Z' }, other], {
      actionModel: { primaryAction: { taskId: selected.id, href: `/work?task=${selected.id}` } },
    }) })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Keep this selected' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Do not replace selection' })).toBeNull()
  })

  it('keeps an active selected work item focused after its pending action clears', async () => {
    const active = reviewTask({ id: 'task-active', displayKey: 'LOO-145', title: 'Keep the live handoff focused', status: 'review' })
    setRoute(`/projects/looma-knit/work?task=${active.id}`)
    render(WorkTab, { props: { detail: projectDetail([active], {
      run: { status: 'running', mode: 'one_task' },
      actionModel: { primaryAction: null },
      startReadiness: { canStart: true, code: 'ready_work' },
    }) } })

    expect(await screen.findByRole('heading', { name: 'Current work', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Work is underway' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Keep the live handoff focused' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Work list' })).toBeNull()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open task' })).toBeNull()
  })

  it('keeps paused focused work resumable instead of burying its control in task detail', async () => {
    const paused = reviewTask({ id: 'task-paused', displayKey: 'LOO-146', title: 'Resume this exact work', status: 'in_progress' })
    setRoute(`/projects/looma-knit/work?task=${paused.id}`)
    render(WorkTab, { props: { detail: projectDetail([paused], {
      startReadiness: { canStart: true, code: 'paused_live_work', focusTaskId: paused.id, focusTaskTitle: paused.title, focusKind: 'paused_work' },
      actionModel: {
        primaryAction: {
          taskId: paused.id,
          code: 'paused_live_work',
          operation: 'start_focused',
          href: `/work?task=${paused.id}`,
        },
      },
    }) } })

    expect(await screen.findByRole('heading', { name: 'Work paused' })).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume work' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open task' })).toBeNull()
  })

  it('only exposes the legacy inventory after an explicit Browse work action', async () => {
    const user = userEvent.setup()
    const review = reviewTask()
    render(WorkTab, { props: { detail: projectDetail([review], {
      startReadiness: { canStart: false, focusTaskId: review.id, focusKind: 'spec_review' },
    }) } })

    await user.click(await screen.findByRole('button', { name: 'Browse work' }))
    expect(path.href).toBe('/projects/looma-knit/work?view=queue')
    expect(await screen.findByRole('heading', { name: 'Work list' })).toBeInTheDocument()
  })

  it('shows the current release slice when Browse work follows a focused handoff', async () => {
    const user = userEvent.setup()
    const focused = reviewTask({ id: 'task-focused', displayKey: 'LOO-146', title: 'Focused review', status: 'review' })
    const next = reviewTask({ id: 'task-next', displayKey: 'LOO-147', title: 'Next release work', status: 'ready' })
    setRoute(`/projects/looma-knit/work?task=${focused.id}`)
    const rendered = render(WorkTab, { props: { detail: projectDetail([focused], {
      actionModel: { primaryAction: { taskId: focused.id, href: `/work?task=${focused.id}` } },
    }) } })

    await screen.findByRole('heading', { name: 'Focused review' })
    await rendered.rerender({ detail: projectDetail([focused, next], {
      actionModel: { primaryAction: { taskId: focused.id, href: `/work?task=${focused.id}` } },
      orientationSpine: {
        summary: { headline: 'Stage 1: Release hardening' },
        scopeRows: [
          { taskId: focused.id, scope: 'included' },
          { taskId: next.id, scope: 'included' },
        ],
      },
    }) })

    await user.click(screen.getByRole('button', { name: 'Browse work' }))

    expect(await screen.findByText('2 current items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect work Focused review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect work Next release work' })).toBeInTheDocument()
  })

  it('shows a bounded next-up preview before the full current-release backlog', async () => {
    const user = userEvent.setup()
    const paused = reviewTask({ id: 'task-paused', displayKey: 'LOO-146', title: 'Resume the active migration', status: 'in_progress' })
    const upcoming = Array.from({ length: 5 }, (_, index) => reviewTask({
      id: `task-upcoming-${index + 1}`,
      displayKey: `LOO-${150 + index}`,
      title: `Upcoming release task ${index + 1}`,
      status: 'review',
    }))
    setRoute(`/projects/looma-knit/work?task=${paused.id}`)
    render(WorkTab, { props: { detail: projectDetail([paused, ...upcoming], {
      startReadiness: { canStart: true, code: 'paused_live_work', focusTaskId: paused.id, focusTaskTitle: paused.title, focusKind: 'paused_work' },
      actionModel: { primaryAction: { taskId: paused.id, code: 'paused_live_work', operation: 'start_focused', href: `/work?task=${paused.id}` } },
      orientationSpine: {
        summary: { headline: 'Stage 1: Release hardening' },
        scopeRows: [paused, ...upcoming].map(task => ({ taskId: task.id, scope: 'included' })),
      },
    }) } })

    await user.click(await screen.findByRole('button', { name: 'Browse work' }))

    expect(await screen.findByRole('heading', { name: 'Up next' })).toBeInTheDocument()
    expect(screen.getByText('5 other current items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect work Upcoming release task 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect work Upcoming release task 3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inspect work Upcoming release task 4' })).toBeNull()
    expect(screen.getByText('2 more in this milestone.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all 5 work items' }))
    expect(await screen.findByRole('heading', { name: 'Work list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect work Upcoming release task 5' })).toBeInTheDocument()
  })

  it('keeps paused current work actionable and hides unrelated draft work after Browse work', async () => {
    const user = userEvent.setup()
    const paused = reviewTask({
      id: 'task-paused', displayKey: 'LOO-146', title: 'Resume this exact work', status: 'in_progress', assignedTo: 'worker-agent',
    })
    const draft = reviewTask({
      id: 'task-draft', displayKey: 'LOO-147', title: 'An unrelated imported draft', status: 'import_draft',
    })
    const coordinatorReview = reviewTask({
      id: 'task-coordinator-review', displayKey: 'LOO-148', title: 'Coordinator review', status: 'spec_review',
      specReviewGate: { authority: 'coordinator' },
    })
    setRoute(`/projects/looma-knit/work?task=${paused.id}`)
    render(WorkTab, { props: { detail: projectDetail([paused, draft, coordinatorReview], {
      startReadiness: { canStart: true, code: 'paused_live_work', focusTaskId: paused.id, focusTaskTitle: paused.title, focusKind: 'paused_work' },
      actionModel: {
        primaryAction: {
          taskId: paused.id,
          code: 'paused_live_work',
          operation: 'start_focused',
          href: `/work?task=${paused.id}`,
        },
      },
      orientationSpine: {
        summary: { headline: 'Stage 1: Release hardening' },
        scopeRows: [
          { taskId: paused.id, scope: 'included' },
          { taskId: coordinatorReview.id, scope: 'included' },
        ],
      },
    }) } })

    await user.click(await screen.findByRole('button', { name: 'Browse work' }))

    expect(await screen.findByRole('region', { name: 'Current work' })).toHaveTextContent('Paused')
    expect(screen.getByRole('button', { name: 'Resume work' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Draft task brief' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Inspect work Resume this exact work' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Inspect work Coordinator review' })).toHaveTextContent('Queued')
    expect(screen.getByRole('button', { name: 'Inspect work Coordinator review' })).not.toHaveTextContent('Review spec')
  })
})
