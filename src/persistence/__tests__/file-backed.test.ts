import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileBackedGuildhallPersistence } from '../file-backed.js'
import type { PersistencePlacement } from '../types.js'

const sharedPlacement: PersistencePlacement = {
  scope: 'shared_project',
  retention: 'active',
  visibility: 'user_visible',
  commitPolicy: 'committed',
}

const localPlacement: PersistencePlacement = {
  scope: 'local_history',
  retention: 'debug',
  visibility: 'internal_audit',
  commitPolicy: 'ignored',
}

describe('FileBackedGuildhallPersistence', () => {
  let tmp: string
  let dataDir: string
  let priorDataDir: string | undefined
  const now = () => new Date('2026-05-25T12:00:00.000Z')

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-persistence-'))
    dataDir = path.join(tmp, 'data')
    priorDataDir = process.env.GUILDHALL_DATA_DIR
    process.env.GUILDHALL_DATA_DIR = dataDir
  })

  afterEach(async () => {
    if (priorDataDir === undefined) {
      delete process.env.GUILDHALL_DATA_DIR
    } else {
      process.env.GUILDHALL_DATA_DIR = priorDataDir
    }
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('writes shared project records with schema, provenance, placement, and hash', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()

    const record = await persistence.writeRecord({
      projectRoot,
      placement: sharedPlacement,
      collection: 'review-plans',
      id: 'task-123',
      schemaName: 'review-plan',
      schemaVersion: 1,
      createdBy: 'coordinator:test',
      sourceRefs: ['task:task-123'],
      payload: { effort: 'balanced', lanes: ['ux_comprehension'] },
      now,
    })

    expect(record.ref.path).toContain(path.join(projectRoot, '.guildhall', 'persistence'))
    expect(record.schema).toEqual({ name: 'review-plan', version: 1 })
    expect(record.provenance).toMatchObject({
      createdAt: '2026-05-25T12:00:00.000Z',
      updatedAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'coordinator:test',
      sourceRefs: ['task:task-123'],
    })
    expect(record.contentHash).toHaveLength(64)

    const loaded = await persistence.readRecord<typeof record.payload>(record.ref)
    expect(loaded?.payload).toEqual({ effort: 'balanced', lanes: ['ux_comprehension'] })
  })

  it('appends local history events without placing raw evidence in shared project state', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()

    await persistence.appendEvent({
      projectRoot,
      placement: localPlacement,
      collection: 'review-runs',
      streamId: 'task-123',
      schemaName: 'reviewer-run',
      schemaVersion: 1,
      createdBy: 'reviewer:ux',
      payload: { verdict: 'revise' },
      now,
    })
    await persistence.appendEvent({
      projectRoot,
      placement: localPlacement,
      collection: 'review-runs',
      streamId: 'task-123',
      schemaName: 'reviewer-run',
      schemaVersion: 1,
      createdBy: 'reviewer:ux',
      payload: { verdict: 'approve' },
      now,
    })

    const events = await persistence.listEvents<{ verdict: string }>({
      projectRoot,
      placement: localPlacement,
      collection: 'review-runs',
      streamId: 'task-123',
    })

    expect(events.map((event) => event.payload.verdict)).toEqual(['revise', 'approve'])
    expect(events[0]!.ref.path).toContain(path.join(dataDir, 'projects'))
    expect(events[0]!.ref.path).not.toContain(path.join(projectRoot, '.guildhall'))
  })

  it('saves artifacts with content hashes and reports unavailable evidence honestly', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()

    const artifact = await persistence.saveArtifact({
      projectRoot,
      placement: localPlacement,
      collection: 'review-screenshots',
      id: 'thread-card',
      content: 'fake image bytes',
      contentType: 'text/plain',
      extension: 'txt',
      createdBy: 'worker:test',
    })

    expect(artifact.hash).toHaveLength(64)
    expect((await persistence.resolveEvidence(artifact)).available).toBe(true)

    await fs.rm(artifact.path)

    expect(await persistence.resolveEvidence(artifact)).toMatchObject({
      available: false,
      reason: 'missing',
    })
  })

  it('requires projectRoot or exportRoot for placements that need them', async () => {
    const persistence = new FileBackedGuildhallPersistence()

    await expect(persistence.writeRecord({
      placement: sharedPlacement,
      collection: 'review-plans',
      id: 'task-123',
      schemaName: 'review-plan',
      schemaVersion: 1,
      createdBy: 'coordinator:test',
      payload: {},
    })).rejects.toThrow(/shared_project placement requires projectRoot/)

    await expect(persistence.writeRecord({
      placement: {
        scope: 'exported_artifact',
        retention: 'archive',
        visibility: 'user_visible',
        commitPolicy: 'user_exported',
      },
      collection: 'review-plans',
      id: 'task-123',
      schemaName: 'review-plan',
      schemaVersion: 1,
      createdBy: 'coordinator:test',
      payload: {},
    })).rejects.toThrow(/exported_artifact placement requires exportRoot/)
  })
})
