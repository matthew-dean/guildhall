import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { bootstrapWorkspace } from '@guildhall/config'
import { detectRuntimeBackendSetup, type RuntimeBackendCommandRunner } from '../runtime-backend-setup.js'

let tmpRoot: string
let previousConfigDir: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmpRoot = await mkdtemp(join(tmpdir(), 'guildhall-container-runtime-selection-'))
  process.env.GUILDHALL_CONFIG_DIR = join(tmpRoot, 'config')
  process.env.GUILDHALL_DATA_DIR = join(tmpRoot, 'data')
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await rm(tmpRoot, { recursive: true, force: true })
})

function runnerFor(fixtures: Record<string, { stdout?: string; stderr?: string; error?: Error }>): RuntimeBackendCommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(' ')
    const fixture = fixtures[key]
    if (!fixture) throw new Error(`unexpected command: ${key}`)
    if (fixture.error) throw fixture.error
    return {
      stdout: fixture.stdout ?? '',
      stderr: fixture.stderr ?? '',
    }
  }
}

async function projectRoot(configPatch = ''): Promise<string> {
  const root = await mkdtemp(join(tmpRoot, 'project-'))
  bootstrapWorkspace(root, { name: 'Runtime Selection Test' })
  if (configPatch.trim()) {
    await writeFile(join(root, 'guildhall.yaml'), `name: Runtime Selection Test\nid: runtime-selection-test\n${configPatch}`, 'utf8')
  }
  return root
}

describe('container runtime selection', () => {
  it('prefers Docker on macOS when Docker is healthy', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { stdout: '/usr/local/bin/docker\n' },
        'docker version --format {{.Server.Version}}': { stdout: '27.5.1\n' },
        'docker info --format {{json .ServerVersion}}': { stdout: '"27.5.1"\n' },
        'which podman': { stdout: '/opt/homebrew/bin/podman\n' },
        'which brew': { stdout: '/opt/homebrew/bin/brew\n' },
        'podman --version': { stdout: 'podman version 5.8.2\n' },
        'podman machine list --format json': {
          stdout: JSON.stringify([{ Name: 'podman-machine-default', Running: true }]),
        },
      }),
    })

    expect(status).toMatchObject({
      backend: 'docker',
      status: 'ready',
      dockerPath: '/usr/local/bin/docker',
      dockerVersion: '27.5.1',
    })
    expect(status.runtimes.docker.status).toBe('ready')
    expect(status.runtimes.podman.status).toBe('ready')
  })

  it('uses Podman when project config prefers Podman and both engines are healthy', async () => {
    const root = await projectRoot([
      'containerRuntime:',
      '  preferredBackend: podman',
      '',
    ].join('\n'))
    const status = await detectRuntimeBackendSetup({
      projectRoot: root,
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { stdout: '/usr/local/bin/docker\n' },
        'docker version --format {{.Server.Version}}': { stdout: '27.5.1\n' },
        'docker info --format {{json .ServerVersion}}': { stdout: '"27.5.1"\n' },
        'which podman': { stdout: '/opt/homebrew/bin/podman\n' },
        'which brew': { stdout: '/opt/homebrew/bin/brew\n' },
        'podman --version': { stdout: 'podman version 5.8.2\n' },
        'podman machine list --format json': {
          stdout: JSON.stringify([{ Name: 'podman-machine-default', Running: true }]),
        },
      }),
    })

    expect(status).toMatchObject({
      backend: 'podman',
      status: 'ready',
      dockerPath: '/usr/local/bin/docker',
      podmanPath: '/opt/homebrew/bin/podman',
    })
  })

  it('uses Podman when Docker is missing and Podman is healthy', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { error: new Error('not found') },
        'which podman': { stdout: '/opt/homebrew/bin/podman\n' },
        'which brew': { stdout: '/opt/homebrew/bin/brew\n' },
        'podman --version': { stdout: 'podman version 5.8.2\n' },
        'podman machine list --format json': {
          stdout: JSON.stringify([{ Name: 'podman-machine-default', Running: true }]),
        },
      }),
    })

    expect(status).toMatchObject({
      backend: 'podman',
      status: 'ready',
      podmanPath: '/opt/homebrew/bin/podman',
    })
    expect(status.runtimes.docker.status).toBe('missing')
    expect(status.runtimes.podman.status).toBe('ready')
  })

  it('blocks host-run when neither Docker nor Podman is ready and config has not opted in', async () => {
    const root = await projectRoot()
    const status = await detectRuntimeBackendSetup({
      projectRoot: root,
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { error: new Error('not found') },
        'which podman': { error: new Error('not found') },
        'which brew': { error: new Error('not found') },
      }),
    })

    expect(status.backend).toBe('none')
    expect(status.status).toBe('missing')
    expect(status.nonContainerExecution.allowed).toBe(false)
    expect(status.actions.map(action => action.id)).not.toContain('use-host-run-compatibility')
  })

  it('offers host-run only when the project config explicitly opts into it', async () => {
    const root = await projectRoot([
      'containerRuntime:',
      '  mode: host-run-allowed',
      '',
    ].join('\n'))
    const status = await detectRuntimeBackendSetup({
      projectRoot: root,
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { error: new Error('not found') },
        'which podman': { error: new Error('not found') },
        'which brew': { error: new Error('not found') },
      }),
    })

    expect(status.backend).toBe('none')
    expect(status.nonContainerExecution).toMatchObject({
      allowed: true,
      source: 'project',
    })
    expect(status.actions.map(action => action.id)).toContain('use-host-run-compatibility')
  })

  it('offers host-run for an installed but unusable runtime only when config opts into it', async () => {
    const root = await projectRoot([
      'containerRuntime:',
      '  mode: host-run-allowed',
      '',
    ].join('\n'))
    const status = await detectRuntimeBackendSetup({
      projectRoot: root,
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { error: new Error('not found') },
        'which podman': { stdout: '/opt/homebrew/bin/podman\n' },
        'which brew': { stdout: '/opt/homebrew/bin/brew\n' },
        'podman --version': { stdout: 'podman version 5.8.2\n' },
        'podman machine list --format json': { stdout: '[]' },
      }),
    })

    expect(status.status).toBe('machine-not-created')
    expect(status.actions.map(action => action.id)).toContain('use-host-run-compatibility')
  })

  it('offers host-run when the global config explicitly opts into it', async () => {
    await mkdir(process.env.GUILDHALL_CONFIG_DIR!, { recursive: true })
    await writeFile(join(process.env.GUILDHALL_CONFIG_DIR!, 'config.yaml'), [
      'containerRuntime:',
      '  mode: host-run-allowed',
      '',
    ].join('\n'), 'utf8')
    const root = await projectRoot()

    const status = await detectRuntimeBackendSetup({
      projectRoot: root,
      platform: 'darwin',
      commandRunner: runnerFor({
        'which docker': { error: new Error('not found') },
        'which podman': { error: new Error('not found') },
        'which brew': { error: new Error('not found') },
      }),
    })

    expect(status.backend).toBe('none')
    expect(status.nonContainerExecution).toMatchObject({
      allowed: true,
      source: 'global',
    })
    expect(status.actions.map(action => action.id)).toContain('use-host-run-compatibility')
  })
})
