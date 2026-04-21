import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { proposeTask, preRejectTask } from '../proposal.js'
import { readTasks } from '../task-queue.js'

let tmpDir: string
let tasksPath: string

async function seedEmptyQueue(): Promise<void> {
  const now = new Date().toISOString()
  await fs.writeFile(
    tasksPath,
    JSON.stringify({ version: 1, lastUpdated: now, tasks: [] }, null, 2),
    'utf-8',
  )
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-proposal-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  await seedEmptyQueue()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('proposeTask', () => {
  it('creates a task in status=proposed with origination=agent', async () => {
    const result = await proposeTask({
      tasksPath,
      proposal: {
        id: 'prop-1',
        title: 'Add fuzzer to the URL parser',
        description: 'Run 10k fuzz iterations against parseUrl and log crashes',
        domain: 'looma',
        projectPath: '/projects/looma',
        proposedBy: 'worker:looma:session-42',
        rationale: 'Noticed an unsanitized branch while reviewing parser.ts:142',
      },
    })
    expect(result.success).toBe(true)
    expect(result.taskId).toBe('prop-1')

    const { queue } = await readTasks({ tasksPath })
    expect(queue).not.toBeNull()
    const t = queue!.tasks[0]!
    expect(t.status).toBe('proposed')
    expect(t.origination).toBe('agent')
    expect(t.proposedBy).toBe('worker:looma:session-42')
    expect(t.proposalRationale).toMatch(/parser\.ts/)
  })

  it('rejects duplicate ids', async () => {
    await proposeTask({
      tasksPath,
      proposal: {
        id: 'prop-1',
        title: 't',
        description: 'd',
        domain: 'looma',
        projectPath: '/p',
        proposedBy: 'a',
        rationale: 'r',
      },
    })
    const second = await proposeTask({
      tasksPath,
      proposal: {
        id: 'prop-1',
        title: 't2',
        description: 'd2',
        domain: 'looma',
        projectPath: '/p',
        proposedBy: 'a',
        rationale: 'r',
      },
    })
    expect(second.success).toBe(false)
    expect(second.error).toMatch(/already exists/)
  })

  it('carries parentGoalId when provided', async () => {
    await proposeTask({
      tasksPath,
      proposal: {
        id: 'prop-1',
        title: 't',
        description: 'd',
        domain: 'looma',
        projectPath: '/p',
        proposedBy: 'a',
        rationale: 'r',
        parentGoalId: 'goal-platform-resilience',
      },
    })
    const { queue } = await readTasks({ tasksPath })
    expect(queue!.tasks[0]!.parentGoalId).toBe('goal-platform-resilience')
  })
})

describe('preRejectTask', () => {
  async function seedInProgress(id: string): Promise<void> {
    const now = new Date().toISOString()
    await fs.writeFile(
      tasksPath,
      JSON.stringify(
        {
          version: 1,
          lastUpdated: now,
          tasks: [
            {
              id,
              title: 'Work on X',
              description: 'Do X',
              domain: 'looma',
              projectPath: '/p',
              status: 'in_progress',
              priority: 'normal',
              dependsOn: [],
              outOfScope: [],
              acceptanceCriteria: [],
              notes: [],
              gateResults: [],
              escalations: [],
              revisionCount: 0,
              origination: 'agent',
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    )
  }

  it('moves the task to shelved with a structured reason', async () => {
    await seedInProgress('t-1')
    const result = await preRejectTask({
      tasksPath,
      taskId: 't-1',
      code: 'not_viable',
      detail: 'The external API does not support batch reads',
      rejectedBy: 'worker:42',
    })
    expect(result.success).toBe(true)

    const { queue } = await readTasks({ tasksPath })
    const t = queue!.tasks[0]!
    expect(t.status).toBe('shelved')
    expect(t.shelveReason?.code).toBe('not_viable')
    expect(t.shelveReason?.detail).toMatch(/batch reads/)
    expect(t.shelveReason?.rejectedBy).toBe('worker:42')
    expect(t.completedAt).toBeDefined()
  })

  it('does not increment revisionCount (FR-22 distinction)', async () => {
    await seedInProgress('t-1')
    await preRejectTask({
      tasksPath,
      taskId: 't-1',
      code: 'low_value',
      detail: 'Work would yield <5% improvement',
      rejectedBy: 'w',
    })
    const { queue } = await readTasks({ tasksPath })
    expect(queue!.tasks[0]!.revisionCount).toBe(0)
  })

  it('refuses to pre-reject a task that is already terminal', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      tasksPath,
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 't-done',
            title: 't',
            description: 'd',
            domain: 'l',
            projectPath: '/p',
            status: 'done',
            priority: 'normal',
            dependsOn: [],
            outOfScope: [],
            acceptanceCriteria: [],
            notes: [],
            gateResults: [],
            escalations: [],
            revisionCount: 0,
            origination: 'human',
            createdAt: now,
            updatedAt: now,
            completedAt: now,
          },
        ],
      }),
      'utf-8',
    )
    const result = await preRejectTask({
      tasksPath,
      taskId: 't-done',
      code: 'duplicate',
      detail: 'late',
      rejectedBy: 'w',
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already terminal/)
  })

  it('refuses unknown task ids', async () => {
    const result = await preRejectTask({
      tasksPath,
      taskId: 'does-not-exist',
      code: 'duplicate',
      detail: 'nope',
      rejectedBy: 'w',
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/)
  })
})
