import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
import { listOwnerInputRequests } from '../owner-input-store.js'
import { migrateTaskQuestionsToBoundedChat } from '../task-question-migration.js'

const now = '2026-06-01T12:00:00.000Z'

describe('task question migration', () => {
  it('moves unanswered task questions into owner-input linked bounded chat and removes openQuestions', async () => {
    const root = await projectWithTasks([{
      id: 'task-1',
      title: 'Clarify billing policy',
      description: 'Needs owner direction.',
      domain: 'product',
      projectPath: '/repo/demo',
      status: 'exploring',
      priority: 'normal',
      notes: [],
      dependsOn: [],
      openQuestions: [{
        id: 'q1',
        kind: 'choice',
        prompt: 'Which policy should Guildhall follow?',
        choices: ['A', 'B'],
        askedBy: 'spec-agent',
        askedAt: now,
      }],
    }])

    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: true, now })
    expect(result.changedTasks).toEqual(['task-1'])
    expect(result.createdOwnerInputRequests).toHaveLength(1)
    expect(result.createdSessions).toHaveLength(1)

    const queue = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    expect(queue.tasks[0].openQuestions).toBeUndefined()

    const requests = await listOwnerInputRequests(root)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      boundedChatSessionId: result.createdSessions[0],
      status: 'waiting_for_owner',
    })

    const session = JSON.parse(await readFile(
      getProjectSystemStatePath(root, path.join('bounded-chat', `${result.createdSessions[0]}.json`)),
      'utf8',
    ))
    expect(session.objective.kind).toBe('task_shaping')
    expect(session.source).toBe('migration:0.10.0/task-open-questions-to-bounded-chat:task-1:q1')
    expect(session.subObjectives[0].prompt).toBe('Which policy should Guildhall follow?')
    expect(session.subObjectives[0].choices).toEqual(['A', 'B'])
    expect(session.transitionReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ machineId: 'bounded-chat', event: 'wait_for_owner', to: 'waiting_for_owner' }),
    ]))
  })

  it('preserves answered questions as task notes and is idempotent', async () => {
    const root = await projectWithTasks([{
      id: 'task-1',
      title: 'Answered task',
      description: 'Already answered.',
      domain: 'product',
      projectPath: '/repo/demo',
      status: 'exploring',
      priority: 'normal',
      notes: [],
      dependsOn: [],
      openQuestions: [{
        id: 'q1',
        kind: 'text',
        prompt: 'Which policy?',
        answer: 'Use policy A.',
        answeredAt: now,
        askedBy: 'spec-agent',
        askedAt: now,
      }],
    }])

    const first = await migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: true, now })
    const second = await migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: true, now })

    expect(first.changedTasks).toEqual(['task-1'])
    expect(first.createdOwnerInputRequests).toEqual([])
    expect(first.createdSessions).toEqual([])
    expect(second.changedTasks).toEqual([])

    const queue = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    expect(queue.tasks[0].openQuestions).toBeUndefined()
    expect(queue.tasks[0].notes).toEqual([
      expect.objectContaining({
        agentId: 'migration:0.10.0/task-open-questions-to-bounded-chat',
        content: expect.stringContaining('Use policy A.'),
      }),
    ])
  })

  it('migrates fallback narration as the actual embedded question plus helper context', async () => {
    const root = await projectWithTasks([{
      id: 'task-alert',
      title: 'AlertDialog',
      description: 'Needs owner direction.',
      domain: 'product',
      projectPath: '/repo/demo',
      status: 'exploring',
      priority: 'normal',
      notes: [],
      dependsOn: [],
      openQuestions: [{
        id: 'q1',
        kind: 'text',
        prompt: 'I have enough context. The roadmap lists AlertDialog as missing (P0 gap). The existing `ui-dialog` uses `<dialog>`.\n\nThe key question I need to ask before drafting: what variants does the user need? Let me write the product brief first, then ask.',
        askedBy: 'spec-agent',
        askedAt: now,
      }],
    }])

    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: true, now })
    const requests = await listOwnerInputRequests(root)
    const session = JSON.parse(await readFile(
      getProjectSystemStatePath(root, path.join('bounded-chat', `${result.createdSessions[0]}.json`)),
      'utf8',
    ))

    expect(requests[0]?.prompt).toBe('What variants does AlertDialog need?')
    expect(session.subObjectives[0]).toMatchObject({
      prompt: 'What variants does AlertDialog need?',
      helperText: 'The roadmap lists AlertDialog as missing (P0 gap). The existing `ui-dialog` uses `<dialog>`.',
    })
  })

  it('does not inspect or apply legacy questions after SQLite promotion', async () => {
    const root = await projectWithTasks([{
      id: 'legacy-task',
      title: 'Legacy task',
      openQuestions: [{ id: 'q1', prompt: 'Legacy question?' }],
    }])
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    await writeProjectStateDatabaseSnapshot(tasksPath, {
      projectRoot: root,
      queue: {
        version: 1,
        lastUpdated: now,
        tasks: [{ id: 'canonical-task', title: 'Canonical task', status: 'ready' }],
      },
      summary: { projectId: 'questions-test', generatedAt: now },
    })
    promoteProjectStateDatabaseAuthority(root)

    await expect(migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: false, now }))
      .resolves.toEqual({ changedTasks: [], createdOwnerInputRequests: [], createdSessions: [], affectedPaths: [] })
    await expect(migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: true, now }))
      .rejects.toThrow(/SQLite already owns current project state/)
  })

  it('rejects malformed legacy queue data instead of treating it as empty', async () => {
    const root = await projectWithTasks([])
    await writeFile(path.join(root, '.guildhall', 'TASKS.json'), '{"tasks": "not-a-list"}')

    await expect(migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: false, now }))
      .rejects.toThrow(/does not contain a task queue/)
  })
})

async function projectWithTasks(tasks: unknown[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'guildhall-questions-'))
  await mkdir(path.join(root, '.guildhall'), { recursive: true })
  await writeFile(path.join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
    version: 1,
    lastUpdated: now,
    tasks,
  }, null, 2))
  return root
}
