import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildThread } from '../thread.js'
import { emptyWizardsState, type ProjectSnapshot } from '../wizards.js'

describe('buildThread', () => {
  it('prefers active task work over setup cards when both exist', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Import workspace',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [],
        },
        hasProvider: false,
        hasDirection: false,
        workspaceImportReviewed: false,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              message: 'Refining the import draft.',
            },
          },
        ],
      })

      expect(thread.activeTurnId).toBe('inflight:task-1')
      expect(thread.turns.some(t => t.kind === 'setup_step' && t.status === 'active')).toBe(false)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects last live-agent activity and stalled state onto in-flight turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Build the thing',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 180_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 240_000).toISOString(),
            event: {
              type: 'agent_started',
              task_id: 'task-1',
              agent_name: 'worker-agent',
            },
          },
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventAt).toBe(lastEventAt)
      expect(turn.liveAgent?.lastEventLabel).toBe('Finished file read')
      expect(turn.liveAgent?.stalled).toBe(true)
      expect(turn.liveAgent?.silentMs).toBeGreaterThanOrEqual(180_000)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('reconstructs a live in-flight agent from activity after the start event ages out', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 1_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.summary).toBe('Worker is working on this now.')
      expect(turn.liveAgent?.name).toBe('worker-agent')
      expect(turn.liveAgent?.lastEventAt).toBe(lastEventAt)
      expect(turn.liveAgent?.lastEventLabel).toBe('Finished file read')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('labels failed live tools as failed instead of finished', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'edit-file',
              is_error: true,
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventLabel).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.label).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.tone).toBe('danger')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows recent failed activity on blocked escalation turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix conversion',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'human_judgment_required',
                  summary: 'Worker stopped after hitting its turn limit.',
                  details: 'Exceeded maximum turn limit (24)',
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'edit-file',
              is_error: true,
              output: 'Invalid input for edit-file: [{"code":"invalid_type","expected":"string","received":"undefined","path":["oldString"],"message":"Required"}]',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.activity?.at(-1)?.label).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.tone).toBe('danger')
      expect(turn.activity?.at(-1)?.detail).toContain('missing oldString')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows a rolling excerpt while an agent is writing', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'I am checking ',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'the failing tests before editing.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.at(-1)?.label).toBe('Writing')
      expect(turn.activity?.at(-1)?.detail).toContain('checking the failing tests')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats empty-model reply errors as warnings and retries as running activity', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Model returned an empty reply. Retrying (1/2) without changing task state.',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Model returned an empty assistant message. The turn was ignored to keep the session healthy.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.[0]?.tone).toBe('running')
      expect(turn.activity?.[1]?.tone).toBe('warn')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps recent failed tool output visible while later writing continues', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix tests',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const laterWriting = Array.from({ length: 8 }, (_, index) => ({
        at: new Date(Date.now() + index).toISOString(),
        event: {
          type: index % 2 === 0 ? 'assistant_delta' : 'assistant_complete',
          task_id: 'task-1',
          agent_name: 'worker-agent',
          message: `later note ${index}`,
        },
      }))

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'run-command',
              is_error: true,
              output: 'vitest failed with 3 tests',
            },
          },
          ...laterWriting,
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.map(item => item.label)).toContain('Failed command')
      expect(turn.activity?.find(item => item.label === 'Failed command')?.detail).toContain('vitest failed')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('hides stale live activity older than the task updatedAt when a task has been reset', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const updatedAt = new Date().toISOString()
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Reset task',
              status: 'review',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 120_000).toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Old failure that should not survive reset',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity ?? []).toHaveLength(0)
      expect(turn.liveAgent).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects reviewer feedback as its own lifecycle turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Revise the thing',
              status: 'in_progress',
              revisionCount: 1,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: [
                    '**Aggregated revisions from 3 personas:**',
                    '',
                    'What must change:',
                    '- Fix the failing converter tests.',
                    '- Add a checkpoint before review.',
                  ].join('\n'),
                  timestamp: new Date(Date.now() - 120_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'review_feedback')
      if (!turn || turn.kind !== 'review_feedback') throw new Error('expected review feedback turn')
      expect(turn.persona).toBe('reviewer')
      expect(turn.phase).toBe('inflight')
      expect(turn.status).toBe('done')
      expect(turn.revisionCount).toBe(1)
      expect(turn.summary).toBe('Fix the failing converter tests.')
      expect(turn.feedback).toContain('Aggregated revisions')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('numbers reviewer feedback by feedback turn instead of current task revision', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Revise twice',
              status: 'in_progress',
              revisionCount: 2,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'What must change:\n- First fix.',
                  timestamp: new Date(Date.now() - 180_000).toISOString(),
                },
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'What must change:\n- Second fix.',
                  timestamp: new Date(Date.now() - 120_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const feedbackTurns = thread.turns.filter(t => t.kind === 'review_feedback')
      expect(feedbackTurns.map(t => t.kind === 'review_feedback' ? t.revisionCount : null)).toEqual([1, 2])
      expect(feedbackTurns.map(t => t.kind === 'review_feedback' ? t.summary : '')).toEqual([
        'First fix.',
        'Second fix.',
      ])
      expect(feedbackTurns.map(t => t.phase)).toEqual(['done', 'inflight'])
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('lets a newer failed verifier event dominate the active view over stale review feedback', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const reviewAt = new Date(Date.now() - 180_000).toISOString()
      const failAt = new Date(Date.now() - 30_000).toISOString()
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix auth callback',
              status: 'in_progress',
              revisionCount: 1,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: failAt,
              notes: [
                {
                  agentId: 'reviewer-agent',
                  role: 'reviewer',
                  content: 'What must change:\n- Add an explicit return type.',
                  timestamp: reviewAt,
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: failAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'shell',
              is_error: true,
              output: 'pnpm typecheck\nserver/api/auth/callback.get.ts(30,1): error TS1434',
            },
          },
        ],
      })

      const reviewTurn = thread.turns.find(t => t.kind === 'review_feedback')
      if (!reviewTurn || reviewTurn.kind !== 'review_feedback') throw new Error('expected review feedback turn')
      expect(reviewTurn.phase).toBe('done')

      const inflight = thread.turns.find(t => t.kind === 'inflight')
      if (!inflight || inflight.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(inflight.activity?.[0]?.label).toBe('Failed shell')
      expect(inflight.activity?.[0]?.detail).toContain('error TS1434')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })
})
