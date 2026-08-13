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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeInTheDocument()
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
      startReadiness: { canStart: false, focusTaskId: review.id, focusKind: 'spec_review' },
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
    expect(screen.getByRole('button', { name: 'Resume this work item' })).toBeInTheDocument()
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
})
