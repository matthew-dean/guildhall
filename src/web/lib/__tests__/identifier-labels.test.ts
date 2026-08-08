import { describe, expect, it } from 'vitest'

import { humanizeRuntimeText, labelForIdentifier, taskDisplayKey, taskDisplayLabel } from '../identifier-labels.js'

describe('identifier label maps', () => {
  it('uses short stable task keys for project-local task references', () => {
    const tasks = [
      { id: 'task-import-1l0mr2r', title: 'ContextMenu' },
      { id: 'task-import-1l0mr2r-split-component-implementation', title: 'Component implementation' },
      { id: 'task-import-1l0mr2r-split-storybook-story', title: 'Storybook story', displayKey: 'T-009' },
    ]

    expect(taskDisplayKey(tasks[0], tasks)).toMatch(/^T-[A-Z0-9]{6}$/)
    expect(taskDisplayKey(tasks[1], tasks)).toMatch(/^T-[A-Z0-9]{6}$/)
    expect(taskDisplayKey(tasks[0], [tasks[0]])).toBe(taskDisplayKey(tasks[0], tasks))
    expect(taskDisplayKey(tasks[2], tasks)).toBe('T-009')
    expect(taskDisplayLabel(tasks[1], tasks)).toBe(taskDisplayKey(tasks[1], tasks))
  })

  it('resolves colliding numeric task ids to distinct stable keys', () => {
    const tasks = [
      { id: 'task-1' },
      { id: 'task-001' },
      { id: 'release-task-1' },
    ]
    const keys = tasks.map(task => taskDisplayKey(task, tasks, 'narrative-harness'))

    expect(new Set(keys).size).toBe(tasks.length)
    expect(keys.every(key => /^NAR-[A-Z0-9-]+$/.test(key))).toBe(true)
    expect(tasks.map(task => taskDisplayKey(task, tasks, 'narrative-harness'))).toEqual(keys)
  })

  it('turns runtime identifiers into owner-facing labels', () => {
    expect(labelForIdentifier('agent', 'spec-agent').label).toBe('Spec writer')
    expect(labelForIdentifier('domain', '_meta').label).toBe('Setup')
    expect(labelForIdentifier('status', 'exploring').label).toBe('Queued')
    expect(labelForIdentifier('status', 'spec_review').label).toBe('Awaiting approval')
    expect(labelForIdentifier('run-reason', 'all_terminal').label).toBe('Run finished')
  })

  it('humanizes progress text without exposing shell command internals', () => {
    expect(
      humanizeRuntimeText(
        'task-002 — in_progress → blocked. error: worktree setup failed — Command failed: git worktree add /tmp/project/task-002 guildhall/task-002 fatal',
        { 'task-002': 'Shape commerce spec' },
      ),
    ).toBe('Shape commerce spec — Working -> Blocked. error: worktree setup failed.')
  })

  it('replaces unknown long task ids with stable compact keys', () => {
    const taskId = 'task-import-9s8tkc-split-shape-fixture-and-expected-record-ground-truth'
    const text = humanizeRuntimeText(`The contracts task (${taskId}) is done.`, {}, 'narrative-harness')

    expect(text).toMatch(/^The contracts task \(NAR-[A-Z0-9]{6}\) is done\.$/)
    expect(text).not.toContain(taskId)
  })
})
