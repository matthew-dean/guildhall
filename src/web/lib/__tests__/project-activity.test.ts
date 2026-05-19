import { describe, expect, it } from 'vitest'

import { buildProjectCardTicker, buildProjectTicker } from '../project-activity.js'
import type { EventEnvelope, ProjectDetail, ServiceProjectSummary } from '../types.js'

describe('buildProjectTicker', () => {
  const now = new Date('2026-05-12T13:00:20.000Z')

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

    expect(buildProjectTicker(detail, latestEvent, now)).toEqual({
      tone: 'active',
      pulse: true,
      actorLabel: 'Worker',
      label: 'Live',
      message: 'Started Wire up auth callback',
      timeLabel: '10s ago',
    })
  })

  it('names finished work, status transitions, errors, escalations, and provider changes from events', () => {
    const detail: ProjectDetail = {
      tasks: [{ id: 'task-1', status: 'review', title: 'Polish task cards' }],
    }

    expect(
      buildProjectTicker(
        detail,
        { at: '2026-05-12T12:59:20.000Z', event: { type: 'agent_finished', agent_name: 'reviewer-agent', taskId: 'task-1' } },
        now,
      ),
    ).toMatchObject({
      tone: 'ok',
      pulse: false,
      actorLabel: 'Reviewer',
      label: 'Updated',
      message: 'Finished Polish task cards',
      timeLabel: '1m ago',
    })

    expect(
      buildProjectTicker(
        detail,
        { at: '2026-05-12T11:00:00.000Z', event: { type: 'task_transition', task_id: 'task-1', to_status: 'done' } },
        now,
      ),
    ).toMatchObject({
      tone: 'ok',
      actorLabel: 'Done',
      label: 'Done',
      message: 'Polish task cards finished',
      timeLabel: '2h ago',
    })

    expect(
      buildProjectTicker(
        detail,
        { at: '2026-05-10T12:00:00.000Z', event: { type: 'task_transition', task_id: 'missing', to_status: 'blocked', reason: 'Bootstrap failed' } },
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Blocked',
      label: 'Blocked',
      message: 'Bootstrap failed',
      timeLabel: '2d ago',
    })

    expect(
      buildProjectTicker(
        detail,
        { at: 'not-a-date', event: { type: 'error', message: 'Run failed' } },
        now,
      ),
    ).toMatchObject({
      tone: 'danger',
      actorLabel: 'Error',
      label: 'Error',
      message: 'Run failed',
      timeLabel: null,
    })

    expect(
      buildProjectTicker(
        detail,
        { event: { type: 'agent_issue', task_id: 'task-1' } },
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Blocked',
      label: 'Blocked',
      message: 'Polish task cards needs attention',
    })

    expect(
      buildProjectTicker(
        detail,
        { event: { type: 'provider_health_changed' } },
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Providers',
      label: 'Provider',
      message: 'Provider health changed',
    })
  })

  it('falls back to project state when no recent event should be shown', () => {
    expect(buildProjectTicker({ initializationNeeded: true }, null, now)).toMatchObject({
      tone: 'warn',
      actorLabel: 'Setup',
      message: 'Finish first-time Guildhall setup',
    })

    expect(
      buildProjectTicker(
        { run: { status: 'running' }, tasks: [{ id: 'task-1', status: 'ready', title: 'Ready task' }] },
        { event: { type: 'unknown_event' } },
        now,
      ),
    ).toMatchObject({
      tone: 'active',
      pulse: true,
      actorLabel: 'Coordinator',
      message: 'Working on 1 task',
    })

    expect(
      buildProjectTicker(
        { run: { status: 'running' }, tasks: [] },
        null,
        now,
      ),
    ).toMatchObject({
      tone: 'active',
      message: 'Run is active on this project',
    })

    expect(
      buildProjectTicker(
        { tasks: [{ id: 'task-1', status: 'blocked', title: 'Blocked task' }, { id: 'task-2', status: 'blocked', title: 'Another' }] },
        null,
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Blocked',
      message: '2 blocked tasks',
    })

    expect(
      buildProjectTicker(
        { tasks: [{ id: 'task-1', status: 'ready', title: 'Ready task' }, { id: 'task-2', status: 'review', title: 'Review task' }] },
        null,
        now,
      ),
    ).toMatchObject({
      tone: 'idle',
      actorLabel: 'Queued',
      message: '2 tasks queued to resume',
    })

    expect(buildProjectTicker({ tasks: [] }, null, now)).toMatchObject({
      tone: 'idle',
      actorLabel: 'Idle',
      message: 'No recent activity',
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

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
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

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
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

  it('covers setup, draft, paused, recent, and idle project-card states', () => {
    expect(
      buildProjectCardTicker({
        id: 'new',
        name: 'New',
        path: '/work/new',
        initializationNeeded: true,
      }),
    ).toEqual({
      tone: 'warn',
      pulse: false,
      label: 'Setup',
      message: 'First-time Guildhall setup',
    })

    expect(
      buildProjectCardTicker({
        id: 'drafts',
        name: 'Drafts',
        path: '/work/drafts',
        taskCounts: { total: 3, active: 0, draftReview: 2, blocked: 0, done: 0, shelved: 0 },
      }),
    ).toEqual({
      tone: 'warn',
      pulse: false,
      label: 'Needs shaping',
      message: '2 imported drafts waiting',
    })

    expect(
      buildProjectCardTicker({
        id: 'paused',
        name: 'Paused',
        path: '/work/paused',
        taskCounts: { total: 2, active: 2, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
      }),
    ).toEqual({
      tone: 'idle',
      pulse: false,
      label: 'Paused',
      message: '2 tasks paused',
    })

    expect(
      buildProjectCardTicker({
        id: 'recent',
        name: 'Recent',
        path: '/work/recent',
        taskCounts: { total: 1, active: 0, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
        highlights: { recentCompletedTaskTitle: 'Finished setup' },
      }),
    ).toEqual({
      tone: 'ok',
      pulse: false,
      label: 'Recent',
      message: 'Finished setup',
    })

    expect(
      buildProjectCardTicker({
        id: 'idle',
        name: 'Idle',
        path: '/work/idle',
      }),
    ).toEqual({
      tone: 'idle',
      pulse: false,
      label: 'Idle',
      message: 'No recent activity',
    })
  })
})
