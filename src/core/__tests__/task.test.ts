import { describe, it, expect } from 'vitest'
import { AcceptanceCriteria, Task, TaskQueue, TaskStatus } from '../task.js'

describe('TaskStatus', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['import_draft', 'exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check', 'pending_pr', 'done', 'shelved', 'blocked']
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

  it('applies default empty arrays', () => {
    const result = Task.parse(validTask)
    expect(result.notes).toEqual([])
    expect(result.gateResults).toEqual([])
    expect(result.acceptanceCriteria).toEqual([])
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
})
