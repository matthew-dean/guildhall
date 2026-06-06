import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  detectRuntimeBackendSetup,
  runRuntimeBackendSetupAction,
  type RuntimeBackendCommandRunner,
} from '../runtime-backend-setup.js'
import { readProjectRuntimeState } from '../project-runtime-store.js'

let tmpProject: string | null = null

afterEach(async () => {
  if (tmpProject) await rm(tmpProject, { recursive: true, force: true })
  tmpProject = null
})

async function projectRoot(): Promise<string> {
  tmpProject = await mkdtemp(join(tmpdir(), 'guildhall-runtime-setup-'))
  return tmpProject
}

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

describe('runtime backend setup', () => {
  it('reports missing Podman on supported macOS without requiring Homebrew', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'darwin',
      now: () => '2026-05-27T20:00:00.000Z',
      commandRunner: runnerFor({
        'which podman': { error: new Error('not found') },
        'which brew': { error: new Error('not found') },
      }),
    })

    expect(status.status).toBe('missing')
    expect(status.supportedHost).toBe(true)
    expect(status.homebrewPath).toBeNull()
    expect(status.actions.map(action => action.id)).toEqual([
      'install-instructions',
      'retry-detection',
      'use-host-run-compatibility',
    ])
    expect(status.actions.find(action => action.id === 'install-instructions')).toMatchObject({
      mutatesHost: false,
      homebrewAvailable: false,
    })
  })

  it('reports ready when Podman exists and a machine is running', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'darwin',
      commandRunner: runnerFor({
        'which podman': { stdout: '/opt/homebrew/bin/podman\n' },
        'which brew': { stdout: '/opt/homebrew/bin/brew\n' },
        'podman --version': { stdout: 'podman version 5.6.2\n' },
        'podman machine list --format json': {
          stdout: JSON.stringify([{ Name: 'podman-machine-default', Running: true }]),
        },
      }),
    })

    expect(status).toMatchObject({
      status: 'ready',
      podmanPath: '/opt/homebrew/bin/podman',
      podmanVersion: 'podman version 5.6.2',
      homebrewPath: '/opt/homebrew/bin/brew',
      machine: {
        exists: true,
        running: true,
        name: 'podman-machine-default',
      },
    })
    expect(status.actions).toEqual([])
    expect(status.compatibilityModeLabel).toBe('Host-run compatibility mode')
  })

  it('reports machine-not-created when Podman has no macOS VM yet', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'darwin',
      commandRunner: runnerFor({
        'which podman': { stdout: '/usr/local/bin/podman\n' },
        'which brew': { error: new Error('not found') },
        'podman --version': { stdout: 'podman version 5.6.2\n' },
        'podman machine list --format json': { stdout: '[]' },
      }),
    })

    expect(status.status).toBe('machine-not-created')
    expect(status.actions.map(action => action.id)).toEqual([
      'initialize-machine',
      'retry-detection',
      'use-host-run-compatibility',
    ])
    expect(status.actions[0]).toMatchObject({
      mutatesHost: true,
      requiresApproval: true,
      command: ['podman', 'machine', 'init', '--now'],
    })
  })

  it('reports machine-stopped when Podman has a stopped macOS VM', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'darwin',
      commandRunner: runnerFor({
        'which podman': { stdout: '/usr/local/bin/podman\n' },
        'which brew': { error: new Error('not found') },
        'podman --version': { stdout: 'podman version 5.6.2\n' },
        'podman machine list --format json': {
          stdout: JSON.stringify([{ Name: 'podman-machine-default', Running: false }]),
        },
      }),
    })

    expect(status.status).toBe('machine-stopped')
    expect(status.actions.map(action => action.id)).toEqual([
      'start-machine',
      'retry-detection',
      'use-host-run-compatibility',
    ])
  })

  it('keeps non-macOS hosts in compatibility mode for the 0.9 local release', async () => {
    const status = await detectRuntimeBackendSetup({
      platform: 'linux',
      commandRunner: runnerFor({}),
    })

    expect(status.status).toBe('unsupported-platform')
    expect(status.supportedHost).toBe(false)
    expect(status.actions.map(action => action.id)).toEqual([
      'retry-detection',
      'use-host-run-compatibility',
    ])
  })

  it('requires explicit approval before initializing or starting a Podman machine', async () => {
    const root = await projectRoot()
    const result = await runRuntimeBackendSetupAction(root, {
      action: 'initialize-machine',
      approved: false,
      platform: 'darwin',
      commandRunner: runnerFor({}),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('approval')
    expect(result.result?.mutatedHost).toBe(false)
    await expect(readProjectRuntimeState(root)).resolves.toMatchObject({
      backendSetup: {
        selectedMode: null,
        lastAction: 'initialize-machine',
        lastResult: 'declined',
      },
    })
  })

  it('runs approved setup itself, re-detects, and persists the result', async () => {
    const root = await projectRoot()
    const commands: string[] = []
    const result = await runRuntimeBackendSetupAction(root, {
      action: 'initialize-machine',
      approved: true,
      platform: 'darwin',
      now: () => '2026-05-27T20:30:00.000Z',
      commandRunner: async (command, args) => {
        const key = [command, ...args].join(' ')
        commands.push(key)
        if (key === 'podman machine init --now') return { stdout: 'machine initialized\n', stderr: '' }
        if (key === 'which podman') return { stdout: '/opt/homebrew/bin/podman\n', stderr: '' }
        if (key === 'which brew') return { stdout: '/opt/homebrew/bin/brew\n', stderr: '' }
        if (key === 'podman --version') return { stdout: 'podman version 5.6.2\n', stderr: '' }
        if (key === 'podman machine list --format json') {
          return {
            stdout: JSON.stringify([{ Name: 'podman-machine-default', Running: true }]),
            stderr: '',
          }
        }
        throw new Error(`unexpected command: ${key}`)
      },
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        mutatedHost: true,
        steps: [{ command: ['podman', 'machine', 'init', '--now'], ok: true }],
      },
      status: {
        status: 'ready',
      },
    })
    expect(commands[0]).toBe('podman machine init --now')
    await expect(readFile(join(root, '.guildhall', 'runtime', 'state.json'), 'utf8')).rejects.toThrow()
    await expect(readProjectRuntimeState(root)).resolves.toMatchObject({
      backendSetup: {
        status: 'ready',
        selectedMode: 'podman',
        lastAction: 'initialize-machine',
        lastResult: 'completed',
        updatedAt: '2026-05-27T20:30:00.000Z',
      },
    })
  })
})
