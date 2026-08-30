import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { getProjectSystemStatePath } from '@guildhall/sessions'
import { recordOwnerPauseWithSavedWork } from '../serve.js'
import { readTaskRuntimeStore } from '../task-state-store.js'

const execFileP = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('records dirty isolated work when the owner pauses the active task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guildhall-owner-pause-'))
  roots.push(root)
  const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
  await mkdir(dirname(tasksPath), { recursive: true })
  await execFileP('git', ['init'], { cwd: root })
  await execFileP('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: root })
  await writeFile(join(root, '.gitignore'), '.guildhall\n')
  await execFileP('git', ['add', '.gitignore'], { cwd: root })
  await execFileP('git', ['commit', '-m', 'test baseline'], { cwd: root })
  await writeFile(join(root, 'saved-change.txt'), 'partial work\n')
  await writeFile(tasksPath, JSON.stringify({
    version: 1,
    lastUpdated: '2026-08-30T00:00:00.000Z',
    tasks: [{
      id: 'task-1',
      title: 'Saved partial work',
      description: 'Keep the partial implementation available after pause.',
      status: 'in_progress',
      worktreePath: root,
    }],
  }))

  await expect(recordOwnerPauseWithSavedWork(root, 'task-1')).resolves.toBe(true)
  expect((await readTaskRuntimeStore(root)).tasks['task-1']?.workerRecovery).toMatchObject({
    ownerPauseWithSavedWorkAt: expect.any(String),
  })
})

it('does not mark a clean task worktree as saved progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guildhall-owner-pause-clean-'))
  roots.push(root)
  const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
  await mkdir(dirname(tasksPath), { recursive: true })
  await execFileP('git', ['init'], { cwd: root })
  await execFileP('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: root })
  await writeFile(join(root, '.gitignore'), '.guildhall\n')
  await execFileP('git', ['add', '.gitignore'], { cwd: root })
  await execFileP('git', ['commit', '-m', 'test baseline'], { cwd: root })
  await writeFile(tasksPath, JSON.stringify({
    version: 1,
    lastUpdated: '2026-08-30T00:00:00.000Z',
    tasks: [{
      id: 'task-1',
      title: 'Clean worktree',
      description: 'A clean pause remains an ordinary resume.',
      status: 'in_progress',
      worktreePath: root,
    }],
  }))

  await expect(recordOwnerPauseWithSavedWork(root, 'task-1')).resolves.toBe(false)
  expect((await readTaskRuntimeStore(root)).tasks['task-1']).toBeUndefined()
})
