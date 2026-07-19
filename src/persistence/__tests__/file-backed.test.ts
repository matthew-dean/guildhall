import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getProjectLocalHistoryDir } from '@guildhall/sessions'
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

    expect(record.ref.path).toContain(path.join(dataDir, 'projects'))
    expect(record.ref.path).toContain(path.join('project-state', 'persistence'))
    await expect(fs.stat(path.join(projectRoot, '.guildhall'))).rejects.toThrow()
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

  it('deduplicates event ids and enforces bounded stream retention', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()

    for (let index = 0; index < 200; index += 1) {
      await persistence.appendEvent({
        projectRoot,
        placement: localPlacement,
        collection: 'debug-stream',
        streamId: 'task-123',
        eventId: `event-${index}`,
        schemaName: 'debug-event',
        schemaVersion: 1,
        createdBy: 'debug:test',
        payload: { index, output: 'x'.repeat(3000) },
        now,
      })
    }

    const events = await persistence.listEvents<{ index: number }>({
      projectRoot,
      placement: localPlacement,
      collection: 'debug-stream',
      streamId: 'task-123',
    })
    expect(events.length).toBeLessThan(200)
    expect(events.at(-1)?.payload.index).toBe(199)
    expect((await fs.stat(events[0]!.ref.path)).size).toBeLessThanOrEqual(256 * 1024)
    expect((await persistence.listEvents({
      projectRoot,
      placement: localPlacement,
      collection: 'debug-stream',
      streamId: 'task-123',
      limit: 3,
    }))).toHaveLength(3)

    const duplicate = await persistence.appendEvent({
      projectRoot,
      placement: localPlacement,
      collection: 'debug-stream',
      streamId: 'task-123',
      eventId: 'event-199',
      schemaName: 'debug-event',
      schemaVersion: 1,
      createdBy: 'debug:test',
      payload: { index: 999 },
      now,
    })
    expect(duplicate.payload).toMatchObject({ index: 199 })
  })

  it('rejects oversized durable records instead of persisting hidden payload weight', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()

    await expect(persistence.writeRecord({
      projectRoot,
      placement: sharedPlacement,
      collection: 'review-plans',
      id: 'oversized',
      schemaName: 'review-plan',
      schemaVersion: 1,
      createdBy: 'coordinator:test',
      payload: { transcript: 'x'.repeat(300 * 1024) },
      now,
    })).rejects.toThrow(/Store bulky evidence as an artifact or compact summary/)
  })

  it('reads only the retention window from an oversized legacy event stream', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()
    const placement = localPlacement
    const filePath = path.join(getProjectLocalHistoryDir(projectRoot), 'persistence', 'events', 'debug-stream', 'task-123.jsonl')
    const lines = Array.from({ length: 200 }, (_, index) => JSON.stringify({
      schema: { name: 'debug-event', version: 1 },
      ref: { scope: placement.scope, collection: 'debug-stream', id: 'task-123', path: filePath },
      eventId: `event-${index}`,
      recordedAt: now().toISOString(),
      recordedBy: 'debug:test',
      placement,
      sourceRefs: [],
      contentHash: 'hash',
      payload: { index, output: 'x'.repeat(3000) },
    })).join('\n') + '\n'
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, lines, 'utf8')

    const events = await persistence.listEvents<{ index: number }>({
      projectRoot,
      placement,
      collection: 'debug-stream',
      streamId: 'task-123',
    })
    expect(events.at(-1)?.payload.index).toBe(199)
    expect(events.length).toBeLessThan(200)
  })

  it('preserves the retention policy exception for one oversized newest event', async () => {
    const projectRoot = path.join(tmp, 'project')
    const persistence = new FileBackedGuildhallPersistence()

    await persistence.appendEvent({
      projectRoot,
      placement: localPlacement,
      collection: 'debug-stream',
      streamId: 'oversized-single',
      eventId: 'event-oversized',
      schemaName: 'debug-event',
      schemaVersion: 1,
      createdBy: 'debug:test',
      payload: { output: 'x'.repeat(300 * 1024) },
      now,
    })

    const events = await persistence.listEvents<{ output: string }>({
      projectRoot,
      placement: localPlacement,
      collection: 'debug-stream',
      streamId: 'oversized-single',
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload.output).toHaveLength(300 * 1024)
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
