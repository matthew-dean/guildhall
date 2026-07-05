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

    const importedScopeShaping = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'imported_scope_shaping',
        message: '12 imported current-scope tasks still need real briefs before Guildhall can build unattended. Start with "Define fixture schemas".',
        actionHref: '/task/task-import-1',
      },
      tasks: [{ id: 'task-import-1', title: 'Define fixture schemas', status: 'import_draft' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(importedScopeShaping.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Imported scope needs briefs',
      detail: '12 imported current-scope tasks still need real briefs before Guildhall can build unattended. Start with "Define fixture schemas".',
      buttonLabel: 'Draft first brief',
      href: '/task/task-import-1',
      tone: 'warn',
    })
    expect(importedScopeShaping.runControl).toMatchObject({
      label: 'Needs briefs',
      startEnabled: false,
    })

    const briefCleanup = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '"Clean up the brief" needs a clearer brief before unattended work can run.',
        actionHref: '/work?task=task-brief',
        focusTaskId: 'task-brief',
        focusTaskTitle: 'Clean up the brief',
        focusKind: 'brief_cleanup',
        count: 1,
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
      label: 'Clean up the brief',
      detail: '"Clean up the brief" needs a clearer brief before unattended work can run.',
      buttonLabel: 'Review brief',
      href: '/work?task=task-brief',
      tone: 'warn',
    })
    expect(briefCleanup.secondaryActions[0]).toMatchObject({
      source: 'task',
      label: 'Clean up the brief',
      buttonLabel: 'Open Work',
      href: '/work?task=task-brief',
    })

    const specReview = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '2 specs are waiting for review before work can start. Start with "Continue drafted spec work".',
        actionHref: '/thread?thread=task%3Atask-spec-a',
        focusTaskId: 'task-spec-a',
        focusTaskTitle: 'Continue drafted spec work',
        focusKind: 'spec_review',
        count: 2,
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(specReview.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Continue drafted spec work',
      detail: '2 specs are waiting for review before work can start. Start with "Continue drafted spec work".',
      buttonLabel: 'Review next spec',
      href: '/thread?thread=task%3Atask-spec-a',
      tone: 'warn',
    })
    expect(specReview.runControl).toMatchObject({
      label: 'Review needed',
      startEnabled: false,
    })

    const pausedSpecReview = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '"Continue drafted spec work" is waiting for review before work can start.',
        actionHref: '/thread?thread=task%3Atask-spec-a',
        focusTaskId: 'task-spec-a',
        focusTaskTitle: 'Continue drafted spec work',
        focusKind: 'spec_review',
        count: 1,
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
      availability: { status: 'paused' },
    })
    expect(pausedSpecReview.runControl).toMatchObject({
      label: 'Review needed',
      startEnabled: false,
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
      href: '/work?task=task-stripe-brief',
    })
    expect(model.secondaryActions.map(action => action.source)).toContain('inbox')
  })

  it('surfaces a blocked current-scope task before unrelated ready work', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [
        {
          id: 'runner-proof',
          title: 'Implement a no-UI runner that builds a packet from fixture records.',
          description: 'Build the script runner proof.',
          status: 'blocked',
          blockReason: "decision_required: Cannot transition task to 'review' -- guard keeps blocking despite self-critique note being persisted",
          updatedAt: '2026-07-04T10:00:00.000Z',
        },
        {
          id: 'schema-narrowing',
          title: 'Use the first run to narrow the MVP story-memory schema.',
          description: 'Follow-on ready task.',
          status: 'ready',
          updatedAt: '2026-07-04T10:05:00.000Z',
        },
      ],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Implement a no-UI runner that builds a packet from fixture records.',
      detail: "decision_required: Cannot transition task to 'review' -- guard keeps blocking despite self-critique note being persisted",
      buttonLabel: 'Open Work',
      href: '/work?task=runner-proof',
      tone: 'warn',
      taskId: 'runner-proof',
    })
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

  it('surfaces open scope-authority requests as owner input', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      scopeAuthorityRequests: [{
        id: 'scope-1',
        type: 'change_release_boundary',
        status: 'open',
        targetWorkId: 'release-mvp',
        question: 'Should UI editor work be part of Current MVP, or moved to Later?',
        whyItMatters: 'This changes what Guildhall is allowed to work on next.',
        createdAt: '2026-06-17T00:00:00.000Z',
        createdBy: 'coordinator',
      }],
      tasks: [{
        id: 'task-ready',
        title: 'Ready work',
        status: 'ready',
      }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'owner_input',
      label: 'Needs your decision',
      detail: 'Should UI editor work be part of Current MVP, or moved to Later?',
      buttonLabel: 'Open decision',
      href: '/overview/inbox?scopeAuthority=scope-1',
    })
    expect(model.ownerInput).toMatchObject({
      active: true,
      label: 'Needs your decision',
    })
  })

  it('does not promote low-signal thread lead-ins as owner action detail', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Clarify Templates needs your answer before work can continue',
        actionHref: '/thread?thread=bc-template-question',
      },
      tasks: [],
      thread: {
        activeTurnId: 'bounded-chat:bc-template-question',
        turns: [{
          id: 'bounded-chat:bc-template-question',
          kind: 'bounded_chat',
          status: 'active',
          actionHref: '/thread?thread=bc-template-question',
          question: { prompt: "From what I've seen:" },
        }],
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'owner_input',
      label: 'Answer in Thread',
      detail: 'Open the thread to answer the current question.',
      href: '/thread?thread=bc-template-question',
      buttonLabel: 'Open Thread',
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

  it('chooses the first dependency-unblocked ready task over newer blocked ready work', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [
        {
          id: 'task-define-schemas',
          title: 'Define fixture schemas',
          status: 'ready',
          updatedAt: '2026-07-04T07:58:36.633Z',
        },
        {
          id: 'task-build-fixture',
          title: 'Add the first tiny fiction fixture',
          status: 'ready',
          dependsOn: ['task-define-schemas'],
          updatedAt: '2026-07-04T07:58:36.937Z',
        },
      ],
      thread: { activeTurnId: null, turns: [] },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Define fixture schemas',
      href: '/work?task=task-define-schemas',
    })
  })

  it('keeps dependency-blocked shaping siblings behind their runnable prerequisite', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [
        {
          id: 'writer-packet',
          title: 'Build the bounded writer packet instead of rereading the manuscript',
          status: 'ready',
          updatedAt: '2026-07-05T02:37:52.658Z',
          spec: '## Spec\nBuild the writer packet.',
          acceptanceCriteria: [{ description: 'The packet is built.' }],
        },
        {
          id: 'reviewer-loop',
          title: 'Run the bounded reviewer and writer loop headlessly',
          status: 'exploring',
          dependsOn: ['writer-packet'],
          updatedAt: '2026-07-04T18:39:44.927Z',
        },
      ],
      thread: { activeTurnId: null, turns: [] },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Build the bounded writer packet instead of rereading the manuscript',
      href: '/work?task=writer-packet',
      tone: 'accent',
      taskId: 'writer-packet',
    })
    expect(model.primaryAction?.detail ?? '').not.toContain('Needs brief')
  })

  it('does not treat an inflight execution turn as an owner-answer action', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [{
        id: 'task-import-9s8tkc',
        title: 'Define fixture schemas',
        status: 'spec_review',
        description: 'Review the seeded implementation blueprint.',
        updatedAt: '2026-06-18T10:26:34.811Z',
      }],
      thread: {
        activeTurnId: 'inflight:task-import-9s8tkc',
        turns: [{
          id: 'inflight:task-import-9s8tkc',
          kind: 'inflight',
          status: 'active',
          actionHref: '/thread?thread=task%3Atask-import-9s8tkc',
          title: 'Define fixture schemas',
        }],
      },
      runStatus: 'running',
    })

    expect(model.ownerInput.active).toBe(false)
    expect(model.primaryAction).toMatchObject({
      source: 'task',
      buttonLabel: 'Review in Thread',
      href: '/thread?thread=task%3Atask-import-9s8tkc',
    })
    expect(model.secondaryActions.some(action => /answer in thread/i.test(action.label))).toBe(false)
  })

  it('pins child shaping work ahead of parent cleanup while the project is running', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [
        {
          id: 'task-import-9s8tkc',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          status: 'ready',
          updatedAt: '2026-07-04T10:00:00.000Z',
          productBrief: { approvedAt: '2026-07-04T09:00:00.000Z', userJob: '' },
          spec: '',
          acceptanceCriteria: [],
        },
        {
          id: 'task-import-9s8tkc-split-define-fixture-expected-record-prototype-run-and-evaluat',
          title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
          status: 'exploring',
          description: 'Spec agent is defining the fixture, expected-record, prototype-run, and evaluation contracts.',
          updatedAt: '2026-07-04T10:05:00.000Z',
        },
      ],
      thread: { activeTurnId: null, turns: [] },
      runStatus: 'running',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
      detail: 'Spec agent is defining the fixture, expected-record, prototype-run, and evaluation contracts.',
      buttonLabel: 'Open Work',
      href: '/work?task=task-import-9s8tkc-split-define-fixture-expected-record-prototype-run-and-evaluat',
      tone: 'running',
      taskId: 'task-import-9s8tkc-split-define-fixture-expected-record-prototype-run-and-evaluat',
    })
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

  it('links spec-review task actions to the specific Thread chain', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [{
        id: 'task-spec-a',
        title: 'Approve first spec',
        status: 'spec_review',
        description: 'Review the drafted spec.',
        updatedAt: '2026-06-03T18:00:00.000Z',
      }],
      thread: { turns: [] },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      buttonLabel: 'Review in Thread',
      href: '/thread?thread=task%3Atask-spec-a',
    })
  })

  it('links work task actions to the selected Work item and recovers clipped task labels from the full description', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [{
        id: 'task-smoke-test',
        title: 'What commands should I run to smoke test this project without changin...',
        status: 'ready',
        description: 'What commands should I run to smoke test this project without changing files?',
        updatedAt: '2026-06-15T18:48:51.097Z',
        productBrief: { approvedAt: '2026-06-15T18:48:51.097Z', userJob: '' },
        spec: '',
        acceptanceCriteria: [],
      }],
      thread: { turns: [] },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'What commands should I run to smoke test this project without changing files?',
      buttonLabel: 'Open Work',
      href: '/work?task=task-smoke-test',
      taskId: 'task-smoke-test',
    })
  })

  it('uses action-shaped labels for legacy question-shaped runnable work', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: { items: [] },
      tasks: [{
        id: 'task-smoke-test',
        title: 'What commands should I run to smoke test this project without changing files?',
        status: 'in_progress',
        description: 'What commands should I run to smoke test this project without changing files?',
        updatedAt: '2026-06-15T18:48:51.097Z',
      }],
      thread: { turns: [] },
      runStatus: 'running',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Define safe smoke-test commands',
      detail: 'What commands should I run to smoke test this project without changing files?',
      buttonLabel: 'Open Work',
      href: '/work?task=task-smoke-test',
      taskId: 'task-smoke-test',
    })
  })

  it('keeps paused live work resumable and pinned to the active task', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        message: '"Define fixture contracts" is paused in live work. Resume continues from that pinned task.',
        actionHref: '/work?task=contract-task',
        focusTaskId: 'contract-task',
        focusTaskTitle: 'Define fixture contracts',
        focusKind: 'paused_work',
        count: 1,
      },
      tasks: [
        {
          id: 'contract-task',
          title: 'Define fixture contracts',
          description: 'Imported contract work should materialize the named schema and record surfaces.',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          updatedAt: '2026-07-04T15:30:00.000Z',
        },
      ],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Define fixture contracts',
      buttonLabel: 'Open Work',
      href: '/work?task=contract-task',
      tone: 'accent',
      taskId: 'contract-task',
    })
    expect(model.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
      href: '/work?task=contract-task',
    })
  })
})
