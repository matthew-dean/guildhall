import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getProjectSystemStateDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { createOwnerInputRequest, listOwnerInputRequests } from '../owner-input-store.js'
import { listBoundedChatSessions } from '../bounded-chat.js'
import { repairOwnerInputState } from '../owner-input-state-repair.js'

const now = '2026-06-03T18:10:00.000Z'

describe('repairOwnerInputState', () => {
  it('cancels malformed narration owner-input records and records the repair on the task', async () => {
    const root = await projectWithTasks([task('task-1', 'Converter commands')])
    const created = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'test:bad-question',
      now,
      actor: 'test',
      source: { kind: 'task', taskId: 'task-1', questionId: 'q-bad' },
      target: { kind: 'thread' },
      question: {
        prompt: 'Which command should verify the converter package?',
        choices: ['pnpm test', 'pnpm build'],
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify Converter commands',
        successCriteria: ['Owner answers the linked bounded-chat session.'],
      },
    })
    await rewriteOwnerInputPrompt(root, created.request.id, {
      prompt: 'I have enough from the glob results. Let me piece together what I know:',
      choices: [
        'The converter package is at `packages/converter/`',
        'It uses **vitest**',
      ],
    })

    const result = await repairOwnerInputState({ projectRoot: root, apply: true, now })

    expect(result.cancelledInvalid).toEqual([created.request.id])
    expect(await listOwnerInputRequests(root)).toEqual([
      expect.objectContaining({
        id: created.request.id,
        status: 'cancelled',
        receipts: [expect.objectContaining({ event: 'cancel_invalid', to: 'cancelled' })],
      }),
    ])
    expect(listBoundedChatSessions(getProjectSystemStateDir(root))).toEqual([
      expect.objectContaining({
        id: created.session.id,
        status: 'cancelled',
        closure: expect.objectContaining({ outcome: 'cancelled' }),
      }),
    ])
    const queue = await readQueue(root)
    expect(queue.tasks[0]?.notes).toEqual([
      expect.objectContaining({
        role: 'state-repair',
        content: expect.stringContaining('agent narration or evidence summary'),
      }),
    ])
  })

  it('resolves containable planning-note questions with a recorded assumption', async () => {
    const root = await projectWithTasks([task('task-2', 'Add planning note')])
    const first = await createPlanningNoteQuestion(root, 'q-1')
    const second = await createPlanningNoteQuestion(root, 'q-2')
    const duplicate = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'test:already-posted',
      now,
      actor: 'test',
      source: { kind: 'task', taskId: 'task-2', questionId: 'q-fallback' },
      target: { kind: 'thread' },
      question: {
        prompt: 'Which file should receive the planning note?',
        choices: ['.cursor/plan.md', '.guildhall/project-brief.md'],
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify planning note',
        successCriteria: ['Owner answers the linked bounded-chat session.'],
      },
    })
    await rewriteOwnerInputPrompt(root, duplicate.request.id, {
      prompt: 'No problem - I already have the question posted. The user has not answered it yet.',
      choices: undefined,
    })

    const result = await repairOwnerInputState({ projectRoot: root, apply: true, now })

    expect(result.resolvedByAssumption).toEqual(expect.arrayContaining([first.request.id, second.request.id]))
    expect(result.cancelledInvalid).toEqual([duplicate.request.id])
    const requests = await listOwnerInputRequests(root)
    expect(requests.every(request => request.status === 'cancelled')).toBe(true)
    const queue = await readQueue(root)
    expect(JSON.stringify(queue.tasks[0]?.notes)).toContain('Use `.cursor/plan.md`')
    expect(JSON.stringify(queue.tasks[0]?.notes)).toContain('atomic-commit containment')
  })
})

async function createPlanningNoteQuestion(root: string, questionId: string) {
  return createOwnerInputRequest({
    projectRoot: root,
    projectId: 'demo',
    commandId: `test:${questionId}`,
    now,
    actor: 'test',
    source: { kind: 'task', taskId: 'task-2', questionId },
    target: { kind: 'thread' },
    question: {
      prompt: 'I do not see a TODO.md, PLANNING.md, or BACKLOG.md in the repo. Where should I put the "review timezone wording later" note?',
      choices: [
        '.cursor/plan.md - add a note there',
        '.guildhall/project-brief.md - add a note there',
        'Create a new TODO.md at the project root',
      ],
    },
    objective: {
      kind: 'task_shaping',
      label: 'Clarify planning note',
      successCriteria: ['Owner answers the linked bounded-chat session.'],
    },
  })
}

async function rewriteOwnerInputPrompt(root: string, requestId: string, patch: { prompt: string; choices?: string[] }): Promise<void> {
  const requestFile = getProjectSystemStatePath(root, path.join('owner-input', `${requestId}.json`))
  const request = JSON.parse(await readFile(requestFile, 'utf8'))
  request.prompt = patch.prompt
  if (patch.choices === undefined) delete request.choices
  else request.choices = patch.choices
  await writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8')

  const sessionFile = getProjectSystemStatePath(root, path.join('bounded-chat', `${request.boundedChatSessionId}.json`))
  const session = JSON.parse(await readFile(sessionFile, 'utf8'))
  session.subObjectives[0].prompt = patch.prompt
  if (patch.choices === undefined) delete session.subObjectives[0].choices
  else session.subObjectives[0].choices = patch.choices
  await writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

async function projectWithTasks(tasks: unknown[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-repair-'))
  const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
  await mkdir(path.dirname(tasksPath), { recursive: true })
  await writeFile(tasksPath, JSON.stringify({
    version: 1,
    lastUpdated: now,
    tasks,
  }, null, 2))
  return root
}

function task(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    description: title,
    domain: 'product',
    projectPath: '/repo/demo',
    status: 'exploring',
    priority: 'normal',
    notes: [],
    dependsOn: [],
  }
}

async function readQueue(root: string): Promise<{ tasks: Array<{ notes?: unknown[] }> }> {
  return JSON.parse(await readFile(getProjectSystemStatePath(root, 'TASKS.json'), 'utf8'))
}
