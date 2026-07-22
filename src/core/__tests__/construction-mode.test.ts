import { describe, expect, it } from 'vitest'
import { constructionModeForTask } from '../construction-mode.js'
import type { Task } from '../task.js'

type TaskFixtureInput = Partial<Task> & { blockerKind?: 'change_order' | 'execution_failure' }

function task(partial: TaskFixtureInput): Task & { blocker?: string } {
  return {
    id: 't-1',
    title: 'Example',
    description: '',
    status: 'proposed',
    domain: 'default',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...partial,
  } as Task
}

describe('constructionModeForTask', () => {
  it.each([
    ['proposed', 'survey'],
    ['exploring', 'blueprint'],
    ['spec_review', 'blueprint'],
    ['ready', 'frame'],
    ['in_progress', 'build'],
    ['review', 'inspect'],
    ['gate_check', 'inspect'],
    ['done', 'punch_list'],
    ['shelved', 'punch_list'],
    ['pending_pr', 'punch_list'],
  ] as const)('maps %s to %s', (status, mode) => {
    expect(constructionModeForTask(task({ status }))).toBe(mode)
  })

  it('maps an explicit structured planning blocker to change_order', () => {
    expect(
      constructionModeForTask(
        task({
          status: 'blocked',
          blockerKind: 'change_order',
        }),
      ),
    ).toBe('change_order')
  })

  it('maps blocked execution failures to inspection', () => {
    expect(
      constructionModeForTask(
        task({
          status: 'blocked',
          blockerKind: 'execution_failure',
        }),
      ),
    ).toBe('inspect')
  })
})
