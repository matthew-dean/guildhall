import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { getProjectRuntimeDevServersPath } from '@guildhall/sessions'
import { defaultProjectRuntimeState, type ProjectRuntimeState } from '../project-runtime-store.js'
import {
  DevServerManager,
  readRuntimeDevServers,
  type DevServerLauncher,
} from '../dev-server-manager.js'

class FakeRuntimeSupervisor {
  starts: string[] = []
  rebuilds = 0
  released: string[] = []
  state: ProjectRuntimeState | null = null

  async start(projectRoot: string, options: { reason: string }) {
    this.starts.push(options.reason)
    this.state = {
      ...defaultProjectRuntimeState(projectRoot),
      status: 'running',
      containerId: 'runtime-container',
      ports: [{ container: 5173, host: 45173, purpose: 'dev-server' }],
    }
    return this.state
  }

  async rebuild(projectRoot: string) {
    this.rebuilds++
    return {
      ...defaultProjectRuntimeState(projectRoot),
      status: 'stopped' as const,
      containerId: 'runtime-container',
      ports: [{ container: 5173, host: 45173, purpose: 'dev-server' as const }],
    }
  }

  async releaseKeepAlive(_projectRoot: string, reason: string) {
    this.released.push(reason)
    return this.state ?? defaultProjectRuntimeState(_projectRoot)
  }
}

class FakeLauncher implements DevServerLauncher {
  starts = 0
  stops: string[] = []

  async start() {
    this.starts++
    return {
      runtimeProcessId: `dev-${this.starts}`,
      logs: [
        'Listening on http://0.0.0.0:5173',
        'TOKEN=super-secret-token',
      ],
    }
  }

  async stop(_projectRoot: string, runtimeProcessId: string) {
    this.stops.push(runtimeProcessId)
  }
}

describe('runtime dev server manager', () => {
  it('starts a runtime dev server, proves the host URL, redacts logs, and persists state', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-dev-server-'))
    const supervisor = new FakeRuntimeSupervisor()
    const launcher = new FakeLauncher()
    const manager = new DevServerManager({
      runtimeSupervisor: supervisor,
      launcher,
      isPortAvailable: async port => port === 45173,
      fetch: async url => ({
        ok: String(url) === 'http://127.0.0.1:45173/health',
        status: 200,
      }),
      now: () => '2026-05-27T22:00:00.000Z',
    })

    const server = await manager.start(projectRoot, {
      id: 'app',
      projectId: 'demo',
      taskId: 'task-web',
      cwd: '/workspace/demo',
      argv: ['pnpm', 'dev', '--host', '0.0.0.0'],
      containerPort: 5173,
      preferredHostPort: 45173,
      readinessPath: '/health',
    })

    expect(server).toMatchObject({
      id: 'app',
      status: 'running',
      readiness: 'ready',
      url: 'http://127.0.0.1:45173',
      command: {
        cwd: '/workspace/demo',
        argv: ['pnpm', 'dev', '--host', '0.0.0.0'],
      },
      ports: [{ container: 5173, host: 45173, purpose: 'dev-server' }],
      browserProof: {
        url: 'http://127.0.0.1:45173/health',
        ok: true,
        status: 200,
      },
      logs: [
        'Listening on http://0.0.0.0:5173',
        'TOKEN=[redacted]',
      ],
    })
    expect(supervisor.starts).toEqual(['dev-server'])
    expect(launcher.starts).toBe(1)
    await expect(readRuntimeDevServers(projectRoot)).resolves.toEqual([server])
    await expect(readFile(getProjectRuntimeDevServersPath(projectRoot), 'utf8')).resolves.toContain('"app"')
  })

  it('stops and restarts dev servers while preserving owner-visible state', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-dev-server-'))
    const supervisor = new FakeRuntimeSupervisor()
    const launcher = new FakeLauncher()
    const manager = new DevServerManager({
      runtimeSupervisor: supervisor,
      launcher,
      isPortAvailable: async () => true,
      fetch: async () => ({ ok: true, status: 200 }),
      now: (() => {
        let tick = 0
        return () => `2026-05-27T22:00:0${tick++}.000Z`
      })(),
    })

    await manager.start(projectRoot, {
      id: 'app',
      projectId: 'demo',
      cwd: '/workspace/demo',
      argv: ['npm', 'run', 'dev'],
      containerPort: 5173,
    })
    const stopped = await manager.stop(projectRoot, 'app')
    const restarted = await manager.restart(projectRoot, 'app')

    expect(stopped).toMatchObject({ status: 'stopped', stoppedAt: '2026-05-27T22:00:02.000Z' })
    expect(restarted).toMatchObject({ status: 'running', runtimeProcessId: 'dev-2' })
    expect(launcher.stops).toEqual(['dev-1'])
    expect(supervisor.released).toEqual(['dev-server'])
  })

  it('marks running dev servers stale when runtime reconciliation says the container stopped', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-dev-server-'))
    const manager = new DevServerManager({
      runtimeSupervisor: new FakeRuntimeSupervisor(),
      launcher: new FakeLauncher(),
      isPortAvailable: async () => true,
      fetch: async () => ({ ok: true, status: 200 }),
      now: () => '2026-05-27T22:15:00.000Z',
    })
    await manager.start(projectRoot, {
      id: 'app',
      projectId: 'demo',
      cwd: '/workspace/demo',
      argv: ['npm', 'run', 'dev'],
      containerPort: 5173,
    })

    await expect(manager.reconcile(projectRoot, { runtimeStatus: 'stopped' })).resolves.toMatchObject([
      { id: 'app', status: 'stale', readiness: 'unknown' },
    ])
  })
})
