import { describe, expect, it } from 'vitest'

import { buildProjectCardTicker, buildProjectTicker } from '../project-activity.js'
import type { EventEnvelope, ProjectDetail, ServiceProjectSummary } from '../types.js'

describe('buildProjectTicker', () => {
  it('surfaces active worker progress from recent events', () => {
    const detail: ProjectDetail = {
      run: { status: 'running' },
      tasks: [
        { id: 'task-1', status: 'in_progress', title: 'Wire up auth callback' },
      ],
    }
    const latestEvent: EventEnvelope = {
      at: '2026-05-12T13:00:10.000Z',
      event: {
        type: 'agent_started',
        agent_name: 'worker-agent',
        task_id: 'task-1',
      },
    }

    expect(buildProjectTicker(detail, latestEvent, new Date('2026-05-12T13:00:20.000Z'))).toEqual({
      tone: 'active',
      pulse: true,
      actorLabel: 'Worker',
      label: 'Live',
      message: 'Started Wire up auth callback',
      timeLabel: '10s ago',
    })
  })

  it('turns blocked stop summaries into a visible warning state', () => {
    const detail: ProjectDetail = {
      run: {
        status: 'stopped',
        stopSummary: {
          stopReason: 'blocked_only',
          stopMessage: 'Blocked on bootstrap failure',
        },
      },
      tasks: [{ id: 'task-1', status: 'blocked', title: 'Bootstrap auth' }],
    }

    expect(buildProjectTicker(detail, null, new Date('2026-05-12T13:00:20.000Z'))).toMatchObject({
      tone: 'warn',
      pulse: false,
      actorLabel: 'Blocked',
      message: 'Blocked on bootstrap failure',
    })
  })

  it('shows a waiting-on-you state when the run stopped for human input', () => {
    const detail: ProjectDetail = {
      run: {
        status: 'stopped',
        stopSummary: {
          stopReason: 'awaiting_human',
          stopMessage: 'Waiting on your answer in Thread',
        },
      },
    }

    expect(buildProjectTicker(detail, null, new Date('2026-05-12T13:00:20.000Z'))).toMatchObject({
      tone: 'warn',
      actorLabel: 'Needs you',
      message: 'Waiting on your answer in Thread',
    })
  })
})

describe('buildProjectCardTicker', () => {
  it('summarizes running project work in one compact live line', () => {
    const project: ServiceProjectSummary = {
      id: 'fair-labor-license',
      name: 'Fair Labor License',
      path: '/work/fll',
      taskCounts: { total: 4, active: 1, blocked: 0, done: 2, shelved: 1 },
      highlights: { activeTaskTitle: 'Revise auth onboarding spec' },
      run: { status: 'running' },
    }

    expect(buildProjectCardTicker(project)).toEqual({
      tone: 'active',
      pulse: true,
      label: 'Live',
      message: 'Revise auth onboarding spec',
    })
  })

  it('turns blocked highlights into a blocked strip', () => {
    const project: ServiceProjectSummary = {
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/work/looma-knit',
      taskCounts: { total: 8, active: 0, blocked: 1, done: 4, shelved: 3 },
      highlights: { blockedTaskTitle: 'Bootstrap knit worktree' },
      run: { status: 'stopped' },
    }

    expect(buildProjectCardTicker(project)).toEqual({
      tone: 'warn',
      pulse: false,
      label: 'Blocked',
      message: 'Bootstrap knit worktree',
    })
  })
})
