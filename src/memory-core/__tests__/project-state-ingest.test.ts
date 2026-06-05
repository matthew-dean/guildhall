import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createDeterministicGuildhallMemory } from '../index.js'
import { ingestProjectStateForMemoryPrototype } from '../project-state-ingest.js'

let tmp: string
let projectRoot: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-ingest-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  const stateDir = path.join(projectRoot, '.guildhall')
  await fs.mkdir(path.join(stateDir, 'tasks', 'archive'), { recursive: true })
  await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
    version: 1,
    tasks: [
      { id: 'active', status: 'blocked', title: 'Clean memory bloat', notes: Array.from({ length: 40 }, (_, index) => `note ${index}`) },
      { id: 'done', status: 'done', title: 'Old completed migration' },
    ],
  }, null, 2), 'utf8')
  await fs.writeFile(path.join(stateDir, 'PROGRESS.md'), [
    '# Progress',
    '',
    '### HEARTBEAT 1',
    'Noisy status update.',
    '',
    '### DECISION 1',
    'Keep memory storage system-local.',
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(stateDir, 'TASKS.migration-backup.json'), `${'x'.repeat(20_000)}\n`, 'utf8')
  await fs.writeFile(path.join(stateDir, 'codebase-map.yaml'), `${'file: summary\n'.repeat(5_000)}`, 'utf8')
  await fs.writeFile(path.join(stateDir, 'tasks', 'archive', 'old.json'), JSON.stringify({ id: 'old', notes: Array.from({ length: 100 }, (_, index) => `note ${index}`) }), 'utf8')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('ingestProjectStateForMemoryPrototype', () => {
  it('records summaries of bulky project state without copying full files into memory', async () => {
    const memory = createDeterministicGuildhallMemory({ projectRoot })
    const report = await ingestProjectStateForMemoryPrototype({ projectRoot, memory })

    expect(report.projectLocalBytes).toBeGreaterThan(20_000)
    expect(report.files).toContainEqual(expect.objectContaining({
      relativePath: '.guildhall/TASKS.json',
      eventType: 'task_queue_summary',
    }))
    expect(report.files).toContainEqual(expect.objectContaining({
      relativePath: '.guildhall/TASKS.migration-backup.json',
      action: 'do_not_ingest_full_file',
    }))

    const packet = await memory.buildCandidatePacket({
      scope: { kind: 'project', projectRoot },
      intent: 'What project state is bloated and what should the next worker fix?',
      maxBytes: 3_000,
    })

    expect(packet.included.some((item) => item.summary.includes('active=1'))).toBe(true)
    expect(packet.included.some((item) => item.summary.includes('migration backup'))).toBe(true)
    expect(JSON.stringify(packet)).not.toContain('note 39')
    expect(JSON.stringify(packet)).not.toContain('x'.repeat(100))
  })
})
