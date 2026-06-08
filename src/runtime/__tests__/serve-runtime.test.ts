import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { bootstrapWorkspace } from '@guildhall/config'
import { getProjectStateDir } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import {
  ProjectRuntimeSupervisor,
} from '../project-runtime-supervisor.js'
import type {
  ProjectRuntimeBackend,
  RuntimeBackendCommandEvent,
  RuntimeBackendCommandRequest,
} from '../project-runtime-backend.js'
import type { ProjectRuntimeState } from '../project-runtime-store.js'
import type { RuntimeBackendSetupDetector } from '../runtime-backend-setup.js'
import { createCapabilityRequest, listCapabilityRequests } from '../capability-requests.js'
import { readRuntimeCommandEvidence } from '../project-runtime-command.js'
import type { DevServerRecord, StartDevServerRequest } from '../dev-server-manager.js'
import { applyProjectMigrations } from '../migrations.js'

const execFileP = promisify(execFile)
const PROJECT_ID = 'runtime-test'

let tmpDir: string
let previousHome: string | undefined
let previousConfigDir: string | undefined
let systemDir: string

class CountingBackend implements ProjectRuntimeBackend {
  starts = 0
  inspections = 0
  commandRequests: RuntimeBackendCommandRequest[] = []
  commandError: Error | null = null

  async create() {
    return { containerId: 'runtime-container' }
  }

  async start() {
    this.starts++
    return { containerId: 'runtime-container' }
  }

  async stop() {
    return
  }

  async inspect() {
    this.inspections++
    return {
      status: 'running' as const,
      health: {
        status: 'healthy' as const,
        checkedAt: '2026-05-27T18:00:00.000Z',
        checks: [{ name: 'runtime', ok: true }],
      },
    }
  }

  async logs() {
    return ''
  }

  async rebuild(_projectRoot: string, state: ProjectRuntimeState) {
    return { containerId: state.containerId }
  }

  async remove() {
    return
  }

  async runCommand(
    _projectRoot: string,
    _state: ProjectRuntimeState,
    request: RuntimeBackendCommandRequest,
    emit: (event: RuntimeBackendCommandEvent) => void,
  ) {
    this.commandRequests.push(request)
    if (this.commandError) throw this.commandError
    emit({ type: 'stdout', data: 'hello from runtime\n' })
    emit({ type: 'port', port: 5173, hostPort: 45173 })
    return { exitCode: 0 }
  }
}

class FakeDevServerManager {
  records: DevServerRecord[] = []
  starts: StartDevServerRequest[] = []
  stops: string[] = []
  restarts: string[] = []

  async list() {
    return this.records
  }

  async start(_projectRoot: string, request: StartDevServerRequest) {
    this.starts.push(request)
    const record: DevServerRecord = {
      id: request.id,
      projectId: request.projectId,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      status: 'running',
      readiness: 'ready',
      command: { cwd: request.cwd, argv: request.argv },
      ports: [{ container: request.containerPort, host: request.preferredHostPort ?? 45173, purpose: 'dev-server' }],
      url: `http://127.0.0.1:${request.preferredHostPort ?? 45173}`,
      readinessPath: request.readinessPath ?? '/',
      browserProof: {
        url: `http://127.0.0.1:${request.preferredHostPort ?? 45173}${request.readinessPath ?? '/'}`,
        ok: true,
        status: 200,
        checkedAt: '2026-05-27T22:00:00.000Z',
        error: null,
      },
      runtimeProcessId: 'dev-1',
      logs: ['ready'],
      startedAt: '2026-05-27T22:00:00.000Z',
      stoppedAt: null,
      lastCheckedAt: '2026-05-27T22:00:00.000Z',
      error: null,
    }
    this.records = [record]
    return record
  }

  async stop(_projectRoot: string, id: string) {
    this.stops.push(id)
    const record = this.records.find(item => item.id === id)!
    const stopped = { ...record, status: 'stopped' as const, readiness: 'unknown' as const }
    this.records = [stopped]
    return stopped
  }

  async restart(_projectRoot: string, id: string) {
    this.restarts.push(id)
    const record = this.records.find(item => item.id === id)!
    const restarted = { ...record, status: 'running' as const, readiness: 'ready' as const, runtimeProcessId: 'dev-2' }
    this.records = [restarted]
    return restarted
  }
}

function scoped(pathname: string): string {
  const separator = pathname.includes('?') ? '&' : '?'
  return `http://localhost${pathname}${separator}projectId=${encodeURIComponent(PROJECT_ID)}`
}

beforeEach(async () => {
  previousHome = process.env.HOME
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-runtime-'))
  systemDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-runtime-system-'))
  process.env.HOME = tmpDir
  process.env.GUILDHALL_CONFIG_DIR = systemDir
  bootstrapWorkspace(tmpDir, { name: 'Runtime Test' })
  await execFileP('git', ['init', '-b', 'main'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: tmpDir })
  await execFileP('git', ['add', '.'], { cwd: tmpDir })
  await execFileP('git', ['commit', '-m', 'init'], { cwd: tmpDir })
  await applyProjectMigrations({ projectRoot: tmpDir, only: ['0.10.0/project-state-storage-boundary'] })
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(systemDir, { recursive: true, force: true })
})

describe('project runtime API', () => {
  it('reports stopped-by-default runtime state without starting a container', async () => {
    const backend = new CountingBackend()
    const runtimeSupervisor = new ProjectRuntimeSupervisor({ backend })
    const { app } = buildServeApp({ projectPath: tmpDir, runtimeSupervisor })

    const project = await app.fetch(new Request(scoped('/api/project')))
    const runtime = await app.fetch(new Request(scoped('/api/project/runtime')))

    expect(project.status).toBe(200)
    expect(runtime.status).toBe(200)
    await expect(runtime.json()).resolves.toMatchObject({
      status: 'stopped',
      backend: 'docker',
      runtimeApiVersion: '1',
      image: {
        repository: 'ghcr.io/matthew-dean/guildhall-runtime-debian',
      },
    })
    expect(backend.starts).toBe(0)
    expect(backend.inspections).toBe(0)
  })

  it('reports runtime health through a separate endpoint', async () => {
    const backend = new CountingBackend()
    const runtimeSupervisor = new ProjectRuntimeSupervisor({ backend })
    await runtimeSupervisor.start(tmpDir, { reason: 'command' })
    const { app } = buildServeApp({ projectPath: tmpDir, runtimeSupervisor })

    const res = await app.fetch(new Request(scoped('/api/project/runtime/health')))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      status: 'healthy',
      checks: [{ name: 'runtime', ok: true }],
    })
    expect(backend.starts).toBe(1)
    expect(backend.inspections).toBe(1)
  })

  it('runs runtime commands through the project API and persists ordered evidence', async () => {
    const backend = new CountingBackend()
    const runtimeSupervisor = new ProjectRuntimeSupervisor({ backend })
    const { app } = buildServeApp({ projectPath: tmpDir, runtimeSupervisor })

    const res = await app.fetch(new Request(scoped('/api/project/runtime/command'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        cwd: '/workspace/runtime-test',
        argv: ['pnpm', 'test'],
        env: { NODE_ENV: 'test' },
        timeoutMs: 5_000,
        expectedPorts: [{ container: 5173, purpose: 'dev-server' }],
        taskId: 'task-1',
      }),
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      projectId: PROJECT_ID,
      taskId: 'task-1',
      status: 'exited',
      exitCode: 0,
      request: {
        cwd: '/workspace/runtime-test',
        argv: ['pnpm', 'test'],
        env: { NODE_ENV: 'test' },
      },
      events: [
        { type: 'started', cwd: '/workspace/runtime-test', argv: ['pnpm', 'test'] },
        { type: 'stdout', data: 'hello from runtime\n' },
        { type: 'port', port: 5173, hostPort: 45173 },
        { type: 'exit', exitCode: 0 },
      ],
    })
    expect(backend.starts).toBe(1)
    expect(backend.commandRequests).toHaveLength(1)
    expect(backend.commandRequests[0]).toMatchObject({
      runtimeUser: 'guildhall',
      expectedPorts: [{ container: 5173, purpose: 'dev-server' }],
    })
    await expect(readRuntimeCommandEvidence(tmpDir)).resolves.toHaveLength(1)
  })

  it('turns denied host access from runtime commands into a capability request', async () => {
    const backend = new CountingBackend()
    backend.commandError = new Error('host access denied: /Users/matthew/Secrets')
    const runtimeSupervisor = new ProjectRuntimeSupervisor({ backend })
    const { app } = buildServeApp({ projectPath: tmpDir, runtimeSupervisor })

    const res = await app.fetch(new Request(scoped('/api/project/runtime/command'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        cwd: '/workspace/runtime-test',
        argv: ['ls', '/Users/matthew/Secrets'],
        taskId: 'task-denied',
      }),
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      status: 'failed',
      error: 'host access denied: /Users/matthew/Secrets',
      capabilityRequest: {
        taskId: 'task-denied',
        kind: 'mount_directory',
        requestedBy: 'runtime-command',
        status: 'pending',
        mount: {
          hostPath: '/Users/matthew/Secrets',
          containerPath: '/mnt/guildhall-grants/secrets',
          access: 'read-only',
        },
      },
    })
    expect(listCapabilityRequests(getProjectStateDir(tmpDir))).toHaveLength(1)
    await expect(readRuntimeCommandEvidence(tmpDir)).resolves.toHaveLength(1)
  })

  it('lists, approves, denies, blocks, and revokes capability requests through the API', async () => {
    const memoryDir = getProjectStateDir(tmpDir)
    const pending = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-fixtures',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need fixture reads.',
      mount: {
        hostPath: '/Users/matthew/git/fixtures',
        containerPath: '/mnt/requested/fixtures',
        access: 'read-write',
      },
    })
    const deniedRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-secrets',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need private data.',
      mount: {
        hostPath: '/Users/matthew/.ssh',
        containerPath: '/mnt/requested/ssh',
        access: 'read-only',
      },
    })
    const blockedRequest = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-private',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need a private repo.',
      mount: {
        hostPath: '/Users/matthew/git/private/repo',
        containerPath: '/mnt/requested/private',
        access: 'read-only',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const listBefore = await app.fetch(new Request(scoped('/api/project/capability-requests')))
    const approve = await app.fetch(new Request(scoped(`/api/project/capability-requests/${pending.id}/approve`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access: 'read-only',
        hostPath: '/Users/matthew/git/fixtures/screenshots',
        duration: 'this task',
      }),
    }))
    const deny = await app.fetch(new Request(scoped(`/api/project/capability-requests/${deniedRequest.id}/deny`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fallback: 'Use public fixtures only.' }),
    }))
    const block = await app.fetch(new Request(scoped(`/api/project/capability-requests/${blockedRequest.id}/block`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Owner needs to clone the repo first.' }),
    }))
    const listAfter = await app.fetch(new Request(scoped('/api/project/capability-requests')))
    const approved = await approve.json() as {
      id: string
      grant: { id: string }
    }
    const revoke = await app.fetch(new Request(scoped(`/api/project/capability-requests/${approved.id}/revoke`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'No longer needed.' }),
    }))

    expect(listBefore.status).toBe(200)
    const beforeJson = await listBefore.json() as {
      requests: Array<{ id: string; status: string }>
      activeGrants: unknown[]
    }
    expect(beforeJson.activeGrants).toEqual([])
    expect(beforeJson.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pending.id, status: 'pending' }),
    ]))
    expect(approve.status).toBe(200)
    expect(approved).toMatchObject({
      status: 'approved',
      grant: {
        access: 'read-only',
        hostPath: '/Users/matthew/git/fixtures/screenshots',
        status: 'active',
      },
    })
    await expect(deny.json()).resolves.toMatchObject({
      status: 'denied',
      fallback: 'Use public fixtures only.',
    })
    await expect(block.json()).resolves.toMatchObject({
      status: 'blocked',
      blockedReason: 'Owner needs to clone the repo first.',
    })
    await expect(listAfter.json()).resolves.toMatchObject({
      activeGrants: [{ id: approved.grant.id, status: 'active' }],
    })
    await expect(revoke.json()).resolves.toMatchObject({
      status: 'revoked',
      grant: { status: 'revoked', revokeReason: 'No longer needed.' },
    })
  })

  it('starts, lists, stops, and restarts runtime dev servers through the API', async () => {
    const devServerManager = new FakeDevServerManager()
    const { app } = buildServeApp({ projectPath: tmpDir, devServerManager })

    const start = await app.fetch(new Request(scoped('/api/project/runtime/dev-servers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'app',
        projectId: PROJECT_ID,
        taskId: 'task-web',
        cwd: '/workspace/runtime-test',
        argv: ['pnpm', 'dev', '--host', '0.0.0.0'],
        containerPort: 5173,
        preferredHostPort: 45173,
        readinessPath: '/',
      }),
    }))
    const list = await app.fetch(new Request(scoped('/api/project/runtime/dev-servers')))
    const stop = await app.fetch(new Request(scoped('/api/project/runtime/dev-servers/app/stop'), { method: 'POST' }))
    const restart = await app.fetch(new Request(scoped('/api/project/runtime/dev-servers/app/restart'), { method: 'POST' }))

    expect(start.status).toBe(200)
    await expect(start.json()).resolves.toMatchObject({
      id: 'app',
      status: 'running',
      readiness: 'ready',
      url: 'http://127.0.0.1:45173',
      browserProof: { ok: true, status: 200 },
    })
    await expect(list.json()).resolves.toMatchObject({
      devServers: [{ id: 'app', command: { cwd: '/workspace/runtime-test' } }],
    })
    await expect(stop.json()).resolves.toMatchObject({ id: 'app', status: 'stopped' })
    await expect(restart.json()).resolves.toMatchObject({ id: 'app', status: 'running', runtimeProcessId: 'dev-2' })
    expect(devServerManager.starts[0]).toMatchObject({ taskId: 'task-web', containerPort: 5173 })
    expect(devServerManager.stops).toEqual(['app'])
    expect(devServerManager.restarts).toEqual(['app'])
  })

  it('reports guided backend setup status through a separate endpoint', async () => {
    const runtimeBackendSetup: RuntimeBackendSetupDetector = async () => ({
      backend: 'podman',
      platform: 'darwin',
      supportedHost: true,
      status: 'machine-stopped',
      dockerPath: null,
      dockerVersion: null,
      podmanPath: '/opt/homebrew/bin/podman',
      podmanVersion: 'podman version 5.6.2',
      homebrewPath: '/opt/homebrew/bin/brew',
      runtimes: {
        docker: { status: 'missing', path: null, version: null },
        podman: {
          status: 'machine-stopped',
          path: '/opt/homebrew/bin/podman',
          version: 'podman version 5.6.2',
          machine: { exists: true, running: false, name: 'podman-machine-default' },
        },
      },
      nonContainerExecution: { allowed: false, source: 'default' },
      machine: { exists: true, running: false, name: 'podman-machine-default' },
      message: 'Podman is installed, but the local runtime service is stopped.',
      compatibilityModeAvailable: true,
      compatibilityModeLabel: 'Host-run compatibility mode',
      installGuidance: {
        homebrew: 'brew install podman',
        officialInstallerUrl: 'https://podman.io/docs/installation#macos',
      },
      actions: [
        {
          id: 'start-machine',
          label: 'Start local runtime',
          description: 'Start the Podman machine for runtime-backed work.',
          mutatesHost: true,
          requiresApproval: true,
          command: ['podman', 'machine', 'start'],
        },
      ],
      lastCheckedAt: '2026-05-27T20:00:00.000Z',
    })
    const { app } = buildServeApp({ projectPath: tmpDir, runtimeBackendSetup })

    const res = await app.fetch(new Request(scoped('/api/project/runtime/setup')))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      status: 'machine-stopped',
      compatibilityModeLabel: 'Host-run compatibility mode',
      actions: [{ id: 'start-machine', requiresApproval: true }],
    })
  })

  it('declines host-changing runtime setup actions without explicit approval', async () => {
    const runtimeBackendSetup: RuntimeBackendSetupDetector = async () => {
      throw new Error('detector should not run before approval')
    }
    const { app } = buildServeApp({ projectPath: tmpDir, runtimeBackendSetup })

    const res = await app.fetch(new Request(scoped('/api/project/runtime/setup/action'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start-machine', approved: false }),
    }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      result: { mutatedHost: false },
    })
  })
})
