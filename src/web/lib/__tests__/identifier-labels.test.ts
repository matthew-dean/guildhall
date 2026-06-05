import { describe, expect, it } from 'vitest'

import { humanizeRuntimeText, labelForIdentifier, taskDisplayKey, taskDisplayLabel } from '../identifier-labels.js'

describe('identifier label maps', () => {
  it('uses short stable task keys for project-local task references', () => {
    const tasks = [
      { id: 'task-import-1l0mr2r', title: 'ContextMenu' },
      { id: 'task-import-1l0mr2r-split-component-implementation', title: 'Component implementation' },
      { id: 'task-import-1l0mr2r-split-storybook-story', title: 'Storybook story', displayKey: 'T-009' },
    ]

    expect(taskDisplayKey(tasks[0], tasks)).toBe('T-001')
    expect(taskDisplayKey(tasks[1], tasks)).toBe('T-002')
    expect(taskDisplayKey(tasks[2], tasks)).toBe('T-009')
    expect(taskDisplayLabel(tasks[1], tasks)).toBe('T-002')
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
})
