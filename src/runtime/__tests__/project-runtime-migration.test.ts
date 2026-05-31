import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  applyProjectRuntimeMigration,
  planProjectRuntimeMigration,
  rollbackProjectRuntimeMigration,
} from '../project-runtime-migration.js'
import { readProjectRuntimeState, writeProjectRuntimeState, defaultProjectRuntimeState } from '../project-runtime-store.js'
import { getProjectMigrationStatus } from '../migrations.js'

let tmpProject: string | null = null

afterEach(async () => {
  if (tmpProject) await rm(tmpProject, { recursive: true, force: true })
  tmpProject = null
})

async function projectRoot(): Promise<string> {
  tmpProject = await mkdtemp(join(tmpdir(), 'guildhall-runtime-migration-'))
  return tmpProject
}

describe('project runtime migration', () => {
  it('plans a guided host-run to runtime-backed migration with fallback available', async () => {
    const root = await projectRoot()
    const plan = await planProjectRuntimeMigration(root, {
      projectId: 'sample-app',
      now: () => '2026-05-27T22:10:00.000Z',
    })

    expect(plan).toMatchObject({
      projectRoot: root,
      status: 'needs-health-check',
      fallbackMode: 'host-run',
      fallbackAvailable: true,
      mountLayout: {
        projectPath: '/workspace/sample-app',
        guildhallHomePath: '/home/guildhall/.guildhall',
      },
      actions: [
        { id: 'run-health-checks' },
        { id: 'accept-runtime-backed' },
        { id: 'keep-host-run-compatibility' },
      ],
    })
    expect(plan.runtimeImage.tag).toBe('0.9.0-trixie-node22-python313-playwright')
  })

  it('does not switch away from host-run until health passes and the owner accepts', async () => {
    const root = await projectRoot()
    const result = await applyProjectRuntimeMigration(root, {
      projectId: 'sample-app',
      accepted: false,
      healthReport: {
        status: 'healthy',
        checkedAt: '2026-05-27T22:12:00.000Z',
        mountLayout: {
          projectRoot: root,
          projectPath: '/workspace/sample-app',
          guildhallHome: '/Users/test/.guildhall',
          guildhallHomePath: '/home/guildhall/.guildhall',
        },
        checks: [],
      },
      now: () => '2026-05-27T22:12:00.000Z',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('accept')
    await expect(readProjectRuntimeState(root)).resolves.toMatchObject({
      backendSetup: {
        selectedMode: null,
      },
      migration: {
        mode: 'host-run',
        fallbackAvailable: true,
        lastResult: 'declined',
      },
    })
  })

  it('records runtime-backed migration details and rollback state after accepted healthy migration', async () => {
    const root = await projectRoot()
    await writeProjectRuntimeState(root, {
      ...defaultProjectRuntimeState(root),
      backendSetup: {
        status: 'ready',
        selectedMode: 'host-run',
        lastAction: 'use-host-run-compatibility',
        lastResult: 'completed',
        updatedAt: '2026-05-27T22:00:00.000Z',
      },
    })

    const result = await applyProjectRuntimeMigration(root, {
      projectId: 'sample-app',
      accepted: true,
      healthReport: {
        status: 'healthy',
        checkedAt: '2026-05-27T22:15:00.000Z',
        mountLayout: {
          projectRoot: root,
          projectPath: '/workspace/sample-app',
          guildhallHome: '/Users/test/.guildhall',
          guildhallHomePath: '/home/guildhall/.guildhall',
        },
        checks: [{ name: 'tool:git', ok: true, message: 'ok' }],
      },
      now: () => '2026-05-27T22:15:00.000Z',
    })

    expect(result).toMatchObject({ ok: true, record: { mode: 'runtime-backed' } })
    await expect(readProjectRuntimeState(root)).resolves.toMatchObject({
      mounts: {
        projectPath: '/workspace/sample-app',
        guildhallHomePath: '/home/guildhall/.guildhall',
      },
      backendSetup: {
        selectedMode: 'podman',
      },
      migration: {
        mode: 'runtime-backed',
        fallbackAvailable: true,
        lastResult: 'completed',
        acceptedAt: '2026-05-27T22:15:00.000Z',
        runtimeApiVersion: '1',
        image: {
          tag: '0.9.0-trixie-node22-python313-playwright',
        },
        health: {
          status: 'healthy',
          checks: [{ name: 'tool:git', ok: true }],
        },
        rollback: {
          mode: 'host-run',
          backendSetupSelectedMode: 'host-run',
        },
      },
    })
  })

  it('rolls back to the previous compatibility mode', async () => {
    const root = await projectRoot()
    await applyProjectRuntimeMigration(root, {
      projectId: 'sample-app',
      accepted: true,
      healthReport: {
        status: 'healthy',
        checkedAt: '2026-05-27T22:15:00.000Z',
        mountLayout: {
          projectRoot: root,
          projectPath: '/workspace/sample-app',
          guildhallHome: '/Users/test/.guildhall',
          guildhallHomePath: '/home/guildhall/.guildhall',
        },
        checks: [],
      },
      now: () => '2026-05-27T22:15:00.000Z',
    })

    const rolledBack = await rollbackProjectRuntimeMigration(root, {
      now: () => '2026-05-27T22:20:00.000Z',
    })

    expect(rolledBack.ok).toBe(true)
    await expect(readProjectRuntimeState(root)).resolves.toMatchObject({
      backendSetup: {
        selectedMode: 'host-run',
      },
      migration: {
        mode: 'host-run',
        lastResult: 'rolled-back',
        rolledBackAt: '2026-05-27T22:20:00.000Z',
      },
    })
  })

  it('surfaces the 0.9 runtime-backed migration in the project migration plan', async () => {
    const root = await projectRoot()

    const status = await getProjectMigrationStatus({ projectRoot: root })

    expect(status.pending).toContainEqual(expect.objectContaining({
      id: '0.9.0/runtime-backed-project',
      safety: 'manual',
      summary: expect.stringContaining('runtime-backed'),
    }))
  })
})
