// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TaskCard from '../TaskCard.svelte'
import { path } from '../nav.svelte.js'
import type { TaskLite } from '../types.js'

function task(overrides: Partial<TaskLite> = {}): TaskLite {
  return {
    id: 'task-link-editor',
    title: 'Knit: add link editor controls',
    status: 'ready',
    domain: 'frontend',
    priority: 'high',
    ...overrides,
  }
}

describe('TaskCard', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    path.value = '/projects/looma-knit/work'
  })

  afterEach(() => cleanup())

  it('opens the task drawer route while preserving the background path', async () => {
    render(TaskCard, { task: task() })

    await userEvent.click(screen.getByRole('button', { name: /knit: add link editor controls/i }))

    expect(path.value).toBe('/projects/looma-knit/task/task-link-editor')
    expect(window.history.state).toMatchObject({ backgroundPath: '/projects/looma-knit/work' })
  })

  it('surfaces paused queue, active work, escalations, and reviewer summaries', () => {
    const latestReviewerSummary = [
      '## Review',
      '- **Revise** the import path and run the focused component test before handoff.',
    ].join('\n')

    render(TaskCard, {
      task: task({
        status: 'review',
        revisionCount: 2,
        latestReviewerSummary,
        escalations: [{ id: 'esc-1', summary: 'Worker is stuck.' }],
      }),
      coordinatorRunning: false,
    })

    expect(screen.getByText('In review')).toBeInTheDocument()
    expect(screen.getByText('paused')).toBeInTheDocument()
    expect(screen.getByTitle('Open escalation')).toBeInTheDocument()
    expect(screen.getByText('Latest review:')).toBeInTheDocument()
    expect(screen.getByText(/Revise the import path/)).toBeInTheDocument()
    expect(screen.getByText('r2')).toBeInTheDocument()

    cleanup()
    render(TaskCard, {
      task: task({
        status: 'in_progress',
        latestCheckpoint: {
          nextPlannedAction: 'Replace the missing component import with the existing shared button and rerun the component test.',
        },
      }),
      coordinatorRunning: true,
    })

    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Next:')).toBeInTheDocument()
    expect(screen.getByText(/Replace the missing component import/)).toBeInTheDocument()
  })

  it('shows terminal outcomes and honors display overrides', async () => {
    render(TaskCard, {
      task: task({
        status: 'pending_pr',
        terminalSummary: {
          headline: 'Pull request opened.',
          detail: 'Reviewer should inspect the editor toolbar path.',
        },
      }),
      displayStatusLabel: 'Waiting for PR',
      displayStatusTone: 'warn',
      displayStatusIcon: 'git-pull-request',
    })

    expect(screen.getByText('Waiting for PR')).toBeInTheDocument()
    expect(screen.getByText('Outcome:')).toBeInTheDocument()
    expect(screen.getByText(/Pull request opened/)).toBeInTheDocument()

    await userEvent.keyboard('{Tab}{Enter}')
    expect(path.value).toBe('/projects/looma-knit/task/task-link-editor')
  })
})
