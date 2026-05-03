import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { postUserQuestionTool } from '../post-user-question.js'

let tmpDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-question-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  await fs.writeFile(
    tasksPath,
    JSON.stringify({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: 'task-001',
          title: 'Test',
          description: 'desc',
          domain: 'knit',
          projectPath: tmpDir,
          status: 'exploring',
          priority: 'normal',
          dependsOn: [],
          outOfScope: [],
          acceptanceCriteria: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }, null, 2),
    'utf-8',
  )
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('postUserQuestionTool', () => {
  it('defaults task context from metadata when omitted', async () => {
    const result = await postUserQuestionTool.execute(
      {
        kind: 'choice',
        body: 'Pick one',
        choices: ['A', 'B'],
        selectionMode: 'single',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-001',
          current_agent_id: 'spec-agent',
        },
      },
    )
    expect(result.is_error).toBe(false)

    const queue = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as {
      tasks: Array<{ openQuestions?: Array<{ askedBy?: string; prompt?: string }> }>
    }
    expect(queue.tasks[0]?.openQuestions).toHaveLength(1)
    expect(queue.tasks[0]?.openQuestions?.[0]?.askedBy).toBe('spec-agent')
    expect(queue.tasks[0]?.openQuestions?.[0]?.prompt).toBe('Pick one')
  })

  it('accepts prompt as an alias for body on choice questions', async () => {
    const result = await postUserQuestionTool.execute(
      {
        kind: 'choice',
        prompt: 'Pick one',
        choices: ['A', 'B'],
        selectionMode: 'single',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-001',
          current_agent_id: 'spec-agent',
        },
      },
    )
    expect(result.is_error).toBe(false)

    const queue = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as {
      tasks: Array<{ openQuestions?: Array<{ prompt?: string; choices?: string[] }> }>
    }
    expect(queue.tasks[0]?.openQuestions?.[0]).toMatchObject({
      prompt: 'Pick one',
      choices: ['A', 'B'],
    })
  })

  it('infers structured choice questions from last_assistant_text when the model calls it with {}', async () => {
    const metadata: Record<string, unknown> = {
      tasks_path: tasksPath,
      current_task_id: 'task-001',
      current_agent_id: 'spec-agent',
      last_assistant_text: [
        'Pick one option per item:',
        '',
        '1) **Primary scenario to spec**',
        '- A) Validation failure',
        '- B) Empty assistant message',
        '',
        '2) **Stop behavior**',
        '- A) Stop immediately',
        '- B) Allow a batch, then stop',
      ].join('\n'),
    }

    const first = await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    const second = await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    expect(first.is_error).toBe(false)
    expect(second.is_error).toBe(false)

    const queue = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as {
      tasks: Array<{ openQuestions?: Array<{ kind?: string; prompt?: string; choices?: string[] }> }>
    }
    expect(queue.tasks[0]?.openQuestions).toHaveLength(2)
    expect(queue.tasks[0]?.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      prompt: 'Primary scenario to spec',
      choices: ['Validation failure', 'Empty assistant message'],
    })
    expect(queue.tasks[0]?.openQuestions?.[1]).toMatchObject({
      kind: 'choice',
      prompt: 'Stop behavior',
      choices: ['Stop immediately', 'Allow a batch, then stop'],
    })
  })

  it('exposes a usable JSON schema so models see the real argument shape', () => {
    expect(postUserQuestionTool.jsonSchema).toMatchObject({
      type: 'object',
      properties: {
        kind: { type: 'string' },
        body: { type: 'string' },
        prompt: { type: 'string' },
        choices: { type: 'array' },
        selectionMode: { type: 'string' },
      },
    })
  })

  it('limits inferred questions from assistant prose to the top three', async () => {
    const metadata: Record<string, unknown> = {
      tasks_path: tasksPath,
      current_task_id: 'task-001',
      current_agent_id: 'spec-agent',
      last_assistant_text: [
        'Pick one option per item:',
        '',
        '1) **First**',
        '- A) one',
        '- B) two',
        '',
        '2) **Second**',
        '- A) one',
        '- B) two',
        '',
        '3) **Third**',
        '- A) one',
        '- B) two',
        '',
        '4) **Fourth**',
        '- A) one',
        '- B) two',
      ].join('\n'),
    }

    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    const fourth = await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    expect(fourth.is_error).toBe(true)

    const queue = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as {
      tasks: Array<{ openQuestions?: Array<{ prompt?: string }> }>
    }
    expect(queue.tasks[0]?.openQuestions).toHaveLength(3)
    expect(queue.tasks[0]?.openQuestions?.map((q) => q.prompt)).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  it('prefers prompt-line plus numbered choices over promoting the trailing Other option into the prompt', async () => {
    const metadata: Record<string, unknown> = {
      tasks_path: tasksPath,
      current_task_id: 'task-001',
      current_agent_id: 'spec-agent',
      last_assistant_text: [
        'Got it — I’ll keep this first intake tight.',
        '',
        'To lock scope before I draft acceptance criteria, pick one:',
        '',
        '1. **Behavior spec only** — define what “narrowed first-turn batch” means.',
        '2. **End-to-end feature spec** — behavior + storage/format expectations.',
        '3. **Evaluation harness spec** — define test scenarios + pass/fail metrics.',
        '4. **Other** — tell me your target in one line.',
        '',
        'Also, what should success look like in one concrete check?',
        '- A) In first turn, agent asks at most N questions and yields.',
        '- B) Task spec quality stays complete while first turn stays narrow.',
        '- C) Both A and B.',
        '- D) Other.',
      ].join('\n'),
    }

    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })

    const queue = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as {
      tasks: Array<{ openQuestions?: Array<{ prompt?: string; choices?: string[] }> }>
    }
    expect(queue.tasks[0]?.openQuestions).toHaveLength(2)
    expect(queue.tasks[0]?.openQuestions?.[0]).toMatchObject({
      prompt: 'To lock scope before I draft acceptance criteria, pick one:',
      choices: [
        'Behavior spec only',
        'End-to-end feature spec',
        'Evaluation harness spec',
        'Other',
      ],
    })
    expect(queue.tasks[0]?.openQuestions?.[1]).toMatchObject({
      prompt: 'Also, what should success look like in one concrete check?',
      choices: [
        'In first turn, agent asks at most N questions and yields.',
        'Task spec quality stays complete while first turn stays narrow.',
        'Both A and B.',
        'Other.',
      ],
    })
  })

  it('infers multiple choice questions from headed sections that use lettered A/B/C options', async () => {
    const metadata: Record<string, unknown> = {
      tasks_path: tasksPath,
      current_task_id: 'task-001',
      current_agent_id: 'spec-agent',
      last_assistant_text: [
        '### 1) What should be the **primary success signal** for this task? (pick one)',
        'A. Spec quality only: clear ACs + testing strategy, no implementation expectations',
        'B. Implementation-ready: ACs are directly testable and mapped to unit/integration tests',
        'C. End-to-end governance: includes ACs for behavior, tests, task-state transitions, and transcript persistence as release gates',
        '',
        '### 2) Coverage posture for the future implementation (pick one)',
        'A. Standard floor only (existing project defaults; no extra target)',
        'B. Elevated on touched intake modules (explicit higher expectation in spec)',
        'C. Standard floor + explicit exemption note allowed for non-deterministic orchestration paths',
      ].join('\n'),
    }

    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })
    await postUserQuestionTool.execute({}, { cwd: '/tmp', metadata })

    const queue = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as {
      tasks: Array<{ openQuestions?: Array<{ prompt?: string; choices?: string[] }> }>
    }
    expect(queue.tasks[0]?.openQuestions).toHaveLength(2)
    expect(queue.tasks[0]?.openQuestions?.[0]).toMatchObject({
      prompt: 'What should be the **primary success signal** for this task? (pick one)',
      choices: [
        'Spec quality only: clear ACs + testing strategy, no implementation expectations',
        'Implementation-ready: ACs are directly testable and mapped to unit/integration tests',
        'End-to-end governance: includes ACs for behavior, tests, task-state transitions, and transcript persistence as release gates',
      ],
    })
    expect(queue.tasks[0]?.openQuestions?.[1]).toMatchObject({
      prompt: 'Coverage posture for the future implementation (pick one)',
      choices: [
        'Standard floor only (existing project defaults; no extra target)',
        'Elevated on touched intake modules (explicit higher expectation in spec)',
        'Standard floor + explicit exemption note allowed for non-deterministic orchestration paths',
      ],
    })
  })
})
