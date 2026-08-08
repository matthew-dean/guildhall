import { describe, expect, it } from 'vitest'

import { buildProjectCardTicker, buildProjectTicker } from '../project-activity.js'
import type { EventEnvelope, ProjectDetail, ServiceProjectSummary } from '../types.js'

describe('buildProjectTicker', () => {
  const now = new Date('2026-05-12T13:00:20.000Z')

  it('lets required migration readiness override stale run summaries', () => {
    expect(
      buildProjectTicker(
        {
          startReadiness: {
            canStart: false,
            code: 'required_migration_pending',
            message: 'Run required Guildhall migration before starting this project.',
            actionHref: '/migrations',
          },
          run: {
            status: 'stopped',
            stopSummary: {
              stopReason: 'all_terminal',
              stopMessage: 'No actionable tasks remain.',
            },
          },
          tasks: [],
        },
        null,
        now,
      ),
    ).toMatchObject({
      label: 'Needs migration',
      actorLabel: 'Needs migration',
      message: 'Run required Guildhall migration before starting this project.',
      tone: 'warn',
    })
  })

  it('lets proof readiness override stale all-terminal run events', () => {
    expect(
      buildProjectTicker(
        {
          startReadiness: {
            canStart: false,
            code: 'proof_evidence_missing',
            message: 'Stage 1 is waiting on proof evidence for 7 completed tasks.',
            actionHref: '/work?task=task-1',
            focusTaskTitle: 'Run fixture evaluator proof',
            focusKind: 'proof',
            count: 7,
          },
          run: {
            status: 'stopped',
            stopSummary: {
              stopReason: 'all_terminal',
              stopMessage: 'No actionable tasks remain.',
            },
          },
          recentEvents: [
            {
              at: now.toISOString(),
              event: {
                type: 'supervisor_stopped',
                reason: 'all_terminal',
                message: 'No actionable tasks remain: 8 done, 0 blocked, 20 shelved.',
              },
            },
          ],
          tasks: [{ id: 'task-1', title: 'Run fixture evaluator proof', status: 'done' }],
        },
        {
          at: now.toISOString(),
          event: {
            type: 'supervisor_stopped',
            reason: 'all_terminal',
            message: 'No actionable tasks remain: 8 done, 0 blocked, 20 shelved.',
          },
        },
        now,
      ),
    ).toMatchObject({
      label: 'Needs proof',
      actorLabel: 'Needs proof',
      message: 'Run fixture evaluator proof',
      detail: '7 completed tasks missing proof',
      tone: 'warn',
    })
  })

  it('lets selected-scope completion override stale stopped run events', () => {
    expect(
      buildProjectTicker(
        {
          startReadiness: {
            canStart: false,
            code: 'all_terminal',
            message: 'Stage 1: Fixture And Evaluation Harness is complete.',
          },
          run: {
            status: 'stopped',
            stopSummary: {
              stopReason: 'stop_requested',
              stopMessage: 'Stop requested after tick 4.',
            },
          },
          recentEvents: [
            {
              at: now.toISOString(),
              event: {
                type: 'supervisor_stopped',
                reason: 'stop_requested',
                message: 'Stop requested after tick 4.',
              },
            },
          ],
          tasks: [
            { id: 'task-stage-1', title: 'Stage 1 proof', status: 'done' },
            { id: 'task-later', title: 'Later release feature', status: 'ready' },
          ],
        },
        {
          at: now.toISOString(),
          event: {
            type: 'supervisor_stopped',
            reason: 'stop_requested',
            message: 'Stop requested after tick 4.',
          },
        },
        now,
      ),
    ).toMatchObject({
      label: 'Complete',
      actorLabel: 'Complete',
      message: 'Stage 1: Fixture And Evaluation Harness is complete.',
      tone: 'ok',
    })
  })

  it('presents a shipped release as a terminal receipt instead of runnable-work status', () => {
    expect(buildProjectTicker({
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'A stale migration check says this project needs attention.',
      },
      releaseReadiness: {
        release: { id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'shipped', source: 'release_plan' },
        scope: { id: 'stage-1', label: 'Stage 1', kind: 'release', state: 'shipped', source: 'release_plan' },
        ready: true,
        totals: { tasks: 15, done: 15 },
      },
    }, null, now)).toMatchObject({
      label: 'Complete',
      actorLabel: 'Complete',
      message: 'Stage 1 shipped',
      detail: '15/15 complete',
      tone: 'ok',
    })
  })

  it('does not call all-terminal scope complete when the orientation spine has gaps', () => {
    const detail: ProjectDetail = {
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1 is complete.',
      },
      orientationSpine: {
        summary: {
          headline: 'Stage 1 has source conflicts to review.',
          selectedScopeLabel: 'Stage 1',
          topBlocker: 'Possible duplicate work is split across scopes.',
          nextAction: 'Review source conflicts before treating the scope as settled.',
        },
        sourceHealth: {
          gaps: 1,
          conflicts: 1,
          inferred: 0,
        },
      } as any,
      tasks: [{ id: 'task-1', status: 'done', title: 'Done task' }],
    }

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
      tone: 'warn',
      actorLabel: 'Review',
      label: 'Review',
      message: 'Stage 1 has source conflicts to review.',
      detail: 'Possible duplicate work is split across scopes.',
    })
  })

  it('surfaces source-conflict readiness before stale run events', () => {
    const detail: ProjectDetail = {
      startReadiness: {
        canStart: false,
        code: 'scope_source_conflict',
        message: 'Stage 1 has source conflicts to review before it can be treated as complete.',
        actionHref: '/map',
        focusKind: 'source_conflict',
      },
      run: {
        status: 'stopped',
        stopSummary: {
          stopReason: 'all_terminal',
          stopMessage: 'No actionable tasks remain.',
        },
      },
      tasks: [{ id: 'task-1', status: 'done', title: 'Done task' }],
    }

    expect(buildProjectTicker(detail, {
      at: now.toISOString(),
      event: {
        type: 'supervisor_stopped',
        reason: 'all_terminal',
        message: 'No actionable tasks remain: 1 done.',
      },
    }, now)).toMatchObject({
      tone: 'warn',
      actorLabel: 'Review',
      label: 'Review',
      message: 'Stage 1 has source conflicts to review before it can be treated as complete.',
      detail: 'Open the Project Map to resolve the conflicting source trail.',
    })
  })

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
      actorLabel: 'Builder',
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
      actorLabel: 'Review team',
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
        {
          ...detail,
          gitStory: {
            ready: false,
            state: 'unknown',
            blockers: [{ state: 'unknown', reason: 'spawn git ENOENT' }],
            snapshots: [{ state: 'unknown', reason: 'spawn git ENOENT' }],
          },
        },
        { event: { type: 'supervisor_error', message: 'spawn git ENOENT' } },
        now,
      ),
    ).toMatchObject({
      tone: 'danger',
      actorLabel: 'Git',
      label: 'Error',
      message: 'Guildhall could not find git while inspecting this project.',
    })

    expect(
      buildProjectTicker(
        {
          ...detail,
          tasks: [{ id: 'task-1', status: 'ready', title: 'Polish task cards' }],
          gitStory: {
            ready: true,
            state: 'clean',
            blockers: [],
            snapshots: [{ state: 'clean', reason: 'No local changes or unpublished branch work detected.' }],
          },
        },
        { event: { type: 'supervisor_error', message: 'spawn git ENOENT' } },
        now,
      ),
    ).toMatchObject({
      tone: 'idle',
      actorLabel: 'Ready',
      message: '1 task ready when you resume',
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
      message: 'Finish first-time setup',
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
        {
          run: { status: 'running', mode: 'one_task' },
          tasks: [
            { id: 'task-1', status: 'ready', title: 'Ready task' },
            { id: 'task-2', status: 'ready', title: 'Another ready task' },
          ],
        },
        { event: { type: 'unknown_event' } },
        now,
      ),
    ).toMatchObject({
      tone: 'active',
      pulse: true,
      actorLabel: 'Coordinator',
      message: 'Advancing one task',
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
      actorLabel: 'Ready',
      message: '2 tasks ready when you resume',
    })

    expect(
      buildProjectTicker(
        {
          tasks: [
            { id: 'parent-1', status: 'spec_review', title: 'Define schema contracts' },
            { id: 'parent-2', status: 'ready', title: 'Implement runner' },
            { id: 'child-1', status: 'exploring', title: 'Split child one' },
            { id: 'child-2', status: 'exploring', title: 'Split child two' },
          ],
          orientationSpine: {
            summary: {
              selectedScopeLabel: 'Current task scope',
              includedWorkCount: 2,
              deferredWorkCount: 12,
              topBlocker: 'Define schema contracts is waiting for spec review.',
            },
          },
        },
        null,
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Current task scope',
      label: 'Current task scope',
      message: '2 current tasks; 12 later',
      detail: 'Define schema contracts is waiting for spec review.',
    })

    expect(
      buildProjectTicker(
        {
          tasks: [
            { id: 'task-import-1', status: 'import_draft', title: 'Review existing work' },
            { id: 'task-import-2', status: 'import_draft', title: 'Review more work' },
            { id: 'done-1', status: 'done', title: 'Finished' },
          ],
        },
        null,
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Needs brief',
      label: 'Needs brief',
      message: '2 imported drafts need task briefs',
    })

    expect(buildProjectTicker({ tasks: [] }, null, now)).toMatchObject({
      tone: 'idle',
      actorLabel: 'Idle',
      message: 'No recent activity',
    })
  })

  it('shows the run error instead of calling queued work paused', () => {
    expect(
      buildProjectTicker(
        {
          run: {
            status: 'error',
            error: 'spawn git ENOENT',
          },
          tasks: [
            { id: 'task-1', status: 'in_progress', title: 'Basic project listing' },
            { id: 'task-2', status: 'ready', title: 'Stripe Connect' },
          ],
        },
        null,
        now,
      ),
    ).toMatchObject({
      tone: 'danger',
      pulse: false,
      actorLabel: 'Run error',
      label: 'Error',
      message: 'Guildhall could not find git while inspecting this project.',
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

  it('does not reduce stopped projects with resumable work to only blocked status', () => {
    const detail: ProjectDetail = {
      run: { status: 'stopped' },
      tasks: [
        { id: 'task-1', status: 'in_progress', title: 'Build first reviewer' },
        { id: 'task-2', status: 'ready', title: 'Write trace pipeline' },
        { id: 'task-3', status: 'blocked', title: 'Resolve imported backlog' },
      ],
    }

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
      tone: 'idle',
      actorLabel: 'Ready',
      label: 'Ready',
      message: '2 tasks ready when you resume',
      detail: '1 blocked task',
    })
  })

  it('uses visible detail progress instead of raw task statuses for paused work', () => {
    const detail: ProjectDetail = {
      run: { status: 'stopped' },
      tasks: [
        { id: 'task-1', status: 'ready', title: 'Old ready task' },
        { id: 'task-2', status: 'in_progress', title: 'Old active task' },
      ],
      workProgress: {
        counts: {
          visibleTotal: 2,
          visibleActive: 0,
          visibleBlocked: 0,
          visibleDone: 2,
          visibleShelved: 0,
          deliveryTotal: 2,
          deliveryRequired: 2,
          deliveryDone: 2,
          deliveryBlocked: 0,
        },
        byTaskId: {},
      },
    }

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
      tone: 'idle',
      actorLabel: 'Idle',
      message: 'No recent activity',
    })
  })

  it('surfaces immediate all-terminal supervisor stop details', () => {
    const detail: ProjectDetail = {
      run: { status: 'stopped' },
      tasks: [{ id: 'done-1', status: 'done', title: 'Done one' }],
    }

    const result = buildProjectTicker(
      detail,
      {
        at: '2026-05-12T13:00:15.000Z',
        event: {
          type: 'supervisor_stopped',
          reason: 'all_terminal',
          message: 'No actionable tasks remain: 1 done, 0 blocked, 0 shelved.',
        },
      },
      now,
    )

    expect(result.message).toContain('Run finished')
    expect(result.detail).toContain('No actionable tasks remain')
  })

  it('keeps all-terminal supervisor stop details when terminal blocked tasks exist', () => {
    const detail: ProjectDetail = {
      run: { status: 'stopped' },
      tasks: [
        { id: 'done-1', status: 'done', title: 'Done one' },
        { id: 'blocked-1', status: 'blocked', title: 'Blocked one' },
      ],
    }

    const result = buildProjectTicker(
      detail,
      {
        at: '2026-05-12T13:00:15.000Z',
        event: {
          type: 'supervisor_stopped',
          reason: 'all_terminal',
          message: 'No actionable tasks remain: 1 done, 1 blocked, 0 shelved.',
        },
      },
      now,
    )

    expect(result.message).toContain('Run finished')
    expect(result.detail).toContain('No actionable tasks remain')
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

  it('summarizes owner-input readiness without repeating the full blocker sentence', () => {
    const detail: ProjectDetail = {
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        focusKind: 'spec_review',
        message: 'Review the waiting spec before Guildhall can continue',
      },
    }

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
      tone: 'warn',
      actorLabel: 'Needs you',
      message: 'Spec review pending',
    })
  })

  it('names the concrete readiness blocker when spec review is the stop reason', () => {
    const detail: ProjectDetail = {
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '2 specs are waiting for review before work can start. Start with "Continue drafted spec work".',
        focusTaskId: 'task-spec-a',
        focusTaskTitle: 'Continue drafted spec work',
        focusKind: 'spec_review',
        count: 2,
      },
    }

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
      tone: 'warn',
      actorLabel: 'Review',
      label: 'Review',
      message: 'Continue drafted spec work',
      detail: '1 more waiting behind it',
    })
  })

  it('names the concrete readiness blocker when a brief still needs shaping', () => {
    const detail: ProjectDetail = {
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '"Thin ready task" needs a clearer brief before unattended work can run.',
        focusTaskId: 'task-thin-ready',
        focusTaskTitle: 'Thin ready task',
        focusKind: 'brief_cleanup',
        count: 1,
      },
      tasks: [{ id: 'task-thin-ready', status: 'ready', title: 'Thin ready task' }],
    }

    expect(buildProjectTicker(detail, null, now)).toMatchObject({
      tone: 'warn',
      actorLabel: 'Needs brief',
      label: 'Needs brief',
      message: 'Thin ready task',
      detail: 'Needs a fuller brief before it can run',
    })
  })

  it('lets current actionable draft state beat stale stopped-event copy', () => {
    const detail: ProjectDetail = {
      run: { status: 'stopped' },
      tasks: [
        { id: 'task-import-1', status: 'import_draft', title: 'Bootstrap database' },
      ],
    }

    expect(
      buildProjectTicker(
        detail,
        {
          at: '2026-05-12T08:00:00.000Z',
          event: {
            type: 'supervisor_stopped',
            message: 'No actionable tasks remain: 3 done, 0 blocked, 1 shelved.',
          },
        },
        now,
      ),
    ).toMatchObject({
      tone: 'warn',
      actorLabel: 'Needs brief',
      label: 'Needs brief',
      message: '1 imported draft needs task briefs',
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

  it('uses visible work progress instead of raw historical task counts', () => {
    const project: ServiceProjectSummary = {
      id: 'narrative-harness',
      name: 'Narrative Harness',
      path: '/work/narrative-harness',
      taskCounts: { total: 168, active: 121, draftReview: 0, blocked: 0, done: 35, shelved: 12 },
      workProgress: {
        counts: {
          visibleTotal: 38,
          visibleActive: 0,
          visibleBlocked: 0,
          visibleDone: 26,
          visibleShelved: 12,
          deliveryTotal: 28,
          deliveryRequired: 28,
          deliveryDone: 24,
          deliveryBlocked: 2,
        },
        selectedCounts: {
          visibleTotal: 11,
          visibleActive: 0,
          visibleBlocked: 0,
          visibleDone: 11,
          visibleShelved: 0,
          deliveryTotal: 17,
          deliveryRequired: 17,
          deliveryDone: 17,
          deliveryBlocked: 0,
        },
        byTaskId: {},
      },
      highlights: { recentCompletedTaskTitle: 'Headless MVP scope completed' },
      run: { status: 'stopped' },
    }

    expect(buildProjectCardTicker(project)).toEqual({
      tone: 'ok',
      pulse: false,
      label: 'Recent',
      message: 'Headless MVP scope completed',
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
      message: 'First-time setup',
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
      label: 'Needs brief',
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
