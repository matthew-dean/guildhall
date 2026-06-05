import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
  createBugReportTask,
  parseStackTraceTopFile,
} from '../intake.js'
import { registerContractSurface } from '../contract-surfaces.js'
import { TaskQueue } from '@guildhall/core'
import { raiseEscalation } from '@guildhall/tools'
import { getProjectStateDir, getProjectTranscriptPath } from '@guildhall/sessions'
import { listOwnerInputRequests } from '../owner-input-store.js'

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
  memoryDir = getProjectStateDir(tmpDir)
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
  // Bootstrap seeds TASKS.json as a bare `[]`, so test that path directly too.
  await fs.writeFile(tasksPath, '[]', 'utf-8')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  return TaskQueue.parse(JSON.parse(raw))
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

  it('handles a bare-array TASKS.json (bootstrap legacy format)', async () => {
    // Already seeded as '[]' in beforeEach — createExploringTask should cope.
    const result = await createExploringTask({
      memoryDir,
      ask: 'legacy format',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    // After first intake, the file should be a full queue object
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.tasks).toHaveLength(1)
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

  it('keeps long asks complete in description instead of storing truncated title content', async () => {
    const long = 'x'.repeat(200)
    await createExploringTask({ memoryDir, ask: long, domain: 'looma', projectPath: '/x' })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('New request')
    expect(queue.tasks[0]!.description).toBe(long)
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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
  })

  it('transitions spec_review → ready', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('ready')
  })

  it('persists task readiness and finishability artifacts when a spec is approved', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.proofPaths = [{ id: 'proof-ghost-button' }]
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('splits a split-required spec into containing work and child tasks when approved', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.businessEnvelope = { goalId: 'goal-task-001' }
    parent.sizePlan = {
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
          title: 'Implement the billing settings workflow',
          reason: 'Keep the user-facing workflow small enough for UX review.',
          suggestedDomain: 'frontend',
          dependsOn: [],
        },
        {
          title: 'Add the admin subscription API contract',
          reason: 'Separate API compatibility and security review from UI work.',
          suggestedDomain: 'backend',
          dependsOn: ['Implement the billing settings workflow'],
        },
      ],
      reviewBudgetHint: 'release_critical',
      reasons: ['Task size score: 8.'],
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('ready')
    expect(updated.tasks[0]!.taskReadiness?.recommendation).toBe('split')
    expect(updated.tasks.map(task => task.title)).toEqual([
      'Add ghost button',
      'Implement the billing settings workflow',
      'Add the admin subscription API contract',
    ])
    expect(updated.tasks[0]!.sizePlan?.recommendedChildren.map(child => child.createdTaskId)).toEqual([
      'task-001-split-implement-the-billing-settings-workflow',
      'task-001-split-add-the-admin-subscription-api-contract',
    ])
    expect(updated.tasks[0]!.hierarchy?.childIds).toEqual([
      'task-001-split-implement-the-billing-settings-workflow',
      'task-001-split-add-the-admin-subscription-api-contract',
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
    expect(updated.tasks[2]!.dependsOn).toEqual(['task-001-split-implement-the-billing-settings-workflow'])
  })

  it('splits a split-recommended spec into containing work and child tasks when approved', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.sizePlan = {
      taskId: 'task-001',
      score: 5,
      band: 'large',
      action: 'split_recommended',
      factors: [],
      recommendedChildren: [
        {
          title: 'Component implementation',
          reason: 'Ship the component implementation first.',
          suggestedDomain: 'frontend',
          dependsOn: [],
        },
        {
          title: 'Storybook story',
          reason: 'Add visual proof after the implementation exists.',
          suggestedDomain: 'frontend',
          dependsOn: ['Component implementation'],
        },
      ],
      reviewBudgetHint: 'thorough',
      reasons: ['Task size score: 5.'],
      createdAt: '2026-06-05T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('ready')
    expect(updated.tasks[0]!.taskReadiness?.recommendation).toBe('split')
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

  it('backfills acceptance criteria from approved markdown specs before blueprint sanity', async () => {
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
    task.productBrief = {
      userJob: 'Track pantry items.',
      successMetric: 'Browser review shows the title and count update.',
      antiPatterns: [],
    }
    task.acceptanceCriteria = []
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const approved = await approveSpec({ memoryDir, taskId: task.id })

    expect(approved.success).toBe(true)
    expect(approved.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks.find(candidate => candidate.id === task.id)?.acceptanceCriteria.map(ac => ac.description)).toEqual([
      'A page titled Pantry Pulse is visible.',
      'Mark used updates the visible count.',
    ])
  })

  it('keeps fixed Pantry Pulse specs runnable when a stale size plan suggests unrelated splits', async () => {
    const queue = await readQueue()
    const task = queue.tasks[0]!
    task.title = 'Pantry Pulse app spec'
    task.description = 'Run the fixed-spec Pantry Pulse completion proof.'
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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const approved = await approveSpec({ memoryDir, taskId: task.id })

    expect(approved.success).toBe(true)
    expect(approved.newStatus).toBe('ready')
    const updated = await readQueue()
    expect(updated.tasks).toHaveLength(1)
    expect(updated.tasks[0]?.status).toBe('ready')
    expect(updated.tasks[0]?.sizePlan?.action).toBe('proceed_with_warning')
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
    parent.businessEnvelope = { goalId: 'goal-task-001' }
    parent.sizePlan = {
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no spec')
  })

  it('refuses to approve a task not in spec_review status', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.status = 'in_progress'
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2))

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
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2))

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
    expect(queue.tasks[0]!.escalations[0]!.resolvedAt).toBeDefined()
    expect(queue.tasks[0]!.escalations[0]!.resolution).toBe('yes, mobile too')
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
