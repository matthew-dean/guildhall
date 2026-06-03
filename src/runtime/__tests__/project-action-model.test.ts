import { describe, expect, it } from 'vitest'
import { buildProjectActionModel } from '../project-action-model.js'

describe('buildProjectActionModel', () => {
  it('keeps active brief cleanup ahead of project discovery reconciliation', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: {
        items: [{
          kind: 'project_understanding',
          severity: 'high',
          title: 'Review project discovery update',
          detail: 'Review the new discovery reconciliation.',
          actionHref: '/workspace-import?mode=reconcile',
        }],
      },
      tasks: [{
        id: 'task-stripe-brief',
        title: 'Clean up the Stripe checkout brief',
        status: 'ready',
        needsBriefCleanup: true,
        updatedAt: '2026-06-03T10:00:00.000Z',
      }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Clean up the Stripe checkout brief',
      buttonLabel: 'Open Work',
      href: '/work',
    })
    expect(model.secondaryActions.map(action => action.source)).toContain('inbox')
  })

  it('uses owner-input start readiness as the single primary action over competing queues', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Font Something needs your answer before Guildhall can continue',
        actionHref: '/thread?thread=bc-font-decision',
      },
      inbox: {
        items: [{
          kind: 'project_understanding',
          severity: 'high',
          title: 'Review project discovery update',
          actionHref: '/workspace-import?mode=reconcile',
        }],
      },
      tasks: [{
        id: 'task-font-worker',
        title: 'Wire Font Something runtime',
        status: 'in_progress',
        updatedAt: '2026-06-03T09:00:00.000Z',
      }],
      thread: {
        activeTurnId: 'bounded-chat:bc-font-decision',
        turns: [{
          id: 'bounded-chat:bc-font-decision',
          kind: 'bounded_chat',
          status: 'active',
          actionHref: '/thread?thread=bc-font-decision',
          question: { prompt: 'Which font source should Guildhall use?' },
        }],
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'owner_input',
      label: 'Answer in Thread',
      detail: 'Which font source should Guildhall use?',
      href: '/thread?thread=bc-font-decision',
      buttonLabel: 'Open Thread',
    })
    expect(model.ownerInput).toMatchObject({
      active: true,
      href: '/thread?thread=bc-font-decision',
    })
    expect(model.runControl).toMatchObject({
      startEnabled: false,
      disabledReason: 'Font Something needs your answer before Guildhall can continue',
      label: 'Waiting on answer',
    })
  })

  it('does not show stale Answer in Thread when no live owner-input turn exists', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [{
        id: 'task-narrative-review',
        title: 'Review Narrative Harness story intelligence',
        status: 'ready',
        updatedAt: '2026-06-03T08:00:00.000Z',
      }],
      thread: {
        activeTurnId: null,
        turns: [{
          id: 'bounded-chat:old-narrative-question',
          kind: 'bounded_chat',
          status: 'done',
          actionHref: '/thread?thread=old-narrative-question',
          question: { prompt: 'Answered already?' },
        }],
      },
      runStatus: 'stopped',
    })

    expect(model.ownerInput.active).toBe(false)
    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Review Narrative Harness story intelligence',
      buttonLabel: 'Open Work',
    })
    expect(model.primaryAction?.label).not.toMatch(/answer/i)
  })

  it('blocks Start work for active setup questions even when raw readiness is permissive and the project has zero tasks', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [],
      thread: {
        activeTurnId: 'setup:commerce-question',
        turns: [{
          id: 'setup:commerce-question',
          kind: 'setup_step',
          status: 'active',
          title: 'Shape the first spec',
          why: 'Guildhall needs setup direction before it creates work.',
          actionHref: '/thread?thread=bc-commerce-setup',
        }],
      },
      runStatus: 'stopped',
    })

    expect(model.setup).toMatchObject({
      state: 'blocked',
      freshIntakeNeeded: false,
    })
    expect(model.runControl).toMatchObject({
      startEnabled: false,
      disabledReason: 'Guildhall needs setup direction before it creates work.',
      label: 'Waiting on setup',
    })
    expect(model.primaryAction).toMatchObject({
      source: 'owner_input',
      href: '/thread?thread=bc-commerce-setup',
    })
  })
})
