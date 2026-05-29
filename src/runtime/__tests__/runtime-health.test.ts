import { describe, expect, it } from 'vitest'

import {
  buildRuntimeMountLayout,
  runtimeProjectSlug,
  runRuntimeHealthChecks,
  type RuntimeHealthCommandRunner,
} from '../runtime-health.js'
import { defaultProjectRuntimeState } from '../project-runtime-store.js'

function passingRunner(commands: string[] = []): RuntimeHealthCommandRunner {
  return async (command, args) => {
    commands.push([command, ...args].join(' '))
    return { exitCode: 0, stdout: 'ok\n', stderr: '' }
  }
}

describe('runtime health', () => {
  it('defines stable project and Guildhall home mount paths', () => {
    expect(runtimeProjectSlug('/Users/matthew/git/oss/My App')).toBe('my-app')
    expect(buildRuntimeMountLayout('/Users/matthew/git/oss/My App', {
      projectId: 'Looma Knit',
      guildhallHome: '/Users/matthew/.guildhall',
    })).toEqual({
      projectRoot: '/Users/matthew/git/oss/My App',
      projectPath: '/workspace/looma-knit',
      guildhallHome: '/Users/matthew/.guildhall',
      guildhallHomePath: '/home/guildhall/.guildhall',
    })
  })

  it('runs mount, tool, DNS, and command-log persistence checks', async () => {
    const commands: string[] = []
    const state = defaultProjectRuntimeState('/repo/app')
    state.mounts = buildRuntimeMountLayout('/repo/app', {
      projectId: 'app',
      guildhallHome: '/Users/test/.guildhall',
    })

    const report = await runRuntimeHealthChecks('/repo/app', {
      state,
      commandRunner: passingRunner(commands),
      now: () => '2026-05-27T22:00:00.000Z',
    })

    expect(report.status).toBe('healthy')
    expect(report.checkedAt).toBe('2026-05-27T22:00:00.000Z')
    expect(report.mountLayout.projectPath).toBe('/workspace/app')
    expect(report.checks.map(check => check.name)).toEqual(expect.arrayContaining([
      'mount:project:read-write',
      'mount:project:owner',
      'mount:project:file-ops',
      'mount:guildhall-home:file-ops',
      'mount:polling-fallback',
      'tool:sh',
      'tool:git',
      'tool:rg',
      'tool:jq',
      'tool:node',
      'tool:npm',
      'tool:corepack',
      'tool:python3',
      'tool:pipx',
      'network:dns',
      'persistence:command-log',
    ]))
    expect(commands.some(command => command.includes('/workspace/app') && command.includes('.guildhall-runtime-health'))).toBe(true)
    expect(commands.some(command => command.includes('/home/guildhall/.guildhall/runtime/health/command-log.jsonl'))).toBe(true)
  })

  it('marks a failed health check as unhealthy with the raw failure message', async () => {
    const report = await runRuntimeHealthChecks('/repo/app', {
      commandRunner: async (_command, args) => {
        const script = args.join(' ')
        if (script.includes('command -v jq')) {
          return { exitCode: 127, stdout: '', stderr: 'jq: not found' }
        }
        return { exitCode: 0, stdout: 'ok\n', stderr: '' }
      },
    })

    expect(report.status).toBe('unhealthy')
    expect(report.checks.find(check => check.name === 'tool:jq')).toMatchObject({
      ok: false,
      message: 'jq: not found',
    })
  })
})
