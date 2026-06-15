import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  pauseProjectAvailability,
  readProjectAvailability,
  resumeProjectAvailability,
} from '../project-availability.js'

describe('project availability', () => {
  let previousDataDir: string | undefined
  let tmp: string
  let projectRoot: string

  beforeEach(async () => {
    previousDataDir = process.env.GUILDHALL_DATA_DIR
    tmp = await mkdtemp(join(tmpdir(), 'guildhall-project-availability-'))
    process.env.GUILDHALL_DATA_DIR = join(tmp, 'data')
    projectRoot = join(tmp, 'project')
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
    else process.env.GUILDHALL_DATA_DIR = previousDataDir
    await rm(tmp, { recursive: true, force: true })
  })

  it('defaults projects to active and persists pause/resume policy', async () => {
    await expect(readProjectAvailability(projectRoot)).resolves.toEqual({
      status: 'active',
      pausedAt: null,
      resumedAt: null,
    })

    await expect(
      pauseProjectAvailability(projectRoot, {
        now: () => '2026-06-03T15:00:00.000Z',
        reason: 'user_paused_project',
      }),
    ).resolves.toEqual({
      status: 'paused',
      pausedAt: '2026-06-03T15:00:00.000Z',
      resumedAt: null,
      reason: 'user_paused_project',
    })

    await expect(readProjectAvailability(projectRoot)).resolves.toEqual({
      status: 'paused',
      pausedAt: '2026-06-03T15:00:00.000Z',
      resumedAt: null,
      reason: 'user_paused_project',
    })

    await expect(
      resumeProjectAvailability(projectRoot, {
        now: () => '2026-06-03T15:10:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'active',
      pausedAt: null,
      resumedAt: '2026-06-03T15:10:00.000Z',
    })

    await expect(readProjectAvailability(projectRoot)).resolves.toEqual({
      status: 'active',
      pausedAt: null,
      resumedAt: '2026-06-03T15:10:00.000Z',
    })
  })
})
