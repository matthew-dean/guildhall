import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DockerProjectRuntimeBackend } from '../docker-project-runtime-backend.js'
import { defaultProjectRuntimeState } from '../project-runtime-store.js'
import type { RuntimeBackendCommandEvent } from '../project-runtime-backend.js'

describe('docker project runtime backend', () => {
  it('creates, starts, and runs commands through docker as the guildhall user', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const backend = new DockerProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        if (args[0] === 'create') return { stdout: 'container-docker\n', stderr: '' }
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
          child.emit('close', 0)
        })
        return child as never
      },
    })
    const state = defaultProjectRuntimeState('/tmp/demo-docker-project')

    const started = await backend.start('/tmp/demo-docker-project', state)
    const events: RuntimeBackendCommandEvent[] = []
    const result = await backend.runCommand(
      '/tmp/demo-docker-project',
      { ...state, containerId: started.containerId ?? null },
      {
        projectId: 'demo-docker-project',
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
    expect(events).toEqual([{ type: 'stdout', data: 'ok\n' }])
    expect(calls).toEqual([
      expect.objectContaining({
        file: 'docker',
        args: expect.arrayContaining([
          'create',
          '--user',
          'guildhall',
          '--volume',
          `${state.mounts.projectRoot}:${state.mounts.projectPath}:rw`,
          '--tmpfs',
          `${state.mounts.projectPath}/.guildhall:rw,noexec,nosuid,nodev`,
          '--volume',
          `${state.mounts.guildhallHome}:${state.mounts.guildhallHomePath}:rw`,
        ]),
      }),
      { file: 'docker', args: ['start', 'container-docker'] },
      expect.objectContaining({
        file: 'docker',
        args: [
          'exec',
          '--user',
          'guildhall',
          '--workdir',
          state.mounts.projectPath,
          '--env',
          'NODE_ENV=test',
          'container-docker',
          'guildhall-exec',
          'pnpm',
          'test',
        ],
      }),
    ])
  })

  it('mounts an isolated container Guildhall home and overlays project-local state', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const projectRoot = await mkdtemp(join(tmpdir(), 'guildhall-docker-project-'))
    const backend = new DockerProjectRuntimeBackend({
      execFile: async (file, args) => {
        calls.push({ file, args })
        return { stdout: 'container-docker\n', stderr: '' }
      },
    })
    const state = defaultProjectRuntimeState(projectRoot)

    await backend.create(projectRoot, state)

    expect(calls[0]!.args).toEqual(expect.arrayContaining([
      '--volume',
      `${state.mounts.guildhallHome}:${state.mounts.guildhallHomePath}:rw`,
      '--tmpfs',
      `${state.mounts.projectPath}/.guildhall:rw,noexec,nosuid,nodev`,
    ]))
    expect(calls[0]!.args).not.toContain(`${join(homedir(), '.guildhall')}:${state.mounts.guildhallHomePath}:rw`)
    expect(existsSync(state.mounts.guildhallHome)).toBe(true)

    await rm(projectRoot, { recursive: true, force: true })
  })
})
