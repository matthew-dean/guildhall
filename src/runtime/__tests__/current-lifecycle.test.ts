import { describe, expect, it } from 'vitest'

import { currentLifecycleForTask } from '../current-lifecycle.js'

describe('currentLifecycleForTask', () => {
  const marker = {
    reopenedAt: '2026-08-08T12:00:00.000Z',
    status: 'exploring' as const,
    source: 'rerun_spec' as const,
  }

  it('keeps the rerun marker while the task is exploring', () => {
    expect(currentLifecycleForTask({
      id: 'task-086',
      title: 'Prove packaged Tauri sidecar',
      status: 'exploring',
      currentLifecycle: marker,
    } as any)).toEqual(marker)
  })

  it('ignores a stale rerun marker after the task advances to live work', () => {
    expect(currentLifecycleForTask({
      id: 'task-086',
      title: 'Prove packaged Tauri sidecar',
      status: 'in_progress',
      currentLifecycle: marker,
    } as any)).toBeNull()
  })
})
