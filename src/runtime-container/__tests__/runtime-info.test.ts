import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import {
  buildRuntimeInfo,
  checkRuntimeHealth,
  renderRuntimeInfo,
  runtimeExecutableNames,
} from '../index.js'

describe('runtime container contract', () => {
  it('reports the executable and mount contract expected by the 0.9 runtime image', () => {
    const info = buildRuntimeInfo({
      env: {
        GUILDHALL_PROJECT_ID: 'commerce',
        GUILDHALL_RUNTIME_ID: 'runtime-commerce',
        GUILDHALL_PROJECT_ROOT: '/workspace/project',
        GUILDHALL_HOME: '/home/guildhall/.guildhall',
        GUILDHALL_RUNTIME_IMAGE_TAG: '0.9.0-trixie-node22-python313-playwright',
      },
      versions: {
        node: 'v22.11.0',
        python: 'Python 3.13.0',
      },
    })

    expect(info.apiVersion).toBe('1')
    expect(info.image.family).toBe('guildhall-runtime-debian')
    expect(info.image.tag).toBe('0.9.0-trixie-node22-python313-playwright')
    expect(info.image.os).toEqual({
      distribution: 'debian',
      version: '13',
      codename: 'trixie',
    })
    expect(info.versions).toEqual({
      node: 'v22.11.0',
      python: 'Python 3.13.0',
    })
    expect(info.executables).toEqual(runtimeExecutableNames)
    expect(info.mounts).toEqual({
      projectRoot: '/workspace/project',
      guildhallHome: '/home/guildhall/.guildhall',
    })
    expect(info.project).toEqual({
      id: 'commerce',
      runtimeId: 'runtime-commerce',
    })
  })

  it('renders stable pretty JSON for the runtime-info executable', () => {
    const info = buildRuntimeInfo({
      env: {
        GUILDHALL_PROJECT_ID: 'docs',
        GUILDHALL_RUNTIME_ID: 'runtime-docs',
        GUILDHALL_PROJECT_ROOT: '/workspace/docs',
        GUILDHALL_HOME: '/home/guildhall/.guildhall',
      },
      versions: {
        node: 'v22.12.0',
      },
    })

    expect(renderRuntimeInfo(info)).toBe(`${JSON.stringify(info, null, 2)}\n`)
  })

  it('healthcheck passes only when the project and guildhall mounts are present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guildhall-runtime-health-'))
    const projectRoot = join(root, 'project')
    const guildhallHome = join(root, 'guildhall-home')

    await mkdir(projectRoot)
    await mkdir(guildhallHome)

    const healthy = await checkRuntimeHealth({
      env: {
        GUILDHALL_PROJECT_ROOT: projectRoot,
        GUILDHALL_HOME: guildhallHome,
      },
    })

    expect(healthy.ok).toBe(true)
    expect(healthy.checks.map((check) => check.name)).toEqual([
      'project-root-mounted',
      'guildhall-home-mounted',
    ])
    expect(healthy.checks.every((check) => check.ok)).toBe(true)

    const unhealthy = await checkRuntimeHealth({
      env: {
        GUILDHALL_PROJECT_ROOT: join(root, 'missing-project'),
        GUILDHALL_HOME: guildhallHome,
      },
    })

    expect(unhealthy.ok).toBe(false)
    expect(unhealthy.checks).toContainEqual({
      name: 'project-root-mounted',
      ok: false,
      message: `missing directory: ${join(root, 'missing-project')}`,
    })
  })

  it('healthcheck verifies required Node and Python runtime versions when supplied', async () => {
    const healthy = await checkRuntimeHealth({
      env: {
        GUILDHALL_PROJECT_ROOT: process.cwd(),
        GUILDHALL_HOME: process.cwd(),
      },
      versions: {
        node: 'v22.12.0',
        python: 'Python 3.13.1',
      },
    })

    expect(healthy.ok).toBe(true)
    expect(healthy.checks).toContainEqual({
      name: 'node-22-available',
      ok: true,
    })
    expect(healthy.checks).toContainEqual({
      name: 'python-3-13-available',
      ok: true,
    })

    const unhealthy = await checkRuntimeHealth({
      env: {
        GUILDHALL_PROJECT_ROOT: process.cwd(),
        GUILDHALL_HOME: process.cwd(),
      },
      versions: {
        node: 'v20.0.0',
        python: 'Python 3.12.0',
      },
    })

    expect(unhealthy.ok).toBe(false)
    expect(unhealthy.checks).toContainEqual({
      name: 'node-22-available',
      ok: false,
      message: 'expected Node 22.x, got v20.0.0',
    })
    expect(unhealthy.checks).toContainEqual({
      name: 'python-3-13-available',
      ok: false,
      message: 'expected Python 3.13.x, got Python 3.12.0',
    })
  })
})
