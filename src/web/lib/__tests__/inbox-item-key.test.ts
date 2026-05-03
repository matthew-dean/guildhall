import { describe, expect, it } from 'vitest'

import { inboxItemKey, type InboxItem } from '../inbox-item-key.js'

describe('inboxItemKey', () => {
  it('stays unique for escalation items that share the same title', () => {
    const a = inboxItemKey({
      kind: 'open_escalation',
      escalationId: 'esc-task-003-1',
      taskId: 'task-003',
      title: 'Integrate Looma editor table primitives into Knit',
      detail: 'Spec author stopped after hitting its turn limit.',
      actionHref: '/task/task-003',
    })
    const b = inboxItemKey({
      kind: 'open_escalation',
      escalationId: 'esc-task-004-1',
      taskId: 'task-004',
      title: 'Integrate Looma editor table primitives into Knit',
      detail: 'Spec author stopped after hitting its turn limit.',
      actionHref: '/task/task-004',
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
