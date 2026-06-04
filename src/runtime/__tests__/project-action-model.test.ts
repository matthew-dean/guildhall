import { describe, expect, it } from 'vitest'
import { buildProjectActionModel } from '../project-action-model.js'

describe('buildProjectActionModel', () => {
  it('normalizes risky start blockers into terse shared actions', () => {
    const importDrafts = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'import_drafts_waiting',
        message: 'Review 2 imported drafts before starting Guildhall. Start with "API cleanup".',
        actionHref: '/task/task-api-cleanup',
      },
      tasks: [{ id: 'task-api-cleanup', title: 'API cleanup', status: 'import_draft' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(importDrafts.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Review imported drafts',
      detail: 'Review 2 imported drafts before starting Guildhall. Start with "API cleanup".',
      buttonLabel: 'Review drafts',
      href: '/task/task-api-cleanup',
      tone: 'warn',
    })
    expect(importDrafts.runControl).toMatchObject({
      label: 'Review drafts',
      startEnabled: false,
    })

    const briefCleanup = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: 'One task needs a clearer brief and acceptance criteria before Guildhall can build unattended.',
        actionHref: '/work',
      },
      tasks: [{
        id: 'task-brief',
        title: 'Clean up the brief',
        status: 'ready',
        productBrief: { approvedAt: '2026-06-04T10:00:00.000Z', userJob: '' },
        spec: '',
        acceptanceCriteria: [],
      }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(briefCleanup.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Needs brief cleanup',
      detail: 'One task needs a clearer brief and acceptance criteria before Guildhall can build unattended.',
      buttonLabel: 'Review brief',
      href: '/work',
      tone: 'warn',
    })
    expect(briefCleanup.secondaryActions[0]).toMatchObject({
      source: 'task',
      label: 'Clean up the brief',
      buttonLabel: 'Open Work',
    })

    const provider = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'no_provider',
        message: 'No provider configured. Open Providers to choose one before starting Guildhall.',
        actionHref: '/providers',
      },
      tasks: [{ id: 'task-ready', title: 'Ready work', status: 'ready' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(provider.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Provider unavailable',
      detail: 'No provider configured. Open Providers to choose one before starting Guildhall.',
      buttonLabel: 'Choose provider',
      href: '/providers',
      tone: 'warn',
    })
    expect(provider.runControl).toMatchObject({
      label: 'Needs provider',
      startEnabled: false,
    })

    const migration = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'Run the required Guildhall migration before starting this project.',
        actionHref: '/migrations',
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(migration.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Required migration',
      detail: 'Run the required Guildhall migration before starting this project.',
      buttonLabel: 'Migrate project',
      href: '/migrations',
      tone: 'danger',
    })

    const terminal = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'All tasks are already finished.',
      },
      tasks: [{ id: 'task-done', title: 'Done task', status: 'done' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(terminal.primaryAction).toBeNull()
    expect(terminal.runControl).toMatchObject({
      label: 'No runnable tasks',
      startEnabled: false,
      disabledReason: 'All tasks are already finished.',
    })
  })

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

  it('labels stopped project work as resumable and only active runs as pausable', () => {
    const active = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [{ id: 'task-ready', title: 'Ready task', status: 'ready' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(active.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
    })

    const paused = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [{ id: 'task-ready', title: 'Ready task', status: 'ready' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
      availability: { status: 'paused' },
    })
    expect(paused.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
    })

    const running = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [{ id: 'task-ready', title: 'Ready task', status: 'ready' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'running',
    })
    expect(running.runControl).toMatchObject({
      label: 'Pause',
      startEnabled: true,
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

  it('blocks Resume for active setup questions even when raw readiness is permissive and the project has zero tasks', () => {
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
      source: 'thread',
      href: '/thread?thread=bc-commerce-setup',
    })
  })

  it('ignores stale setup-step thread actions once the project already has tasks and can start', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [{
        id: 'task-planning-note',
        title: 'Add planning note',
        status: 'exploring',
        description: 'Add a harmless note to the planning backlog.',
        updatedAt: '2026-06-03T18:00:00.000Z',
      }],
      thread: {
        activeTurnId: 'setup:firstTask',
        turns: [{
          id: 'setup:firstTask',
          kind: 'setup_step',
          status: 'active',
          title: 'Shape the first spec',
          why: 'Turn a rough idea into a product brief, focused questions, and the first buildable spec before implementation work starts.',
          actionHref: '/thread',
        }],
      },
      runStatus: 'stopped',
    })

    expect(model.ownerInput.active).toBe(false)
    expect(model.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
    })
    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Add planning note',
      buttonLabel: 'Open Work',
    })
    expect(model.primaryAction?.label).not.toMatch(/answer/i)
  })
})
