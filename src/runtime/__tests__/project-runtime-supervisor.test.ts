import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ProjectRuntimeSupervisor,
  type ProjectRuntimeBackend,
} from '../project-runtime-supervisor.js'

class FakeBackend implements ProjectRuntimeBackend {
  createCalls = 0
  startCalls = 0
  stopCalls = 0
  inspectCalls = 0
  logsCalls = 0
  rebuildCalls = 0
  removeCalls = 0

  async create() {
    this.createCalls++
    return { containerId: 'fake-container' }
  }

  async start() {
    this.startCalls++
    return { containerId: 'fake-container' }
  }

  async stop() {
    this.stopCalls++
  }

  async inspect() {
    this.inspectCalls++
    return {
      status: 'running' as const,
      containerId: 'fake-container',
      health: {
        status: 'healthy' as const,
        checkedAt: '2026-05-27T18:00:00.000Z',
        checks: [{ name: 'runtime', ok: true }],
      },
    }
  }

  async logs() {
    this.logsCalls++
    return 'runtime logs'
  }

  async rebuild() {
    this.rebuildCalls++
    return { containerId: 'rebuilt-container' }
  }

  async remove() {
    this.removeCalls++
  }

  async runCommand() {
    return { exitCode: 0 }
  }
}

describe('project runtime supervisor', () => {
  it('keeps registered projects stopped by default and does not start on inspect', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-supervisor-'))
    const backend = new FakeBackend()
    const supervisor = new ProjectRuntimeSupervisor({ backend })

    const registered = await supervisor.create(projectRoot)
    const inspected = await supervisor.inspect(projectRoot)

    expect(registered.status).toBe('stopped')
    expect(inspected.status).toBe('stopped')
    expect(backend.createCalls).toBe(1)
    expect(backend.inspectCalls).toBe(0)
    expect(backend.startCalls).toBe(0)
  })

  it('starts only for runtime-backed work reasons and records health/status', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-supervisor-'))
    const backend = new FakeBackend()
    const supervisor = new ProjectRuntimeSupervisor({ backend })

    await expect(supervisor.start(projectRoot, { reason: 'ui-open' })).rejects.toThrow(
      'Runtime start reason "ui-open" is not allowed.',
    )

    const started = await supervisor.start(projectRoot, { reason: 'command' })
    const health = await supervisor.health(projectRoot)

    expect(started).toMatchObject({
      status: 'running',
      containerId: 'fake-container',
      keepAliveReasons: ['command'],
    })
    expect(health).toMatchObject({
      status: 'healthy',
      checks: [{ name: 'runtime', ok: true }],
    })
    expect(backend.startCalls).toBe(1)
    expect(backend.inspectCalls).toBe(1)
  })

  it('supports stop, logs, rebuild, and remove lifecycle methods', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-supervisor-'))
    const backend = new FakeBackend()
    const supervisor = new ProjectRuntimeSupervisor({ backend })

    await supervisor.start(projectRoot, { reason: 'proof' })
    expect(await supervisor.logs(projectRoot)).toBe('runtime logs')
    await expect(supervisor.rebuild(projectRoot)).resolves.toMatchObject({
      status: 'stopped',
      containerId: 'rebuilt-container',
    })
    await supervisor.start(projectRoot, { reason: 'dev-server' })
    await expect(supervisor.stop(projectRoot)).resolves.toMatchObject({
      status: 'stopped',
      containerId: null,
      keepAliveReasons: [],
    })
    await expect(supervisor.remove(projectRoot)).resolves.toMatchObject({
      status: 'stopped',
      containerId: null,
    })

    expect(backend.logsCalls).toBe(1)
    expect(backend.rebuildCalls).toBe(1)
    expect(backend.stopCalls).toBe(1)
    expect(backend.removeCalls).toBe(1)
  })

  it('stops after idle timeout when no keep-alive reason remains', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-supervisor-'))
    const backend = new FakeBackend()
    let now = '2026-05-27T18:30:00.000Z'
    const supervisor = new ProjectRuntimeSupervisor({
      backend,
      now: () => now,
    })

    await supervisor.start(projectRoot, { reason: 'browser-proof' })
    now = '2026-05-27T18:40:00.000Z'
    await supervisor.releaseKeepAlive(projectRoot, 'browser-proof')
    now = '2026-05-27T18:50:00.000Z'
    const reaped = await supervisor.stopIdle({ idleTimeoutMs: 5 * 60 * 1000 })

    expect(reaped).toEqual([projectRoot])
    expect(await supervisor.inspect(projectRoot)).toMatchObject({
      status: 'stopped',
      containerId: null,
    })
  })
})
