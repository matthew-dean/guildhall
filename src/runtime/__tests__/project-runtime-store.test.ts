import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { getProjectRuntimeStatePath, getProjectSystemStatePath } from '@guildhall/sessions'
import {
  defaultProjectRuntimeState,
  readProjectRuntimeState,
  writeProjectRuntimeState,
} from '../project-runtime-store.js'
import { readProjectSummaryProjection, writeProjectSummaryProjectionFromUnknownQueue } from '../project-summary-projection.js'

describe('project runtime store', () => {
  it('creates stopped-by-default runtime state in host-owned Guildhall local history', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-store-'))

    const state = await readProjectRuntimeState(projectRoot)

    expect(state).toMatchObject({
      backend: 'docker',
      status: 'stopped',
      containerId: null,
      runtimeApiVersion: '1',
      image: {
        tag: '0.10.0-trixie-node22-python313-playwright',
        digest: null,
      },
      mounts: {
        projectRoot,
        projectPath: expect.stringMatching(/^\/workspace\/guildhall-runtime-store-/),
        guildhallHome: join(dirname(getProjectRuntimeStatePath(projectRoot)), 'container-home'),
        guildhallHomePath: '/home/guildhall/.guildhall',
      },
      cacheVolumes: [],
      ports: [],
      health: {
        status: 'unknown',
        checkedAt: null,
        checks: [],
      },
      lastStartedAt: null,
      lastStoppedAt: null,
    })

    expect(getProjectRuntimeStatePath(projectRoot)).toContain('runtime/state.json')
    expect(getProjectRuntimeStatePath(projectRoot)).not.toContain(`${projectRoot}/.guildhall`)
  })

  it('uses an isolated container home instead of mounting the host Guildhall home', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-store-'))

    const state = defaultProjectRuntimeState(projectRoot)

    expect(state.mounts.guildhallHome).toBe(join(dirname(getProjectRuntimeStatePath(projectRoot)), 'container-home'))
    expect(state.mounts.guildhallHome).not.toBe(join(homedir(), '.guildhall'))
    expect(state.mounts.guildhallHome).not.toBe(join(projectRoot, '.guildhall'))
    expect(state.migration.mountLayout.guildhallHome).toBe(state.mounts.guildhallHome)
  })

  it('persists runtime state outside the project checkout', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-store-'))
    const custom = {
      ...defaultProjectRuntimeState(projectRoot),
      status: 'running' as const,
      containerId: 'container-123',
      lastStartedAt: '2026-05-27T18:00:00.000Z',
      ports: [{ host: 17777, container: 7777, purpose: 'dashboard' as const }],
    }

    await writeProjectRuntimeState(projectRoot, custom)

    await expect(readFile(getProjectRuntimeStatePath(projectRoot), 'utf8')).resolves.toContain('container-123')
    await expect(readFile(join(projectRoot, '.guildhall', 'runtime', 'state.json'), 'utf8')).rejects.toThrow()
    await expect(readProjectRuntimeState(projectRoot)).resolves.toMatchObject(custom)
  })

  it('keeps the compact project summary current with runtime state', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-summary-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'runtime-summary',
      queue: {
        version: 1,
        lastUpdated: '2026-07-14T12:00:00.000Z',
        tasks: [],
      },
    })

    await writeProjectRuntimeState(projectRoot, {
      ...defaultProjectRuntimeState(projectRoot),
      status: 'running',
      lastActivityAt: '2026-07-14T12:01:00.000Z',
      health: {
        status: 'healthy',
        checkedAt: '2026-07-14T12:01:00.000Z',
        checks: [],
      },
    })

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'current',
      runtime: {
        status: 'running',
        health: 'healthy',
        lastActivityAt: '2026-07-14T12:01:00.000Z',
      },
    })
  })

  it('does not require the project .guildhall directory to exist', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-store-'))
    await mkdir(join(projectRoot, 'src'))

    await expect(readProjectRuntimeState(projectRoot)).resolves.toMatchObject({
      status: 'stopped',
      mounts: {
        projectRoot,
      },
    })
  })
})
