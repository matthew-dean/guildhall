import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getDataDir } from '@guildhall/sessions'
import {
  getProjectLocalHistoryDir,
  getProjectStateDir,
} from '@guildhall/sessions'
import { atomicWriteText } from '@guildhall/sessions'
import type {
  AppendEventInput,
  ArtifactRef,
  CompactionScope,
  CompactionSummary,
  EvidenceRef,
  EvidenceResolution,
  EventQuery,
  GuildhallPersistence,
  PersistedEvent,
  PersistedRecord,
  PersistencePlacement,
  PersistenceRef,
  RecordRefInput,
  SaveArtifactInput,
  WriteRecordInput,
} from './types.js'
import { PersistedEvent as PersistedEventSchema, PersistedRecord as PersistedRecordSchema } from './types.js'

function nowIso(input?: () => Date): string {
  return (input?.() ?? new Date()).toISOString()
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) out[key] = sortValue(record[key])
    return out
  }
  return value
}

function hash(value: unknown): string {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : stableJson(value)
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function slug(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'record'
}

function ensureProjectRoot(input: { projectRoot?: string }, scope: string): string {
  if (!input.projectRoot) throw new Error(`${scope} placement requires projectRoot`)
  return input.projectRoot
}

function ensureExportRoot(input: { exportRoot?: string }, scope: string): string {
  if (!input.exportRoot) throw new Error(`${scope} placement requires exportRoot`)
  return input.exportRoot
}

export class FileBackedGuildhallPersistence implements GuildhallPersistence {
  recordRef(input: RecordRefInput): PersistenceRef {
    const id = slug(input.id)
    return this.ref(
      input.placement,
      input.collection,
      id,
      this.recordPath(input.placement, input.collection, id, input),
    )
  }

  async writeRecord<T>(input: WriteRecordInput<T>): Promise<PersistedRecord<T>> {
    const id = slug(input.id ?? `${input.schemaName}-${hash(input.payload).slice(0, 12)}`)
    const filePath = this.recordPath(input.placement, input.collection, id, input)
    const existing = await this.readExistingRecord(filePath)
    const at = nowIso(input.now)
    const ref = this.recordRef({ ...input, id })
    const record: PersistedRecord<T> = {
      schema: { name: input.schemaName, version: input.schemaVersion },
      ref,
      placement: input.placement,
      provenance: {
        createdAt: existing?.provenance.createdAt ?? at,
        updatedAt: at,
        createdBy: input.createdBy,
        sourceRefs: input.sourceRefs ?? [],
      },
      contentHash: hash(input.payload),
      payload: input.payload,
      compaction: input.compactedFrom
        ? { compactedFrom: input.compactedFrom, fullEvidenceAvailable: true }
        : undefined,
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    atomicWriteText(filePath, `${JSON.stringify(record, null, 2)}\n`)
    return record
  }

  async appendEvent<T>(input: AppendEventInput<T>): Promise<PersistedEvent<T>> {
    const streamId = slug(input.streamId)
    const eventId = slug(input.eventId ?? `${input.schemaName}-${hash(input.payload).slice(0, 12)}`)
    const filePath = this.eventPath(input.placement, input.collection, streamId, input)
    const at = nowIso(input.now)
    const event: PersistedEvent<T> = {
      schema: { name: input.schemaName, version: input.schemaVersion },
      ref: this.ref(input.placement, input.collection, streamId, filePath),
      eventId,
      recordedAt: at,
      recordedBy: input.createdBy,
      placement: input.placement,
      sourceRefs: input.sourceRefs ?? [],
      contentHash: hash(input.payload),
      payload: input.payload,
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
    return event
  }

  async readRecord<T = unknown>(ref: PersistenceRef): Promise<PersistedRecord<T> | null> {
    try {
      const raw = await fs.readFile(ref.path, 'utf8')
      return PersistedRecordSchema.parse(JSON.parse(raw)) as PersistedRecord<T>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async listEvents<T = unknown>(query: EventQuery): Promise<Array<PersistedEvent<T>>> {
    const filePath = this.eventPath(query.placement, query.collection, slug(query.streamId), query)
    let raw = ''
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => PersistedEventSchema.parse(JSON.parse(line)) as PersistedEvent<T>)
  }

  async saveArtifact(input: SaveArtifactInput): Promise<ArtifactRef> {
    const bytes = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content
    const digest = hash(bytes)
    const id = slug(input.id ?? `${input.collection}-${digest.slice(0, 12)}`)
    const extension = input.extension ? input.extension.replace(/^\./, '') : 'bin'
    const filePath = this.artifactPath(input.placement, input.collection, `${id}.${extension}`, input)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, bytes)
    return {
      ...this.ref(input.placement, input.collection, id, filePath),
      hash: digest,
      contentType: input.contentType,
      bytes: bytes.byteLength,
    }
  }

  async compact(scope: CompactionScope): Promise<CompactionSummary> {
    const summary: CompactionSummary = {
      ref: this.ref(
        scope.placement,
        scope.collection,
        slug(scope.id),
        this.recordPath(scope.placement, scope.collection, slug(scope.id), scope),
      ),
      compactedAt: nowIso(scope.now),
      compactedBy: scope.createdBy,
      evidenceRefs: scope.evidenceRefs,
      fullEvidenceAvailable: true,
    }
    await this.writeRecord({
      ...scope,
      id: scope.id,
      schemaName: 'compaction-summary',
      schemaVersion: 1,
      payload: summary,
      compactedFrom: scope.evidenceRefs,
    })
    return summary
  }

  async resolveEvidence(ref: EvidenceRef): Promise<EvidenceResolution> {
    try {
      await fs.stat(ref.path)
      return { ref, available: true }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ref, available: false, reason: 'missing' }
      }
      throw err
    }
  }

  private async readExistingRecord(filePath: string): Promise<PersistedRecord | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      return PersistedRecordSchema.parse(JSON.parse(raw)) as PersistedRecord
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  private ref(
    placement: PersistencePlacement,
    collection: string,
    id: string,
    filePath: string,
  ): PersistenceRef {
    return {
      scope: placement.scope,
      collection: slug(collection),
      id: slug(id),
      path: filePath,
    }
  }

  private rootFor(
    placement: PersistencePlacement,
    input: { projectRoot?: string; exportRoot?: string },
  ): string {
    switch (placement.scope) {
      case 'shared_project':
        return path.join(getProjectStateDir(ensureProjectRoot(input, placement.scope)), 'persistence')
      case 'local_history':
        return path.join(getProjectLocalHistoryDir(ensureProjectRoot(input, placement.scope)), 'persistence')
      case 'global_user':
        return path.join(getDataDir(), 'persistence')
      case 'exported_artifact':
        return path.join(ensureExportRoot(input, placement.scope), 'guildhall-persistence')
    }
  }

  private recordPath(
    placement: PersistencePlacement,
    collection: string,
    id: string,
    input: { projectRoot?: string; exportRoot?: string },
  ): string {
    return path.join(this.rootFor(placement, input), 'records', slug(collection), `${slug(id)}.json`)
  }

  private eventPath(
    placement: PersistencePlacement,
    collection: string,
    streamId: string,
    input: { projectRoot?: string; exportRoot?: string },
  ): string {
    return path.join(this.rootFor(placement, input), 'events', slug(collection), `${slug(streamId)}.jsonl`)
  }

  private artifactPath(
    placement: PersistencePlacement,
    collection: string,
    id: string,
    input: { projectRoot?: string; exportRoot?: string },
  ): string {
    return path.join(this.rootFor(placement, input), 'artifacts', slug(collection), id)
  }
}
