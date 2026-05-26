import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  applyProjectMigrations,
  getProjectMigrationStatus,
  readProjectMigrationLedger,
  writeProjectMigrationLedger,
} from '../migrations.js'

let tmp: string
let projectRoot: string
let previousConfigDir: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-migrations-'))
  process.env.GUILDHALL_CONFIG_DIR = path.join(tmp, 'config')
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  await fs.mkdir(projectRoot, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), 'name: Migration Test\nid: migration-test\n', 'utf8')
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('project migration ledger', () => {
  it('starts empty and round-trips applied migration records', async () => {
    expect(await readProjectMigrationLedger(projectRoot)).toEqual({ version: 1, records: [] })

    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.8.0/example',
        introducedIn: '0.8.0',
        scope: 'project',
        safety: 'automatic',
        status: 'applied',
        appliedAt: '2026-05-26T00:00:00.000Z',
        appliedByVersion: '0.8.0',
        summary: 'Example migration applied.',
      }],
    })

    expect(await readProjectMigrationLedger(projectRoot)).toMatchObject({
      version: 1,
      records: [{ id: '0.8.0/example', status: 'applied' }],
    })
  })
})

describe('getProjectMigrationStatus', () => {
  it('reports pending built-in project migrations and hides applied ledger entries', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)

    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.8.0/project-state-layout',
        introducedIn: '0.8.0',
        scope: 'project',
        safety: 'prompt',
        status: 'applied',
        appliedAt: '2026-05-26T00:00:00.000Z',
        appliedByVersion: '0.8.0',
        summary: 'Moved legacy memory into split project state.',
      }],
    })

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.blocked.some(item => item.id === '0.8.0/project-state-layout')).toBe(false)
    expect(after.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  })
})

describe('applyProjectMigrations', () => {
  it('applies automatic migrations but leaves prompt migrations pending by default', async () => {
    await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'config.yaml'), [
      'openaiApiKey: sk-local',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    const result = await applyProjectMigrations({ projectRoot, includePrompt: false })

    expect(result.applied.some(item => item.id === '0.8.0/provider-config-globalization')).toBe(true)
    expect(result.skipped.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  })

  it('applies selected prompt migrations and records them in the ledger', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    expect(result.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
    const ledger = await readProjectMigrationLedger(projectRoot)
    expect(ledger.records.some(record => record.id === '0.8.0/project-state-layout')).toBe(true)
  })

  it('seeds missing project-state files when applying the required layout migration', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    await expect(fs.readFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), 'utf8')).resolves.toBe('[]\n')
    await expect(fs.readFile(path.join(projectRoot, '.guildhall', 'DECISIONS.md'), 'utf8')).resolves.toContain('# Migration Test Decisions')
    await expect(fs.readFile(path.join(projectRoot, '.guildhall', 'PROGRESS.md'), 'utf8')).resolves.toContain('# Migration Test Progress')
  })
})
