import { mkdtemp, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { getProjectRuntimeCommandEvidencePath } from '@guildhall/sessions'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { setProvider } from '../../config/global-providers.js'
import {
  ProjectRuntimeSupervisor,
} from '../project-runtime-supervisor.js'
import type {
  ProjectRuntimeBackend,
  RuntimeBackendCommandEvent,
  RuntimeBackendCommandRequest,
} from '../project-runtime-backend.js'
import type { ProjectRuntimeState } from '../project-runtime-store.js'
import {
  migrateLegacyRuntimeCommandEvidenceToPersistence,
  readRuntimeCommandEvidence,
} from '../project-runtime-command.js'

class CommandBackend implements ProjectRuntimeBackend {
  startCalls = 0
  stopCalls = 0
  requests: RuntimeBackendCommandRequest[] = []

  async create() {
    return { containerId: 'runtime-container' }
  }

  async start() {
    this.startCalls++
    return { containerId: 'runtime-container' }
  }

  async stop() {
    this.stopCalls++
  }

  async inspect() {
    return { status: 'running' as const, containerId: 'runtime-container' }
  }

  async logs() {
    return ''
  }

  async rebuild() {
    return { containerId: 'runtime-container' }
  }

  async remove() {
    return
  }

  async runCommand(
    _projectRoot: string,
    _state: ProjectRuntimeState,
    request: RuntimeBackendCommandRequest,
    emit: (event: RuntimeBackendCommandEvent) => void,
    _signal: AbortSignal,
  ) {
    this.requests.push(request)
    emit({ type: 'stdout', data: 'hello\n' })
    emit({ type: 'stderr', data: 'warn\n' })
    emit({ type: 'port', port: 5173, hostPort: 45173 })
    return { exitCode: 0 }
  }
}

describe('project runtime command execution', () => {
  it('starts a stopped runtime, runs as guildhall, orders events, and persists evidence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-command-'))
    const backend = new CommandBackend()
    const supervisor = new ProjectRuntimeSupervisor({
      backend,
      now: (() => {
        let n = 0
        return () => `2026-05-27T19:00:0${n++}.000Z`
      })(),
    })

    const result = await supervisor.runCommand(projectRoot, {
      projectId: 'demo',
      cwd: '/workspace/demo',
      argv: ['node', '--version'],
      env: { NODE_ENV: 'test' },
      timeoutMs: 5_000,
      expectedPorts: [{ container: 5173, purpose: 'dev-server' }],
      taskId: 'task-123',
    })

    expect(backend.startCalls).toBe(1)
    expect(backend.requests[0]).toMatchObject({
      runtimeUser: 'guildhall',
      argv: ['node', '--version'],
      env: { NODE_ENV: 'test' },
    })
    expect(result).toMatchObject({
      status: 'exited',
      exitCode: 0,
      runtime: { containerId: 'runtime-container' },
    })
    expect(result.events.map(event => event.type)).toEqual([
      'started',
      'stdout',
      'stderr',
      'port',
      'exit',
    ])

    const records = await readRuntimeCommandEvidence(projectRoot)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: result.commandId,
      projectId: 'demo',
      taskId: 'task-123',
      runtime: { containerId: 'runtime-container' },
      exitCode: 0,
      events: [
        { type: 'started' },
        { type: 'stdout', data: 'hello\n' },
        { type: 'stderr', data: 'warn\n' },
        { type: 'port', port: 5173, hostPort: 45173 },
        { type: 'exit', exitCode: 0 },
      ],
    })
    await expect(stat(getProjectRuntimeCommandEvidencePath(projectRoot))).rejects.toMatchObject({ code: 'ENOENT' })

    const persistence = new FileBackedGuildhallPersistence()
    const events = await persistence.listEvents({
      projectRoot,
      placement: {
        scope: 'local_history',
        retention: 'active',
        visibility: 'internal_audit',
        commitPolicy: 'ignored',
      },
      collection: 'runtime-command-evidence',
      streamId: 'task-123',
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      schema: { name: 'runtime-command-evidence', version: 1 },
      recordedBy: 'runtime-command',
      payload: {
        id: result.commandId,
        projectId: 'demo',
        taskId: 'task-123',
      },
    })
  })

  it('falls back to legacy command evidence JSONL only when persistence has no records', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-command-legacy-'))
    const legacyFile = getProjectRuntimeCommandEvidencePath(projectRoot)
    await mkdir(dirname(legacyFile), { recursive: true })
    await writeFile(legacyFile, `${JSON.stringify({
      id: 'cmd-legacy',
      projectId: 'demo',
      request: {
        projectId: 'demo',
        cwd: '/workspace/demo',
        argv: ['node', '--version'],
        env: {},
        timeoutMs: 5_000,
        expectedPorts: [],
      },
      runtime: { id: null, containerId: null },
      status: 'exited',
      exitCode: 0,
      startedAt: '2026-05-27T19:00:00.000Z',
      completedAt: '2026-05-27T19:00:01.000Z',
      events: [],
      error: null,
    })}\n`, 'utf8')

    await expect(readRuntimeCommandEvidence(projectRoot)).resolves.toMatchObject([
      { id: 'cmd-legacy', projectId: 'demo' },
    ])
  })

  it('migrates legacy command evidence JSONL to persistence and removes the legacy file', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-command-migrate-'))
    const legacyFile = getProjectRuntimeCommandEvidencePath(projectRoot)
    await mkdir(dirname(legacyFile), { recursive: true })
    await writeFile(legacyFile, `${JSON.stringify({
      id: 'cmd-legacy',
      projectId: 'demo',
      taskId: 'task-123',
      request: {
        projectId: 'demo',
        cwd: '/workspace/demo',
        argv: ['node', '--version'],
        env: {},
        timeoutMs: 5_000,
        expectedPorts: [],
        taskId: 'task-123',
      },
      runtime: { id: null, containerId: null },
      status: 'exited',
      exitCode: 0,
      startedAt: '2026-05-27T19:00:00.000Z',
      completedAt: '2026-05-27T19:00:01.000Z',
      events: [],
      error: null,
    })}\n`, 'utf8')

    const result = await migrateLegacyRuntimeCommandEvidenceToPersistence(projectRoot)

    expect(result).toMatchObject({ migrated: 1, deletedLegacyFile: true })
    await expect(stat(legacyFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readRuntimeCommandEvidence(projectRoot)).resolves.toMatchObject([
      { id: 'cmd-legacy', projectId: 'demo', taskId: 'task-123' },
    ])
  })

  it('times out commands, emits failure evidence, and releases command keep-alive', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-command-'))
    const backend = new CommandBackend()
    backend.runCommand = async (
      _projectRoot: string,
      _state: ProjectRuntimeState,
      _request: RuntimeBackendCommandRequest,
      _emit: (event: RuntimeBackendCommandEvent) => void,
      signal: AbortSignal,
    ) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true })
      })
      return { exitCode: 0 }
    }
    let now = '2026-05-27T19:10:00.000Z'
    const supervisor = new ProjectRuntimeSupervisor({ backend, now: () => now })

    const result = await supervisor.runCommand(projectRoot, {
      projectId: 'demo',
      cwd: '/workspace/demo',
      argv: ['sleep', '10'],
      env: {},
      timeoutMs: 1,
      expectedPorts: [],
    })

    expect(result.status).toBe('timed_out')
    expect(result.events.map(event => event.type)).toEqual(['started', 'failed'])
    expect(result.events.at(-1)).toMatchObject({ type: 'failed', reason: 'timeout' })

    now = '2026-05-27T19:20:00.000Z'
    await expect(supervisor.stopIdle({ idleTimeoutMs: 1 })).resolves.toEqual([projectRoot])
    expect(backend.stopCalls).toBe(1)

    const records = await readRuntimeCommandEvidence(projectRoot)
    expect(records[0]).toMatchObject({
      status: 'timed_out',
      error: 'Command timed out after 1ms.',
    })
  })

  it('passes configured provider credentials to commands without persisting secrets in evidence', async () => {
    const previousHome = process.env.GUILDHALL_CONFIG_DIR
    const previousOpenAiKey = process.env.OPENAI_API_KEY
    const previousOpenAiBaseUrl = process.env.OPENAI_BASE_URL
    const previousDeepinfraToken = process.env.DEEPINFRA_API_TOKEN
    const home = await mkdtemp(join(tmpdir(), 'guildhall-runtime-provider-home-'))
    process.env.GUILDHALL_CONFIG_DIR = home
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.DEEPINFRA_API_TOKEN
    try {
      setProvider('openai-api', {
        apiKey: 'fake-deepinfra-key',
        baseUrl: 'https://api.deepinfra.com/v1/openai',
      })
      const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-runtime-provider-'))
      const backend = new CommandBackend()
      const supervisor = new ProjectRuntimeSupervisor({ backend })

      const result = await supervisor.runCommand(projectRoot, {
        projectId: 'demo',
        cwd: '/workspace/demo',
        argv: ['pnpm', 'prove:deepinfra-drafting-model'],
        env: {},
        timeoutMs: 5_000,
        expectedPorts: [],
        taskId: 'task-provider-proof',
      })

      expect(result.exitCode).toBe(0)
      expect(backend.requests[0]?.env).toMatchObject({
        OPENAI_API_KEY: 'fake-deepinfra-key',
        OPENAI_BASE_URL: 'https://api.deepinfra.com/v1/openai',
        DEEPINFRA_API_TOKEN: 'fake-deepinfra-key',
      })
      expect(result.request.env).toEqual({})
      const records = await readRuntimeCommandEvidence(projectRoot)
      expect(records[0]?.request.env).toEqual({})
    } finally {
      if (previousHome === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousHome
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousOpenAiKey
      if (previousOpenAiBaseUrl === undefined) delete process.env.OPENAI_BASE_URL
      else process.env.OPENAI_BASE_URL = previousOpenAiBaseUrl
      if (previousDeepinfraToken === undefined) delete process.env.DEEPINFRA_API_TOKEN
      else process.env.DEEPINFRA_API_TOKEN = previousDeepinfraToken
    }
  })
})
