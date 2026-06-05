import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createDeterministicGuildhallMemory,
  defaultMemoryStorageRoot,
  projectMemoryIdentity,
} from '../index.js'

let tmp: string
let projectRoot: string
let storageRoot: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-core-'))
  projectRoot = path.join(tmp, 'project')
  storageRoot = path.join(tmp, 'guildhall-data')
  process.env.GUILDHALL_DATA_DIR = storageRoot
  await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('deterministic Guildhall memory core', () => {
  it('stores raw events in system-local project memory instead of project .guildhall files', async () => {
    const memory = createDeterministicGuildhallMemory({ projectRoot })

    await memory.recordEvent({
      scope: { kind: 'project', projectRoot },
      type: 'task_evidence',
      summary: 'Worker found migration backups are bloating project state.',
      body: 'TASKS.json migration backups should move out of project-local committed state.',
      sourceRefs: [{ kind: 'project_file', path: '.guildhall/TASKS.json', summary: 'Large task queue.' }],
    })

    const audit = await memory.audit({ scope: { kind: 'project', projectRoot } })
    const localEvents = await fs.readFile(path.join(audit.storageDir, 'events.jsonl'), 'utf8')

    expect(audit.storageDir).toBe(path.join(defaultMemoryStorageRoot(), 'projects', projectMemoryIdentity(projectRoot)))
    expect(audit.writesProjectLocalState).toBe(false)
    expect(localEvents).toContain('migration backups')
    await expect(fs.stat(path.join(projectRoot, '.guildhall', 'memory-core.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('compacts repeated raw events into bounded observations with provenance', async () => {
    const memory = createDeterministicGuildhallMemory({ projectRoot })
    for (let index = 0; index < 20; index += 1) {
      await memory.recordEvent({
        scope: { kind: 'project', projectRoot },
        type: 'task_evidence',
        summary: `Heartbeat ${index}: worker touched files but did not add a durable decision.`,
        body: `Noisy progress heartbeat ${index} from PROGRESS.md with a very long body. ${'noise '.repeat(40)}`,
        sourceRefs: [{ kind: 'project_file', path: '.guildhall/PROGRESS.md', summary: `Heartbeat ${index}.` }],
        relevanceHints: ['progress', 'heartbeat'],
      })
    }

    const result = await memory.compact({
      scope: { kind: 'project', projectRoot },
      reason: 'background',
      maxObservationBytes: 1_500,
    })

    expect(result.rawEventsConsidered).toBe(20)
    expect(result.observationsCreated).toBeGreaterThan(0)
    expect(result.bytesAfter).toBeLessThan(result.bytesBefore)

    const packet = await memory.buildCandidatePacket({
      scope: { kind: 'project', projectRoot },
      intent: 'Prepare next worker context about project-state bloat.',
      maxBytes: 1_200,
    })

    expect(packet.byteEstimate).toBeLessThanOrEqual(1_200)
    expect(packet.included[0]).toMatchObject({
      reasonForInclusion: expect.stringContaining('intent'),
      sourceRefs: expect.arrayContaining([
        expect.objectContaining({ path: '.guildhall/PROGRESS.md' }),
      ]),
    })
    expect(packet.included[0]?.summary.length).toBeLessThan(320)
  })

  it('withholds stale or risky records while explaining omissions', async () => {
    const memory = createDeterministicGuildhallMemory({ projectRoot })
    await memory.recordObservation({
      scope: { kind: 'project', projectRoot },
      summary: 'Use Mastra Memory as the first substrate candidate.',
      body: 'Mastra has thread/resource memory, working memory, semantic recall, and observational memory.',
      confidence: 'high',
      risk: 'low',
      freshness: 'fresh',
      sourceRefs: [{ kind: 'external_doc', ref: 'mastra-memory-overview', summary: 'Mastra memory docs.' }],
      tags: ['mastra', 'memory'],
    })
    await memory.recordObservation({
      scope: { kind: 'project', projectRoot },
      summary: 'Use old project-local PROGRESS.md as the primary memory backend.',
      body: 'This is intentionally bad and should not be selected.',
      confidence: 'medium',
      risk: 'high',
      freshness: 'stale',
      sourceRefs: [{ kind: 'project_file', path: '.guildhall/PROGRESS.md', summary: 'Legacy progress file.' }],
      tags: ['memory'],
    })

    const packet = await memory.buildCandidatePacket({
      scope: { kind: 'project', projectRoot },
      intent: 'Choose the memory backend for Guildhall memory refactor.',
      maxBytes: 2_000,
    })

    expect(packet.included.map((item) => item.summary)).toContain('Use Mastra Memory as the first substrate candidate.')
    expect(packet.omitted).toContainEqual(expect.objectContaining({
      summary: 'Use old project-local PROGRESS.md as the primary memory backend.',
      reason: 'risk:high',
    }))
  })
})
