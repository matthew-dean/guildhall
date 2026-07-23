import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createExploringTask,
  approveSpec,
  reframeTask,
  resumeExploring,
  createBugReportTask,
  parseStackTraceTopFile,
} from '../intake.js'
import { registerContractSurface } from '../contract-surfaces.js'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import { raiseEscalation } from '@guildhall/tools'
import {
  getProjectStateDir,
  getProjectSystemStatePathFromMemoryDir,
  getProjectTranscriptPath,
  readTaskRuntimeStore,
} from '@guildhall/sessions'
import { listOwnerInputRequests } from '../owner-input-store.js'
import { buildEffectiveTask } from '../effective-task.js'
import { applyProjectMigrations } from '../migrations.js'
import {
  readProjectTaskQueueForMutationSync,
  readProjectTaskQueueSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
  writeProjectTaskQueueWithSummary,
} from '../project-state-boundary.js'

// ---------------------------------------------------------------------------
// FR-12 exploratory task intake
//
// Verifies that a fuzzy ask becomes an `exploring` task with a seeded
// transcript, that approve-spec advances a reviewed spec, and that a resume can
// resolve a blocking escalation and append a follow-up message.
// ---------------------------------------------------------------------------

let tmpDir: string
let dataDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-intake-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  bootstrapWorkspace(tmpDir, { name: 'Intake Test' })
  memoryDir = getProjectStateDir(tmpDir)
  tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  writeProjectTaskQueueWithSummary(tasksPath, {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [],
  }, { projectRoot: tmpDir })
  const prerequisites = await applyProjectMigrations({ projectRoot: tmpDir, includePrompt: true })
  expect(prerequisites.failed).toEqual([])
  const finalize = await applyProjectMigrations({
    projectRoot: tmpDir,
    only: ['0.13.0/project-state-finalize'],
  })
  expect(finalize.failed).toEqual([])
  const cleanup = await applyProjectMigrations({
    projectRoot: tmpDir,
    only: ['0.13.0/project-state-legacy-live-file-cleanup'],
  })
  expect(cleanup.failed).toEqual([])
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const queue = TaskQueue.parse(readProjectTaskQueueSync(tasksPath))
  return {
    ...queue,
    tasks: await Promise.all(queue.tasks.map(async task => {
      return buildEffectiveTask(tmpDir, task, { evidence: 'full' }) as unknown as typeof task
    })),
  }
}

async function writeQueue(queue: TaskQueue): Promise<void> {
  const current = readProjectTaskQueueForMutationSync(tasksPath)
  writeProjectTaskQueue(tasksPath, queue, {
    projectRoot: tmpDir,
    expectedQueueRevision: current.expectedQueueRevision,
  })
}

function buildableSpec(extra = ''): string {
  return [
    '## Summary',
    'Add a ghost button variant.',
    '## Acceptance Criteria',
    '1. Renders.',
    '## Completion Boundary',
    'Product outcome: Users can choose a ghost button style where this task applies.',
    'What Guildhall can complete in code: Add the repo-local button styling and usage contract.',
    'External dependencies: None.',
    'Owner-only setup: None.',
    'Verification environment: Local automated tests and review in the app.',
    'What counts as done: The ghost button variant renders and can be reviewed locally.',
    'What must be split or blocked: Nothing to split.',
    extra,
  ].filter(Boolean).join('\n')
}

function boundedStructuredSpec(splitPolicy: 'none' | 'conditional' | 'required' = 'none') {
  return {
    whatThisIs: 'A bounded source-backed task.',
    problemContext: 'The task needs one explicit completion boundary.',
    goals: ['Implement the bounded outcome.'],
    nonGoals: ['Do not expand into unrelated work.'],
    proposedDesign: 'Use the existing project surface.',
    keyDecisions: ['Keep the proof attached to this task.'],
    acceptanceCriteria: [{
      scenario: 'Given the task boundary, when the work is complete',
      expectation: 'Then the bounded outcome is available.',
      verificationMode: 'review' as const,
    }],
    verification: ['Run the task-specific proof.'],
    completionBoundary: {
      productOutcome: 'The bounded outcome is available.',
      whatGuildhallCanCompleteInCode: 'Implement the task boundary.',
      externalDependencies: 'None known.',
      ownerOnlySetup: 'None known.',
      verificationEnvironment: 'The registered local project.',
      whatCountsAsDone: 'The bounded outcome is proven.',
      whatMustBeSplitOrBlocked: 'No split is required for this task.',
      splitPolicy,
    },
  }
}

describe('createExploringTask', () => {
  it('creates a new task in exploring status and seeds the transcript', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'Add a ghost button variant',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    expect(result.transcriptPath).toBe(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
    )

    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.description).toBe('Add a ghost button variant')
    expect(task.domain).toBe('looma')
    expect(task.title).toBe('Add a ghost button variant')

    const transcript = await fs.readFile(result.transcriptPath, 'utf-8')
    expect(transcript).toContain('Add a ghost button variant')
    expect(transcript).toContain('user')
  })

  it('persists invoking-surface source references on a new task', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'Re-intake the current release from its documented project sources.',
      domain: 'looma',
      projectPath: '/projects/looma',
      sourceRefs: ['docs/project-brief.md', 'docs/current-release.md', 'docs/project-brief.md'],
    })

    const queue = await readQueue()
    expect(queue.tasks[0]?.references).toEqual([
      'docs/project-brief.md',
      'docs/current-release.md',
    ])
  })

  it('attaches an automatic pressure-test summary to small tasks', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'Update the README install command.',
      domain: 'docs',
      projectPath: '/projects/docs',
    })

    const queue = await readQueue()
    expect(queue.tasks[0]?.requestIntake?.pressureTestSummary).toMatchObject({
      systemOwned: true,
      degree: 'automatic',
      qualityBar: 'Apply enough pressure to make this task trustworthy without asking the owner to choose a process.',
    })
    expect(queue.tasks[0]?.requestIntake?.pressureTestSummary?.checks.map(check => check.id)).toEqual([
      'owner-intent',
      'scope-boundary',
      'acceptance-criteria',
      'verification',
      'review-lenses',
      'release-boundary',
    ])
    expect(queue.tasks[0]?.requestIntake?.pressureTestSummary?.ownerQuestionPolicy).toContain(
      'Only ask when the answer could change product intent',
    )
    expect(queue.tasks[0]?.requestIntake?.assumptions).toEqual(expect.arrayContaining([
      'Routine implementation details should be inferred from repo evidence unless owner judgment would materially change the work.',
    ]))
    expect(queue.tasks[0]?.requestIntake?.evidenceRefs).toEqual(['request:title', 'request:ask'])
  })

  it('adds design-quality pressure to UI tasks before implementation', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'Build a Pantry Pulse web app page with all-items and expiring-soon filters.',
      domain: 'product',
      projectPath: '/projects/pantry-pulse',
      title: 'Pantry Pulse app spec',
    })

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.requestIntake?.componentStack.map(component => component.kind)).toContain('ui_surface')
    expect(task.requestIntake?.pressureTestSummary?.checks.map(check => check.id)).toEqual(expect.arrayContaining([
      'design-system',
      'interaction-semantics',
      'palette-direction',
      'visual-proof',
    ]))
    expect(task.requestIntake?.pressureTestSummary?.checks.find(check => check.id === 'interaction-semantics')).toMatchObject({
      status: 'system-check',
      reason: expect.stringContaining('segmented control'),
    })
    expect(task.requestIntake?.assumptions).toEqual(expect.arrayContaining([
      'UI quality, interaction semantics, and visual proof are part of the acceptance bar for this request.',
    ]))
    expect(task.requestIntake?.evidenceRefs).toEqual(['request:title', 'request:ask'])
  })

  it('writes the canonical queue after intake', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'canonical format',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    expect(readProjectTaskQueueSync(tasksPath)).toMatchObject({
      tasks: [expect.objectContaining({ id: 'task-001' })],
    })
  })

  it('generates sequential ids when called multiple times', async () => {
    const a = await createExploringTask({
      memoryDir,
      ask: 'first',
      domain: 'looma',
      projectPath: '/x',
    })
    const b = await createExploringTask({
      memoryDir,
      ask: 'second',
      domain: 'looma',
      projectPath: '/x',
    })
    expect(a.taskId).toBe('task-001')
    expect(b.taskId).toBe('task-002')
  })

  it('respects an explicit task id override', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'x',
      domain: 'looma',
      projectPath: '/x',
      taskId: 'custom-id',
    })
    expect(result.taskId).toBe('custom-id')
  })

  it('keeps unbroken long asks complete in description instead of storing a fake cropped title', async () => {
    const long = 'x'.repeat(200)
    await createExploringTask({ memoryDir, ask: long, domain: 'looma', projectPath: '/x' })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('New request')
    expect(queue.tasks[0]!.description).toBe(long)
  })

  it('stores complete normal-language long asks instead of cropping titles', async () => {
    const ask = 'What commands should I run to smoke test this project without changing files?'
    await createExploringTask({ memoryDir, ask, domain: 'meta', projectPath: '/x' })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe(ask)
    expect(queue.tasks[0]!.title).not.toContain('...')
    expect(queue.tasks[0]!.description).toBe(ask)
  })

  it('uses explicit title when provided', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'some long ask that should not be used as the title',
      domain: 'looma',
      projectPath: '/x',
      title: 'Short Title',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('Short Title')
  })

  it('classifies ambiguous policy requests and asks whether the user wants spec or implementation', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
      domain: 'policy',
      projectPath: '/projects/fll',
      title: 'Set FLL overhead charge policy',
    })

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.requestIntake).toMatchObject({
      intent: 'ambiguous_spec_or_implementation',
      recommendedNextAction: 'ask_clarifying_question',
      ownerDecisionNeeded: expect.stringContaining('policy/spec'),
      whyOwnerDecisionMatters: expect.stringContaining('parent feature plan'),
      missingInformation: [
        'Whether the owner wants policy drafting only or also wants linked implementation planning/work.',
      ],
      pressureTestSummary: {
        systemOwned: true,
        degree: 'guided',
      },
    })
    expect(task.requestIntake?.componentStack.map(component => component.kind)).toEqual([
      'policy_decision',
      'documented_spec',
      'implementation',
      'verification',
    ])
    expect(task.openQuestions ?? []).toEqual([])
    const ownerInputRequests = await listOwnerInputRequests(tmpDir)
    expect(ownerInputRequests).toHaveLength(1)
    expect(ownerInputRequests[0]).toMatchObject({
      source: { kind: 'request_intake', intakeId: result.taskId, questionId: 'policy-request-scope' },
      objective: { kind: 'new_request', label: 'Clarify policy request scope' },
      prompt: expect.stringContaining('draft the FLL overhead policy first'),
      choices: [
        'Draft the policy/spec first',
        'Draft the policy and create linked implementation tasks',
        'Apply the policy now',
      ],
    })
    expect(task.requestIntake?.evidenceRefs).toEqual(['request:title', 'request:ask'])
  })

  it('does not reuse the FLL policy question for concrete app specs', async () => {
    await createExploringTask({
      memoryDir,
      ask: [
        '# Pantry Pulse App Spec',
        '',
        'Build a small local web app that tracks pantry items, highlights what expires soon, filters expiring items, and lets the user mark an item as used.',
        '',
        'The app is complete only when the visible behavior works in the browser and the proof path records the browser checks.',
      ].join('\n'),
      domain: 'product',
      projectPath: '/projects/pantry-pulse',
      title: 'Pantry Pulse app spec',
    })

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.requestIntake).toMatchObject({
      intent: 'implementation',
      recommendedNextAction: 'proceed_to_implementation_spec',
    })
    expect(task.requestIntake?.missingInformation).toEqual([])
    expect(task.openQuestions ?? []).toEqual([])
    expect(JSON.stringify(task.requestIntake)).not.toContain('FLL overhead')
  })

  it('rejects reusing an existing task id', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'first',
      domain: 'looma',
      projectPath: '/x',
      taskId: 'same',
    })
    await expect(
      createExploringTask({
        memoryDir,
        ask: 'second',
        domain: 'looma',
        projectPath: '/x',
        taskId: 'same',
      }),
    ).rejects.toThrow(/already exists/)
  })
})

describe('reframeTask', () => {
  it('clears stale task classification and derived planning state', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'Build the synopsis generation pipeline',
      domain: 'docs',
      projectPath: '/projects/narrative-harness',
    })
    const mutation = writePromotedTaskDetailMutation(tasksPath, result.taskId, {
      projectRoot: tmpDir,
      mutate: task => ({
        ...task,
        taskKind: 'research',
      }),
    })
    expect(mutation).not.toBeNull()

    const reframed = await reframeTask({
      memoryDir,
      taskId: result.taskId,
      reason: 'The old imported classification is stale.',
    })

    expect(reframed.success).toBe(true)
    const updated = await readQueue()
    const reframedTask = updated.tasks.find(candidate => candidate.id === result.taskId)!
    expect(reframedTask.status).toBe('exploring')
    expect(reframedTask.taskKind).toBeUndefined()
  })

  it('keeps proof-specific recovery attached to a proof reframe', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'Recover the selected release proof command',
      domain: 'docs',
      projectPath: '/projects/narrative-harness',
    })

    const reframed = await reframeTask({
      memoryDir,
      taskId: result.taskId,
      recoveryKind: 'proof',
      reason: 'The selected release requires a concrete project-backed proof command.',
    })

    expect(reframed.success).toBe(true)
    const runtime = await readTaskRuntimeStore(tmpDir)
    expect(runtime.tasks[result.taskId]?.proofRecovery?.kind).toBe('proof')
    expect(runtime.tasks[result.taskId]?.proofRecovery?.reason).toContain('project-backed proof command')
  })
})

describe('approveSpec', () => {
  beforeEach(async () => {
    // Create and then attach a spec
    await createExploringTask({
      memoryDir,
      ask: 'Add ghost button',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    const queue = await readQueue()
    queue.tasks[0]!.status = 'spec_review'
    queue.tasks[0]!.spec = buildableSpec()
    queue.tasks[0]!.structuredSpec = boundedStructuredSpec()
    queue.tasks[0]!.productBrief = {
      userJob: 'Use a lower-emphasis button action.',
      successMetric: 'A ghost button variant is available and reviewable.',
      antiPatterns: [],
      authoredBy: 'spec-agent',
      authoredAt: new Date().toISOString(),
    }
    queue.tasks[0]!.acceptanceCriteria = [
      { id: 'AC-1', description: 'Ghost button renders.', verifiedBy: 'review', met: false },
    ]
    await writeQueue(queue)
  })

  it('transitions spec_review → ready', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('ready')
  })

  it('keeps the approved spec and materializes missing script proof as linked verification work', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.releaseIds = ['release-1']
    queue.selectedReleaseId = 'release-1'
    queue.releases = [{
      id: 'release-1',
      label: 'Stage 1',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: [],
      deferredNodeIds: [],
      proofStyle: 'script_only',
    }]
    task.acceptanceCriteria = [{
      id: 'AC-1',
      description: 'The focused proof passes.',
      verifiedBy: 'automated',
      command: 'pnpm proof',
      met: false,
    }]
    const approvedSpec = task.spec
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: task.id })

    expect(result).toEqual({ success: true, newStatus: 'ready' })
    const updated = await readQueue()
    const parent = updated.tasks.find(candidate => candidate.id === task.id)!
    const proofSetup = updated.tasks.find(candidate => candidate.workKind === 'verification')
    expect(parent.status).toBe('ready')
    expect(parent.spec).toBe(approvedSpec)
    expect(parent.acceptanceCriteria[0]?.command).toBeUndefined()
    expect(parent.acceptanceCriteria[0]?.verificationState).toBe('stale')
    expect(proofSetup).toMatchObject({
      title: 'Establish concrete proof for Add ghost button',
      // This is generated, bounded verification work, not a fresh request
      // that needs another exploratory/spec loop.
      status: 'ready',
      hierarchy: { parentId: task.id },
      releaseIds: ['release-1'],
      workVisibility: { kind: 'internal_step', countInProjectTotals: false },
    })
    expect(parent.hierarchy?.childIds).toContain(proofSetup?.id)
    expect(parent.notes.some(note => note.content.includes('Kept the approved product/spec boundary'))).toBe(true)
    expect((await readTaskRuntimeStore(tmpDir)).tasks[task.id]?.proofRecovery).toBeUndefined()
  })

  it('derives the product brief from a complete completion boundary before approval', async () => {
    const queue = await readQueue()
    delete queue.tasks[0]!.productBrief
    queue.tasks[0]!.structuredSpec = {
      ...boundedStructuredSpec(),
      completionBoundary: {
        ...boundedStructuredSpec().completionBoundary,
        productOutcome: 'A developer can run the fixture loop and inspect a saved run record.',
        whatGuildhallCanCompleteInCode: 'Add the script and local proof.',
        verificationEnvironment: 'Local Node.js command.',
        whatCountsAsDone: 'The fixture loop exits 0 and saves reviewer and writer output.',
        whatMustBeSplitOrBlocked: 'Real LLM calls belong to a later stage.',
      },
    }
    queue.tasks[0]!.spec = [
      '## Summary',
      '',
      'Run a deterministic backend harness script.',
      '',
      '## Completion Boundary',
      '- Product outcome: A developer can run the fixture loop and inspect a saved run record.',
      '- What Guildhall can complete in code: Add the script and local proof.',
      '- External dependencies: None.',
      '- Owner-only setup: None.',
      '- Verification environment: Local Node.js command.',
      '- What counts as done: The fixture loop exits 0 and saves reviewer and writer output.',
      '- What must be split or blocked: Real LLM calls belong to a later stage.',
      '',
      '## Acceptance Criteria',
      '1. The fixture loop exits 0.',
    ].join('\n')
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('ready')
    expect(updated.tasks[0]!.productBrief).toMatchObject({
      userJob: 'A developer can run the fixture loop and inspect a saved run record.',
      successMetric: 'The fixture loop exits 0 and saves reviewer and writer output.',
      authoredBy: 'system:completion-boundary',
    })
  })

  it('approves an explicit contract task when no child work is materialized', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.title = 'Define fixture, expected-record, prototype-run, and evaluation contracts'
    queue.tasks[0]!.hierarchy = { parentId: 'task-parent', childIds: [] }
    queue.tasks[0]!.spec = [
      '## Summary',
      'Define the concrete fixture, expected-record, prototype-run, and evaluation contract surface for this Stage 1 harness work.',
      '',
      'Contract terms to account for:',
      '- `FixtureManifest`',
      '- `ExpectedRecordSet`',
      '- `ExpectedSignal`',
      '- `PrototypeRun`',
      '- `RunEvaluation`',
      '- `PacketQualityScore`',
      '',
      '## Acceptance Criteria',
      '1. Given the current schema files and imported parent spec, when this task is implemented, then the repo defines or verifies each relevant contract term listed above without introducing a second parallel contract surface.',
      '2. Given the Stage 1 fixture harness boundary, when fixture and expected-record contracts are reviewed, then they can express a tiny fiction fixture, author/profile permissions, expected records, and expected signals.',
      '3. Given the prototype run and evaluation boundary, when run/evaluation contracts are reviewed, then they capture run output, signal evaluation, packet quality or field usage, and trace evidence needed for the first proof loop.',
      '4. Given the implementation is complete, when the local proof command runs, then Guildhall records the exact command and result against this task before the parent work is treated as satisfied.',
      '',
      '## Out of Scope',
      '- Do not introduce Rust contracts for this TypeScript project.',
      '- Do not add UI copy or API endpoints for this contract-only child task.',
      '',
      '## Completion Boundary',
      '- Product outcome: Contract terms are represented by concrete TypeScript schema/record contracts and proof evidence.',
      '- What Guildhall can complete in code: schema/type updates, fixture or evaluation record updates, exports, and local proof scripts/tests needed for this child work.',
      '- External dependencies: None known.',
      '- Owner-only setup: None known.',
      '- Verification environment: the local checkout and repo-local package scripts.',
      '- What counts as done: the contract terms above are defined or verified, acceptance criteria are checked, and the proof result is recorded.',
      '- What must be split or blocked: any newly discovered product decision that changes which contracts belong in Stage 1 versus a later stage.',
    ].join('\n')
    queue.tasks[0]!.acceptanceCriteria = []
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('ready')
    expect(updated.tasks[0]!.sizePlan?.action).toBe('proceed')
    expect(updated.tasks[0]!.sizePlan?.recommendedChildren ?? []).toEqual([])
  })

  it('persists task readiness and finishability artifacts when a spec is approved', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.proofPaths = [{ id: 'proof-ghost-button' }]
    await writeQueue(queue)

    await approveSpec({ memoryDir, taskId: 'task-001' })

    const updated = await readQueue()
    expect(updated.tasks[0]!.taskReadiness?.recommendation).toBe('ready')
    expect(updated.tasks[0]!.definitionOfDone?.items.length).toBeGreaterThan(0)
    expect(updated.tasks[0]!.blockerPlans?.length).toBeGreaterThan(0)
    expect(updated.tasks[0]!.contextBudget?.fitsInOneWorkerBrief).toBe(true)
    expect(updated.tasks[0]!.decomposition?.action).toBe('keep')
  })

  it('generates contract-surface review packets from structured spec deltas during approval', async () => {
    await registerContractSurface({
      id: 'design-system.tokens-and-variants',
      label: 'Design tokens and variants',
      kind: 'design_system',
      owningProject: { id: 'fixture-app', label: 'Fixture App', path: tmpDir },
      authority: 'shared',
      scope: 'project',
      sourceRefs: [{ kind: 'design_tokens', path: '.guildhall/design-system.yaml', summary: 'Approved token authority.' }],
      consumerRefs: [{ id: 'settings-panel', label: 'Settings panel' }],
      invariants: [{
        id: 'approved-variant-axis',
        label: 'Approved variant axis',
        rule: 'Interactive controls use approved variant axes instead of local synonyms.',
        proofObligations: ['Run component API tests for variant names.'],
      }],
      decisions: [],
      createdBy: 'test',
      now: '2026-06-02T12:00:00.000Z',
    })
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.structuredSpec = {
      whatThisIs: 'A design-system variant update.',
      problemContext: 'Two panels need the same low-emphasis action treatment.',
      goals: ['Extend the shared variant vocabulary.'],
      nonGoals: ['Do not add local button classes.'],
      proposedDesign: 'Add the variant through the shared button primitive.',
      keyDecisions: ['Keep styling owned by the design system.'],
      contractSurfaceDeltas: [{
        surfaceId: 'design-system.tokens-and-variants',
        relation: 'amends',
        summary: 'Adds a subdued action variant to the shared control vocabulary.',
        invariantRefs: ['approved-variant-axis'],
        proofObligations: ['Add a Button variant contract test.'],
      }],
      acceptanceCriteria: [{ scenario: 'Variant is used', expectation: 'The shared primitive owns it', verificationMode: 'automated' }],
      verification: ['pnpm vitest run src/web/lib/__tests__/Button.css-contract.test.ts'],
      completionBoundary: {
        productOutcome: 'Design-system consumers share one variant vocabulary.',
        whatGuildhallCanCompleteInCode: 'Update the shared primitive and tests.',
        externalDependencies: 'None.',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'Local unit tests.',
        whatCountsAsDone: 'The variant contract is tested.',
        whatMustBeSplitOrBlocked: 'Nothing.',
      },
    }
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: task.id })

    expect(result.success).toBe(true)
    const updated = await readQueue()
    expect(updated.tasks[0]?.contractSurfaceReviewPackets).toHaveLength(1)
    expect(updated.tasks[0]?.contractSurfaceReviewPackets?.[0]).toMatchObject({
      surface: {
        id: 'design-system.tokens-and-variants',
        label: 'Design tokens and variants',
      },
      currentSpecRef: 'task:task-001',
      currentDelta: {
        summary: 'Adds a subdued action variant to the shared control vocabulary.',
      },
    })
    expect(updated.tasks[0]?.contractSurfaceReviewPackets?.[0]?.proofObligations).toContain('Add a Button variant contract test.')
    expect(updated.tasks[0]?.notes.at(-1)?.content).toContain('Generated 1 contract-surface review packet')
  })

  it('approves specs where Completion Boundary is the final section', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = buildableSpec()
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('approves specs with markdown-formatted Completion Boundary labels', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = [
      '## Summary',
      'Build a tiny local app.',
      '## Acceptance Criteria',
      '1. It runs locally.',
      '## Completion Boundary',
      '- **Product outcome**: A user can open the local app.',
      '- **What Guildhall can complete in code**: Add the app source files.',
      '- **External dependencies**: None.',
      '- **Owner-only setup**: None.',
      '- **Verification environment**: Local browser.',
      '- **What counts as done**: The app renders in a browser.',
      '- **What must be split or blocked**: Nothing.',
    ].join('\n')
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('approves specs when the Completion Boundary colon is inside the markdown emphasis', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = [
      '## Summary',
      'Patch a local markdown file.',
      '## Acceptance Criteria',
      '1. The local file is updated.',
      '## Completion Boundary',
      '- **Product outcome:** The markdown file reflects the new note.',
      '- **What Guildhall can complete in code:** Append the requested note to the local file.',
      '- **External dependencies:** None. This is a local-only fixture change.',
      '- **Owner-only setup:** None. No manual steps are required.',
      '- **Verification environment:** Local filesystem on the current machine.',
      '- **What counts as done:** The file contains the requested note and only the intended file changed.',
      '- **What must be split or blocked:** Nothing. The task is self-contained.',
    ].join('\n')
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('approves specs with multiline Completion Boundary values and local dev dependencies', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = [
      '## Summary',
      'Build a tiny Vite app.',
      '## Acceptance Criteria',
      '1. It runs locally.',
      '## Completion Boundary',
      '- **Product outcome**: A user can open the app in a browser.',
      '- **What Guildhall can complete in code**: Add the app source files.',
      '- **External dependencies**: None. Vite is installed locally via npm and no external service is required.',
      '- **Owner-only setup**: None. Run npm install and npm run dev.',
      '- **Verification environment**: Local browser at http://localhost:5173.',
      '- **What counts as done**:',
      '  1. The app starts locally.',
      '  2. The browser shows the expected page.',
      '- **What must be split or blocked**: Nothing — this is a single self-contained task.',
    ].join('\n')
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('does not treat a local browser used for verification as an external runtime dependency', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = [
      '## Summary',
      'Build a dependency-free Pantry Pulse app.',
      '## Acceptance Criteria',
      '1. It renders locally.',
      '## Completion Boundary',
      '- **Product outcome**: A user can open index.html and manage pantry items locally.',
      '- **What Guildhall can complete in code**: Add the dependency-free index.html app.',
      '- **External dependencies**: A modern web browser is required to open and verify the app. The app itself has no runtime dependencies — no APIs, no CDN resources, no backend services, no credentials, no deployed infrastructure, and no network.',
      '- **Owner-only setup**: None. The app works by opening index.html directly.',
      '- **Verification environment**: Local browser or headless browser screenshot.',
      '- **What counts as done**: The app renders and passes browser inspection.',
      '- **What must be split or blocked**: Nothing.',
    ].join('\n')
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('approves tiny local repair specs when standard local tooling is already available', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = [
      '## Summary',
      'Repair the seeded helper copy.',
      '## Acceptance Criteria',
      '1. node scripts/test.js exits with code 0.',
      '## Completion Boundary',
      "- **Product outcome**: helperCopy returns 'benchmark-ready helper copy'.",
      "- **What Guildhall can complete in code**: Edit src/copy.ts to replace 'stale helper copy' with 'benchmark-ready helper copy'.",
      '- **External dependencies**: Node.js runtime only. The task uses only built-in modules and no external service is required.',
      '- **Owner-only setup**: None. Node.js is already available on PATH in the execution environment.',
      '- **Verification environment**: Local filesystem project root with Node.js available on PATH.',
      '- **What counts as done**: node scripts/test.js exits with code 0.',
      '- **What must be split or blocked**: Nothing.',
    ].join('\n')
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('splits a split-required spec into containing work and child tasks when approved', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.structuredSpec = boundedStructuredSpec('required')
    parent.spec = parent.spec?.replace(
      'Nothing to split.',
      'The proposed UI and API work must be split into linked child tasks before execution.',
    )
    parent.businessEnvelope = { goalId: 'goal-task-001' }
    parent.sizePlan = {
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
          identity: 'implement-billing-settings-workflow',
          title: 'Implement the billing settings workflow',
          reason: 'Keep the user-facing workflow small enough for UX review.',
          suggestedDomain: 'frontend',
          dependsOn: [],
        },
        {
          identity: 'admin-subscription-api-contract',
          title: 'Add the admin subscription API contract',
          reason: 'Separate API compatibility and security review from UI work.',
          suggestedDomain: 'backend',
          dependsOn: ['implement-billing-settings-workflow'],
        },
      ],
      reviewBudgetHint: 'release_critical',
      reasons: ['Task size score: 8.'],
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('ready')
    expect(updated.tasks[0]!.taskReadiness?.recommendation).toBe('ready')
    expect(updated.tasks[0]!.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(updated.tasks[0]!.sizePlan?.action).toBe('proceed_with_warning')
    expect(updated.tasks.map(task => task.title)).toEqual([
      'Add ghost button',
      'Implement the billing settings workflow',
      'Add the admin subscription API contract',
    ])
    expect(updated.tasks[0]!.sizePlan?.recommendedChildren.map(child => child.createdTaskId)).toEqual([
      'task-001-split-implement-billing-settings-workflow',
      'task-001-split-admin-subscription-api-contract',
    ])
    expect(updated.tasks[0]!.hierarchy?.childIds).toEqual([
      'task-001-split-implement-billing-settings-workflow',
      'task-001-split-admin-subscription-api-contract',
    ])
    expect(updated.tasks[1]).toMatchObject({
      status: 'exploring',
      businessEnvelope: { goalId: 'goal-task-001' },
      hierarchy: {
        parentId: 'task-001',
        order: 0,
        childIds: [],
      },
      origination: 'system',
      proposedBy: 'task-sizing',
    })
    expect(updated.tasks[2]!.dependsOn).toEqual(['task-001-split-implement-billing-settings-workflow'])
  })

  it('does not re-split a child task into duplicate sibling work when approved', async () => {
    const base = {
      description: 'Details',
      domain: 'docs',
      projectPath: tmpDir,
      priority: 'high' as const,
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      structuredSpec: boundedStructuredSpec('required'),
      origination: 'system' as const,
      createdAt: '2026-05-25T12:00:00.000Z',
      updatedAt: '2026-05-25T12:00:00.000Z',
    }
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-05-25T12:00:00.000Z',
      tasks: [
        {
          ...base,
          id: 'parent',
          title: 'Expand backlog into full doc-to-task decomposition',
          status: 'ready',
          hierarchy: {
            childIds: ['child-audit', 'child-implement', 'child-verify'],
            order: 0,
          },
        },
        {
          ...base,
          id: 'child-audit',
          sourceIdentity: 'parent::split::audit',
          title: 'Audit the remaining replacement scope',
          status: 'spec_review',
          hierarchy: {
            parentId: 'parent',
            childIds: [],
            order: 0,
          },
          spec: buildableSpec(),
          productBrief: {
            userJob: 'Audit remaining replacement scope.',
            successMetric: 'The inventory exists and identifies the next replacement task.',
            antiPatterns: ['Do not create duplicate nested split work.'],
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Inventory exists.', verifiedBy: 'review', met: false },
          ],
          sizePlan: {
            taskId: 'child-audit',
            score: 8,
            band: 'epic',
            action: 'split_required',
            factors: [],
            recommendedChildren: [
              { identity: 'audit', createdTaskId: 'child-audit', title: 'Audit the remaining replacement scope', reason: 'Duplicate of current child.', dependsOn: [] },
              { identity: 'implement', createdTaskId: 'child-implement', title: 'Implement the first independently verifiable replacement', reason: 'Duplicate sibling.', dependsOn: [] },
              { identity: 'verify', createdTaskId: 'child-verify', title: 'Verify and update the migration record', reason: 'Duplicate sibling.', dependsOn: [] },
            ],
            reviewBudgetHint: 'release_critical',
            reasons: ['Task size score: 8.'],
            createdAt: '2026-05-25T12:00:00.000Z',
            createdBy: 'task-sizing',
          },
        },
        {
          ...base,
          id: 'child-implement',
          sourceIdentity: 'parent::split::implement',
          title: 'Implement the first independently verifiable replacement',
          status: 'exploring',
          hierarchy: {
            parentId: 'parent',
            childIds: [],
            order: 1,
          },
        },
        {
          ...base,
          id: 'child-verify',
          sourceIdentity: 'parent::split::verify',
          title: 'Verify and update the migration record',
          status: 'exploring',
          hierarchy: {
            parentId: 'parent',
            childIds: [],
            order: 2,
          },
        },
      ],
    }
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'child-audit' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks).toHaveLength(4)
    const audit = updated.tasks.find(task => task.id === 'child-audit')
    expect(audit?.status).toBe('ready')
    expect(audit?.taskReadiness?.recommendation).toBe('ready')
    expect(audit?.sizePlan?.action).toBe('proceed_with_warning')
    expect(audit?.sizePlan?.recommendedChildren.map(child => child.title)).toEqual([
      'Audit the remaining replacement scope',
      'Implement the first independently verifiable replacement',
      'Verify and update the migration record',
    ])
    expect(audit?.sizePlan?.reasons.at(-1)).toContain('already matches existing sibling tasks')
  })

  it('rewrites an approved parent that already has linked child tasks instead of keeping stale split-required copy', async () => {
    const timestamp = '2026-06-12T00:00:00.000Z'
    const queue = await readQueue()
    const base = queue.tasks[0]!
    base.id = 'parent'
    base.title = 'Build the release scope'
    base.description = 'Coordinate the release scope through existing child work.'
    base.status = 'spec_review'
    base.hierarchy = {
      childIds: ['child-audit', 'child-implement'],
      order: 0,
    }
    base.spec = [
      '## Summary',
      'Build the release scope.',
      '',
      '## Completion Boundary',
      'Product outcome: The release scope is ready.',
      'What Guildhall can complete in code: Coordinate linked child work.',
      'External dependencies: None.',
      'Owner-only setup: None.',
      'Verification environment: Local.',
      'What counts as done: Linked proof is recorded.',
      'What must be split or blocked: Audit and implementation must still be split before work can proceed.',
    ].join('\n')
    base.structuredSpec = boundedStructuredSpec('required')
    base.sizePlan = {
      taskId: 'parent',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
          identity: 'audit',
          createdTaskId: 'child-audit',
          title: 'Stale coordinator split title',
          reason: 'This no longer matches the real child records.',
          dependsOn: [],
        },
        {
          identity: 'implement',
          createdTaskId: 'child-implement',
          title: 'Another stale coordinator split title',
          reason: 'This is represented by the existing implementation child.',
          dependsOn: ['audit'],
        },
      ],
      reviewBudgetHint: 'release_critical',
      reasons: ['Task size score: 8.'],
      createdAt: timestamp,
      createdBy: 'task-sizing',
    }
    base.taskReadiness = {
      taskKind: 'implementation',
      recommendation: 'requires_child_work',
      summary: 'Task needs to be split again.',
      dimensions: [
        {
          id: 'size',
          status: 'blocked',
          summary: 'Too broad.',
          evidence: ['Split required before work can continue.'],
        },
      ],
      definitionOfDone: {
        items: ['Ship the release scope.'],
        evidenceRequired: ['Proof is recorded.'],
        updatedAt: timestamp,
        createdBy: 'test',
      },
      blockerPlans: [],
      contextBudget: {
        estimatedTokens: 12000,
        risk: 'high',
        fitsInOneWorkerBrief: false,
        reasons: ['Too large.'],
      },
      assessedAt: timestamp,
      assessedBy: 'test',
    }
    queue.tasks.push(
      {
        ...structuredClone(base),
        id: 'child-audit',
        sourceIdentity: 'parent::split::audit',
        title: 'Audit the remaining replacement scope',
        status: 'exploring',
        hierarchy: { parentId: 'parent', childIds: [], order: 0 },
        sizePlan: undefined,
        taskReadiness: undefined,
      },
      {
        ...structuredClone(base),
        id: 'child-implement',
        sourceIdentity: 'parent::split::implement',
        title: 'Implement the first independently verifiable replacement',
        status: 'exploring',
        hierarchy: { parentId: 'parent', childIds: [], order: 1 },
        sizePlan: undefined,
        taskReadiness: undefined,
      },
    )
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'parent' })

    expect(result.success, result.error).toBe(true)
    const updated = await readQueue()
    const parent = updated.tasks.find(task => task.id === 'parent')!
    expect(updated.tasks.map(task => task.id)).toEqual(['parent', 'child-audit', 'child-implement'])
    expect(parent.sizePlan?.action).toBe('proceed_with_warning')
    expect(parent.taskReadiness?.recommendation).toBe('ready')
    expect(parent.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(parent.spec).toContain('Already split into linked child tasks: child-audit, child-implement')
    expect(parent.spec).not.toContain('must still be split before work can proceed')
  })

  it('splits a split-recommended spec into containing work and child tasks when approved', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.structuredSpec = boundedStructuredSpec('required')
    parent.spec = parent.spec?.replace(
      'Nothing to split.',
      'The implementation and visual-proof work should be split into linked child tasks before execution.',
    )
    parent.sizePlan = {
      taskId: 'task-001',
      score: 5,
      band: 'large',
      action: 'split_recommended',
      factors: [],
      recommendedChildren: [
        {
          identity: 'component-implementation',
          title: 'Component implementation',
          reason: 'Ship the component implementation first.',
          suggestedDomain: 'frontend',
          dependsOn: [],
        },
        {
          identity: 'storybook-story',
          title: 'Storybook story',
          reason: 'Add visual proof after the implementation exists.',
          suggestedDomain: 'frontend',
          dependsOn: ['component-implementation'],
        },
      ],
      reviewBudgetHint: 'thorough',
      reasons: ['Task size score: 5.'],
      createdAt: '2026-06-05T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('ready')
    expect(updated.tasks[0]!.taskReadiness?.recommendation).toBe('ready')
    expect(updated.tasks[0]!.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(updated.tasks[0]!.sizePlan?.action).toBe('proceed_with_warning')
    expect(updated.tasks[0]!.hierarchy?.childIds).toEqual([
      'task-001-split-component-implementation',
      'task-001-split-storybook-story',
    ])
    expect(updated.tasks[1]).toMatchObject({
      status: 'exploring',
      hierarchy: {
        parentId: 'task-001',
        order: 0,
        childIds: [],
      },
      origination: 'system',
      proposedBy: 'task-sizing',
    })
    expect(updated.tasks[2]!.dependsOn).toEqual(['task-001-split-component-implementation'])
  })

  it('materializes semantic work-unit children when a split-required spec is approved', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.title = 'Define Narrative Harness MVP drafting model and physical-world review lanes'
    task.description = 'Shape the Narrative Harness MVP drafting model and physical-world review lanes.'
    task.domain = 'harness'
    task.structuredSpec = boundedStructuredSpec('required')
    task.spec = [
      '## Summary',
      'Define the Narrative Harness MVP drafting model and physical-world review lanes.',
      '',
      '## Acceptance Criteria',
      '1. The DeepInfra drafting model proof is scoped.',
      '2. The world-state continuity review lane is scoped.',
      '3. The spatial/geographic continuity review lane is scoped.',
      '',
      '## Completion Boundary',
      '- Product outcome: Narrative Harness has source-backed MVP work for the drafting model and physical-world review lanes.',
      '- What Guildhall can complete in code: task shaping, proof scripts, tests, and recorded evidence.',
      '- External dependencies: None known.',
      '- Owner-only setup: None known.',
      '- Verification environment: local project scripts.',
      '- What counts as done: all scoped child units are linked and independently reviewable.',
      '- What must be split or blocked: split the model proof, world-state review lane, and spatial/geographic review lane into child work.',
    ].join('\n')
    task.acceptanceCriteria = []
    task.workUnitAnalysis = {
      summary: '3 independently reviewable requirements were recovered from numbered owner scope.',
      units: [
        {
          id: 'recovered-requirement-1',
          title: 'Select and prove DeepInfra drafting model',
          deliverable: 'Guildhall records source-backed current-scope MVP work and proof for DeepInfra drafting.',
          rationale: 'Recovered from numbered owner requirement 1.',
          dependsOn: [],
          suggestedDomain: 'harness',
        },
        {
          id: 'recovered-requirement-2',
          title: 'Define world-state continuity review lane',
          deliverable: 'Guildhall records source-backed current-scope MVP work and proof for world-state continuity.',
          rationale: 'Recovered from numbered owner requirement 2.',
          dependsOn: ['recovered-requirement-1'],
          suggestedDomain: 'harness',
        },
        {
          id: 'recovered-requirement-3',
          title: 'Define spatial/geographic continuity review lane',
          deliverable: 'Guildhall records source-backed current-scope MVP work and proof for spatial/geographic continuity.',
          rationale: 'Recovered from numbered owner requirement 3.',
          dependsOn: ['recovered-requirement-1'],
          suggestedDomain: 'harness',
        },
      ],
      proofOnlyItems: [],
      createdAt: '2026-07-05T18:54:18.292Z',
      createdBy: 'coordinator-recovery',
    }
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    const parent = updated.tasks.find(candidate => candidate.id === 'task-001')!
    expect(parent.hierarchy?.childIds).toEqual([
      'task-001-split-recovered-requirement-1',
      'task-001-split-recovered-requirement-2',
      'task-001-split-recovered-requirement-3',
    ])
    expect(updated.tasks.map(candidate => candidate.title)).toContain('Select and prove DeepInfra drafting model')
    expect(updated.tasks.find(candidate => candidate.title === 'Define world-state continuity review lane')?.dependsOn).toEqual([
      'task-001-split-recovered-requirement-1',
    ])
    expect(parent.taskReadiness?.recommendation).toBe('ready')
    expect(parent.spec).toContain('Already split into linked child tasks')
  })

  it('does not invent generic child work when a split boundary has no explicit work units', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.title = 'Define a broad delivery program'
    task.description = 'Implement model selection, review lanes, release coordination, telemetry, docs, and migration planning.'
    task.spec = [
      '## Summary',
      'Define a broad delivery program.',
      '',
      '## Acceptance Criteria',
      '1. Model selection is covered.',
      '2. Review lanes are covered.',
      '3. Release coordination is covered.',
      '4. Telemetry is covered.',
      '',
      '## Completion Boundary',
      '- Product outcome: broad program work is ready.',
      '- What Guildhall can complete in code: implementation, tests, docs, telemetry, and release coordination.',
      '- External dependencies: None known.',
      '- Owner-only setup: None known.',
      '- Verification environment: local project scripts.',
      '- What counts as done: the whole program is shipped.',
      '- What must be split or blocked: split before execution.',
    ].join('\n')
    task.acceptanceCriteria = []
    delete task.workUnitAnalysis
    await writeQueue(queue)

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks).toHaveLength(1)
    expect(updated.tasks[0]!.status).toBe('ready')
  })

  it('uses the structured acceptance boundary instead of prose-only markdown criteria', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.title = 'Pantry Pulse app spec'
    task.description = 'Build a Pantry Pulse app.'
    task.domain = 'product'
    task.projectPath = tmpDir
    task.status = 'spec_review'
    task.spec = [
      '## Summary',
      'Build Pantry Pulse.',
      '## Acceptance Criteria',
      '1. A page titled Pantry Pulse is visible.',
      '2. Mark used updates the visible count.',
      '## Completion Boundary',
      'Product outcome: Users can track pantry items.',
      'What Guildhall can complete in code: Build the local web app.',
      'External dependencies: None.',
      'Owner-only setup: None.',
      'Verification environment: Local automated tests and browser review.',
      'What counts as done: The app can be opened and reviewed locally.',
      'What must be split or blocked: Nothing to split.',
    ].join('\n')
    task.structuredSpec = boundedStructuredSpec('none')
    task.productBrief = {
      userJob: 'Track pantry items.',
      successMetric: 'Browser review shows the title and count update.',
      antiPatterns: [],
    }
    task.acceptanceCriteria = []
    await writeQueue(queue)

    const approved = await approveSpec({ memoryDir, taskId: task.id })

    expect(approved.success).toBe(true)
    expect(approved.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks.find(candidate => candidate.id === task.id)?.acceptanceCriteria.map(ac => ac.description)).toEqual([
      'Given the task boundary, when the work is complete Then the bounded outcome is available.',
    ])
  })

  it('keeps explicitly bounded specs runnable when a stale size plan suggests unrelated splits', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.title = 'Pantry Pulse app spec'
    task.description = 'Run the fixed-spec Pantry Pulse completion proof.'
    task.domain = 'product'
    task.projectPath = tmpDir
    task.status = 'spec_review'
    task.structuredSpec = boundedStructuredSpec('none')
    task.spec = [
      '## Summary',
      'Build Pantry Pulse.',
      '## Acceptance Criteria',
      '1. A page titled Pantry Pulse is visible.',
      '2. Mark used updates the visible count.',
      '## Completion Boundary',
      'Product outcome: Users can track pantry items.',
      'What Guildhall can complete in code: Build the local web app.',
      'External dependencies: None.',
      'Owner-only setup: None.',
      'Verification environment: Local automated tests and browser review.',
      'What counts as done: The app can be opened and reviewed locally.',
      'What must be split or blocked: Nothing to split.',
    ].join('\n')
    task.productBrief = {
      userJob: 'Track pantry items.',
      successMetric: 'Browser review shows the title and count update.',
      antiPatterns: [],
    }
    task.sizePlan = {
      taskId: task.id,
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [{
        title: 'Instrument analytics documentation',
        reason: 'Unrelated stale split recommendation.',
        suggestedDomain: 'docs',
        dependsOn: [],
      }],
      reviewBudgetHint: 'release_critical',
      reasons: ['Stale model split.'],
      createdAt: '2026-05-28T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await writeQueue(queue)

    const approved = await approveSpec({ memoryDir, taskId: task.id })

    expect(approved.success).toBe(true)
    expect(approved.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks).toHaveLength(1)
    expect(updated.tasks[0]?.status).toBe('ready')
    expect(updated.tasks[0]?.sizePlan?.action).toBe('proceed_with_warning')
    expect(updated.tasks[0]?.taskReadiness?.recommendation).toBe('ready')
  })

  it('keeps a source-backed contract task runnable without project-specific labels', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.title = 'Define author intent and voice input'
    task.description = 'Capture genre, form, audience, themes, constraints, representative voice, and provenance for synopsis and drafting.'
    task.domain = 'docs'
    task.projectPath = tmpDir
    task.status = 'spec_review'
    task.spec = [
      '## Source Trail',
      'docs/harness/headless-mvp-release-plan.md.',
      '## Acceptance Criteria',
      '1. The durable input boundary preserves source-backed intent and voice provenance.',
      '## Completion Boundary',
      'Product outcome: A source-backed author-intent-and-voice input boundary is available to synopsis and drafting.',
      'What Guildhall can complete in code: Define, serialize, validate, and prove the bounded input record.',
      'External dependencies: None.',
      'Owner-only setup: The author supplies the representative voice input when the fixture is populated.',
      'Verification environment: Local pnpm tests and saved release evidence.',
      'What counts as done: The record, provenance rules, consumer mapping, and proof are visible on the task.',
      'What must be split or blocked: Synopsis generation, drafting, reviewers, model selection, and UI are separate tasks; nothing is blocked for this input boundary.',
    ].join('\n')
    task.structuredSpec = boundedStructuredSpec('none')
    task.productBrief = {
      userJob: 'Record project intent and representative author voice once for downstream generation.',
      successMetric: 'The durable input boundary and its provenance are validated and visible in Guildhall.',
      antiPatterns: [],
    }
    task.acceptanceCriteria = [{
      id: 'AC-1',
      description: 'The durable input boundary preserves source-backed intent and voice provenance.',
      verifiedBy: 'review',
      met: false,
    }]
    task.sizePlan = {
      taskId: task.id,
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [{
        title: 'Invent unrelated follow-up work',
        reason: 'Unrelated stale split recommendation.',
        suggestedDomain: 'docs',
        dependsOn: [],
      }],
      reviewBudgetHint: 'release_critical',
      reasons: ['Stale model split.'],
      createdAt: '2026-05-28T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await writeQueue(queue)

    const approved = await approveSpec({ memoryDir, taskId: task.id })

    expect(approved.success).toBe(true)
    expect(approved.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks).toHaveLength(1)
    expect(updated.tasks[0]?.status).toBe('ready')
    expect(updated.tasks[0]?.sizePlan?.action).toBe('proceed_with_warning')
    expect(updated.tasks[0]?.taskReadiness?.recommendation).toBe('ready')
  })

  it('does not invent generic child work for broad deterministic recovery specs without explicit work units', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.id = 'task-import-twwvys'
    task.title = 'Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu'
    task.description = 'looma/PROJECT_STATE.md: 1. Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menus.'
    task.domain = 'looma'
    task.projectPath = tmpDir
    task.status = 'spec_review'
    task.origination = 'human'
    task.productBrief = {
      userJob: 'I want Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu turned into concrete project work using the evidence and owner decisions already recorded.',
      successMetric: 'Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu has a reviewable spec, acceptance criteria, and a clear completion boundary before implementation starts.',
      antiPatterns: [],
      authoredBy: 'coordinator-recovery',
      authoredAt: '2026-06-12T20:43:48.886Z',
    }
    task.notes = [{
      agentId: 'coordinator-recovery',
      role: 'system',
      structured: { event: 'recovery_spec_seed', source: 'deterministic' },
      content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane, so the task has durable progress instead of returning to a read-only shaping loop.',
      timestamp: '2026-06-12T20:43:48.886Z',
    }]
    task.spec = [
      '## Summary',
      'Build Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu from the current project evidence, preserving the source intent: 1. Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menus. from looma/PROJECT_STATE.md',
      '## Acceptance Criteria',
      '1. Given the existing project conventions and source evidence, when Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu is implemented, then the feature appears in the appropriate repo surface without introducing a one-off parallel pattern.',
      '## Completion Boundary',
      'Product outcome: A user can use Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu in the intended project surface.',
      'What Guildhall can complete in code: Implement the source intent from the imported planning note.',
      'External dependencies: None.',
      'Owner-only setup: None.',
      'Verification environment: Local repo checks and browser proof.',
      'What counts as done: Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu is implemented.',
      'What must be split or blocked: The remaining replacement wave must be split into concrete child tasks before execution.',
    ].join('\n')
    task.acceptanceCriteria = []
    delete task.sizePlan
    await writeQueue(queue)

    const approved = await approveSpec({ memoryDir, taskId: task.id })

    expect(approved.success).toBe(true)
    expect(approved.newStatus).toBe('ready')
    const updated = await readQueue()
    const parent = updated.tasks.find(candidate => candidate.id === task.id)
    expect(parent?.status).toBe('ready')
    expect(parent?.hierarchy?.childIds ?? []).toEqual([])
    expect(updated.tasks).toHaveLength(1)
  })

  it('records an approval note on the task when provided', async () => {
    await approveSpec({
      memoryDir,
      taskId: 'task-001',
      approvalNote: 'LGTM, ship it',
    })
    const queue = await readQueue()
    const notes = queue.tasks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.agentId).toBe('human')
    expect(notes[0]!.role).toBe('approver')
    expect(notes[0]!.content).toBe('LGTM, ship it')
  })

  it('appends an approval entry to the transcript', async () => {
    await approveSpec({
      memoryDir,
      taskId: 'task-001',
      approvalNote: 'ship it',
    })
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('Spec approved')
    expect(transcript).toContain('ship it')
  })

  it('describes split approval in plain language in the transcript', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.structuredSpec = boundedStructuredSpec('required')
    parent.spec = parent.spec?.replace(
      'Nothing to split.',
      'The policy work must be split into linked child tasks before execution.',
    )
    parent.businessEnvelope = { goalId: 'goal-task-001' }
    parent.sizePlan = {
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
          identity: 'draft-policy',
          title: 'Draft the policy',
          reason: 'Separate the decision from implementation.',
          suggestedDomain: 'product',
          dependsOn: [],
        },
      ],
      reviewBudgetHint: 'release_critical',
      reasons: ['Task size score: 8.'],
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await writeQueue(queue)

    await approveSpec({ memoryDir, taskId: 'task-001' })

    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('Spec approved. Guildhall created the nested work and kept this item as the containing work.')
  })

  it('refuses to approve a task that has no spec', async () => {
    const queue = await readQueue()
    delete queue.tasks[0]!.spec
    delete queue.tasks[0]!.structuredSpec
    await writeQueue(queue)
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no structured spec')
  })

  it('refuses to approve a task not in spec_review status', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.status = 'in_progress'
    await writeQueue(queue)
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain("'in_progress'")
  })

  it('returns an error for unknown task id', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})

describe('parseStackTraceTopFile', () => {
  it('extracts the file path from a parenthesised frame', () => {
    const stack = [
      'Error: something',
      '    at foo (/src/app/server.ts:42:7)',
      '    at bar (/src/app/other.ts:10:1)',
    ].join('\n')
    expect(parseStackTraceTopFile(stack)).toBe('/src/app/server.ts')
  })

  it('extracts the file path from a bare "at file:line:col" frame', () => {
    const stack = [
      'Error: other',
      '    at /src/worker.ts:99:3',
    ].join('\n')
    expect(parseStackTraceTopFile(stack)).toBe('/src/worker.ts')
  })

  it('returns undefined when nothing file-shaped is present', () => {
    expect(parseStackTraceTopFile('Error: no frames here')).toBeUndefined()
  })
})

describe('createBugReportTask', () => {
  it('creates a proposed task with "Bug:" prefix and high priority by default', async () => {
    const result = await createBugReportTask({
      memoryDir,
      projectPath: '/projects/looma',
      title: 'Ghost button crashes on hover',
      body: 'Clicking ghost button in the sidebar throws.',
      domain: 'looma',
    })
    expect(result.taskId).toBe('task-001')
    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    const task = queue.tasks[0]!
    expect(task.status).toBe('proposed')
    expect(task.priority).toBe('high')
    expect(task.title.startsWith('Bug: ')).toBe(true)
    expect(task.title).toContain('Ghost button')
    expect(task.origination).toBe('human')
    expect(task.description).toContain('Clicking ghost button')
    expect(task.notes).toHaveLength(1)
    expect(task.notes[0]!.role).toBe('reporter')
  })

  it('does not double-prefix when the user already wrote "Bug:" in the title', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'Bug: API 500 on login',
      body: 'body',
      domain: 'api',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('Bug: API 500 on login')
  })

  it('includes the stack trace as a fenced block in the description', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'boom',
      body: 'It crashed.',
      stackTrace: 'Error: x\n    at foo (/src/x.ts:1:1)',
      domain: 'api',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.description).toContain('```')
    expect(queue.tasks[0]!.description).toContain('at foo (/src/x.ts:1:1)')
  })

  it('appends the environment block when provided', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'env repro',
      body: 'Happens only on macOS.',
      env: { os: 'darwin 25.3.0', node: 'v22.7.0' },
      domain: 'api',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.description).toContain('**Environment:**')
    expect(queue.tasks[0]!.description).toContain('os: darwin 25.3.0')
    expect(queue.tasks[0]!.description).toContain('node: v22.7.0')
  })

  it('accepts an explicit priority override', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'minor',
      body: 'cosmetic',
      domain: 'looma',
      priority: 'low',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.priority).toBe('low')
  })
})

describe('resumeExploring', () => {
  beforeEach(async () => {
    await createExploringTask({
      memoryDir,
      ask: 'first ask',
      domain: 'looma',
      projectPath: '/x',
    })
  })

  it('appends a new user message to the transcript', async () => {
    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'one more requirement',
    })
    expect(result.success).toBe(true)
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('first ask')
    expect(transcript).toContain('one more requirement')
  })

  it('moves a non-terminal task back to exploring when the user replies', async () => {
    let queue = await readQueue()
    queue.tasks[0]!.status = 'ready'
    await writeQueue(queue)

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'Actually, re-check the imported TODO before implementing.',
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('exploring')
  })

  it('can add a human steering note without reopening spec intake', async () => {
    let queue = await readQueue()
    queue.tasks[0]!.status = 'in_progress'
    await writeQueue(queue)

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'Before editing more files, summarize the failing test.',
      preserveStatus: true,
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('in_progress')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('summarize the failing test')
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('summarize the failing test')
  })

  it('persists a steering note on a blocked task without silently returning ok', async () => {
    let queue = await readQueue()
    queue.tasks[0]!.status = 'blocked'
    queue.tasks[0]!.blockReason = 'human_judgment_required: choose a retry path'
    await writeQueue(queue)

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'Retry from the partial diff and make one concrete mutation first.',
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('blocked')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('Retry from the partial diff')
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('Retry from the partial diff')
  })

  it('resolves a pending escalation and returns task to exploring', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'spec-agent',
      reason: 'spec_ambiguous',
      summary: 'is this for mobile too?',
    })
    let queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('blocked')

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      resolveEscalationId: 'esc-task-001-1',
      resolution: 'yes, mobile too',
      message: 'also mobile, yes',
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.escalations).toEqual([])
  })

  it('returns error for unknown task id', async () => {
    const result = await resumeExploring({
      memoryDir,
      taskId: 'nope',
      message: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})
