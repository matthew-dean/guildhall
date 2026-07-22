import { afterAll, describe, it, expect } from 'vitest'
import type { Task } from '@guildhall/core'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  computeBranchName,
  computeWorktreePath,
  ensureWorktreeForDispatch,
  cleanupWorktreeForTerminal,
  worktreeRootFor,
} from '../worktree-manager.js'
import { InMemoryGitDriver } from '../git-driver.js'

const ORIGINAL_GUILDHALL_CONFIG_DIR = process.env.GUILDHALL_CONFIG_DIR
const TEST_GUILDHALL_HOME = path.join(os.tmpdir(), `guildhall-worktree-home-${process.pid}`)

process.env.GUILDHALL_CONFIG_DIR = TEST_GUILDHALL_HOME

afterAll(() => {
  if (ORIGINAL_GUILDHALL_CONFIG_DIR === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = ORIGINAL_GUILDHALL_CONFIG_DIR
})

function task(overrides: Partial<Task> = {}): Task {
  const now = '2026-04-22T00:00:00.000Z'
  return {
    id: 'task-1',
    title: 'x',
    description: '',
    domain: 'core',
    projectPath: '/repo',
    status: 'ready',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('computeBranchName / computeWorktreePath', () => {
  it('per_task uses stable names across revisions', () => {
    const t = task({ id: 'abc/123', revisionCount: 2 })
    expect(computeBranchName(t, 'per_task')).toBe('guildhall/task-abc_123')
    expect(computeWorktreePath('demo-project', t, 'per_task')).toBe(
      path.join(TEST_GUILDHALL_HOME, 'worktrees', 'demo-project', 'abc_123'),
    )
  })

  it('per_attempt suffixes with the revision counter', () => {
    const t = task({ id: 'abc', revisionCount: 3 })
    expect(computeBranchName(t, 'per_attempt')).toBe(
      'guildhall/task-abc-attempt-3',
    )
    expect(computeWorktreePath('demo-project', t, 'per_attempt')).toBe(
      path.join(TEST_GUILDHALL_HOME, 'worktrees', 'demo-project', 'abc', 'attempt-3'),
    )
  })

  it('worktreeRootFor joins under ~/.guildhall/worktrees/<project-id>', () => {
    expect(worktreeRootFor('some-project')).toBe(
      path.join(TEST_GUILDHALL_HOME, 'worktrees', 'some-project'),
    )
  })
})

describe('ensureWorktreeForDispatch', () => {
  it("returns the project path and created:false when mode is 'none'", async () => {
    const driver = new InMemoryGitDriver()
    const r = await ensureWorktreeForDispatch({
      task: task(),
      mode: 'none',
      projectId: 'demo-project',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.worktreePath).toBe('/repo')
    expect(r.created).toBe(false)
    expect(driver.state.createdWorktrees).toHaveLength(0)
  })

  it('creates a fresh worktree on first dispatch (per_task)', async () => {
    const driver = new InMemoryGitDriver()
    const r = await ensureWorktreeForDispatch({
      task: task({ id: 'abc' }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.created).toBe(true)
    expect(r.branchName).toBe('guildhall/task-abc')
    expect(r.baseBranch).toBe('main')
    expect(driver.state.createdWorktrees).toHaveLength(1)
  })

  it('reuses an existing worktree when task already owns the expected one', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-worktree-reuse-'))
    const worktreePath = path.join(tmp, 'abc')
    await fs.mkdir(worktreePath, { recursive: true })
    const driver = new InMemoryGitDriver()
    const seeded = task({
      id: 'abc',
      worktreePath,
      branchName: 'guildhall/task-abc',
      baseBranch: 'main',
    })
    const r = await ensureWorktreeForDispatch({
      task: seeded,
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.created).toBe(false)
    expect(driver.state.createdWorktrees).toHaveLength(0)
    expect(driver.state.worktreeSyncs).toHaveLength(1)
    expect(driver.state.worktreeSyncs[0]).toMatchObject({
      worktreePath,
      baseBranch: 'main',
    })
  })

  it('fails closed when a reusable worktree cannot be synchronized with base', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-worktree-sync-failure-'))
    const worktreePath = path.join(tmp, 'abc')
    await fs.mkdir(worktreePath, { recursive: true })
    const driver = new InMemoryGitDriver({
      nextWorktreeSyncResult: {
        ok: false,
        conflict: true,
        detail: 'CONFLICT (content): merge conflict in package.json',
      },
    })

    await expect(ensureWorktreeForDispatch({
      task: task({
        id: 'abc',
        worktreePath,
        branchName: 'guildhall/task-abc',
        baseBranch: 'main',
      }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })).rejects.toThrow(/synchronize task worktree abc with main/i)
    expect(driver.state.worktreeSyncs).toHaveLength(1)
  })

  it('reattaches when a recorded worktree path no longer exists', async () => {
    const missingPath = path.join(TEST_GUILDHALL_HOME, 'worktrees', 'demo-project', 'abc')
    await fs.rm(missingPath, { recursive: true, force: true })
    const driver = new InMemoryGitDriver()
    const seeded = task({
      id: 'abc',
      worktreePath: missingPath,
      branchName: 'guildhall/task-abc',
      baseBranch: 'main',
    })

    const result = await ensureWorktreeForDispatch({
      task: seeded,
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })

    expect(result.created).toBe(true)
    expect(result.worktreePath).toBe(missingPath)
    expect(driver.state.attachedWorktrees).toEqual([
      {
        worktreePath: missingPath,
        branch: 'guildhall/task-abc',
      },
    ])
  })

  it('removes stale runtime node_modules symlinks when reusing an existing worktree', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-runtime-reuse-'))
    const projectPath = path.join(tmp, 'knit')
    const worktreePath = path.join(TEST_GUILDHALL_HOME, 'worktrees', 'demo-project', 'abc')
    await fs.mkdir(path.join(projectPath, 'node_modules'), { recursive: true })
    await fs.mkdir(path.join(projectPath, 'web', 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'web', 'package.json'), '{}')
    await fs.mkdir(path.join(worktreePath, 'web'), { recursive: true })
    await fs.symlink(
      path.relative(worktreePath, path.join(projectPath, 'node_modules')),
      path.join(worktreePath, 'node_modules'),
      'dir',
    )
    await fs.symlink(
      path.relative(path.join(worktreePath, 'web'), path.join(projectPath, 'web', 'node_modules')),
      path.join(worktreePath, 'web', 'node_modules'),
      'dir',
    )

    const driver = new InMemoryGitDriver()
    const seeded = task({
      id: 'abc',
      projectPath,
      worktreePath,
      branchName: 'guildhall/task-abc',
      baseBranch: 'main',
    })
    const result = await ensureWorktreeForDispatch({
      task: seeded,
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath,
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(result.created).toBe(false)
    await expect(fs.lstat(path.join(worktreePath, 'node_modules'))).rejects.toThrow()
    await expect(fs.lstat(path.join(worktreePath, 'web', 'node_modules'))).rejects.toThrow()
  })

  it('creates a new per_attempt worktree when revision bumps', async () => {
    const driver = new InMemoryGitDriver()
    const seeded = task({
      id: 'abc',
      revisionCount: 1,
      worktreePath: '/repo/.guildhall/worktrees/abc/attempt-0',
      branchName: 'guildhall/task-abc-attempt-0',
      baseBranch: 'main',
    })
    const r = await ensureWorktreeForDispatch({
      task: seeded,
      mode: 'per_attempt',
      projectId: 'demo-project',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.created).toBe(true)
    expect(r.branchName).toBe('guildhall/task-abc-attempt-1')
  })

  it('creates sibling repo symlinks for nested multi-repo worktrees', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-worktree-'))
    const workspacePath = path.join(tmp, 'workspace')
    const knitPath = path.join(workspacePath, 'knit')
    const loomaPath = path.join(workspacePath, 'looma')
    await fs.mkdir(knitPath, { recursive: true })
    await fs.mkdir(loomaPath, { recursive: true })
    await fs.writeFile(path.join(knitPath, '.git'), '')
    await fs.writeFile(path.join(loomaPath, 'package.json'), '{}')

    const driver = new InMemoryGitDriver()
    await ensureWorktreeForDispatch({
      task: task({ id: 'abc', projectPath: knitPath }),
      mode: 'per_task',
      projectId: 'knit',
      projectPath: knitPath,
      workspacePath,
      baseBranch: 'main',
      gitDriver: driver,
    })

    const linkPath = path.join(TEST_GUILDHALL_HOME, 'worktrees', 'knit', 'looma')
    expect(await fs.readlink(linkPath)).toBe(path.relative(path.dirname(linkPath), loomaPath))
  })

  it('leaves task worktrees free to create their own node_modules installs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-runtime-links-'))
    const projectPath = path.join(tmp, 'knit')
    const webPath = path.join(projectPath, 'web')
    await fs.mkdir(path.join(projectPath, 'node_modules'), { recursive: true })
    await fs.mkdir(path.join(webPath, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(webPath, 'package.json'), '{}')

    const driver = new InMemoryGitDriver()
    const result = await ensureWorktreeForDispatch({
      task: task({ id: 'runtime-links', projectPath }),
      mode: 'per_task',
      projectId: 'knit',
      projectPath,
      baseBranch: 'main',
      gitDriver: driver,
    })

    await expect(fs.lstat(path.join(result.worktreePath, 'node_modules'))).rejects.toThrow()
    await expect(fs.lstat(path.join(result.worktreePath, 'web', 'node_modules'))).rejects.toThrow()
  })

  it('copies explicit local config files into new task worktrees', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-worktree-include-'))
    const projectPath = path.join(tmp, 'app')
    const outsidePath = path.join(tmp, 'outside.env')
    await fs.mkdir(path.join(projectPath, 'config'), { recursive: true })
    await fs.writeFile(path.join(projectPath, '.env'), 'API_TOKEN=local-secret\n')
    await fs.writeFile(
      path.join(projectPath, 'config', 'appsettings.local.yaml'),
      'db: local\n',
    )
    await fs.writeFile(outsidePath, 'SHOULD_NOT_COPY=true\n')

    const driver = new InMemoryGitDriver()
    const result = await ensureWorktreeForDispatch({
      task: task({ id: 'include-local-config', projectPath }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath,
      baseBranch: 'main',
      gitDriver: driver,
      worktreeInclude: [
        '.env',
        'config/*.local.yaml',
        '../outside.env',
        'missing.local.yaml',
      ],
    })

    await expect(fs.readFile(path.join(result.worktreePath, '.env'), 'utf8')).resolves.toBe(
      'API_TOKEN=local-secret\n',
    )
    await expect(
      fs.readFile(path.join(result.worktreePath, 'config', 'appsettings.local.yaml'), 'utf8'),
    ).resolves.toBe('db: local\n')
    await expect(fs.access(path.join(result.worktreePath, 'outside.env'))).rejects.toThrow()
  })

  it('refreshes explicit local config files when reusing a task worktree', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-worktree-refresh-'))
    const projectPath = path.join(tmp, 'app')
    const worktreePath = path.join(TEST_GUILDHALL_HOME, 'worktrees', 'demo-project', 'refresh')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(worktreePath, { recursive: true })
    await fs.writeFile(path.join(projectPath, '.env'), 'API_TOKEN=first\n')
    await fs.writeFile(path.join(worktreePath, '.env'), 'API_TOKEN=stale\n')

    const driver = new InMemoryGitDriver()
    const result = await ensureWorktreeForDispatch({
      task: task({
        id: 'refresh',
        projectPath,
        worktreePath,
        branchName: 'guildhall/task-refresh',
        baseBranch: 'main',
      }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath,
      baseBranch: 'main',
      gitDriver: driver,
      worktreeInclude: ['.env'],
    })

    expect(result.created).toBe(false)
    await expect(fs.readFile(path.join(worktreePath, '.env'), 'utf8')).resolves.toBe(
      'API_TOKEN=first\n',
    )
  })
})

describe('cleanupWorktreeForTerminal', () => {
  it("is a no-op when mode is 'none'", async () => {
    const driver = new InMemoryGitDriver()
    await cleanupWorktreeForTerminal({
      task: task({ worktreePath: '/repo/x' }),
      mode: 'none',
      projectId: 'demo-project',
      projectPath: '/repo',
      gitDriver: driver,
    })
    expect(driver.state.removedWorktrees).toHaveLength(0)
  })

  it('preserves the worktree when preserveForPendingPr is true', async () => {
    const driver = new InMemoryGitDriver()
    await cleanupWorktreeForTerminal({
      task: task({ worktreePath: '/repo/x' }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      gitDriver: driver,
      preserveForPendingPr: true,
    })
    expect(driver.state.removedWorktrees).toHaveLength(0)
  })

  it('removes the worktree when mode is active and the task owns a Guildhall checkout', async () => {
    const driver = new InMemoryGitDriver()
    const worktreePath = path.join(worktreeRootFor('demo-project'), 'x')
    await cleanupWorktreeForTerminal({
      task: task({ worktreePath }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      gitDriver: driver,
    })
    expect(driver.state.removedWorktrees).toEqual([worktreePath])
  })

  it('refuses to remove a path outside the Guildhall worktree root', async () => {
    const driver = new InMemoryGitDriver()
    await expect(cleanupWorktreeForTerminal({
      task: task({ worktreePath: '/repo/user-worktree' }),
      mode: 'per_task',
      projectId: 'demo-project',
      projectPath: '/repo',
      gitDriver: driver,
    })).rejects.toThrow('Refusing to remove non-Guildhall worktree')
  })
})
