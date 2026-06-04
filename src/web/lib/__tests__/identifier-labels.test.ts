import { describe, expect, it } from 'vitest'

import { humanizeRuntimeText, labelForIdentifier } from '../identifier-labels.js'

describe('identifier label maps', () => {
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
