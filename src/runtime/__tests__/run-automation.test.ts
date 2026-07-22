import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getProjectSystemStatePath,
  getProjectSystemStatePathFromMemoryDir,
  inferProjectRootFromMemoryDir,
  promoteProjectStateDatabaseAuthority,
  projectStateDatabasePath,
  readTaskEvidence,
  readProjectStateDatabaseTaskPointWithRevision,
  readProjectTaskQueueSync,
} from '@guildhall/sessions'

import { applyRunAutomationPolicy } from '../run-automation.js'
import * as projectStateBoundary from '../project-state-boundary.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const VALID_SPEC = [
  '## Summary',
  '',
  'Implement the requested change.',
  '',
  '## Completion Boundary',
  '- Product outcome: The requested change works for the target user.',
  '- What Guildhall can complete in code: Update the relevant source and test files.',
  '- External dependencies: None.',
  '- Owner-only setup: None.',
  '- Verification environment: Local test environment.',
  '- What counts as done: The acceptance criterion is met and the task can be reviewed locally.',
  '- What must be split or blocked: Nothing.',
  '',
  '## Acceptance Criteria',
  '1. Thing is done.',
].join('\n')

const VALID_STRUCTURED_SPEC = {
  whatThisIs: 'A bounded implementation contract.',
  problemContext: 'The current project needs one verifiable outcome.',
  goals: ['Implement the bounded outcome.'],
  nonGoals: ['Do not expand scope.'],
  proposedDesign: 'Use the existing project surface.',
  keyDecisions: ['Keep proof attached to the task.'],
  acceptanceCriteria: [{
    scenario: 'Given the task boundary, when the work is complete',
    expectation: 'Then the bounded outcome is available.',
    verificationMode: 'review',
  }],
  verification: ['Review the changed surface and recorded evidence.'],
  completionBoundary: {
    productOutcome: 'The bounded outcome is available.',
    whatGuildhallCanCompleteInCode: 'Implement the bounded project work.',
    externalDependencies: 'None known.',
    ownerOnlySetup: 'None known.',
    verificationEnvironment: 'The registered local project.',
    whatCountsAsDone: 'The acceptance criterion is satisfied.',
    whatMustBeSplitOrBlocked: 'New product decisions remain separate.',
  },
}

async function makeMemoryDir(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-automation-'))
  const memoryDir = path.join(projectRoot, '.guildhall')
  await fs.mkdir(path.join(memoryDir, 'transcripts', 'exploring'), { recursive: true })
  return memoryDir
}

async function writeQueue(memoryDir: string, queue: unknown): Promise<void> {
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  projectStateBoundary.writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot })
  promoteProjectStateDatabaseAuthority(projectRoot)
}

async function readQueue(memoryDir: string): Promise<{ tasks: Array<Record<string, any>> }> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  return readProjectTaskQueueSync(tasksPath) as { tasks: Array<Record<string, any>> }
}

describe('run automation policy', () => {
  it('fully automated runs preserve explicit spec approval for the owner', async () => {
    const memoryDir = await makeMemoryDir()
    await writeQueue(memoryDir, {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-root',
          status: 'exploring',
        }),
        task({
          id: 'task-child',
          status: 'spec_review',
          spec: VALID_SPEC,
          productBrief: {
            userJob: 'Use the finished change.',
            successMetric: 'The requested behavior is visible locally.',
            antiPatterns: [],
          },
          hierarchy: { parentId: 'task-root', childIds: [], order: 0 },
        }),
      ],
    })
    const aggregateWriter = vi.spyOn(projectStateBoundary, 'writeProjectTaskQueueWithSummary')

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-root',
      ownerIntent: 'Create a tiny local app.',
    })

    expect(result.changed).toBe(false)
    expect(result.resolutions).toEqual([])
    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find((candidate) => candidate.id === 'task-child')!.status).toBe('spec_review')
    expect(aggregateWriter).not.toHaveBeenCalled()
    await expect(fs.access(path.join(memoryDir, 'transcripts', 'exploring', 'task-child.md'))).rejects.toThrow()
  })

  it('fully automated runs do not manufacture or approve a product brief', async () => {
    const memoryDir = await makeMemoryDir()
    await writeQueue(memoryDir, {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-smoke',
          status: 'spec_review',
          structuredSpec: {
            ...VALID_STRUCTURED_SPEC,
            completionBoundary: {
              ...VALID_STRUCTURED_SPEC.completionBoundary,
              productOutcome: 'Verify the Guildhall pipeline can complete a deterministic marker-file task.',
              whatGuildhallCanCompleteInCode: 'Create the marker file with exact content.',
              whatCountsAsDone: '`guildhall_smoke.txt` exists at the project root with exactly `GUILDHALL_SMOKE_OK`.',
            },
          },
          description: 'Create a file named guildhall_smoke.txt in the project root containing exactly GUILDHALL_SMOKE_OK.',
          spec: [
            '## Summary',
            '',
            'Create a single file `guildhall_smoke.txt` in the project root containing exactly `GUILDHALL_SMOKE_OK`.',
            '',
            '## Product Brief',
            '',
            '- **User job**: Verify the Guildhall pipeline can complete a deterministic marker-file task.',
            '- **Success metric**: `guildhall_smoke.txt` exists at the project root with exactly `GUILDHALL_SMOKE_OK`.',
            '- **Anti-patterns**: Do not create or modify any other files.',
            '- **Rollout plan**: None.',
            '',
            '## Completion Boundary',
            '- Product outcome: An automated check can read `guildhall_smoke.txt` and confirm the run completed.',
            '- What Guildhall can complete in code: Create the marker file with exact content.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local project root.',
            '- What counts as done: `guildhall_smoke.txt` exists with exactly `GUILDHALL_SMOKE_OK`.',
            '- What must be split or blocked: Nothing.',
            '',
            '## Acceptance Criteria',
            '1. File exists at the project root.',
            '2. File content is exactly `GUILDHALL_SMOKE_OK`.',
          ].join('\n'),
          acceptanceCriteria: [
            { id: 'AC-1', description: 'File exists at the project root.', verifiedBy: 'automated', met: false },
            { id: 'AC-2', description: 'File content is exactly GUILDHALL_SMOKE_OK.', verifiedBy: 'automated', met: false },
          ],
        }),
      ],
    })

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-smoke',
      ownerIntent: 'Create the marker file.',
    })

    expect(result.resolutions).toEqual([])
    const queue = await readQueue(memoryDir)
    const smoke = queue.tasks[0]!
    expect(smoke.status).toBe('spec_review')
    expect(smoke.productBrief).toBeUndefined()
  })

  it('leaves imported spec revisions for explicit review', async () => {
    const memoryDir = await makeMemoryDir()
    await writeQueue(memoryDir, {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [task({
        id: 'task-imported-proof',
        status: 'spec_review',
        structuredSpec: undefined,
        spec: [
          '## Completion Boundary',
          '- Product outcome: Evaluate the documented drafting boundary.',
          '- What Guildhall can complete in code: Shape a source-backed proof plan.',
          '- External dependencies: None.',
          '- Owner-only setup: None.',
          '- Verification environment: Local project evidence.',
          '- What counts as done: scripts/invented-proof.mjs runs successfully.',
          '- What must be split or blocked: Nothing.',
          '',
          '## Acceptance Criteria',
          '1. The documented drafting boundary is shaped for proof.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'The documented drafting boundary is shaped for proof.',
          verifiedBy: 'review',
          met: false,
        }],
        sourceClaims: [{
          source: 'workspace-importer',
          title: 'Evaluate the documented drafting boundary',
          evidence: 'Evaluate the documented drafting boundary.',
          references: ['docs/harness/headless-mvp-release-plan.md'],
          confidence: 'high',
        }],
        requestIntake: {
          createdBy: 'workspace-importer',
          evidenceRefs: ['import:docs/harness/headless-mvp-release-plan.md'],
        },
      })],
    })

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-imported-proof',
    })

    expect(result.resolutions).toEqual([])
    expect((await readQueue(memoryDir)).tasks[0]!.productBrief).toBeUndefined()
  })

  it('fully automated runs leave an existing structured product brief awaiting approval', async () => {
    const memoryDir = await makeMemoryDir()
    await writeQueue(memoryDir, {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-pantry',
          title: 'Build Pantry Pulse web app',
          description: 'Build a dependency-free Pantry Pulse web app.',
          status: 'spec_review',
          structuredSpec: {
            ...VALID_STRUCTURED_SPEC,
            problemContext: 'Build Pantry Pulse as a dependency-free single-page pantry tracker.',
            completionBoundary: {
              ...VALID_STRUCTURED_SPEC.completionBoundary,
              productOutcome: 'Track pantry items and use expiring food first.',
              whatCountsAsDone: 'The browser app shows seeded items, filters expiring items, and updates count when an item is marked used.',
            },
          },
          spec: [
            '## Summary',
            'Build Pantry Pulse as a dependency-free single-page pantry tracker.',
            '',
            '## Product Brief',
            '- **User job**: Track pantry items and use expiring food first.',
            '- **Success metric**: The browser app shows seeded items, filters expiring items, and updates count when an item is marked used.',
            '',
            '## Completion Boundary',
            '- Product outcome: Someone can open index.html and manage pantry items locally.',
            '- What Guildhall can complete in code: Create the dependency-free index.html app.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local browser opened against index.html.',
            '- What counts as done: The app works locally and matches the acceptance criteria.',
            '- What must be split or blocked: Nothing.',
            '',
            '## Acceptance Criteria',
            '1. Pantry Pulse heading is visible.',
          ].join('\n'),
          productBrief: {
            userJob: 'A provider wrote this user job in an entirely different style.',
            successMetric: 'A different provider used different words for the same observable outcome.',
            antiPatterns: [],
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Pantry Pulse heading is visible.', verifiedBy: 'browser', met: false },
          ],
        }),
      ],
    })

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-pantry',
      ownerIntent: 'Build the Pantry Pulse app.',
    })

    expect(result.resolutions).toEqual([])
    const queue = await readQueue(memoryDir)
    const pantry = queue.tasks[0]!
    expect(pantry.status).toBe('spec_review')
    expect(pantry.productBrief).toMatchObject({
      userJob: 'A provider wrote this user job in an entirely different style.',
      successMetric: 'A different provider used different words for the same observable outcome.',
    })
  })

  it('supervised runs leave owner checkpoints untouched', async () => {
    const memoryDir = await makeMemoryDir()
    await writeQueue(memoryDir, {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          status: 'exploring',
          openQuestions: [{
            kind: 'text',
            id: 'q-1',
            askedBy: 'spec-agent',
            askedAt: '2026-05-29T10:00:00.000Z',
            prompt: 'What should this do?',
          }],
        }),
      ],
    })
    const aggregateWriter = vi.spyOn(projectStateBoundary, 'writeProjectTaskQueueWithSummary')

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'supervised',
      rootTaskId: 'task-root',
      ownerIntent: 'Create a tiny local app.',
    })

    expect(result.changed).toBe(false)
    expect(result.resolutions).toEqual([])
    expect(aggregateWriter).not.toHaveBeenCalled()
    expect(await readTaskEvidence(path.dirname(memoryDir), 'task-root', { kind: 'note' })).toEqual([])
  })

  it('does not clear a task-level recovery marker without a typed Guildhall-owned escalation', async () => {
    const memoryDir = await makeMemoryDir()
    const projectRoot = path.dirname(memoryDir)
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-root',
          status: 'blocked',
          blockReason: 'Human approval is required before the task can continue.',
          recoveryCode: 'worker_turn_limit',
        }),
        task({ id: 'task-other', title: 'Untouched task' }),
      ],
    }
    projectStateBoundary.writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const beforeDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const untouchedBefore = beforeDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-other') as { payload_gzip: Uint8Array }
    beforeDatabase.close()

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-root',
      ownerIntent: 'Continue the requested work.',
    })

    expect(result.resolutions).toEqual([])
    const promotedTask = readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-root')?.task.definition
    expect(promotedTask).toMatchObject({ status: 'blocked' })
    expect(promotedTask).toHaveProperty('blockReason')
    expect(await readTaskEvidence(projectRoot, 'task-root', { kind: 'note' })).toEqual([])
    const afterDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const untouchedAfter = afterDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-other') as { payload_gzip: Uint8Array }
    expect(Buffer.from(untouchedAfter.payload_gzip)).toEqual(Buffer.from(untouchedBefore.payload_gzip))
    afterDatabase.close()
  })

  it('does not turn a prose-only blocker into automation recovery', async () => {
    const memoryDir = await makeMemoryDir()
    await writeQueue(memoryDir, {
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [task({
        id: 'task-prose-only',
        status: 'blocked',
        blockReason: 'Human approval is required before the task can continue.',
      })],
    })

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-prose-only',
      ownerIntent: 'Continue the requested work.',
    })

    expect(result.resolutions).not.toContainEqual(expect.objectContaining({ kind: 'resolve_automation_blocker' }))
    expect((await readQueue(memoryDir)).tasks[0]?.status).toBe('blocked')
  })
})

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-root',
    title: 'Run automation test',
    description: 'Test task.',
    domain: 'app',
    projectPath: '/tmp/project',
    status: 'exploring',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    structuredSpec: VALID_STRUCTURED_SPEC,
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-29T10:00:00.000Z',
    updatedAt: '2026-05-29T10:00:00.000Z',
    ...overrides,
  }
}
