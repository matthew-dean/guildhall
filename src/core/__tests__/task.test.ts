import { describe, it, expect } from 'vitest'
import { Task, TaskQueue, TaskStatus, TaskPriority, AcceptanceCriteria } from '../task.js'

describe('TaskStatus', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check', 'done', 'blocked']
    for (const s of statuses) {
      expect(TaskStatus.parse(s)).toBe(s)
    }
  })

  it('rejects unknown status', () => {
    expect(() => TaskStatus.parse('unknown')).toThrow()
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
