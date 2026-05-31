import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { getProjectRuntimeStatePath } from '@guildhall/sessions'
import {
  defaultProjectRuntimeState,
  readProjectRuntimeState,
  writeProjectRuntimeState,
} from '../project-runtime-store.js'

describe('project runtime store', () => {
  it('creates stopped-by-default runtime state in host-owned Guildhall local history', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-store-'))

    const state = await readProjectRuntimeState(projectRoot)

    expect(state).toMatchObject({
      backend: 'podman',
      status: 'stopped',
      containerId: null,
      runtimeApiVersion: '1',
      image: {
        tag: '0.9.0-trixie-node22-python313-playwright',
        digest: null,
      },
      mounts: {
        projectRoot,
        projectPath: expect.stringMatching(/^\/workspace\/guildhall-runtime-store-/),
        guildhallHome: expect.stringContaining('.guildhall'),
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
