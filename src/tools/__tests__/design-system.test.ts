import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { DesignSystem, DESIGN_SYSTEM_FILE } from '@guildhall/core'
import { updateDesignSystem } from '../design-system.js'

let tmpDir: string
let memoryDir: string
let dsPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-ds-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  dsPath = path.join(tmpDir, DESIGN_SYSTEM_FILE)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readDS(): Promise<DesignSystem> {
  const raw = await fs.readFile(dsPath, 'utf-8')
  return DesignSystem.parse(yaml.load(raw) ?? {})
}

describe('updateDesignSystem', () => {
  it('authors a new design system when none exists', async () => {
    const result = await updateDesignSystem({
      memoryDir: tmpDir,
      tokens: {
        color: [{ name: 'primary', value: '#0ea5e9' }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [{ name: 'Button', usage: 'Primary action in a form' }],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      authoredBy: 'agent:spec-agent',
    })
    expect(result.success).toBe(true)
    expect(result.revision).toBe(1)

    const ds = await readDS()
    expect(ds.tokens.color).toHaveLength(1)
    expect(ds.tokens.color[0]!.name).toBe('primary')
    expect(ds.primitives).toHaveLength(1)
    expect(ds.authoredBy).toBe('agent:spec-agent')
    expect(ds.approvedAt).toBeUndefined()
  })

  it('drops a prior approval when material surface changes', async () => {
    await updateDesignSystem({
      memoryDir: tmpDir,
      tokens: {
        color: [{ name: 'primary', value: '#0ea5e9' }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      authoredBy: 'agent:spec-agent',
    })
    const approvedAt = new Date().toISOString()
    const seeded = await readDS()
    seeded.approvedBy = 'human'
    seeded.approvedAt = approvedAt
    await fs.writeFile(dsPath, yaml.dump(seeded), 'utf-8')

    await updateDesignSystem({
      memoryDir: tmpDir,
      tokens: {
        color: [{ name: 'primary', value: '#ff0000' }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      authoredBy: 'agent:spec-agent',
    })
    const ds = await readDS()
    expect(ds.approvedAt).toBeUndefined()
    expect(ds.approvedBy).toBeUndefined()
    expect(ds.revision).toBe(2)
  })

  it('preserves approval when only notes change', async () => {
    await updateDesignSystem({
      memoryDir: tmpDir,
      tokens: {
        color: [{ name: 'primary', value: '#0ea5e9' }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [{ name: 'Button', usage: 'primary action' }],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      authoredBy: 'agent:spec-agent',
    })
    const approvedAt = new Date().toISOString()
    const seeded = await readDS()
    seeded.approvedBy = 'human'
    seeded.approvedAt = approvedAt
    await fs.writeFile(dsPath, yaml.dump(seeded), 'utf-8')

    await updateDesignSystem({
      memoryDir: tmpDir,
      tokens: {
        color: [{ name: 'primary', value: '#0ea5e9' }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [{ name: 'Button', usage: 'primary action' }],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      notes: 'extra context that does not change the material surface',
      authoredBy: 'agent:spec-agent',
    })
    const ds = await readDS()
    expect(ds.approvedAt).toBe(approvedAt)
    expect(ds.approvedBy).toBe('human')
    expect(ds.notes).toMatch(/extra context/)
    expect(ds.revision).toBe(1)
  })
})
