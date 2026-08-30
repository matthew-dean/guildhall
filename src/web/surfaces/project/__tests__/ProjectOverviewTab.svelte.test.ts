// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { path } from '../../../lib/nav.svelte.js'
import ProjectOverviewTab from '../ProjectOverviewTab.svelte'

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/workspace/looma-knit',
    tasks: [],
    actionModel: {
      primaryAction: {
        label: 'Review the next spec',
        detail: 'This approval lets the current milestone continue.',
        buttonLabel: 'Review spec',
        href: '/work?task=task-001',
        tone: 'warn',
      },
      secondaryActions: [],
      runControl: { label: 'Start blocked', startEnabled: false, pauseEnabled: true },
      ownerInput: { active: false },
      setup: { state: 'ready', freshIntakeNeeded: false },
    },
    releaseReadiness: {
      release: { id: 'release-1', label: 'Milestone one', kind: 'release', state: 'active' },
      scope: { id: 'release-1', label: 'Milestone one', kind: 'release', state: 'active' },
      releaseCounts: { done: 1, total: 4 },
    },
    ...overrides,
  }
}

const ticker = { label: 'Paused', actorLabel: 'Guildhall', message: 'Paused', tone: 'idle', pulse: false }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  path.value = '/projects/looma-knit/overview'
})

describe('ProjectOverviewTab owner decision', () => {
  it('shows one shared action and removes duplicate dashboard reports', () => {
    render(ProjectOverviewTab, { detail: detail() as any, projectTicker: ticker, activeProjectId: 'looma-knit' })

    expect(screen.getByRole('heading', { name: 'What needs your attention' })).toBeInTheDocument()
    expect(screen.getByText('Milestone one')).toBeInTheDocument()
    expect(screen.getByText('1 of 4 complete')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review the next spec' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review spec' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View work' })).not.toBeInTheDocument()
    expect(screen.queryByText('Work mix')).not.toBeInTheDocument()
    expect(screen.queryByText('Blocked work')).not.toBeInTheDocument()
    expect(screen.queryByText('Next run')).not.toBeInTheDocument()
    expect(screen.queryByText('Signals')).not.toBeInTheDocument()
  })

  it('does not frame live work as an owner-attention demand', () => {
    const running = detail({
      actionModel: {
        primaryAction: {
          code: 'running',
          label: 'Build the next primitive',
          detail: 'Guildhall is working on "Build the next primitive".',
          buttonLabel: 'Open Work',
          href: '/work?task=task-running',
          taskId: 'task-running',
        },
      },
    })

    render(ProjectOverviewTab, { detail: running as any, projectTicker: ticker, activeProjectId: 'looma-knit' })

    expect(screen.getByRole('heading', { name: 'Work is underway' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What needs your attention' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Work' })).toBeInTheDocument()
  })

  it('takes the owner straight to the action selected by the shared model', async () => {
    render(ProjectOverviewTab, { detail: detail() as any, projectTicker: ticker, activeProjectId: 'looma-knit' })

    await fireEvent.click(screen.getByRole('button', { name: 'Review spec' }))
    expect(path.href).toBe('/projects/looma-knit/work?task=task-001')
  })

  it('keeps an owner-review target compact and separate from the review command', () => {
    render(ProjectOverviewTab, {
      detail: detail({
        actionModel: {
          ...detail().actionModel,
          primaryAction: {
            label: 'Review a spec',
            taskLabel: 'Keep the component, editor, and migration roadmaps synchronized as their status changes.',
            taskId: 'task-import-1rpbo8n',
            detail: '10 specs are ready for your review before work can continue.',
            buttonLabel: 'Review next spec',
            href: '/work?task=task-import-1rpbo8n',
            tone: 'warn',
            code: 'owner_review_required',
          },
        },
      }) as any,
      projectTicker: ticker,
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('heading', { name: 'Review a spec' })).toBeInTheDocument()
    expect(screen.getByText('LOO-EBUYE7')).toBeInTheDocument()
    expect(screen.getByText(/Keep the component, editor, and migration roadmaps synchronized/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review next spec' })).toBeInTheDocument()
  })

  it('keeps runnable work state separate from the selected task identity', () => {
    render(ProjectOverviewTab, {
      detail: detail({
        actionModel: {
          ...detail().actionModel,
          primaryAction: {
            label: 'Work ready to resume',
            taskLabel: 'Present draft review evaluation and provenance',
            taskId: 'task-091',
            buttonLabel: 'Open Work',
            href: '/work?task=task-091',
            tone: 'accent',
            code: 'ready_work',
          },
        },
      }) as any,
      projectTicker: ticker,
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByRole('heading', { name: 'Ready to continue' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What needs your attention' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Work ready to resume' })).toBeInTheDocument()
    expect(screen.getByText('NAR-091')).toBeInTheDocument()
    expect(screen.getByText('Present draft review evaluation and provenance')).toBeInTheDocument()
    expect(screen.queryByText(/ready to continue review/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Work' })).toBeInTheDocument()
  })

  it('runs a focused spec repair directly instead of routing the owner through Work', async () => {
    const onRunTask = vi.fn()
    render(ProjectOverviewTab, {
      detail: detail({
        actionModel: {
          ...detail().actionModel,
          primaryAction: {
            label: 'Repair this spec',
            taskLabel: 'Component implementation',
            taskId: 'task-component',
            detail: 'Guildhall needs one focused pass before this spec can be reviewed.',
            buttonLabel: 'Repair spec',
            href: '/work?task=task-component',
            tone: 'accent',
            code: 'ready_work',
            operation: 'repair_spec',
          },
        },
      }) as any,
      projectTicker: ticker,
      activeProjectId: 'looma-knit',
      onRunTask,
    })

    expect(screen.getByRole('heading', { name: 'Spec repair needed' })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Repair spec' }))
    expect(onRunTask).toHaveBeenCalledWith('task-component')
  })

  it('runs the supplied repair action instead of exposing a raw migration route', async () => {
    const onMigrate = vi.fn()
    render(ProjectOverviewTab, {
      detail: detail({
        actionModel: {
          ...detail().actionModel,
          primaryAction: {
            label: 'Repair project',
            buttonLabel: 'Repair now',
            href: '/migrations',
            tone: 'danger',
            code: 'required_migration_pending',
          },
        },
      }) as any,
      projectTicker: ticker,
      activeProjectId: 'looma-knit',
      onMigrate,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Repair now' }))
    expect(onMigrate).toHaveBeenCalledTimes(1)
  })

  it('ends a shipped release without inventing urgency but can start the next release', async () => {
    const onStartNextRelease = vi.fn()
    render(ProjectOverviewTab, {
      detail: detail({
        releaseReadiness: {
          release: { id: 'release-1', label: 'Milestone one', kind: 'release', state: 'shipped' },
          scope: { id: 'release-1', label: 'Milestone one', kind: 'release', state: 'shipped' },
        },
      }) as any,
      projectTicker: ticker,
      activeProjectId: 'looma-knit',
      onStartNextRelease,
    })

    expect(screen.getByRole('heading', { name: 'Current release' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shipped' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review spec' })).not.toBeInTheDocument()
    expect(screen.getByText(/There is nothing you need to do here\./)).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Start next release' }))
    expect(onStartNextRelease).toHaveBeenCalledTimes(1)
  })
})
