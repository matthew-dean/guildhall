// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import CoordinatorsTab from '../CoordinatorsTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import type { ProjectDetail } from '../../../lib/types.js'

function detail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    run: { status: 'running', mode: 'continuous' },
    config: {
      coordinators: [
        {
          id: 'frontend',
          domain: 'frontend',
          path: 'web/app',
          mandate: 'Protect editor UI behavior, component contracts, and browser-facing regressions.',
          concerns: [
            {
              id: 'rendered-ui',
              description: 'Rendered surfaces must remain clear and usable.',
              reviewQuestions: ['Does the main workflow stay visible?'],
            },
          ],
          autonomousDecisions: ['Choose local component names that match the codebase.'],
          escalationTriggers: ['Ask before removing existing editor affordances.'],
        },
        {
          id: 'backend',
          domain: 'backend',
          path: 'api',
          mandate: 'Protect persistence and endpoint behavior.',
        },
      ],
    },
    tasks: [
      {
        id: 'task-active',
        title: 'Wire link toolbar',
        status: 'in_progress',
        domain: 'frontend',
        priority: 'high',
        updatedAt: '2026-05-19T15:00:00.000Z',
      },
      {
        id: 'task-blocked',
        title: 'Fix drawer sizing',
        status: 'blocked',
        domain: 'frontend',
        priority: 'normal',
        updatedAt: '2026-05-19T14:00:00.000Z',
      },
      {
        id: 'task-done',
        title: 'Persist route slugs',
        status: 'done',
        domain: 'backend',
        priority: 'normal',
        updatedAt: '2026-05-19T13:00:00.000Z',
      },
      {
        id: 'task-draft',
        title: 'Imported draft should not count',
        status: 'import_draft',
        domain: 'frontend',
        priority: 'normal',
        updatedAt: '2026-05-19T12:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

describe('CoordinatorsTab', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/looma-knit/routing')
    path.value = '/projects/looma-knit/routing'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the routing board with task counts and coordinator mandates', async () => {
    render(CoordinatorsTab, { detail: detail() })

    expect(screen.getByText('Internal routing')).toBeTruthy()
    expect(screen.getByText('Part: Frontend')).toBeTruthy()
    expect(screen.getByText('Scope: web/app')).toBeTruthy()
    expect(screen.getByText(/1 active/)).toBeTruthy()
    expect(screen.getByText(/1 blocked/)).toBeTruthy()
    expect(screen.getByText(/2 total/)).toBeTruthy()
    expect(screen.getByText('Protect editor UI behavior, component contracts, and browser-facing regressions.')).toBeTruthy()
    expect(screen.getByText('Wire link toolbar')).toBeTruthy()
    expect(screen.queryByText('Imported draft should not count')).toBeNull()

    await userEvent.click(screen.getAllByRole('button', { name: /view routing/i })[0]!)
    expect(path.value).toBe('/routing/frontend')
  })

  it('renders one selected routing slice with policy detail and visible tasks', async () => {
    render(CoordinatorsTab, { detail: detail(), subView: 'frontend' })

    expect(screen.getByRole('heading', { name: 'Frontend' })).toBeTruthy()
    expect(screen.getByText(/This routing slice covers/)).toBeTruthy()
    expect(screen.getByText('Rendered surfaces must remain clear and usable.')).toBeTruthy()
    expect(screen.getByText('Does the main workflow stay visible?')).toBeTruthy()
    expect(screen.getByText('Choose local component names that match the codebase.')).toBeTruthy()
    expect(screen.getByText('Ask before removing existing editor affordances.')).toBeTruthy()
    expect(screen.getByText('Wire link toolbar')).toBeTruthy()
    expect(screen.getByText('Fix drawer sizing')).toBeTruthy()
  })

  it('shows the setup empty state when no routing slices exist', () => {
    render(CoordinatorsTab, { detail: detail({ config: { coordinators: [] }, tasks: [] }) })

    expect(screen.getByText('No internal routing slices yet. Finish setup first.')).toBeTruthy()
  })
})
