// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import ProjectOverviewTab from '../ProjectOverviewTab.svelte'

describe('ProjectOverviewTab', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders same-task escalation inbox items with distinct escalation ids', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [],
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'open_escalation',
          severity: 'high',
          taskId: 'task-006',
          escalationId: 'esc-task-006-23',
          title: 'Set the platform fee policy',
          detail: 'Card component exists but template syntax mismatch prevents edit',
          actionHref: '/task/task-006',
        },
        {
          kind: 'open_escalation',
          severity: 'high',
          taskId: 'task-006',
          escalationId: 'esc-task-006-24',
          title: 'Set the platform fee policy',
          detail: 'Card component exists but template syntax mismatch prevents edit',
          actionHref: '/task/task-006',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByRole('heading', { name: 'Fair Labor License' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Set the platform fee policy/ })).toHaveLength(2)
  })

  it('shows full task content on the overview detail path even when the title is compact', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [],
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'open_escalation',
          severity: 'high',
          taskId: 'task-006',
          escalationId: 'esc-task-006-23',
          title: 'We should have a system-wide policy of how much FLL charges on overhe...',
          taskDescription: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
          detail: 'Card component exists but template syntax mismatch prevents edit',
          actionHref: '/task/task-006',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getAllByText('We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.').length).toBeGreaterThan(0)
  })
})
