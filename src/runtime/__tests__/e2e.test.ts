import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  bootstrapWorkspace,
  readWorkspaceConfig,
  resolveConfig,
} from '@guildhall/config'
import {
  Orchestrator,
  type OrchestratorAgentSet,
} from '../orchestrator.js'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
} from '../intake.js'
import {
  createMetaIntakeTask,
  approveMetaIntake,
  META_INTAKE_TASK_ID,
} from '../meta-intake.js'
import { TaskQueue, type Task, type TaskStatus } from '@guildhall/core'
import {
  raiseEscalation,
  reportIssue,
  writeCheckpoint,
  readCheckpoint,
  proposeTask,
  preRejectTask,
} from '@guildhall/tools'
import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
  type DomainLevers,
} from '@guildhall/levers'
import { PermissionMode } from '@guildhall/engine'
import { LivenessTracker } from '../liveness.js'

// ---------------------------------------------------------------------------
// End-to-end integration tests
//
// These tests wire together the real programmatic APIs — workspace bootstrap,
// intake, meta-intake, the orchestrator loop, escalations, FR-15 permission
// modes — against a real on-disk workspace. Agents are still scripted to
// keep the tests deterministic, but every other layer (config read/write,
// TASKS.json persistence, PROGRESS.md logging, transcript files, coordinator
// draft parsing) runs for real.
//
// The goal is to catch cross-module regressions the unit tests cannot —
// e.g. a schema change that breaks intake→orchestrator hand-off, or a
// logging format change that silently makes PROGRESS.md unreadable.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string
let progressPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-e2e-'))
  bootstrapWorkspace(tmpDir, { name: 'E2E Workspace' })
  memoryDir = path.join(tmpDir, 'memory')
  tasksPath = path.join(memoryDir, 'TASKS.json')
  progressPath = path.join(memoryDir, 'PROGRESS.md')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

async function mutateTask(id: string, patch: Partial<Task>): Promise<void> {
  const queue = await readQueue()
  const task = queue.tasks.find((t) => t.id === id)
  if (!task) throw new Error(`Task ${id} not found`)
  Object.assign(task, patch)
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

async function setTaskSpec(id: string, spec: string): Promise<void> {
  const queue = await readQueue()
  queue.tasks.find((t) => t.id === id)!.spec = spec
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

interface StubAgent {
  readonly name: string
  calls: { prompt: string }[]
  modeCalls: PermissionMode[]
  setPermissionMode(mode: PermissionMode): PermissionMode
  generate(prompt: string): Promise<{ text: string }>
}

function stubAgent(
  name: string,
  sideEffect?: (prompt: string) => Promise<void> | void,
): StubAgent {
  const calls: { prompt: string }[] = []
  const modeCalls: PermissionMode[] = []
  let current = PermissionMode.FULL_AUTO
  return {
    name,
    calls,
    modeCalls,
    setPermissionMode(mode: PermissionMode) {
      modeCalls.push(mode)
      current = mode
      return current
    },
    async generate(prompt: string) {
      calls.push({ prompt })
      if (sideEffect) await sideEffect(prompt)
      return { text: 'ok' }
    },
  }
}

function resolveBootstrapped() {
  return resolveConfig({ workspacePath: tmpDir })
}

// ---------------------------------------------------------------------------
// AC-03: the orchestrator processes a task from exploring → done end-to-end.
//
// This test is the spine AC — it asserts the full FR-01 lifecycle is walked
// without skipping a state. The FR-14 meta-intake test below exercises a
// superset (zero-coordinator bootstrap + lifecycle), but AC-03 wants a
// dedicated assertion that isn't entangled with meta-intake. Here we seed a
// coordinator inline at workspace bootstrap time so the test focuses purely
// on the lifecycle transitions.
// ---------------------------------------------------------------------------

describe('E2E AC-03: task lifecycle exploring → done', () => {
  it('walks every FR-01 status in order with no skips', async () => {
    // Re-bootstrap with an inline coordinator so we skip FR-14 meta-intake.
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.mkdir(tmpDir, { recursive: true })
    bootstrapWorkspace(tmpDir, {
      name: 'AC-03 Workspace',
      coordinators: [
        {
          id: 'looma',
          name: 'Looma Coordinator',
          domain: 'looma',
          mandate: 'Oversee UI quality.',
          concerns: [
            {
              id: 'a11y',
              description: 'Accessibility regressions',
              reviewQuestions: ['Does this preserve keyboard navigation?'],
            },
          ],
          autonomousDecisions: ['Minor copy tweaks'],
          escalationTriggers: ['Public component API changes'],
        },
      ],
    })

    // Create a task in `exploring` and verify that is indeed the starting state.
    const intake = await createExploringTask({
      memoryDir,
      ask: 'Add a ghost button variant to the design system',
      domain: 'looma',
      projectPath: tmpDir,
    })
    const initialQueue = await readQueue()
    const initialTask = initialQueue.tasks.find((t) => t.id === intake.taskId)!
    expect(initialTask.status).toBe('exploring')

    // Human approves the spec → exploring → spec_review.
    await setTaskSpec(
      intake.taskId,
      '## Summary\nAdd a ghost button variant.\n## AC\n1. renders.',
    )
    const specApproval = await approveSpec({
      memoryDir,
      taskId: intake.taskId,
      approvalNote: 'LGTM',
    })
    expect(specApproval.success).toBe(true)
    expect(specApproval.newStatus).toBe('spec_review')

    // Scripted agents drive the remaining transitions. Each agent reads the
    // current status from disk and advances it by one state.
    const coord = stubAgent('looma-coordinator', async () => {
      const q = await readQueue()
      const t = q.tasks.find((x) => x.id === intake.taskId)!
      if (t.status === 'spec_review') {
        await mutateTask(intake.taskId, { status: 'ready' })
      } else if (t.status === 'ready') {
        await mutateTask(intake.taskId, {
          status: 'in_progress',
          assignedTo: 'worker-agent',
        })
      }
    })
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask(intake.taskId, { status: 'review' })
    })
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask(intake.taskId, { status: 'gate_check' })
    })
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      await mutateTask(intake.taskId, {
        status: 'done',
        completedAt: '2026-04-20T00:00:00Z',
      })
    })
    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker,
      reviewer,
      gateChecker,
      coordinators: { looma: coord },
    }

    const config = resolveBootstrapped()
    const orch = new Orchestrator({ config, agents, idleShutdownAfterTicks: 2 })

    const observedStatuses: TaskStatus[] = []
    for (let i = 0; i < 12; i++) {
      const outcome = await orch.tick()
      if (outcome.kind === 'processed') {
        observedStatuses.push(outcome.afterStatus)
        if (outcome.afterStatus === 'done') break
      }
      if (outcome.kind === 'idle' && outcome.allDone) break
    }

    // The spine claim: every intermediate state is visited in order, ending
    // in `done`. `exploring` and `spec_review` are asserted above (pre-orch).
    expect(observedStatuses).toEqual([
      'ready',
      'in_progress',
      'review',
      'gate_check',
      'done',
    ])

    // Task on disk is terminal in `done` with a completedAt timestamp.
    const finalQueue = await readQueue()
    const finalTask = finalQueue.tasks.find((t) => t.id === intake.taskId)!
    expect(finalTask.status).toBe('done')
    expect(finalTask.completedAt).toBe('2026-04-20T00:00:00Z')

    // FR-09 progress logging captured at least the terminal transition.
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('gate_check → done')

    // FR-08 exploring transcript persisted across the whole run.
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', `${intake.taskId}.md`),
      'utf-8',
    )
    expect(transcript).toContain('Add a ghost button variant')
    expect(transcript).toContain('Spec approved')
  })
})

describe('E2E: meta-intake → FR-14 coordinator bootstrap → running tasks', () => {
  it('walks a brand-new workspace from zero coordinators to a done task', async () => {
    // 1. Seed a meta-intake task in the freshly bootstrapped workspace.
    const metaResult = await createMetaIntakeTask({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(metaResult.alreadyExists).toBe(false)

    // 2. Attach a coordinator draft as the Spec Agent would have done during
    //    the interview (we skip the LLM turn; the parser is unit-tested).
    await setTaskSpec(
      META_INTAKE_TASK_ID,
      `## Summary
Interview produced the following draft.

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma Coordinator
    domain: looma
    mandate: Oversee UI quality.
    concerns:
      - id: a11y
        description: Accessibility regressions
        reviewQuestions:
          - Does this preserve keyboard navigation?
    autonomousDecisions:
      - Minor copy tweaks
    escalationTriggers:
      - Public component API changes
\`\`\`
`,
    )

    // 3. Approve the meta-intake → guildhall.yaml gets coordinators.
    const approvalResult = await approveMetaIntake({
      workspacePath: tmpDir,
      memoryDir,
    })
    expect(approvalResult.success).toBe(true)
    expect(approvalResult.coordinatorsAdded).toBe(1)

    const configAfter = readWorkspaceConfig(tmpDir)
    expect(configAfter.coordinators).toHaveLength(1)
    expect(configAfter.coordinators[0]!.id).toBe('looma')

    // 4. Create a real exploring task via the FR-12 intake API. Note the
    //    generated id is `task-002` because the reserved meta-intake task
    //    already occupies the first slot of the queue.
    const intake = await createExploringTask({
      memoryDir,
      ask: 'Add a ghost button variant to the design system',
      domain: 'looma',
      projectPath: tmpDir,
    })
    expect(intake.taskId).toBe('task-002')

    // 5. Simulate the Spec Agent drafting a spec on the orchestrator's next
    //    tick, then approve it via FR-12 approveSpec.
    await setTaskSpec(intake.taskId, '## Summary\nAdd a ghost button variant.\n## AC\n1. renders.')
    const specApproval = await approveSpec({
      memoryDir,
      taskId: intake.taskId,
      approvalNote: 'LGTM',
    })
    expect(specApproval.success).toBe(true)
    expect(specApproval.newStatus).toBe('spec_review')

    // 6. Stand up the orchestrator with real config + stub agents that drive
    //    the task forward through spec_review → ready → in_progress → review
    //    → gate_check → done.
    const config = resolveBootstrapped()

    // Coordinator stub: read the current task status from disk (just like a
    // real agent would) and drive the next forward transition.
    const coord = stubAgent('looma-coordinator', async () => {
      const q = await readQueue()
      const t = q.tasks.find((x) => x.id === intake.taskId)!
      if (t.status === 'spec_review') {
        await mutateTask(intake.taskId, { status: 'ready' })
      } else if (t.status === 'ready') {
        await mutateTask(intake.taskId, { status: 'in_progress', assignedTo: 'worker-agent' })
      }
    })
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask(intake.taskId, { status: 'review' })
    })
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask(intake.taskId, { status: 'gate_check' })
    })
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      await mutateTask(intake.taskId, { status: 'done', completedAt: '2026-04-20T00:00:00Z' })
    })
    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker,
      reviewer,
      gateChecker,
      coordinators: { looma: coord },
    }

    const orch = new Orchestrator({
      config,
      agents,
      idleShutdownAfterTicks: 2,
    })

    // Drive until the task is done (should be 5 productive ticks).
    const observedStatuses: TaskStatus[] = []
    for (let i = 0; i < 12; i++) {
      const outcome = await orch.tick()
      if (outcome.kind === 'processed') {
        observedStatuses.push(outcome.afterStatus)
        if (outcome.afterStatus === 'done') break
      }
      if (outcome.kind === 'idle' && outcome.allDone) break
    }

    expect(observedStatuses).toEqual([
      'ready',
      'in_progress',
      'review',
      'gate_check',
      'done',
    ])

    // 7. PROGRESS.md captured HEARTBEAT and MILESTONE entries.
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('MILESTONE')
    expect(progress).toContain('gate_check → done')
    expect(progress).toContain('looma')

    // 8. Every agent that acted should have been asked for FULL_AUTO by the
    //    orchestrator (no permissionMode override on the task).
    expect(coord.modeCalls).toContain(PermissionMode.FULL_AUTO)
    expect(worker.modeCalls).toContain(PermissionMode.FULL_AUTO)
    expect(reviewer.modeCalls).toContain(PermissionMode.FULL_AUTO)
    expect(gateChecker.modeCalls).toContain(PermissionMode.FULL_AUTO)

    // 9. The exploring transcript is still on disk with the approval note.
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', `${intake.taskId}.md`),
      'utf-8',
    )
    expect(transcript).toContain('Add a ghost button variant')
    expect(transcript).toContain('Spec approved')
  })
})

describe('E2E: FR-10 escalation round-trip', () => {
  it('halts a task on escalation and resumes it after resolution', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'investigate slow startup',
      domain: 'looma',
      projectPath: tmpDir,
    })

    // Bypass the config-resolution path (this test doesn't need coordinators).
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )
    const config = resolveBootstrapped()

    // Spec agent raises an escalation on its first invocation, then acts
    // normally on subsequent ticks (after the escalation is resolved).
    let escalated = false
    const spec = stubAgent('spec-agent', async () => {
      if (!escalated) {
        escalated = true
        await raiseEscalation({
          tasksPath,
          taskId: 'task-001',
          agentId: 'spec-agent',
          reason: 'spec_ambiguous',
          summary: 'is this mobile too?',
        })
      }
    })

    const orch = new Orchestrator({
      config,
      agents: {
        spec,
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: {},
      },
      idleShutdownAfterTicks: 2,
    })

    const firstTick = await orch.tick()
    expect(firstTick.kind).toBe('escalated')

    // The task is now in `blocked` with an open escalation; further ticks
    // should see no actionable task.
    const queueAfter = await readQueue()
    expect(queueAfter.tasks[0]!.status).toBe('blocked')
    expect(queueAfter.tasks[0]!.escalations).toHaveLength(1)

    const idleTick = await orch.tick()
    expect(idleTick.kind).toBe('idle')

    // Human resumes via resumeExploring, resolving the escalation.
    const resume = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      resolveEscalationId: queueAfter.tasks[0]!.escalations[0]!.id,
      resolution: 'yes, mobile too',
      message: 'also mobile',
    })
    expect(resume.success).toBe(true)

    const queueResumed = await readQueue()
    expect(queueResumed.tasks[0]!.status).toBe('exploring')
    expect(queueResumed.tasks[0]!.escalations[0]!.resolvedAt).toBeDefined()

    // Next tick dispatches to spec again now that the escalation is resolved.
    const resumedTick = await orch.tick()
    expect(resumedTick.kind).toBe('processed')
  })
})

describe('E2E: FR-15 per-task permission mode clamp propagates through the orchestrator', () => {
  it('plan-mode task narrows its dispatched agent on the tick', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'safe investigation',
      domain: 'looma',
      projectPath: tmpDir,
    })
    await mutateTask('task-001', { permissionMode: 'plan' })

    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )
    const config = resolveBootstrapped()

    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config,
      agents: {
        spec,
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: {},
      },
      idleShutdownAfterTicks: 2,
    })

    await orch.tick()
    expect(spec.modeCalls).toEqual([PermissionMode.PLAN])
  })
})

// ---------------------------------------------------------------------------
// AC-22 end-to-end:
//   Agent calls `report_issue` → task.agentIssues is populated → orchestrator
//   sees it on the next-tick inbox via collectRemediationTriggers → coordinator
//   chooses an action and the authorization matches the `remediation_autonomy`
//   lever.
//
// Walk: create in_progress task, call reportIssue (the real tool), seed a
// lever position, run collectRemediationTriggers, build context, authorize
// a non-destructive action, then flip the lever to `confirm_all` and verify
// the same action now requires confirmation. Both branches record to
// DECISIONS.md via recordRemediation.
// ---------------------------------------------------------------------------
describe('E2E AC-22: report_issue → coordinator remediation inbox', () => {
  it('routes report_issue through the FR-32 remediation loop with lever-gated authorization', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )

    // Pre-seed an in_progress task with a worker assigned.
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'confirm_destructive',
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    const now = '2026-04-20T00:00:00Z'
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-001',
          title: 'Hook up the build',
          description: 'Details',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          assignedTo: 'worker-agent',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    // Step 1: worker calls report_issue (the real tool). No status change.
    const reported = await reportIssue({
      tasksPath,
      progressPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      code: 'stuck',
      severity: 'warn',
      detail: 'spec says X but the API only supports Y',
      suggestedAction: 'rescope to Y or raise escalation',
    })
    expect(reported.success).toBe(true)
    expect(reported.issueId).toMatch(/^iss-task-001-/)

    const afterReport = await readQueue()
    const taskAfter = afterReport.tasks[0]!
    expect(taskAfter.status).toBe('in_progress')
    expect(taskAfter.agentIssues).toHaveLength(1)
    expect(taskAfter.agentIssues[0]!.broadcast).toBe(false)
    expect(taskAfter.agentIssues[0]!.detail).toContain('spec says X')

    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ISSUE [warn/stuck]')

    // Step 2: orchestrator next tick inbox sees the issue as a trigger.
    const config = resolveBootstrapped()
    const orch = new Orchestrator({
      config,
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: {
          looma: stubAgent('looma-coordinator'),
        },
      },
      idleShutdownAfterTicks: 2,
    })
    orch.liveness.register('worker-agent', 'task-001')

    const triggers = await orch.collectRemediationTriggers()
    const issueTriggers = triggers.filter((t) => t.kind === 'issue')
    expect(issueTriggers).toHaveLength(1)
    expect(issueTriggers[0]!.taskId).toBe('task-001')

    // Step 3: coordinator chooses a non-destructive action; authorization
    // under `confirm_destructive` returns autonomous.
    const ctx = await orch.buildRemediationContextFor(issueTriggers[0]!)
    expect(ctx.leverState.remediationAutonomy).toBe('confirm_destructive')
    const nonDestructive = {
      kind: 'replace_with_different_agent' as const,
      rationale: 'rescope needs a spec-agent pass',
      replacementAgent: 'spec-agent',
    }
    const auth1 = orch.authorizeRemediation(nonDestructive, ctx)
    expect(auth1).toEqual({ kind: 'autonomous' })
    await orch.recordRemediation({
      context: ctx,
      action: nonDestructive,
      authorization: auth1,
      decidedBy: 'looma',
    })

    const decisions1 = await fs.readFile(
      path.join(memoryDir, 'DECISIONS.md'),
      'utf-8',
    )
    expect(decisions1).toMatch(/Remediation: replace_with_different_agent \(issue trigger\)/)
    expect(decisions1).toMatch(/spec-agent/)
    expect(decisions1).toMatch(/remediation_autonomy=confirm_destructive/)
    expect(decisions1).toMatch(/autonomous — executed immediately/)

    // Step 4: flip the lever to confirm_all → same action now requires
    // human confirmation. Verifies AC-22's "consistent with lever
    // `remediation_autonomy`" requirement.
    settings.project.remediation_autonomy = {
      position: 'confirm_all',
      rationale: 'tightening',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    const ctx2 = await orch.buildRemediationContextFor(issueTriggers[0]!)
    expect(ctx2.leverState.remediationAutonomy).toBe('confirm_all')
    const auth2 = orch.authorizeRemediation(nonDestructive, ctx2)
    expect(auth2.kind).toBe('requires_confirm')
    await orch.recordRemediation({
      context: ctx2,
      action: nonDestructive,
      authorization: auth2,
      decidedBy: 'looma',
    })

    const decisions2 = await fs.readFile(
      path.join(memoryDir, 'DECISIONS.md'),
      'utf-8',
    )
    expect(decisions2).toMatch(/requires human confirmation/)
    // remediationAttempts was bumped twice.
    const finalQueue = await readQueue()
    expect(finalQueue.tasks[0]!.remediationAttempts).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// AC-15 end-to-end:
//   An agent calls the propose-task tool to create a task in `proposed`
//   status. The orchestrator's next tick reads the domain's task_origination
//   lever and applies the matching promotion action. The disk state must
//   exactly match the lever position for all four positions.
// ---------------------------------------------------------------------------
describe('E2E AC-15: proposeTask → orchestrator tick → status per task_origination', () => {
  it('routes a proposed task to the status dictated by the lever position', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )

    const config = resolveBootstrapped()
    const orch = new Orchestrator({
      config,
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: { looma: stubAgent('looma-coordinator') },
      },
      idleShutdownAfterTicks: 2,
    })

    // Bootstrap writes TASKS.json as a bare array (legacy shape); re-write
    // it as an empty TaskQueue object so proposeTask can parse it.
    await fs.writeFile(
      tasksPath,
      JSON.stringify({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] }, null, 2),
      'utf-8',
    )

    type Position = DomainLevers['task_origination']['position']
    const cases: Array<{ id: string; position: Position; expectedStatus: TaskStatus }> = [
      { id: 'prop-human', position: 'human_only', expectedStatus: 'shelved' },
      { id: 'prop-hum-approve', position: 'agent_proposed_human_approved', expectedStatus: 'spec_review' },
      { id: 'prop-coord-approve', position: 'agent_proposed_coordinator_approved', expectedStatus: 'spec_review' },
      { id: 'prop-auto', position: 'agent_autonomous', expectedStatus: 'ready' },
    ]

    for (const c of cases) {
      // 1. Set the domain lever for `looma`.
      const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
      settings.domains.default.task_origination = {
        position: c.position,
        rationale: `AC-15 test (${c.position})`,
        setAt: '2026-04-20T00:00:00Z',
        setBy: 'user-direct',
      }
      await saveLeverSettings({
        path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
        settings,
      })

      // 2. An agent calls propose-task (the real tool) to create the task.
      const result = await proposeTask({
        tasksPath,
        proposal: {
          id: c.id,
          title: `Proposal ${c.id}`,
          description: 'Agent noticed work worth doing',
          domain: 'looma',
          projectPath: tmpDir,
          proposedBy: 'worker-agent',
          rationale: 'noticed during review',
        },
      })
      if (!result.success) throw new Error(`proposeTask failed: ${result.error}`)
      expect(result.success).toBe(true)

      const afterPropose = await readQueue()
      const proposed = afterPropose.tasks.find((t) => t.id === c.id)!
      expect(proposed.status).toBe('proposed')
      expect(proposed.origination).toBe('agent')

      // 3. Orchestrator tick — decideProposal applies the lever decision.
      //    Loop until we see a proposal-decided outcome for this task id,
      //    because other already-terminal tasks from prior iterations still
      //    live on the queue and may be scanned first on some ticks.
      let decided = false
      for (let i = 0; i < 8 && !decided; i++) {
        const outcome = await orch.tick()
        if (outcome.kind === 'proposal-decided' && outcome.taskId === c.id) {
          expect(outcome.leverPosition).toBe(c.position)
          expect(outcome.newStatus).toBe(c.expectedStatus)
          decided = true
        }
        if (outcome.kind === 'idle' && outcome.allDone) break
      }
      expect(decided).toBe(true)

      // 4. Disk state matches the decision.
      const afterTick = await readQueue()
      const final = afterTick.tasks.find((t) => t.id === c.id)!
      expect(final.status).toBe(c.expectedStatus)

      // 5. PROGRESS.md records the promotion with the governing lever.
      const progress = await fs.readFile(progressPath, 'utf-8')
      expect(progress).toContain(`Proposal ${c.id}: proposed → ${c.expectedStatus}`)
      expect(progress).toContain(`lever=${c.position}`)
    }
  })
})

// ---------------------------------------------------------------------------
// AC-16 end-to-end:
//   A worker calls pre-reject-task. The task moves to `shelved` with
//   source=worker_pre_rejection WITHOUT incrementing revisionCount. The
//   orchestrator's next tick then applies pre_rejection_policy: under
//   `terminal_shelved` the task stays shelved; under `requeue_lower_priority`
//   it comes back as `ready` at a lowered priority with requeueCount bumped.
// ---------------------------------------------------------------------------
describe('E2E AC-16: worker pre-rejection → pre_rejection_policy applied on tick', () => {
  it('shelves the task, leaves revisionCount untouched, then applies the lever on the next tick', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )

    // First leg: pre_rejection_policy=terminal_shelved → stays shelved.
    const settingsTerminal = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settingsTerminal.domains.default.pre_rejection_policy = {
      position: 'terminal_shelved',
      rationale: 'AC-16 leg 1',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings: settingsTerminal,
    })

    const now = '2026-04-20T00:00:00Z'
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-terminal',
          title: 'Worker says no-op',
          description: 'Details',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          assignedTo: 'worker-agent',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-requeue',
          title: 'Worker says duplicate',
          description: 'Details',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'high',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          assignedTo: 'worker-agent',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    // Worker calls pre-reject-task (the real tool) on the first task.
    const pr1 = await preRejectTask({
      tasksPath,
      taskId: 'task-terminal',
      code: 'no_op',
      detail: 'spec is already satisfied by an earlier change',
      rejectedBy: 'worker-agent',
    })
    expect(pr1.success).toBe(true)

    // Immediately after the tool call the task is shelved via worker path,
    // but policyApplied is still false — the orchestrator hasn't run yet.
    // Critically, revisionCount must be untouched (FR-22).
    const afterReject1 = await readQueue()
    const shelved1 = afterReject1.tasks.find((t) => t.id === 'task-terminal')!
    expect(shelved1.status).toBe('shelved')
    expect(shelved1.revisionCount).toBe(0)
    expect(shelved1.shelveReason?.source).toBe('worker_pre_rejection')
    expect(shelved1.shelveReason?.policyApplied).toBe(false)
    expect(shelved1.shelveReason?.code).toBe('no_op')

    // Orchestrator tick → applyPreRejectionPolicy under terminal_shelved
    // keeps the task shelved and flips policyApplied=true.
    const config = resolveBootstrapped()
    const orch = new Orchestrator({
      config,
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: { looma: stubAgent('looma-coordinator') },
      },
      idleShutdownAfterTicks: 3,
    })

    let terminalDecided = false
    for (let i = 0; i < 8 && !terminalDecided; i++) {
      const outcome = await orch.tick()
      if (outcome.kind === 'pre-rejection-applied' && outcome.taskId === 'task-terminal') {
        expect(outcome.domainLeverPosition).toBe('terminal_shelved')
        terminalDecided = true
      }
      if (outcome.kind === 'idle' && outcome.allDone) break
    }
    expect(terminalDecided).toBe(true)

    const afterTick1 = await readQueue()
    const settled1 = afterTick1.tasks.find((t) => t.id === 'task-terminal')!
    expect(settled1.status).toBe('shelved')
    expect(settled1.revisionCount).toBe(0)
    expect(settled1.shelveReason?.policyApplied).toBe(true)

    // Second leg: flip pre_rejection_policy=requeue_lower_priority, then
    // pre-reject task-requeue. The next tick should bring it back to
    // `ready` with a lower priority and requeueCount=1.
    const settingsRequeue = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settingsRequeue.domains.default.pre_rejection_policy = {
      position: 'requeue_lower_priority',
      rationale: 'AC-16 leg 2',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings: settingsRequeue,
    })

    const pr2 = await preRejectTask({
      tasksPath,
      taskId: 'task-requeue',
      code: 'duplicate',
      detail: 'another in-flight task overlaps',
      rejectedBy: 'worker-agent',
    })
    expect(pr2.success).toBe(true)

    let requeueDecided = false
    for (let i = 0; i < 8 && !requeueDecided; i++) {
      const outcome = await orch.tick()
      if (outcome.kind === 'pre-rejection-applied' && outcome.taskId === 'task-requeue') {
        expect(outcome.domainLeverPosition).toBe('requeue_lower_priority')
        requeueDecided = true
      }
      if (outcome.kind === 'idle' && outcome.allDone) break
    }
    expect(requeueDecided).toBe(true)

    const afterTick2 = await readQueue()
    const settled2 = afterTick2.tasks.find((t) => t.id === 'task-requeue')!
    expect(settled2.status).toBe('ready')
    expect(settled2.revisionCount).toBe(0) // FR-22: NEVER bumped by pre-rejection.
    expect(settled2.priority).toBe('normal') // high → normal under requeue_lower_priority.
    expect(settled2.shelveReason?.requeueCount).toBe(1)
    expect(settled2.shelveReason?.policyApplied).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC-21 end-to-end:
//   With agent_health_strictness: strict, a registered worker that stops
//   emitting FR-16 events for >45s surfaces as a `stall` remediation trigger
//   on the next tick. The coordinator is invoked with a RemediationContext
//   that carries the stall flag AND the strictness lever, and the chosen
//   action is authorized + recorded via the FR-32 pathway.
// ---------------------------------------------------------------------------
describe('E2E AC-21: stall (>45s silence under strict) → coordinator remediation', () => {
  it('raises a stall trigger, builds a stall-context for the coordinator, and records the decision', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )

    // Strict liveness + auto remediation so the coordinator's chosen action
    // executes without confirmation, keeping this test focused on the
    // stall → context → decision path.
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.agent_health_strictness = {
      position: 'strict',
      rationale: 'AC-21 test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.project.remediation_autonomy = {
      position: 'auto',
      rationale: 'AC-21 test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    // Seed a task in_progress with a worker. Same shape as the AC-22 test.
    const now = '2026-04-20T00:00:00Z'
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-001',
          title: 'Render the report',
          description: 'Details',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          assignedTo: 'worker-agent',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    // Inject a LivenessTracker with a controllable clock so we can simulate
    // >45s of silence without sleeping. The orchestrator's refreshLiveness­
    // Strictness() will still read `strict` out of agent-settings.yaml and
    // call setStrictness on this same tracker.
    const registeredAtMs = Date.UTC(2026, 3, 20, 0, 0, 0)
    let currentClockMs = registeredAtMs
    const liveness = new LivenessTracker({
      strictness: 'standard',
      now: () => currentClockMs,
    })

    const config = resolveBootstrapped()
    const orch = new Orchestrator({
      config,
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: {
          looma: stubAgent('looma-coordinator'),
        },
      },
      liveness,
      idleShutdownAfterTicks: 2,
    })

    // Pull `strict` into the tracker from agent-settings.yaml (this is what
    // a real orchestrator tick does before scanning stalls).
    await orch.refreshLivenessStrictness()

    // Register the worker at t=T0, then advance the mock clock 46s forward
    // — one second past the 45s strict stall threshold.
    orch.liveness.register('worker-agent', 'task-001')
    currentClockMs = registeredAtMs + 46_000
    const scanAtMs = currentClockMs

    const triggers = await orch.collectRemediationTriggers(scanAtMs)
    const stallTriggers = triggers.filter((t) => t.kind === 'stall')
    // With a just-registered agent at "now" and a 46s-forward scan, exactly
    // one stall trigger should fire for this worker.
    expect(stallTriggers).toHaveLength(1)
    const stall = stallTriggers[0]!
    if (stall.kind !== 'stall') throw new Error('unreachable')
    expect(stall.taskId).toBe('task-001')
    expect(stall.agentId).toBe('worker-agent')
    expect(stall.flag.strictness).toBe('strict')
    expect(stall.flag.silentMs).toBeGreaterThanOrEqual(45_000)

    // The coordinator is "invoked" — in this test we model the invocation
    // as buildRemediationContextFor returning a full context bundle with
    // the stall trigger AND the strictness lever. That is the interface the
    // serve-layer coordinator agent consumes verbatim.
    const ctx = await orch.buildRemediationContextFor(stall)
    expect(ctx.trigger.kind).toBe('stall')
    expect(ctx.taskId).toBe('task-001')
    expect(ctx.leverState.remediationAutonomy).toBe('auto')
    expect(ctx.leverState.agentHealthStrictness).toBe('strict')

    // Coordinator chooses a non-destructive recovery action; under
    // remediation_autonomy=auto this goes autonomous.
    const action = {
      kind: 'restart_from_checkpoint' as const,
      rationale: 'worker went silent past the strict threshold',
    }
    const auth = orch.authorizeRemediation(action, ctx)
    expect(auth).toEqual({ kind: 'autonomous' })

    await orch.recordRemediation({
      context: ctx,
      action,
      authorization: auth,
      decidedBy: 'looma',
    })

    // AC-24-adjacent proof: the DECISIONS.md entry captures trigger type,
    // chosen action, and lever state including agent_health_strictness.
    const decisions = await fs.readFile(
      path.join(memoryDir, 'DECISIONS.md'),
      'utf-8',
    )
    expect(decisions).toMatch(/Remediation: restart_from_checkpoint \(stall trigger\)/)
    expect(decisions).toMatch(/agent_health_strictness=strict/)

    // The task's remediationAttempts was bumped by the decision record.
    const finalQueue = await readQueue()
    expect(finalQueue.tasks[0]!.remediationAttempts).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// AC-23 end-to-end:
//   Worker writes a checkpoint and then "crashes" (never flushes liveness).
//   On orchestrator scan, the task surfaces as a reclaim candidate, the
//   coordinator selects restart_from_checkpoint, and the checkpoint rehydrates
//   cleanly with the correct `next_planned_action`.
// ---------------------------------------------------------------------------
describe('E2E AC-23: crash → checkpoint → reclaim → restart_from_checkpoint', () => {
  it('treats a task with a live checkpoint but dead worker as a reclaim candidate and restores next_planned_action', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )

    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'auto',
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.domains.default.crash_recovery_default = {
      position: 'prefer_resume',
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    const now = '2026-04-20T00:00:00Z'
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-001',
          title: 'Run the migration',
          description: 'Details',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          assignedTo: 'worker-dead',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    // Step 1: worker writes a checkpoint mid-task.
    const cp = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-dead',
      intent: 'running step 3 of migration',
      nextPlannedAction: 'apply the backfill DDL and verify row count',
      filesTouched: ['migrations/0042_backfill.sql'],
    })
    expect(cp.success).toBe(true)
    expect(cp.step).toBe(1)

    const onDisk = await readCheckpoint(memoryDir, 'task-001')
    expect(onDisk?.nextPlannedAction).toBe(
      'apply the backfill DDL and verify row count',
    )

    // Step 2: simulate a restart — fresh orchestrator, worker-dead is NOT
    // registered in the liveness tracker. scanReclaimCandidates surfaces it.
    const config = resolveBootstrapped()
    const orch = new Orchestrator({
      config,
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: {
          looma: stubAgent('looma-coordinator'),
        },
      },
      idleShutdownAfterTicks: 2,
    })
    // Deliberately do NOT call orch.liveness.register('worker-dead', ...).

    const candidates = await orch.scanReclaimCandidates()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.task.id).toBe('task-001')
    expect(candidates[0]!.checkpoint?.nextPlannedAction).toBe(
      'apply the backfill DDL and verify row count',
    )
    expect(candidates[0]!.autoEscalate).toBe(false)

    // Step 3: collectRemediationTriggers → includes a `crash` trigger that
    // carries the checkpoint. buildRemediationContextFor attaches it to the
    // context so the coordinator (and DECISIONS.md) reflect the checkpoint.
    const triggers = await orch.collectRemediationTriggers()
    const crash = triggers.find((t) => t.kind === 'crash')
    expect(crash).toBeDefined()
    if (crash?.kind !== 'crash') throw new Error('type narrow')

    const ctx = await orch.buildRemediationContextFor(crash)
    expect(ctx.trigger.kind).toBe('crash')
    expect(ctx.checkpoint?.nextPlannedAction).toBe(
      'apply the backfill DDL and verify row count',
    )
    expect(ctx.checkpoint?.step).toBe(1)
    expect(ctx.leverState.crashRecoveryDefault).toBe('prefer_resume')

    // Step 4: coordinator chooses restart_from_checkpoint. Under
    // remediation_autonomy=auto + a fresh checkpoint (<24h), this runs
    // autonomously.
    const action = {
      kind: 'restart_from_checkpoint' as const,
      rationale:
        'prefer_resume + fresh checkpoint — resume from next_planned_action',
    }
    const auth = orch.authorizeRemediation(action, ctx)
    expect(auth).toEqual({ kind: 'autonomous' })

    await orch.recordRemediation({
      context: ctx,
      action,
      authorization: auth,
      decidedBy: 'looma',
    })

    const decisions = await fs.readFile(
      path.join(memoryDir, 'DECISIONS.md'),
      'utf-8',
    )
    expect(decisions).toMatch(/Remediation: restart_from_checkpoint \(crash trigger\)/)
    expect(decisions).toMatch(/checkpoint=step 1/)
    expect(decisions).toMatch(/prior_attempts=0/)
    expect(decisions).toMatch(/crash_recovery_default=prefer_resume/)
    expect(decisions).toMatch(/autonomous — executed immediately/)

    // Step 5: after the remediation is recorded, the queue reflects the
    // attempt and the checkpoint is still readable for the next agent to
    // rehydrate from next_planned_action (FR-20 session rehydrate).
    const finalQueue = await readQueue()
    expect(finalQueue.tasks[0]!.remediationAttempts).toBe(1)

    const rehydrateSource = await readCheckpoint(memoryDir, 'task-001')
    expect(rehydrateSource?.nextPlannedAction).toBe(
      'apply the backfill DDL and verify row count',
    )
    expect(rehydrateSource?.filesTouched).toEqual([
      'migrations/0042_backfill.sql',
    ])
  })

  it('flags a checkpoint older than 24h as autoEscalate and requires confirmation even under auto', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      `name: E2E Workspace\nid: e2e-workspace\ncoordinators:\n  - id: looma\n    name: Looma\n    domain: looma\n    mandate: UI\n`,
      'utf-8',
    )

    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'auto',
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    const now = '2026-04-18T00:00:00Z' // >24h before the reclaim scan
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-old',
          title: 'Stale migration',
          description: 'Details',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          assignedTo: 'worker-ancient',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-old',
      agentId: 'worker-ancient',
      intent: 'started the migration two days ago',
      nextPlannedAction: 'verify row count',
      filesTouched: [],
    })

    // Manually backdate the checkpoint's writtenAt so the age calculation
    // exceeds 24h. writeCheckpoint stamps `new Date().toISOString()` — we
    // rewrite the file to control the timestamp.
    const cpPath = path.join(
      memoryDir,
      'tasks',
      'task-old',
      'checkpoint.json',
    )
    const raw = JSON.parse(await fs.readFile(cpPath, 'utf-8'))
    raw.writtenAt = '2026-04-19T00:00:00Z'
    await fs.writeFile(cpPath, JSON.stringify(raw, null, 2), 'utf-8')

    const config = resolveBootstrapped()
    const orch = new Orchestrator({
      config,
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent'),
        reviewer: stubAgent('reviewer-agent'),
        gateChecker: stubAgent('gate-checker-agent'),
        coordinators: {
          looma: stubAgent('looma-coordinator'),
        },
      },
      idleShutdownAfterTicks: 2,
    })

    // Now = 2026-04-20T00:00:00Z → checkpoint is ~24h old.
    const nowMs = Date.parse('2026-04-20T00:00:00Z')
    const candidates = await orch.scanReclaimCandidates(nowMs)
    expect(candidates[0]!.autoEscalate).toBe(true)

    const triggers = await orch.collectRemediationTriggers(nowMs)
    const crash = triggers.find((t) => t.kind === 'crash')
    if (crash?.kind !== 'crash') throw new Error('expected crash trigger')

    const ctx = await orch.buildRemediationContextFor(crash)
    const auth = orch.authorizeRemediation(
      { kind: 'restart_from_checkpoint', rationale: 'resume' },
      ctx,
    )
    expect(auth.kind).toBe('requires_confirm')
    if (auth.kind === 'requires_confirm') {
      expect(auth.reason).toMatch(/24h/)
    }
  })
})
