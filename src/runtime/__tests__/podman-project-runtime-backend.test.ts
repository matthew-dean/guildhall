import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getProjectStateDir } from '@guildhall/sessions'

import { createCapabilityRequest } from '../capability-requests.js'
import { approveMountDirectoryRequest } from '../capability-grants.js'
import { PodmanProjectRuntimeBackend } from '../podman-project-runtime-backend.js'
import { defaultProjectRuntimeState } from '../project-runtime-store.js'
import type { RuntimeBackendCommandEvent } from '../project-runtime-backend.js'

describe('podman project runtime backend', () => {
  it('creates, starts, and runs commands through podman as the guildhall user', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const backend = new PodmanProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        if (args[0] === 'create') return { stdout: 'container-123\n', stderr: '' }
        return { stdout: '', stderr: '' }
      },
      spawn: (file, args) => {
        calls.push({ file, args })
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough
          stderr: PassThrough
          kill: (signal?: NodeJS.Signals) => boolean
        }
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.kill = () => true
        queueMicrotask(() => {
          child.stdout.write('ok\n')
          child.stderr.write('warn\n')
          child.emit('close', 0)
        })
        return child as never
      },
    })
    const state = defaultProjectRuntimeState('/tmp/demo-project')

    const started = await backend.start('/tmp/demo-project', state)
    const events: RuntimeBackendCommandEvent[] = []
    const result = await backend.runCommand(
      '/tmp/demo-project',
      { ...state, containerId: started.containerId ?? null },
      {
        projectId: 'demo-project',
        cwd: state.mounts.projectPath,
        argv: ['pnpm', 'test'],
        env: { NODE_ENV: 'test' },
        timeoutMs: 5_000,
        expectedPorts: [],
        runtimeUser: 'guildhall',
      },
      event => events.push(event),
      new AbortController().signal,
    )

    expect(result.exitCode).toBe(0)
    expect(events).toEqual([
      { type: 'stdout', data: 'ok\n' },
      { type: 'stderr', data: 'warn\n' },
    ])
    expect(calls).toEqual([
      expect.objectContaining({
        file: 'podman',
        args: expect.arrayContaining([
          'create',
          '--user',
          'guildhall',
          '--volume',
          `${state.mounts.projectRoot}:${state.mounts.projectPath}:rw,z`,
          '--tmpfs',
          `${state.mounts.projectPath}/.guildhall:rw,noexec,nosuid,nodev`,
          '--volume',
          `${state.mounts.guildhallHome}:${state.mounts.guildhallHomePath}:rw,z`,
        ]),
      }),
      { file: 'podman', args: ['start', 'container-123'] },
      expect.objectContaining({
        file: 'podman',
        args: [
          'exec',
          '--user',
          'guildhall',
          '--workdir',
          state.mounts.projectPath,
          '--env',
          'NODE_ENV=test',
          'container-123',
          'guildhall-exec',
          'pnpm',
          'test',
        ],
      }),
    ])
  })

  it('mounts an isolated container Guildhall home instead of the host Guildhall home', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-podman-project-'))
    const backend = new PodmanProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: 'container-789\n', stderr: '' }
      },
    })
    const state = defaultProjectRuntimeState(projectRoot)

    await backend.create(projectRoot, state)

    const createArgs = calls[0]!.args
    expect(createArgs).toContain(`${state.mounts.guildhallHome}:${state.mounts.guildhallHomePath}:rw,z`)
    expect(createArgs).not.toContain(`${join(homedir(), '.guildhall')}:${state.mounts.guildhallHomePath}:rw,z`)
    expect(state.mounts.guildhallHome).toContain('/runtime/container-home')
    expect(existsSync(state.mounts.guildhallHome)).toBe(true)

    await rm(projectRoot, { recursive: true, force: true })
  })

  it('does not trust legacy runtime state that still points at the host Guildhall home', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-podman-project-'))
    const backend = new PodmanProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: 'container-legacy\n', stderr: '' }
      },
    })
    const legacyState = {
      ...defaultProjectRuntimeState(projectRoot),
      mounts: {
        ...defaultProjectRuntimeState(projectRoot).mounts,
        guildhallHome: join(homedir(), '.guildhall'),
      },
    }

    await backend.create(projectRoot, legacyState)

    const createArgs = calls[0]!.args
    expect(createArgs).not.toContain(`${join(homedir(), '.guildhall')}:${legacyState.mounts.guildhallHomePath}:rw,z`)
    expect(createArgs.some(arg => arg.endsWith(`/runtime/container-home:${legacyState.mounts.guildhallHomePath}:rw,z`))).toBe(true)

    await rm(projectRoot, { recursive: true, force: true })
  })

  it('overlays project-local Guildhall state instead of exposing it through the checkout mount', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-podman-project-'))
    const backend = new PodmanProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: 'container-overlay\n', stderr: '' }
      },
    })
    const state = defaultProjectRuntimeState(projectRoot)

    await backend.create(projectRoot, state)

    expect(calls[0]!.args).toEqual(expect.arrayContaining([
      '--tmpfs',
      `${state.mounts.projectPath}/.guildhall:rw,noexec,nosuid,nodev`,
    ]))

    await rm(projectRoot, { recursive: true, force: true })
  })

  it('mounts only active approved capability grants when creating the container', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const projectRoot = '/tmp/demo-project-with-grant'
    const memoryDir = getProjectStateDir(projectRoot)
    const request = await createCapabilityRequest({
      memoryDir,
      taskId: 'task-fixtures',
      kind: 'mount_directory',
      requestedBy: 'worker-agent',
      reason: 'Need fixture reads.',
      mount: {
        hostPath: '/tmp/fixtures',
        containerPath: '/mnt/requested/fixtures',
        access: 'read-write',
      },
    })
    const approved = await approveMountDirectoryRequest({
      memoryDir,
      requestId: request.id,
      approvedBy: 'owner',
      access: 'read-only',
    })
    const backend = new PodmanProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: 'container-456\n', stderr: '' }
      },
    })
    const state = defaultProjectRuntimeState(projectRoot)

    await backend.create(projectRoot, state)

    expect(calls[0]).toEqual(expect.objectContaining({
      file: 'podman',
      args: expect.arrayContaining([
        '--volume',
        `/tmp/fixtures:/mnt/guildhall-grants/${approved.grant?.id}:ro,z`,
      ]),
    }))
  })
})
