import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_PROJECT_TASK_FIELDS,
  findForbiddenProjectTaskFields,
  sanitizeTaskForProjectWrite,
  sanitizeTaskQueueForProjectWrite,
} from '../project-state-boundary.js'

describe('project-state-boundary', () => {
  it('strips runtime and evidence fields from active task records before project-local writes', () => {
    const task = {
      id: 'task-payment-oauth',
      title: 'Finish OAuth setup',
      status: 'blocked',
      spec: 'Keep the real spec.',
      notes: Array.from({ length: 60 }, (_, index) => `note ${index}`),
      reviewVerdicts: Array.from({ length: 70 }, (_, index) => ({ reviewer: `r-${index}`, ok: index % 2 === 0 })),
      adjudications: [{ id: 'adj-1' }],
      gateResults: [{ command: 'pnpm test', ok: true }],
      agentIssues: [{ id: 'issue-1', status: 'resolved' }],
      worktreePath: '/tmp/worktree',
      branchName: 'guildhall/task-payment-oauth',
      baseBranch: 'main',
      mergeRecord: { branch: 'guildhall/task-payment-oauth' },
      revisionCount: 9,
      retryWindow: { count: 3 },
      remediationAttempts: 2,
      escalations: [
        {
          id: 'esc-open',
          status: 'open',
          title: 'Need provider credentials',
          summary: 'The provider setup needs owner credentials.',
          question: 'Which provider should be used?',
          createdAt: '2026-06-06T12:00:00.000Z',
          resolvedAt: undefined,
          rawTranscript: 'large raw escalation transcript',
        },
        {
          id: 'esc-resolved',
          status: 'resolved',
          title: 'Resolved blocker',
          summary: 'Already fixed.',
          resolvedAt: '2026-06-06T12:01:00.000Z',
          rawTranscript: 'large resolved transcript',
        },
      ],
    }

    const result = sanitizeTaskForProjectWrite(task)

    for (const field of FORBIDDEN_PROJECT_TASK_FIELDS) {
      expect(result.task).not.toHaveProperty(field)
    }
    expect(result.task).toMatchObject({
      id: 'task-payment-oauth',
      title: 'Finish OAuth setup',
      status: 'blocked',
      spec: 'Keep the real spec.',
      openEscalations: [
        {
          id: 'esc-open',
          status: 'open',
          title: 'Need provider credentials',
          summary: 'The provider setup needs owner credentials.',
          question: 'Which provider should be used?',
          createdAt: '2026-06-06T12:00:00.000Z',
        },
      ],
    })
    expect(JSON.stringify(result.task)).not.toContain('large raw escalation transcript')
    expect(JSON.stringify(result.task)).not.toContain('esc-resolved')
    expect(result.removedFields).toEqual(expect.arrayContaining([
      'notes',
      'reviewVerdicts',
      'escalations',
      'worktreePath',
      'revisionCount',
    ]))
    expect(result.removedEvidenceBytes).toBeGreaterThan(1_000)
  })

  it('sanitizes task queues and reports forbidden fields before cleanup', () => {
    const queue = {
      version: 1,
      tasks: [
        { id: 'clean', title: 'Clean', status: 'ready' },
        { id: 'dirty', title: 'Dirty', status: 'ready', notes: ['note'], gateResults: [{ ok: true }] },
      ],
    }

    expect(findForbiddenProjectTaskFields(queue)).toEqual([
      { taskId: 'dirty', field: 'notes', bytes: expect.any(Number) },
      { taskId: 'dirty', field: 'gateResults', bytes: expect.any(Number) },
    ])

    const result = sanitizeTaskQueueForProjectWrite(queue)

    expect(result.queue).toMatchObject({
      version: 1,
      tasks: [
        { id: 'clean', title: 'Clean', status: 'ready' },
        { id: 'dirty', title: 'Dirty', status: 'ready' },
      ],
    })
    expect(findForbiddenProjectTaskFields(result.queue)).toEqual([])
    expect(result.taskDefinitionsRewritten).toBe(1)
  })
})
