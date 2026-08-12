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
    expect(screen.getByRole('heading', { name: 'Review the next spec' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review spec' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View work' })).toBeInTheDocument()
    expect(screen.queryByText('Work mix')).not.toBeInTheDocument()
    expect(screen.queryByText('Blocked work')).not.toBeInTheDocument()
    expect(screen.queryByText('Next run')).not.toBeInTheDocument()
    expect(screen.queryByText('Signals')).not.toBeInTheDocument()
  })

  it('takes the owner straight to the action selected by the shared model', async () => {
    render(ProjectOverviewTab, { detail: detail() as any, projectTicker: ticker, activeProjectId: 'looma-knit' })

    await fireEvent.click(screen.getByRole('button', { name: 'Review spec' }))
    expect(path.href).toBe('/projects/looma-knit/work?task=task-001')
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

    await fireEvent.click(screen.getByRole('button', { name: 'Repair project' }))
    expect(onMigrate).toHaveBeenCalledTimes(1)
  })

  it('ends a shipped release without inventing more owner work', () => {
    render(ProjectOverviewTab, {
      detail: detail({
        releaseReadiness: {
          release: { id: 'release-1', label: 'Milestone one', kind: 'release', state: 'shipped' },
          scope: { id: 'release-1', label: 'Milestone one', kind: 'release', state: 'shipped' },
        },
      }) as any,
      projectTicker: ticker,
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('heading', { name: 'Current release' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shipped' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review spec' })).not.toBeInTheDocument()
    expect(screen.getByText(/There is nothing you need to do here\./)).toBeInTheDocument()
  })
})
