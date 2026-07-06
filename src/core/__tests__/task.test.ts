import { describe, it, expect } from 'vitest'
import { AcceptanceCriteria, RequestIntake, Task, TaskQueue, TaskStatus } from '../task.js'

describe('TaskStatus', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['import_draft', 'exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check', 'pending_pr', 'done', 'shelved', 'blocked', 'archived', 'cancelled']
    for (const s of statuses) {
      expect(TaskStatus.parse(s)).toBe(s)
    }
  })

  it('rejects unknown status', () => {
    expect(() => TaskStatus.parse('unknown')).toThrow()
  })

  it('normalizes legacy pending status to ready', () => {
    expect(TaskStatus.parse('pending')).toBe('ready')
  })
})

describe('Task', () => {
  const validTask = {
    id: 'task-001',
    title: 'Add ghost button variant',
    description: 'Add a ghost variant to ui-button in @looma/core',
    domain: 'looma',
    projectPath: '/projects/looma',
    status: 'exploring' as const,
    priority: 'normal' as const,
    dependsOn: [],
    outOfScope: ['Knit-specific styling'],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    revisionCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('parses a valid task', () => {
    const result = Task.parse(validTask)
    expect(result.id).toBe('task-001')
    expect(result.status).toBe('exploring')
    expect(result.revisionCount).toBe(0)
  })

  it('normalizes legacy pending tasks to ready', () => {
    const result = Task.parse({ ...validTask, status: 'pending' })
    expect(result.status).toBe('ready')
  })

  it('applies default priority of normal', () => {
    const { priority, ...withoutPriority } = validTask
    const result = Task.parse(withoutPriority)
    expect(result.priority).toBe('normal')
  })

  it('defaults missing legacy projectPath to the task root marker', () => {
    const { projectPath, ...withoutProjectPath } = validTask
    const result = Task.parse(withoutProjectPath)
    expect(result.projectPath).toBe('.')
  })

  it('applies default empty arrays', () => {
    const result = Task.parse(validTask)
    expect(result.notes).toEqual([])
    expect(result.gateResults).toEqual([])
    expect(result.acceptanceCriteria).toEqual([])
    expect(result.references).toEqual([])
  })

  it('rejects task without required fields', () => {
    expect(() => Task.parse({ id: 'x' })).toThrow()
  })

  it('accepts task with optional spec and completedAt', () => {
    const result = Task.parse({
      ...validTask,
      spec: '## Summary\nAdd ghost variant.\n## Acceptance Criteria\n1. Ghost variant exists.',
      completedAt: new Date().toISOString(),
    })
    expect(result.spec).toContain('Ghost variant')
    expect(result.completedAt).toBeDefined()
  })

  it('normalizes legacy null blockReason to undefined', () => {
    const result = Task.parse({
      ...validTask,
      status: 'ready',
      blockReason: null,
    })
    expect(result.blockReason).toBeUndefined()
  })

  it('does not synthesize worker pre-rejection metadata for terminal shelves that omit policy fields', () => {
    const result = Task.parse({
      ...validTask,
      status: 'shelved',
      shelveReason: {
        code: 'duplicate',
        detail: 'Duplicate of task-006',
        rejectedBy: 'system:import-draft-dedupe',
        rejectedAt: new Date().toISOString(),
      },
    })
    expect(result.shelveReason).toMatchObject({
      code: 'duplicate',
      detail: 'Duplicate of task-006',
      rejectedBy: 'system:import-draft-dedupe',
    })
    expect(result.shelveReason?.source).toBeUndefined()
    expect(result.shelveReason?.policyApplied).toBeUndefined()
    expect(result.shelveReason?.requeueCount).toBeUndefined()
  })

  it('normalizes legacy policy shelves to the current proposal-policy shape', () => {
    const result = Task.parse({
      ...validTask,
      status: 'archived',
      shelveReason: {
        code: 'duplicate',
        detail: 'Superseded by newer scope shaping.',
        source: 'policy',
      },
    })
    expect(result.status).toBe('archived')
    expect(result.shelveReason).toMatchObject({
      code: 'duplicate',
      detail: 'Superseded by newer scope shaping.',
      source: 'proposal_policy',
      rejectedBy: 'system:proposal-policy',
      rejectedAt: '1970-01-01T00:00:00.000Z',
    })
  })

  it('defaults pressure-test summary on legacy request intake records', () => {
    const result = Task.parse({
      ...validTask,
      requestIntake: {
        intent: 'implementation',
        recommendedNextAction: 'proceed_to_implementation_spec',
        componentStack: [],
        clarifyingQuestions: [],
        createdAt: new Date().toISOString(),
        createdBy: 'request-intake',
      },
    })

    expect(result.requestIntake?.pressureTestSummary).toMatchObject({
      systemOwned: true,
      degree: 'automatic',
    })
    expect(result.requestIntake?.pressureTestSummary.checks.map(check => check.id)).toContain('verification')
  })

  it('accepts durable source references on tasks', () => {
    const result = Task.parse({
      ...validTask,
      references: ['import:/repo/docs/specs/story-memory-schemas.md'],
    })

    expect(result.references).toEqual(['import:/repo/docs/specs/story-memory-schemas.md'])
  })

  it('accepts a review-risk profile for calibrated review routing', () => {
    const result = Task.parse({
      ...validTask,
      status: 'ready',
      reviewRisk: {
        lanes: ['ux_comprehension', 'copy_clarity'],
        recipes: [{
          recipeId: 'product-ux-zero-context',
          version: 'v1',
          required: true,
          releaseBlocking: true,
          lanes: ['ux_comprehension', 'copy_clarity'],
          requiredArtifacts: ['visual-evidence'],
          reason: 'The task changes a user-facing first-run flow.',
        }],
        requiredArtifacts: ['implementation-summary', 'verification-evidence', 'visual-evidence'],
        artifactPolicy: 'required_before_review',
        assessedAt: '2026-05-25T12:00:00.000Z',
        assessedBy: 'coordinator-review-planner',
      },
    })

    expect(result.reviewRisk?.lanes).toEqual(['ux_comprehension', 'copy_clarity'])
    expect(result.reviewRisk?.recipes[0]).toMatchObject({
      recipeId: 'product-ux-zero-context',
      releaseBlocking: true,
    })
    expect(result.reviewRisk?.artifactPolicy).toBe('required_before_review')
  })

  it('preserves logical work visibility and semantic delivery steps', () => {
    const result = Task.parse({
      ...validTask,
      workVisibility: {
        kind: 'supporting',
        label: 'Planning support',
        countInProjectTotals: true,
      },
      deliverySteps: [
        {
          id: 'runtime-proof',
          title: 'Runtime proof',
          kind: 'verify',
          status: 'blocked',
          required: true,
          blocksCompletion: true,
          sourceTaskId: 'task-runtime-proof',
          evidenceChannel: 'simulator_snapshot',
          toolLabel: 'local simulator',
        },
      ],
    })

    expect(result.workVisibility).toMatchObject({
      kind: 'supporting',
      countInProjectTotals: true,
    })
    expect(result.deliverySteps?.[0]).toMatchObject({
      kind: 'verify',
      status: 'blocked',
      evidenceChannel: 'simulator_snapshot',
      toolLabel: 'local simulator',
    })
  })
})

describe('AcceptanceCriteria', () => {
  it('parses all verifiedBy types', () => {
    for (const type of ['automated', 'review', 'human'] as const) {
      const result = AcceptanceCriteria.parse({
        id: `ac-${type}`,
        description: 'Test criterion',
        verifiedBy: type,
      })
      expect(result.verifiedBy).toBe(type)
      expect(result.met).toBe(false) // default
      expect(result.scenario).toBe('Test criterion')
      expect(result.expectation).toBe('Test criterion')
    }
  })

  it('accepts optional command for automated criteria', () => {
    const result = AcceptanceCriteria.parse({
      id: 'ac-1',
      description: 'Build passes',
      verifiedBy: 'automated',
      command: 'pnpm build',
    })
    expect(result.command).toBe('pnpm build')
  })

  it('derives structured scenario and expectation from given/when/then descriptions', () => {
    const result = AcceptanceCriteria.parse({
      id: 'ac-1',
      description: 'Given a selected block, when the menu opens, then the approved actions appear.',
      verifiedBy: 'review',
    })
    expect(result.scenario).toBe('Given a selected block, when the menu opens')
    expect(result.expectation).toBe('Then the approved actions appear.')
  })

  it('normalizes command-like verifiedBy values from agent-written criteria', () => {
    const result = AcceptanceCriteria.parse({
      id: 'ac-1',
      description: 'Tests pass',
      verifiedBy: 'vitest run',
    })
    expect(result.verifiedBy).toBe('automated')
    expect(result.command).toBe('vitest run')
  })

  it('normalizes unknown non-command verifiedBy values to reviewer judgment', () => {
    const result = AcceptanceCriteria.parse({
      id: 'ac-1',
      description: 'Copy reads clearly',
      verifiedBy: 'copywriter',
    })
    expect(result.verifiedBy).toBe('review')
  })

  it('normalizes legacy string acceptance criteria to review criteria', () => {
    const result = AcceptanceCriteria.parse('Later work has its own release boundary.')

    expect(result).toMatchObject({
      id: 'legacy-later-work-has-its-own-release-boundary',
      description: 'Later work has its own release boundary.',
      scenario: 'Later work has its own release boundary.',
      expectation: 'Later work has its own release boundary.',
      verifiedBy: 'review',
      met: false,
    })
  })

  it('normalizes legacy text acceptance criteria to review criteria', () => {
    const result = AcceptanceCriteria.parse({ text: 'Reviewed.', met: false })

    expect(result).toMatchObject({
      id: 'legacy-reviewed',
      description: 'Reviewed.',
      verifiedBy: 'review',
      met: false,
    })
  })
})

describe('RequestIntake', () => {
  it('normalizes partial legacy request intake records', () => {
    const result = RequestIntake.parse({ createdBy: 'workspace-importer' })

    expect(result).toMatchObject({
      intent: 'implementation',
      recommendedNextAction: 'proceed_to_implementation_spec',
      createdBy: 'workspace-importer',
      createdAt: '1970-01-01T00:00:00.000Z',
    })
  })
})

describe('TaskQueue', () => {
  it('parses a valid queue', () => {
    const queue = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
    }
    const result = TaskQueue.parse(queue)
    expect(result.tasks).toEqual([])
    expect(result.version).toBe(1)
  })

  it('applies default version of 1', () => {
    const result = TaskQueue.parse({
      lastUpdated: new Date().toISOString(),
      tasks: [],
    })
    expect(result.version).toBe(1)
  })

  it('defaults execution plan actions for existing task queues', () => {
    const result = TaskQueue.parse({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
    })

    expect(result.executionPlanActions).toEqual([])
  })

  it('defaults scope authority requests for existing task queues', () => {
    const result = TaskQueue.parse({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
    })

    expect(result.scopeAuthorityRequests).toEqual([])
  })

  it('normalizes legacy null release descriptions to absent descriptions', () => {
    const result = TaskQueue.parse({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
      releases: [
        {
          id: 'release-1',
          label: 'Release 1',
          description: null,
          nodeIds: [],
          deferredNodeIds: [],
        },
      ],
    })

    expect(result.releases[0]?.description).toBeUndefined()
  })

  it('normalizes legacy string proof paths while parsing task queues', () => {
    const result = TaskQueue.parse({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [{
        id: 'task-1',
        title: 'Task',
        description: 'Task.',
        domain: 'core',
        status: 'done',
        priority: 'normal',
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
        proofPaths: ['artifacts/fixture-evaluator-proof.md'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    })

    expect(result.tasks[0]?.proofPaths?.[0]).toMatchObject({
      id: 'artifacts-fixture-evaluator-proof-md',
      title: 'artifacts/fixture-evaluator-proof.md',
    })
  })

  it('normalizes skeletal legacy tasks while parsing task queues', () => {
    const result = TaskQueue.parse({
      version: 1,
      tasks: [{
        id: 'task-1',
        title: 'Review proof packet',
        status: 'spec_review',
        hierarchy: { parentId: 'task-parent', relation: 'child' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    })

    expect(result.lastUpdated).toBe('1970-01-01T00:00:00.000Z')
    expect(result.tasks[0]).toMatchObject({
      description: 'Task',
      domain: 'general',
      hierarchy: { parentId: 'task-parent', relation: 'decomposes' },
    })
  })

  it('defaults work hierarchy relation to contains', () => {
    const result = Task.parse({
      id: 'task-1',
      title: 'Task',
      description: 'Task.',
      domain: 'test',
      projectPath: '/tmp/project',
      status: 'ready',
      priority: 'normal',
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      origination: 'human',
      revisionCount: 0,
      remediationAttempts: 0,
      hierarchy: { childIds: [], order: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    expect(result.hierarchy?.relation).toBe('contains')
  })
})
