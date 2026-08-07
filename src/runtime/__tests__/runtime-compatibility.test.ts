import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getProjectLocalHistoryDir,
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
import {
  assertLegacyCurrentStateMigrationAccess,
  compareVersions,
  legacyCurrentStateMigrationAvailable,
  projectRuntimeCompatibilityBlocker,
  readProjectRuntimeManifest,
  recordGuildhallRuntimeWrite,
  runtimePackageVersionFromSearchRoots,
} from '../runtime-compatibility.js'

let tmp: string
let projectRoot: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-runtime-compat-'))
  projectRoot = path.join(tmp, 'project')
  await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('compareVersions', () => {
  it('compares semver-like Guildhall versions without treating missing patch parts as newer', () => {
    expect(compareVersions('0.8', '0.8.0')).toBe(0)
    expect(compareVersions('0.8.1', '0.8.0')).toBe(1)
    expect(compareVersions('0.7.9', '0.8.0')).toBe(-1)
  })
})

describe('runtime package identity', () => {
  it('finds an installed package from the process root when a bundled module has no package ancestor', async () => {
    const bundledChunk = path.join(tmp, 'bundle', 'dist', 'chunks')
    const installedApp = path.join(tmp, 'installed', 'app')
    await fs.mkdir(bundledChunk, { recursive: true })
    await fs.mkdir(installedApp, { recursive: true })
    await fs.writeFile(
      path.join(installedApp, 'package.json'),
      JSON.stringify({ name: 'guildhall', version: '9.9.9' }),
      'utf8',
    )

    expect(runtimePackageVersionFromSearchRoots([bundledChunk, installedApp])).toBe('9.9.9')
  })
})

describe('projectRuntimeCompatibilityBlocker', () => {
  it('blocks when the project requires a newer Guildhall or unknown state feature', async () => {
    const runtimePath = getProjectSystemStatePath(projectRoot, 'runtime.json')
    await fs.mkdir(path.dirname(runtimePath), { recursive: true })
    await fs.writeFile(
      runtimePath,
      JSON.stringify({
        version: 1,
        minGuildhallVersion: '2.0.0',
        requiredFeatures: ['future-state.v1'],
      }),
      'utf8',
    )

    expect(projectRuntimeCompatibilityBlocker({ projectRoot, currentVersion: '1.0.0' })).toMatchObject({
      code: 'runtime_too_old',
      actionHref: '/settings/about',
    })

    await fs.writeFile(
      runtimePath,
      JSON.stringify({
        version: 1,
        minGuildhallVersion: '0.1.0',
        requiredFeatures: ['future-state.v1'],
      }),
      'utf8',
    )

    expect(projectRuntimeCompatibilityBlocker({ projectRoot, currentVersion: '1.0.0' })?.message).toContain('future-state.v1')
  })

  it('does not treat a legacy unknown version sentinel as a real upgrade requirement', async () => {
    const runtimePath = getProjectSystemStatePath(projectRoot, 'runtime.json')
    await fs.mkdir(path.dirname(runtimePath), { recursive: true })
    await fs.writeFile(runtimePath, JSON.stringify({ version: 1, minGuildhallVersion: 'unknown' }), 'utf8')

    expect(readProjectRuntimeManifest(projectRoot)).toBeNull()
    expect(projectRuntimeCompatibilityBlocker({ projectRoot, currentVersion: '1.0.0' })).toBeNull()
  })

  it('records runtime features for future compatibility checks', async () => {
    recordGuildhallRuntimeWrite(projectRoot, ['attention-records.v1'])
    recordGuildhallRuntimeWrite(projectRoot, ['project-migrations.v1'])

    expect(readProjectRuntimeManifest(projectRoot)).toMatchObject({
      version: 1,
      requiredFeatures: ['attention-records.v1', 'project-migrations.v1'],
    })
    await expect(fs.access(path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'compatibility.json'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'runtime.json'))).rejects.toThrow()
  })

  it('closes legacy migration access after SQLite becomes the current-state authority', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await writeProjectStateDatabaseSnapshot(tasksPath, {
      projectRoot,
      queue: {
        version: 1,
        lastUpdated: '2026-07-15T12:00:00.000Z',
        tasks: [{ id: 'canonical-task', title: 'Canonical task', status: 'ready' }],
      },
      summary: {
        projectId: 'runtime-compat-test',
        generatedAt: '2026-07-15T12:00:00.000Z',
      },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    expect(legacyCurrentStateMigrationAvailable(projectRoot)).toBe(false)
    expect(() => assertLegacyCurrentStateMigrationAccess(projectRoot, 'test/legacy-migration'))
      .toThrow(/SQLite already owns current project state/)
  })
})
