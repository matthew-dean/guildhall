import { describe, expect, it } from 'vitest'
import { applyRunStatusToStartReadiness, buildFleetAttentionActionModel, buildProjectActionModel, isFocusedOwnerInputTaskReview, projectTaskActionHref, resolveProjectActionModel } from '../project-action-model.js'

describe('applyRunStatusToStartReadiness', () => {
  it('does not leave a saved paused action visible while a run is active', () => {
    const readiness = applyRunStatusToStartReadiness({
      canStart: true,
      code: 'paused_live_work',
      message: 'The task is paused.',
      focusTaskId: 'task-1',
      focusTaskTitle: 'Build Synopsis generation pipeline',
    }, 'running')

    expect(readiness).toMatchObject({
      canStart: true,
      code: 'running',
      message: 'Guildhall is running "Build Synopsis generation pipeline".',
    })
  })
})

describe('buildProjectActionModel', () => {
  it('promotes saved fleet attention only when no project action exists', () => {
    const attentionAction = buildFleetAttentionActionModel({
      items: [{
        kind: 'setup_pending',
        severity: 'medium',
        title: 'Give the project direction',
        detail: 'Start with a short brief you can edit.',
        actionHref: '/thread',
      }],
    })

    expect(attentionAction?.primaryAction).toMatchObject({
      source: 'inbox',
      label: 'Give the project direction',
      buttonLabel: 'Start setup',
      href: '/thread',
      tone: 'warn',
    })
    expect(attentionAction?.runControl).toMatchObject({
      label: 'Start setup',
      startEnabled: false,
      pauseEnabled: false,
      href: '/thread',
    })

    const stored = buildProjectActionModel({
      startReadiness: { canStart: true, code: 'ready_work', focusTaskId: 'task-1' },
      tasks: [{ id: 'task-1', title: 'Continue current work', status: 'ready' }],
    })
    expect(buildFleetAttentionActionModel({
      stored,
      items: [{ kind: 'setup_pending', severity: 'medium', title: 'Ignored', detail: 'Ignored', actionHref: '/thread' }],
    })).toBe(stored)
  })

  it('uses one owner-input review predicate across task routing and setup state', () => {
    expect(isFocusedOwnerInputTaskReview({
      code: 'owner_input_required',
      focusKind: 'brief_cleanup',
      focusTaskId: 'task-086',
    })).toBe(true)
    expect(isFocusedOwnerInputTaskReview({
      code: 'owner_input_required',
      focusKind: 'setup',
      focusTaskId: 'task-086',
    })).toBe(false)
  })

  it('uses the current brief instead of a superseded original description', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [{
        id: 'task-086',
        title: 'Prove packaged Tauri sidecar',
        status: 'exploring',
        description: 'Build this with Vue 3.',
        productBrief: {
          userJob: 'Prove the sidecar with a framework-neutral vanilla TypeScript view.',
          whyItMattersNow: 'Packaging must be proven before the desktop shell.',
          successMetric: 'The packaged app runs one offline fixture.',
          nonGoals: ['Do not choose the shell framework.'],
          antiPatterns: [],
        },
      }],
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      taskId: 'task-086',
      detail: 'Current brief: Prove the sidecar with a framework-neutral vanilla TypeScript view.',
    })
    expect(model.primaryAction?.detail).not.toContain('Vue')
  })

  it('uses shared ready-work state instead of inferring brief cleanup from a compact task point', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'ready_work',
        message: '"Build synopsis expansion" is ready to run.',
        focusTaskId: 'task-synopsis',
        focusTaskTitle: 'Build synopsis expansion',
        focusKind: 'ready_work',
      },
      // Saved summary projections intentionally omit rich brief/spec fields.
      tasks: [{ id: 'task-synopsis', title: 'Build synopsis expansion', status: 'ready' }],
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Work ready to start',
      taskLabel: 'Build synopsis expansion',
      buttonLabel: 'Start work',
      href: '/work?task=task-synopsis',
      tone: 'accent',
      operation: 'start_focused',
    })
    expect(model.primaryAction?.detail).toBeUndefined()
    expect(model.runControl).toMatchObject({ label: 'Start', startEnabled: true })
    expect(model.setup).toMatchObject({ state: 'ready', freshIntakeNeeded: false })
  })

  it('puts a recorded blocked task ahead of a stale resumable-work recommendation', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'ready_work',
        focusTaskId: 'task-ready',
        focusTaskTitle: 'Unrelated ready work',
      },
      tasks: [
        {
          id: 'task-ready',
          title: 'Unrelated ready work',
          status: 'ready',
        },
        {
          id: 'task-blocked',
          title: 'Component implementation',
          status: 'blocked',
          blockReason: 'human_judgment_required: Worker made no visible progress after 5 passes.',
        },
      ],
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      taskId: 'task-blocked',
      label: 'Component implementation',
      buttonLabel: 'Open task',
      href: '/task/task-blocked',
      code: 'blocked_work',
    })
    expect(model.runControl).toMatchObject({
      label: 'Needs recovery',
      startEnabled: false,
      disabledReason: 'Open the blocked task to choose its recovery action.',
      href: '/task/task-blocked',
    })
    expect(model.secondaryActions).toContainEqual(expect.objectContaining({ taskId: 'task-ready' }))
  })

  it('keeps a rebuilt blocked-work decision direct and readable', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'blocked_work',
        focusKind: 'blocked_work',
        focusTaskId: 'task-blocked',
        focusTaskTitle: 'Component implementation',
        message: 'human_judgment_required: Worker made no visible progress after 5 passes.',
      },
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Component implementation',
      detail: 'This task stopped and needs its recovery action before it can continue.',
      buttonLabel: 'Open task',
      href: '/task/task-blocked',
      code: 'blocked_work',
    })
    expect(model.runControl).toMatchObject({
      label: 'Needs recovery',
      disabledReason: 'Open the blocked task to choose its recovery action.',
      startEnabled: false,
    })
  })

  it('keeps a system-owned malformed spec as a typed focused repair operation', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'ready_work',
        message: 'Guildhall will repair the spec for "Component implementation" before asking for your review.',
        focusTaskId: 'task-component',
        focusTaskTitle: 'Component implementation',
        focusKind: 'spec_repair',
      },
      tasks: [{ id: 'task-component', title: 'Component implementation', status: 'spec_review' }],
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      code: 'ready_work',
      label: 'Repair this spec',
      taskId: 'task-component',
      buttonLabel: 'Repair spec',
      operation: 'repair_spec',
    })
  })

  it('keeps paused work actionable when a compact refresh has no task detail', () => {
    const model = resolveProjectActionModel({
      stored: {
        primaryAction: null,
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        message: 'Resume the paused task.',
        focusTaskId: 'task-paused',
        focusTaskTitle: 'Paused task',
        actionHref: '/work?task=task-paused',
      },
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Work paused',
      taskLabel: 'Paused task',
      href: '/work?task=task-paused',
      taskId: 'task-paused',
    })
  })

  it('publishes stable task-summary counts from the full project inventory', () => {
    const completeBrief = {
      approvedAt: '2026-05-19T10:00:00.000Z',
      userJob: 'Run the task.',
      whyItMattersNow: 'The release needs it.',
      successMetric: 'The task passes.',
      nonGoals: ['No extra scope.'],
      antiPatterns: [],
    }
    const model = buildProjectActionModel({
      startReadiness: { canStart: true, code: 'ready_work', focusTaskId: 'ready-task' },
      tasks: [{ id: 'ready-task', title: 'Ready task', status: 'ready' }],
      summaryTasks: [
        {
          id: 'ready-task',
          title: 'Ready task',
          status: 'ready',
          productBrief: completeBrief,
          spec: 'Implement it.',
          acceptanceCriteria: [{}],
        },
        { id: 'waiting-task', title: 'Waiting task', status: 'ready', dependsOn: ['dependency'] },
        { id: 'dependency', title: 'Dependency', status: 'in_progress' },
        { id: 'done-task', title: 'Done task', status: 'pending_pr' },
        { id: 'task-meta-intake', title: 'Setup', status: 'done' },
      ],
      runStatus: 'stopped',
    })

    expect(model.workSummary).toEqual({
      total: 4,
      agentActive: 0,
      paused: 1,
      waiting: 1,
      reviewWaiting: 0,
      gatesWaiting: 0,
      shaping: 0,
      specRevisionQueued: 0,
      readyForWorker: 1,
      needsSpecCleanup: 0,
      awaitingApproval: 0,
      done: 1,
    })
  })

  it('names brief review explicitly when shared readiness requires it', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: '"Prove packaged Tauri sidecar" has a drafted brief ready for review.',
        focusTaskId: 'task-086',
        focusTaskTitle: 'Prove packaged Tauri sidecar',
        focusKind: 'brief_cleanup',
        actionHref: '/thread?thread=task%3Atask-086',
      },
      tasks: [{ id: 'task-086', title: 'Prove packaged Tauri sidecar', status: 'exploring' }],
    })

    expect(model.primaryAction).toMatchObject({
      source: 'owner_input',
      label: 'Prove packaged Tauri sidecar',
      buttonLabel: 'Review brief',
      href: '/thread?thread=task%3Atask-086',
      taskId: 'task-086',
    })
    expect(model.ownerInput).toMatchObject({ active: true, label: 'Prove packaged Tauri sidecar' })
    expect(model.runControl).toMatchObject({ label: 'Waiting on answer', startEnabled: false })
    expect(model.setup).toMatchObject({ state: 'ready', freshIntakeNeeded: false })
  })

  it('keeps focused review routes in Thread across project-scoped summary reads', () => {
    expect(projectTaskActionHref({
      code: 'owner_input_required',
      focusKind: 'brief_cleanup',
      focusTaskId: 'task-086',
    }, 'narrative-harness')).toBe(
      '/projects/narrative-harness/thread?thread=task%3Atask-086',
    )
    expect(projectTaskActionHref({
      code: 'no_unattended_progress',
      focusKind: 'spec_review',
      focusTaskId: 'task-087',
    }, 'narrative-harness')).toBe(
      '/projects/narrative-harness/thread?thread=task%3Atask-087',
    )
    expect(projectTaskActionHref({
      code: 'owner_review_required',
      focusKind: 'owner_review',
      focusTaskId: 'task-089',
    }, 'narrative-harness')).toBe(
      '/projects/narrative-harness/task/task-089',
    )
    expect(projectTaskActionHref({
      code: 'ready_work',
      focusKind: 'ready_work',
      focusTaskId: 'task-088',
    }, 'narrative-harness')).toBe(
      '/projects/narrative-harness/work?task=task-088',
    )
  })

  it('makes a hard setup inbox item the shared action and start blocker', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'task-synopsis',
        focusTaskTitle: 'Build synopsis expansion',
      },
      inbox: {
        items: [{
          kind: 'bootstrap_missing',
          severity: 'high',
          title: 'Bootstrap incomplete',
          detail: 'Verify install and gate commands before agents run.',
          actionHref: '/settings/ready',
        }],
      },
      tasks: [{ id: 'task-synopsis', title: 'Build synopsis expansion', status: 'in_progress' }],
    })

    expect(model.primaryAction).toMatchObject({
      source: 'inbox',
      label: 'Verify your bootstrap commands',
      buttonLabel: 'Open readiness checks',
      href: '/settings/ready',
    })
    expect(model.runControl).toMatchObject({
      label: 'Waiting on setup',
      startEnabled: false,
      pauseEnabled: false,
      disabledReason: 'Verify install and gate commands before agents run.',
    })
  })

  it('names resumed automated review instead of fresh implementation work', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'ready_work',
        focusTaskId: 'task-review',
        focusTaskTitle: 'Review the desktop adapter',
        focusKind: 'review_work',
        message: '"Review the desktop adapter" has saved changes ready for automated review.',
        actionHref: '/work?task=task-review',
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      code: 'ready_work',
      ownerHeading: 'Review ready to continue',
      taskId: 'task-review',
      buttonLabel: 'Resume review',
      detail: 'The implementation is saved. Resume review to have Guildhall check the current change.',
      operation: 'start_focused',
    })
    expect(model.runControl).toMatchObject({ label: 'Resume review', startEnabled: true })
  })

  it('retains setup state without reopening setup urgency after a release shipped', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'The selected release has no runnable work remaining.',
      },
      releaseLifecycleState: 'shipped',
      inbox: {
        items: [{
          kind: 'bootstrap_missing',
          severity: 'high',
          title: 'Bootstrap incomplete',
          actionHref: '/settings/ready',
        }],
      },
    })

    expect(model.primaryAction).toBeNull()
    expect(model.secondaryActions).toEqual([])
    expect(model.setup).toMatchObject({
      state: 'blocked',
      href: '/settings/ready',
      detail: 'Bootstrap incomplete',
    })
    expect(model.ownerInput.active).toBe(false)
    expect(model.runControl).toMatchObject({
      label: 'Release shipped',
      startEnabled: false,
      pauseEnabled: false,
    })
  })

  it('keeps a shipped release terminal even when stale migration and owner-input state remain', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'A project migration is required.',
        actionHref: '/migrations',
      },
      releaseLifecycleState: 'shipped',
      ownerInput: {
        active: true,
        label: 'Answer in Thread',
        href: '/thread',
      },
      inbox: {
        items: [{
          kind: 'required_migration',
          severity: 'high',
          title: 'Migrate project',
          actionHref: '/migrations',
        }],
      },
    })

    expect(model.primaryAction).toBeNull()
    expect(model.secondaryActions).toEqual([])
    expect(model.ownerInput).toEqual({ active: false })
    expect(model.setup).toMatchObject({
      state: 'blocked',
      href: '/migrations',
      detail: 'Migrate project',
    })
    expect(model.runControl.label).toBe('Release shipped')
  })

  it('resolves a stale persisted task action from shared ready-work state', () => {
    const model = resolveProjectActionModel({
      stored: {
        primaryAction: {
          source: 'task',
          label: 'Build synopsis expansion',
          detail: 'Needs brief: finish the handoff before a worker can start.',
          buttonLabel: 'Open Work',
          href: '/work?task=task-synopsis',
          tone: 'warn',
          taskId: 'task-synopsis',
        },
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
      startReadiness: {
        canStart: true,
        code: 'ready_work',
        message: '"Build synopsis expansion" is ready to run.',
        focusTaskId: 'task-synopsis',
        focusTaskTitle: 'Build synopsis expansion',
        focusKind: 'ready_work',
      },
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Work ready to start',
      taskLabel: 'Build synopsis expansion',
      buttonLabel: 'Start work',
      href: '/work?task=task-synopsis',
      tone: 'accent',
      taskId: 'task-synopsis',
    })
    expect(model.primaryAction?.detail).toBeUndefined()
    expect(model.setup).toMatchObject({ state: 'ready', freshIntakeNeeded: false })
  })

  it('drops a persisted same-task secondary action when current readiness owns the task', () => {
    const model = resolveProjectActionModel({
      stored: {
        primaryAction: null,
        secondaryActions: [{
          source: 'task',
          label: 'Prove packaged Tauri sidecar',
          detail: 'Needs brief.',
          buttonLabel: 'Open Work',
          href: '/work?task=task-086',
          tone: 'warn',
          taskId: 'task-086',
        }],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: {
          state: 'blocked',
          freshIntakeNeeded: false,
          href: '/thread',
          detail: 'Finish setup before starting.',
        },
      },
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        focusTaskId: 'task-086',
        focusTaskTitle: 'Prove packaged Tauri sidecar',
        focusKind: 'brief_cleanup',
        actionHref: '/projects/narrative-harness/thread?thread=task%3Atask-086',
      },
    })

    expect(model.primaryAction?.taskId).toBe('task-086')
    expect(model.secondaryActions).toEqual([])
    expect(model.runControl).toMatchObject({ label: 'Waiting on answer', startEnabled: false })
    expect(model.setup).toEqual({ state: 'ready', freshIntakeNeeded: false })
  })

  it('drops persisted release-review actions after the release shipped', () => {
    const model = resolveProjectActionModel({
      stored: {
        primaryAction: {
          source: 'start_readiness',
          label: 'Review completed scope.',
          buttonLabel: 'Open item',
          href: '/overview',
          tone: 'warn',
          code: 'release_ready',
        },
        secondaryActions: [{
          source: 'task',
          label: 'Out-of-scope follow-up',
          buttonLabel: 'Open Work',
          href: '/work?task=task-later',
          tone: 'accent',
          taskId: 'task-later',
        }],
        runControl: { label: 'Start blocked', startEnabled: false },
        ownerInput: { active: false },
        setup: {
          state: 'blocked',
          freshIntakeNeeded: false,
          href: '/settings/ready',
          detail: 'Stale setup failure.',
        },
      },
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'The selected release has no runnable work remaining.',
      },
      releaseLifecycleState: 'shipped',
    })

    expect(model.primaryAction).toBeNull()
    expect(model.secondaryActions).toEqual([])
    expect(model.runControl).toMatchObject({
      label: 'Release shipped',
      startEnabled: false,
    })
    expect(model.setup).toMatchObject({
      state: 'blocked',
      href: '/settings/ready',
      detail: 'Stale setup failure.',
    })
  })

  it('replaces stale persisted task actions when current readiness is terminal', () => {
    const model = resolveProjectActionModel({
      stored: {
        primaryAction: {
          source: 'task',
          label: 'Old task action',
          buttonLabel: 'Open Work',
          href: '/work?task=task-old',
          tone: 'warn',
          taskId: 'task-old',
        },
        secondaryActions: [{
          source: 'task',
          label: 'Another stale task action',
          buttonLabel: 'Open Work',
          href: '/work?task=task-other',
          tone: 'accent',
          taskId: 'task-other',
        }],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'All selected release work is complete.',
      },
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      code: 'release_ready',
      buttonLabel: 'Open Release',
      href: '/release',
    })
    expect(model.secondaryActions).toEqual([])
    expect(model.runControl).toMatchObject({ startEnabled: false })
  })

  it('does not let a contradictory ready-work hint override the shared readiness authority', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'ready_work',
        focusTaskId: 'task-story-context',
        focusTaskTitle: 'Build story context',
      },
      tasks: [{
        id: 'task-story-context',
        title: 'Build story context',
        status: 'exploring',
        productBrief: {
          approvedAt: '2026-07-23T02:00:00.000Z',
          userJob: 'Keep author records immutable.',
          whyItMattersNow: 'Drafting needs trustworthy context.',
          successMetric: 'Derived records retain source links.',
          nonGoals: ['Do not replace author records.'],
        },
        acceptanceCriteria: [],
      }],
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Work ready to start',
      taskLabel: 'Build story context',
      buttonLabel: 'Start work',
    })
    expect(model.primaryAction?.detail).toBeUndefined()
  })

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
      label: 'Imported scope needs shaping',
      detail: '12 imported current-scope tasks still need real briefs before Guildhall can build unattended. Start with "Define fixture schemas".',
      buttonLabel: 'Shape first task',
      href: '/task/task-import-1',
      tone: 'warn',
    })
    expect(importedScopeShaping.runControl).toMatchObject({
      label: 'Needs shaping',
      startEnabled: false,
    })

    const workspaceImportRefresh = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message: "Guildhall's saved import is under-scoped for the current project docs. Refresh the import before treating this project as complete.",
        actionHref: '/workspace-import',
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(workspaceImportRefresh.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Workspace import needs refresh',
      detail: "Guildhall's saved import is under-scoped for the current project docs. Refresh the import before treating this project as complete.",
      buttonLabel: 'Refresh import',
      href: '/workspace-import',
      tone: 'warn',
    })
    expect(workspaceImportRefresh.runControl).toMatchObject({
      label: 'Refresh import',
      startEnabled: false,
    })

    const proofRecovery = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'proof_evidence_missing',
        message: 'Headless MVP is waiting on proof evidence for "Run fixture evaluator proof".',
        actionHref: '/work?task=current-done',
        focusTaskId: 'current-done',
        focusTaskTitle: 'Run fixture evaluator proof',
        focusKind: 'proof',
      },
      tasks: [{ id: 'current-done', title: 'Run fixture evaluator proof', status: 'done' }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(proofRecovery.primaryAction).toMatchObject({
      source: 'start_readiness',
      buttonLabel: 'Attach proof',
      href: '/work?task=current-done',
      tone: 'warn',
    })
    expect(proofRecovery.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
    })

    const repositoryFollowup = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'repository_followup_required',
        message: 'Stage 1 has no runnable task work left, but repository follow-up is still needed: main has 1 local commit not pushed to origin/main.',
        actionHref: '/release',
        focusKind: 'repository_followup',
        count: 1,
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(repositoryFollowup.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Repository follow-up required',
      detail: 'Stage 1 has no runnable task work left, but repository follow-up is still needed: main has 1 local commit not pushed to origin/main.',
      buttonLabel: 'Open release',
      href: '/release',
      tone: 'warn',
    })
    expect(repositoryFollowup.runControl).toMatchObject({
      label: 'Repo follow-up',
      startEnabled: false,
      pauseEnabled: false,
    })

    const sourceConflict = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'scope_source_conflict',
        message: 'Stage 1 has source conflicts to review before it can be treated as complete.',
        actionHref: '/map',
        focusKind: 'source_conflict',
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(sourceConflict.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Source conflict requires review',
      detail: 'Stage 1 has source conflicts to review before it can be treated as complete.',
      buttonLabel: 'Open map',
      href: '/map',
      tone: 'warn',
    })
    expect(sourceConflict.runControl).toMatchObject({
      label: 'Review conflict',
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
    expect(briefCleanup.secondaryActions).toEqual([])

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
      href: '/task/task-spec-a',
      tone: 'warn',
    })
    expect(specReview.runControl).toMatchObject({
      label: 'Review needed',
      startEnabled: false,
    })

    const ownerReview = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'owner_review_required',
        message: '10 specs are ready for your review before work can continue.',
        actionHref: '/work?task=task-spec-a',
        focusTaskId: 'task-spec-a',
        focusTaskTitle: 'Continue drafted spec work',
        focusKind: 'owner_review',
        count: 10,
      },
      tasks: [],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })
    expect(ownerReview.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Review a spec',
      taskLabel: 'Continue drafted spec work',
      buttonLabel: 'Review next spec',
      href: '/task/task-spec-a',
      tone: 'warn',
      code: 'owner_review_required',
      taskId: 'task-spec-a',
    })
    expect(ownerReview.runControl).toMatchObject({
      label: 'Review needed',
      startEnabled: false,
    })
    expect(ownerReview.primaryAction?.detail).toBeUndefined()

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
      label: 'Resume',
      startEnabled: true,
      pauseEnabled: false,
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
      buttonLabel: 'Review project update',
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
    expect(terminal.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Release is ready',
      detail: 'All tasks are already finished.',
      buttonLabel: 'Open Release',
      href: '/release',
      code: 'release_ready',
    })
    expect(terminal.runControl).toMatchObject({
      label: 'No runnable tasks',
      startEnabled: false,
      disabledReason: 'All tasks are already finished.',
    })
  })

  it('does not surface a decomposed containing parent as the primary task action', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [
        {
          id: 'task-150',
          title: 'Define MVP drafting model and physical-world review lanes',
          description: 'Containing parent for three execution children.',
          status: 'ready',
          updatedAt: '2026-07-06T03:00:00.000Z',
        },
        {
          id: 'task-150-split-model',
          title: 'Select and prove DeepInfra drafting model',
          status: 'done',
          hierarchy: { parentId: 'task-150', childIds: [], relation: 'decomposes' },
          updatedAt: '2026-07-06T03:01:00.000Z',
        },
        {
          id: 'task-150-split-world',
          title: 'Define world-state continuity review lane',
          status: 'done',
          hierarchy: { parentId: 'task-150', childIds: [], relation: 'decomposes' },
          updatedAt: '2026-07-06T03:02:00.000Z',
        },
        {
          id: 'task-next',
          title: 'Continue the remaining current-scope proof work',
          status: 'ready',
          updatedAt: '2026-07-06T03:03:00.000Z',
        },
      ],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      taskId: 'task-next',
      label: 'Continue the remaining current-scope proof work',
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
      detail: 'This task stopped before it could make visible progress. Choose its recovery action to continue.',
      buttonLabel: 'Open task',
      href: '/task/runner-proof',
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

    const stoppingTask = {
      id: 'task-stopping',
      title: 'Stopping task',
      status: 'in_progress',
      assignedTo: 'worker-1',
    }
    const stopping = buildProjectActionModel({
      startReadiness: { canStart: true },
      inbox: {
        items: [{
          kind: 'bootstrap_missing',
          severity: 'high',
          title: 'Bootstrap incomplete',
          detail: 'A stopped project must address this before the next run.',
          actionHref: '/settings/ready',
        }],
      },
      tasks: [stoppingTask],
      summaryTasks: [stoppingTask],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopping',
    })
    expect(stopping.runControl).toMatchObject({
      label: 'Stopping',
      startEnabled: false,
      disabledReason: 'Pause requested. Guildhall is waiting for active work to stop.',
    })
    expect(stopping.primaryAction).toMatchObject({
      source: 'task',
      taskId: 'task-stopping',
      tone: 'running',
      code: 'running',
    })
    expect(stopping.secondaryActions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ inboxKind: 'bootstrap_missing' }),
    ]))
    expect(stopping.workSummary).toMatchObject({ agentActive: 1, paused: 0 })
  })

  it('keeps the current running task actionable when compact activity has no task inventory', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'running',
        focusTaskId: 'task-proof',
        focusTaskTitle: 'Establish proof',
        message: 'Guildhall is running "Establish proof".',
        actionHref: '/work?task=task-proof',
      },
      tasks: [],
      runStatus: 'running',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Establish proof',
      buttonLabel: 'Open Work',
      href: '/work?task=task-proof',
      tone: 'running',
      code: 'running',
      taskId: 'task-proof',
    })
  })

  it('surfaces active work with a block reason as warning state', () => {
    const model = buildProjectActionModel({
      startReadiness: { canStart: true },
      tasks: [{
        id: 'task-stage-2',
        title: 'Implement Stage 2 reviewer',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        blockReason: 'Stage sequencing violation: Stage 1 is not complete.',
      }],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'running',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      label: 'Implement Stage 2 reviewer',
      detail: 'Stage sequencing violation: Stage 1 is not complete.',
      tone: 'warn',
      taskId: 'task-stage-2',
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
      buttonLabel: 'Review spec',
      href: '/task/task-import-9s8tkc',
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

  it('links spec-review task actions to the focused task decision', () => {
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
      buttonLabel: 'Review spec',
      href: '/task/task-spec-a',
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

  it('keeps paused live work resumable through the shared project decision', () => {
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
      source: 'start_readiness',
      label: 'Work paused',
      buttonLabel: 'Resume work',
      detail: '"Define fixture contracts" is paused in live work. Resume continues from that pinned task.',
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

  it('pins the primary action to the requested task during a one-task run', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        focusTaskId: 'task-broad-genre',
        focusTaskTitle: 'Build Broad-genre drafting model proof',
      },
      tasks: [
        {
          id: 'task-synopsis',
          title: 'Build Synopsis expansion into story records',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          updatedAt: '2026-07-18T14:25:00.000Z',
        },
        {
          id: 'task-broad-genre',
          title: 'Build Broad-genre drafting model proof',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          updatedAt: '2026-07-18T14:20:00.000Z',
        },
      ],
      runStatus: 'running',
      runMode: 'one_task',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'task',
      taskId: 'task-broad-genre',
      label: 'Build Broad-genre drafting model proof',
      href: '/work?task=task-broad-genre',
      tone: 'running',
    })
  })

  it('labels blocked live work as recovery even when the reason mentions specs', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '"Implement Stage 2 reviewer" is blocked before unattended work can run: spec is a placeholder.',
        actionHref: '/work?task=stage-2-reviewer',
        focusTaskId: 'stage-2-reviewer',
        focusTaskTitle: 'Implement Stage 2 reviewer',
        focusKind: 'blocked_work',
        count: 1,
      },
      tasks: [
        {
          id: 'stage-2-reviewer',
          title: 'Implement Stage 2 reviewer',
          description: 'Stage 2 reviewer implementation.',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          blockReason: 'spec is a placeholder.',
        },
      ],
      thread: { turns: [], activeTurnId: null },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      source: 'start_readiness',
      label: 'Implement Stage 2 reviewer',
      buttonLabel: 'Open task',
      tone: 'warn',
    })
    expect(model.runControl).toMatchObject({
      label: 'Needs recovery',
      startEnabled: false,
    })
  })

  it('does not count background spec records as owner approvals while paused work is the shared action', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Continue current work',
        actionHref: '/work?task=task-current',
      },
      summaryTasks: [
        { id: 'task-current', title: 'Continue current work', status: 'in_progress' },
        { id: 'task-repair', title: 'Repair a malformed spec', status: 'spec_review' },
      ],
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      code: 'paused_live_work',
      taskId: 'task-current',
      ownerHeading: 'Work paused',
      buttonLabel: 'Resume work',
    })
    expect(model.ownerInput).toEqual({ active: false })
    expect(model.workSummary?.awaitingApproval).toBe(0)
  })

  it('explains when a paused task has saved partial work for its next resume', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Continue current work',
        actionHref: '/work?task=task-current',
        progressState: 'partial_work_saved',
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      code: 'paused_live_work',
      taskId: 'task-current',
      buttonLabel: 'Resume work',
      detail: 'Progress is saved. Resume continues this task from its current workspace.',
    })
  })

  it('turns repeated typed no-progress into one explicit worker retry', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Open supported documents as TypeScript',
        actionHref: '/work?task=task-current',
        progressState: 'worker_retry_recommended',
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      code: 'worker_recovery',
      ownerHeading: 'Worker needs a fresh pass',
      taskId: 'task-current',
      buttonLabel: 'Retry worker',
      detail: 'The last two worker passes ended without a durable change. Retry starts a fresh pass using this task\'s current plan.',
      operation: 'start_focused',
    })
    expect(model.runControl).toMatchObject({ label: 'Retry worker', startEnabled: true })
  })

  it('turns observed worker edit loss into the same one-step retry', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Open supported documents as TypeScript',
        actionHref: '/work?task=task-current',
        progressState: 'worker_edit_loss',
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      code: 'worker_recovery',
      ownerHeading: 'Worker discarded its edits',
      taskId: 'task-current',
      buttonLabel: 'Retry worker',
      detail: 'Guildhall saw this worker\'s edits disappear before a handoff. Retry starts a fresh pass from the saved task plan.',
      operation: 'start_focused',
    })
    expect(model.runControl).toMatchObject({ label: 'Retry worker', startEnabled: true })
  })

  it('keeps the retry action after the persisted decision code replaces paused work', () => {
    const model = buildProjectActionModel({
      startReadiness: {
        canStart: true,
        code: 'worker_recovery',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Open supported documents as TypeScript',
        actionHref: '/work?task=task-current',
        progressState: 'worker_retry_recommended',
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({
      code: 'worker_recovery',
      taskId: 'task-current',
      buttonLabel: 'Retry worker',
      operation: 'start_focused',
    })
  })

  it('reconciles a persisted summary when paused work replaces an old approval queue', () => {
    const model = resolveProjectActionModel({
      stored: {
        primaryAction: null,
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
        workSummary: {
          total: 43,
          agentActive: 0,
          paused: 16,
          waiting: 3,
          reviewWaiting: 0,
          gatesWaiting: 0,
          shaping: 0,
          specRevisionQueued: 0,
          readyForWorker: 1,
          needsSpecCleanup: 0,
          awaitingApproval: 21,
          done: 0,
        },
      },
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Continue current work',
        actionHref: '/work?task=task-current',
      },
      runStatus: 'stopped',
    })

    expect(model.primaryAction).toMatchObject({ code: 'paused_live_work', taskId: 'task-current' })
    expect(model.workSummary?.awaitingApproval).toBe(0)
  })
})
