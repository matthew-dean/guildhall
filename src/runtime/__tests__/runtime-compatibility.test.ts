import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  compareVersions,
  projectRuntimeCompatibilityBlocker,
  readProjectRuntimeManifest,
  recordGuildhallRuntimeWrite,
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

describe('projectRuntimeCompatibilityBlocker', () => {
  it('blocks when the project requires a newer Guildhall or unknown state feature', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.guildhall', 'runtime.json'),
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
      path.join(projectRoot, '.guildhall', 'runtime.json'),
      JSON.stringify({
        version: 1,
        minGuildhallVersion: '0.1.0',
        requiredFeatures: ['future-state.v1'],
      }),
      'utf8',
    )

    expect(projectRuntimeCompatibilityBlocker({ projectRoot, currentVersion: '1.0.0' })?.message).toContain('future-state.v1')
  })

  it('records runtime features for future compatibility checks', () => {
    recordGuildhallRuntimeWrite(projectRoot, ['attention-records.v1'])
    recordGuildhallRuntimeWrite(projectRoot, ['project-migrations.v1'])

    expect(readProjectRuntimeManifest(projectRoot)).toMatchObject({
      version: 1,
      requiredFeatures: ['attention-records.v1', 'project-migrations.v1'],
    })
  })
})
