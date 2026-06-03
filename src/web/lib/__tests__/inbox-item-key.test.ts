import { describe, expect, it } from 'vitest'

import { inboxItemKey, type InboxItem } from '../inbox-item-key.js'

describe('inboxItemKey', () => {
  it('stays unique for task-backed alert items that share the same title', () => {
    const a = inboxItemKey({
      kind: 'spec_fill_pending',
      taskId: 'task-003',
      title: 'Integrate Looma editor table primitives into Knit',
      detail: 'Optional cleanup: add acceptance criteria.',
      actionHref: '/task/task-003?tab=spec',
    })
    const b = inboxItemKey({
      kind: 'spec_fill_pending',
      taskId: 'task-004',
      title: 'Integrate Looma editor table primitives into Knit',
      detail: 'Optional cleanup: add acceptance criteria.',
      actionHref: '/task/task-004?tab=spec',
    })

    expect(a).not.toBe(b)
  })

  it('stays stable for identical items', () => {
    const item: InboxItem = {
      severity: 'low',
      kind: 'lever_questions',
      title: 'Review project policies',
      detail: 'One default policy still needs review.',
      actionHref: '/settings',
    }

    expect(inboxItemKey(item)).toBe(inboxItemKey(item))
  })
})
