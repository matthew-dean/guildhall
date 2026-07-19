import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Task } from '@guildhall/core'
import { describe, expect, it } from 'vitest'
import { AGENT_SETTINGS_FILENAME, loadLeverSettings } from '@guildhall/levers'
import { getProjectSystemStatePath, promoteProjectStateDatabaseAuthority, readTaskEvidence } from '@guildhall/sessions'

import { buildEffectiveTask } from '../effective-task.js'
import * as projectStateBoundary from '../project-state-boundary.js'
import { runGuildhallTaskOnce } from '../run-once.js'

describe('runGuildhallTaskOnce', () => {
  it('creates a Guildhall task from a prompt, enables fully automated runtime posture, and writes a compact report', async () => {
    const projectRoot = await seedProject()
    const outputPath = path.join(projectRoot, 'run-once-report.json')
    const seen: Array<{ preferredTaskId?: string; maxTicks?: number }> = []
    const report = await runGuildhallTaskOnce({
      projectRoot,
      prompt: 'Create a tiny app that says hello.',
      outputPath,
      automationPolicy: 'fully_automated',
      proof: 'browser',
      runOrchestratorImpl: async (_config, options) => {
        seen.push(options ?? {})
        return {
          ticks: 1,
          processedTaskIds: ['task-001'],
          stopReason: 'max_ticks',
          stopMessage: 'Reached test max ticks.',
        }
      },
      now: () => '2026-05-29T10:00:00.000Z',
    })

    expect(report).toMatchObject({
      taskId: 'task-001',
      title: 'Create a tiny app that says hello.',
      prompt: 'Create a tiny app that says hello.',
      automationPolicy: 'fully_automated',
      proof: 'browser',
      stopReason: 'max_ticks',
      outputPath,
    })
    expect(seen).toEqual([{ preferredTaskId: 'task-001', maxTicks: 80 }])

    const settings = await loadLeverSettings({
      path: getProjectSystemStatePath(projectRoot, AGENT_SETTINGS_FILENAME),
    })
    expect(settings.project.run_automation.position).toBe('fully_automated')

    const queue = projectStateBoundary.readProjectTaskQueueSync(getProjectSystemStatePath(projectRoot, 'TASKS.json')) as { tasks: any[] }
    queue.tasks = await Promise.all(queue.tasks.map((task: any) => buildEffectiveTask(projectRoot, task)))
    expect(queue.tasks[0]).toMatchObject({
      id: 'task-001',
      title: 'Create a tiny app that says hello.',
      status: 'exploring',
      requestIntake: {
        pressureTestSummary: {
          systemOwned: true,
        },
      },
    })
    expect(queue.tasks[0].notes.at(-1).content).toContain('Run-once automation policy: fully_automated')

    const written = JSON.parse(await fs.readFile(outputPath, 'utf8'))
    expect(written.taskId).toBe('task-001')
    expect(written.orchestrator.stopReason).toBe('max_ticks')
  })

  it('keeps the run-once note in promoted task evidence without a second queue write', async () => {
    const projectRoot = await seedProject()
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    projectStateBoundary.writeProjectTaskQueueWithSummary(tasksPath, projectStateBoundary.readProjectTaskQueueSync(tasksPath), {
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const report = await runGuildhallTaskOnce({
      projectRoot,
      prompt: 'Create a promoted project task.',
      runOrchestratorImpl: async () => ({
        ticks: 0,
        processedTaskIds: [],
        stopReason: 'awaiting_human',
        stopMessage: 'Waiting for promoted task input.',
      }),
      now: () => '2026-05-29T10:00:00.000Z',
    })

    expect(await readTaskEvidence(projectRoot, report.taskId, { kind: 'note' })).toEqual([
      expect.objectContaining({
        kind: 'note',
        payload: expect.objectContaining({
          content: expect.stringContaining('Run-once automation policy: ask_when_necessary'),
        }),
      }),
    ])

    const queue = projectStateBoundary.readProjectTaskQueueForMutationSync(tasksPath).queue as { tasks: Task[] }
    const effective = await buildEffectiveTask(projectRoot, queue.tasks[0]!)
    const notes = effective.notes as Array<{ content?: string }>
    expect(notes.at(-1)?.content).toContain('Requested proof mode: auto')
  })

  it('does not let long run-once prompts degrade the stored task title to New request', async () => {
    const projectRoot = await seedProject()
    const prompt = 'Build a dependency-free single-page Pantry Pulse web app in this project root. Use plain HTML, CSS, and JavaScript only.'

    const report = await runGuildhallTaskOnce({
      projectRoot,
      prompt,
      runOrchestratorImpl: async () => ({
        ticks: 0,
        processedTaskIds: [],
        stopReason: 'max_ticks',
        stopMessage: 'Stopped for title test.',
      }),
      now: () => '2026-05-29T10:00:00.000Z',
    })

    const queue = projectStateBoundary.readProjectTaskQueueSync(getProjectSystemStatePath(projectRoot, 'TASKS.json')) as { tasks: any[] }
    expect(report.title).not.toBe('New request')
    expect(queue.tasks[0].title).toBe(report.title)
    expect(queue.tasks[0].title).not.toBe('New request')
  })

  it('can read the run-once prompt from a file', async () => {
    const projectRoot = await seedProject()
    const promptPath = path.join(projectRoot, 'prompt.md')
    await fs.writeFile(promptPath, 'Add a focused release checklist.\n', 'utf8')

    const report = await runGuildhallTaskOnce({
      projectRoot,
      fromFile: promptPath,
      runOrchestratorImpl: async () => ({
        ticks: 0,
        processedTaskIds: [],
        stopReason: 'awaiting_human',
        stopMessage: 'Task is waiting on spec approval.',
      }),
      now: () => '2026-05-29T10:00:00.000Z',
    })

    expect(report.prompt).toBe('Add a focused release checklist.')
    expect(report.title).toBe('Add a focused release checklist.')
    expect(report.automationPolicy).toBe('ask_when_necessary')
    expect(report.proof).toBe('auto')
  })
})

async function seedProject(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-once-'))
  await fs.mkdir(path.dirname(getProjectSystemStatePath(projectRoot, 'TASKS.json')), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
    'name: Run Once Test',
    'id: run-once-test',
    'coordinators:',
    '  - id: app',
    '    domain: app',
    '    mandate: Build the app.',
    '',
  ].join('\n'), 'utf8')
  projectStateBoundary.writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
    version: 1,
    lastUpdated: '2026-05-29T09:00:00.000Z',
    tasks: [],
  }, { projectRoot })
  promoteProjectStateDatabaseAuthority(projectRoot)
  return projectRoot
}
