import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  authorizeAction,
  buildRemediationContext,
  recordRemediationDecision,
  isDestructiveAction,
  DESTRUCTIVE_REMEDIATION_ACTIONS,
  REMEDIATION_ACTIONS,
  type RemediationAction,
  type RemediationActionKind,
  type RemediationTrigger,
} from '../remediation.js'
import type { AgentIssue, Checkpoint, Task } from '@guildhall/core'
import type { StallFlag } from '../liveness.js'
import type { ReclaimCandidate } from '@guildhall/tools'

// ---------------------------------------------------------------------------
// FR-32 coordinator remediation decision loop tests.
//
// Structure:
//   - `authorizeAction` — pure lever gating. Every lever position × every
//     action is exercised.
//   - `buildRemediationContext` — pure context assembly for each trigger type.
//   - `recordRemediationDecision` — DECISIONS.md content assertions (AC-24:
//     must include trigger, full input context, action, rationale).
// ---------------------------------------------------------------------------

function mkTask(overrides: Partial<Task> = {}): Task {
  const now = '2026-04-20T00:00:00Z'
  return {
    id: 'task-001',
    title: 'Test task',
    description: 'Details',
    domain: 'looma',
    projectPath: '/proj',
    status: 'in_progress',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function mkStallTrigger(overrides: Partial<StallFlag> = {}): RemediationTrigger {
  const flag: StallFlag = {
    agentId: 'worker-1',
    taskId: 'task-001',
    lastEventAt: 0,
    silentMs: 60_000,
    strictness: 'standard',
    ...overrides,
  }
  return { kind: 'stall', taskId: flag.taskId, agentId: flag.agentId, flag }
}

function mkIssueTrigger(overrides: Partial<AgentIssue> = {}): RemediationTrigger {
  const issue: AgentIssue = {
    id: 'iss-task-001-1',
    taskId: 'task-001',
    agentId: 'worker-1',
    code: 'stuck',
    severity: 'warn',
    detail: 'made no progress on build',
    raisedAt: '2026-04-20T00:00:00Z',
    broadcast: false,
    ...overrides,
  }
  return { kind: 'issue', taskId: issue.taskId, agentId: issue.agentId, issue }
}

function mkCrashTrigger(
  checkpoint: Checkpoint | null = null,
  autoEscalate = false,
): RemediationTrigger {
  const candidate: ReclaimCandidate = {
    task: mkTask({ status: 'in_progress', assignedTo: 'worker-1' }),
    checkpoint,
    ageMs: checkpoint ? 60_000 : null,
    autoEscalate,
  }
  return {
    kind: 'crash',
    taskId: candidate.task.id,
    agentId: candidate.task.assignedTo!,
    candidate,
  }
}

// ---------------------------------------------------------------------------
// authorizeAction
// ---------------------------------------------------------------------------

describe('authorizeAction — lever matrix', () => {
  const nonDestructive: RemediationAction = {
    kind: 'restart_from_checkpoint',
    rationale: 'pick up where we left off',
  }
  const destructive: RemediationAction = {
    kind: 'shelve_task',
    rationale: 'not worth resuming',
  }

  it('auto — everything is autonomous', () => {
    for (const kind of REMEDIATION_ACTIONS) {
      const action: RemediationAction = { kind, rationale: 'x' }
      const result = authorizeAction(action, 'auto')
      expect(result).toEqual({ kind: 'autonomous' })
    }
  })

  it('confirm_destructive — non-destructive actions run autonomously', () => {
    expect(authorizeAction(nonDestructive, 'confirm_destructive')).toEqual({
      kind: 'autonomous',
    })
  })

  it('confirm_destructive — destructive actions require confirmation', () => {
    for (const kind of DESTRUCTIVE_REMEDIATION_ACTIONS) {
      const action: RemediationAction = { kind, rationale: 'x' }
      const result = authorizeAction(action, 'confirm_destructive')
      expect(result.kind).toBe('requires_confirm')
    }
  })

  it('confirm_all — every action requires confirmation', () => {
    for (const kind of REMEDIATION_ACTIONS) {
      const action: RemediationAction = { kind, rationale: 'x' }
      const result = authorizeAction(action, 'confirm_all')
      expect(result.kind).toBe('requires_confirm')
    }
  })

  it('pause_all_on_issue — every action is paused', () => {
    for (const kind of REMEDIATION_ACTIONS) {
      const action: RemediationAction = { kind, rationale: 'x' }
      const result = authorizeAction(action, 'pause_all_on_issue')
      expect(result.kind).toBe('paused')
    }
  })
})

describe('authorizeAction — FR-33 24h auto-escalation override', () => {
  const action: RemediationAction = {
    kind: 'restart_from_checkpoint',
    rationale: 'x',
  }

  it('overrides auto with requires_confirm when checkpoint > 24h', () => {
    const trigger = mkCrashTrigger(
      {
        taskId: 'task-001',
        agentId: 'worker-1',
        step: 3,
        intent: 'x',
        filesTouched: [],
        nextPlannedAction: 'x',
        writtenAt: '2026-04-19T00:00:00Z',
      },
      true, // autoEscalate
    )
    const result = authorizeAction(action, 'auto', trigger)
    expect(result.kind).toBe('requires_confirm')
    if (result.kind === 'requires_confirm') {
      expect(result.reason).toMatch(/24h/)
    }
  })

  it('does NOT override for a fresh crash (autoEscalate=false)', () => {
    const trigger = mkCrashTrigger(null, false)
    expect(authorizeAction(action, 'auto', trigger)).toEqual({ kind: 'autonomous' })
  })

  it('does NOT override for stall or issue triggers (they have no age gate)', () => {
    expect(authorizeAction(action, 'auto', mkStallTrigger())).toEqual({
      kind: 'autonomous',
    })
    expect(authorizeAction(action, 'auto', mkIssueTrigger())).toEqual({
      kind: 'autonomous',
    })
  })
})

describe('isDestructiveAction', () => {
  it('classifies restart_clean, shelve_task, pause_task_line as destructive', () => {
    expect(isDestructiveAction('restart_clean')).toBe(true)
    expect(isDestructiveAction('shelve_task')).toBe(true)
    expect(isDestructiveAction('pause_task_line')).toBe(true)
  })
  it('classifies recovery actions as non-destructive', () => {
    expect(isDestructiveAction('wait')).toBe(false)
    expect(isDestructiveAction('restart_from_checkpoint')).toBe(false)
    expect(isDestructiveAction('replace_with_different_agent')).toBe(false)
    expect(isDestructiveAction('escalate_to_human')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildRemediationContext
// ---------------------------------------------------------------------------

describe('buildRemediationContext', () => {
  const task = mkTask({ remediationAttempts: 2 })

  it('produces a context for a stall trigger', () => {
    const trigger = mkStallTrigger({ strictness: 'strict', silentMs: 50_000 })
    const ctx = buildRemediationContext({
      trigger,
      task,
      levers: {
        remediationAutonomy: 'auto',
        crashRecoveryDefault: 'prefer_resume',
        agentHealthStrictness: 'strict',
      },
      checkpoint: null,
      priorAttempts: task.remediationAttempts,
      now: '2026-04-20T12:00:00Z',
    })
    expect(ctx.trigger.kind).toBe('stall')
    expect(ctx.taskId).toBe('task-001')
    expect(ctx.agentId).toBe('worker-1')
    expect(ctx.priorAttempts).toBe(2)
    expect(ctx.leverState.remediationAutonomy).toBe('auto')
    expect(ctx.leverState.crashRecoveryDefault).toBe('prefer_resume')
    expect(ctx.leverState.agentHealthStrictness).toBe('strict')
    expect(ctx.now).toBe('2026-04-20T12:00:00Z')
  })

  it('produces a context for an issue trigger with checkpoint', () => {
    const checkpoint: Checkpoint = {
      taskId: 'task-001',
      agentId: 'worker-1',
      step: 4,
      intent: 'running tests',
      filesTouched: ['src/a.ts'],
      nextPlannedAction: 'fix the flaky one',
      writtenAt: '2026-04-20T11:00:00Z',
    }
    const trigger = mkIssueTrigger({ severity: 'critical', code: 'spec_incoherent' })
    const ctx = buildRemediationContext({
      trigger,
      task,
      levers: {
        remediationAutonomy: 'confirm_destructive',
        crashRecoveryDefault: 'prefer_restart_clean',
      },
      checkpoint,
      priorAttempts: 0,
    })
    expect(ctx.trigger.kind).toBe('issue')
    expect(ctx.checkpoint).toEqual(checkpoint)
    expect(ctx.leverState.agentHealthStrictness).toBeUndefined()
  })

  it('produces a context for a crash trigger carrying its own checkpoint', () => {
    const checkpoint: Checkpoint = {
      taskId: 'task-001',
      agentId: 'worker-1',
      step: 2,
      intent: 'migration step',
      filesTouched: [],
      nextPlannedAction: 'run seed',
      writtenAt: '2026-04-19T23:00:00Z',
    }
    const trigger = mkCrashTrigger(checkpoint, false)
    const ctx = buildRemediationContext({
      trigger,
      task,
      levers: {
        remediationAutonomy: 'auto',
        crashRecoveryDefault: 'pause_for_review',
      },
      checkpoint,
      priorAttempts: 1,
    })
    expect(ctx.trigger.kind).toBe('crash')
    expect(ctx.checkpoint).toEqual(checkpoint)
  })

  it('carries optional event density + artifact snapshot when supplied', () => {
    const ctx = buildRemediationContext({
      trigger: mkStallTrigger(),
      task,
      levers: {
        remediationAutonomy: 'auto',
        crashRecoveryDefault: 'prefer_resume',
      },
      checkpoint: null,
      priorAttempts: 0,
      recentEventDensity: { windowMs: 60_000, count: 3 },
      artifactSnapshot: {
        filesTouched: ['src/a.ts', 'src/b.ts'],
        uncommittedPaths: ['src/b.ts'],
      },
    })
    expect(ctx.recentEventDensity).toEqual({ windowMs: 60_000, count: 3 })
    expect(ctx.artifactSnapshot?.filesTouched).toEqual(['src/a.ts', 'src/b.ts'])
    expect(ctx.artifactSnapshot?.uncommittedPaths).toEqual(['src/b.ts'])
  })
})

// ---------------------------------------------------------------------------
// recordRemediationDecision — DECISIONS.md format (AC-24)
// ---------------------------------------------------------------------------

describe('recordRemediationDecision', () => {
  let tmpDir: string
  let decisionsPath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-rem-'))
    decisionsPath = path.join(tmpDir, 'DECISIONS.md')
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeCtxAndRecord(
    actionKind: RemediationActionKind,
    opts: {
      autonomy?: 'autonomous' | 'requires_confirm' | 'paused'
      rationale?: string
    } = {},
  ): Promise<string> {
    const trigger = mkStallTrigger()
    const ctx = buildRemediationContext({
      trigger,
      task: mkTask({ remediationAttempts: 1 }),
      levers: {
        remediationAutonomy: 'auto',
        crashRecoveryDefault: 'prefer_resume',
        agentHealthStrictness: 'standard',
      },
      checkpoint: {
        taskId: 'task-001',
        agentId: 'worker-1',
        step: 3,
        intent: 'x',
        filesTouched: ['src/a.ts'],
        nextPlannedAction: 'y',
        writtenAt: '2026-04-20T00:00:00Z',
      },
      priorAttempts: 1,
      now: '2026-04-20T12:00:00Z',
      recentEventDensity: { windowMs: 60_000, count: 0 },
      artifactSnapshot: { filesTouched: ['src/a.ts'] },
    })
    await recordRemediationDecision({
      decisionsPath,
      context: ctx,
      action: {
        kind: actionKind,
        rationale: opts.rationale ?? 'chosen because reasons',
      },
      authorization:
        opts.autonomy === 'requires_confirm'
          ? { kind: 'requires_confirm', reason: 'manual approval' }
          : opts.autonomy === 'paused'
            ? { kind: 'paused', reason: 'project frozen' }
            : { kind: 'autonomous' },
      decidedBy: 'coord-looma',
      domain: 'looma',
    })
    return await fs.readFile(decisionsPath, 'utf-8')
  }

  it('writes an ADR block with trigger, context, decision, and consequences', async () => {
    const body = await writeCtxAndRecord('restart_from_checkpoint')
    expect(body).toMatch(/Remediation: restart_from_checkpoint \(stall trigger\)/)
    expect(body).toMatch(/\*\*Date:\*\* 2026-04-20T12:00:00Z/)
    expect(body).toMatch(/\*\*Agent:\*\* coord-looma \(looma\)/)
    expect(body).toMatch(/\*\*Task:\*\* task-001/)
    expect(body).toMatch(/\*\*Decision:\*\* restart_from_checkpoint.*chosen because reasons/)
  })

  it('context line records trigger, prior_attempts, checkpoint, levers', async () => {
    const body = await writeCtxAndRecord('wait')
    expect(body).toMatch(/trigger=stall/)
    expect(body).toMatch(/task=task-001/)
    expect(body).toMatch(/prior_attempts=1/)
    expect(body).toMatch(/checkpoint=step 3/)
    expect(body).toMatch(/event_density=0\/60000ms/)
    expect(body).toMatch(/files_touched=1/)
    expect(body).toMatch(/remediation_autonomy=auto/)
    expect(body).toMatch(/crash_recovery_default=prefer_resume/)
    expect(body).toMatch(/agent_health_strictness=standard/)
  })

  it('consequences line reflects authorization kind', async () => {
    let body = await writeCtxAndRecord('restart_clean', { autonomy: 'requires_confirm' })
    expect(body).toMatch(/Consequences:.*requires human confirmation.*manual approval/)

    await fs.rm(decisionsPath, { force: true })
    body = await writeCtxAndRecord('wait', { autonomy: 'paused' })
    expect(body).toMatch(/Consequences:.*paused.*project frozen/)

    await fs.rm(decisionsPath, { force: true })
    body = await writeCtxAndRecord('wait')
    expect(body).toMatch(/Consequences:.*autonomous — executed immediately/)
  })

  it('appends subsequent decisions rather than overwriting', async () => {
    await writeCtxAndRecord('wait')
    await writeCtxAndRecord('restart_from_checkpoint')
    const body = await fs.readFile(decisionsPath, 'utf-8')
    const headings = body.match(/## \[rem-task-001-/g)
    expect(headings?.length).toBe(2)
  })
})
