import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { stringify as stringifyYaml } from 'yaml'

import {
  AGENT_SETTINGS_FILENAME,
  LeverSettingsCorruptError,
  defaultAgentSettingsPath,
  loadLeverSettings,
  projectLeverInvariantError,
  projectLever,
  resolveDomainLevers,
  saveLeverSettings,
} from '../storage.js'
import { makeDefaultSettings } from '../defaults.js'

let tmpDir: string
let settingsPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'guildhall-levers-'))
  settingsPath = defaultAgentSettingsPath(tmpDir)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('loadLeverSettings', () => {
  it('seeds defaults on first load when the file is missing', async () => {
    const loaded = await loadLeverSettings({ path: settingsPath })
    expect(loaded.version).toBe(1)
    expect(loaded.project.agent_health_strictness.position).toBe('standard')
    expect(loaded.project.agent_health_strictness.setBy).toBe('system-default')
    // And the file is now persisted:
    const stat = await fs.stat(settingsPath)
    expect(stat.isFile()).toBe(true)
  })

  // AC-13: agent-settings.yaml stores every lever from §2.1 with position +
  // inference rationale. Seeding defaults must produce a complete, readable
  // set of levers (both project-scope and domain-scope) where every entry
  // carries a position and rationale so downstream reads are deterministic.
  it('AC-13: seeded defaults expose every lever with position + rationale', async () => {
    const loaded = await loadLeverSettings({ path: settingsPath })

    type LeverRecord = {
      position: unknown
      rationale: string
      setAt: string
      setBy: string
    }
    const entries = (obj: Record<string, unknown>): Array<[string, LeverRecord]> =>
      Object.entries(obj) as Array<[string, LeverRecord]>

    // Every project-scope lever has a non-empty position and rationale.
    for (const [name, record] of entries(loaded.project as Record<string, unknown>)) {
      expect(record.position, `project.${name} position`).toBeDefined()
      expect(typeof record.rationale, `project.${name} rationale`).toBe('string')
      expect(record.rationale.length, `project.${name} rationale non-empty`).toBeGreaterThan(0)
      expect(record.setAt, `project.${name} setAt`).toBeDefined()
      expect(record.setBy, `project.${name} setBy`).toBeDefined()
    }

    // Every domain-scope lever (across every domain) ditto.
    for (const [dname, domain] of Object.entries(loaded.domains) as Array<
      [string, Record<string, unknown>]
    >) {
      for (const [lname, record] of entries(domain)) {
        expect(record.position, `domains.${dname}.${lname} position`).toBeDefined()
        expect(typeof record.rationale, `domains.${dname}.${lname} rationale`).toBe('string')
        expect(record.rationale.length, `domains.${dname}.${lname} rationale`).toBeGreaterThan(0)
      }
    }
  })

  it('round-trips through save/load', async () => {
    const seeded = makeDefaultSettings()
    await saveLeverSettings({ path: settingsPath, settings: seeded })
    const reloaded = await loadLeverSettings({ path: settingsPath })
    expect(reloaded).toEqual(seeded)
  })

  it('loads legacy merge_policy as landing_strategy without exposing the old key', async () => {
    const legacy = makeDefaultSettings() as any
    delete legacy.project.landing_strategy
    legacy.project.merge_policy = {
      position: 'ff_only_with_push',
      rationale: 'legacy auto-push policy',
      setAt: '2026-05-31T00:00:00.000Z',
      setBy: 'user-direct',
    }

    await fs.mkdir(join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(settingsPath, stringifyYaml(legacy), 'utf8')

    const loaded = await loadLeverSettings({ path: settingsPath })

    expect(loaded.project.landing_strategy.position).toBe('cherry_pick_with_push')
    expect(loaded.project.landing_strategy.rationale).toBe('legacy auto-push policy')
    expect('merge_policy' in loaded.project).toBe(false)
  })

  it('preserves parameterized positions (fanout) through YAML round-trip', async () => {
    const settings = makeDefaultSettings()
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 5 },
      rationale: 'enable 5-way fanout after performance profile',
      setAt: '2026-04-20T00:00:00.000Z',
      setBy: 'coordinator:performance',
    }
    await saveLeverSettings({ path: settingsPath, settings })
    const reloaded = await loadLeverSettings({ path: settingsPath })
    expect(reloaded.project.concurrent_task_dispatch.position).toEqual({ kind: 'fanout', n: 5 })
  })

  it('throws LeverSettingsCorruptError on invalid YAML', async () => {
    await fs.mkdir(join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(settingsPath, ': : : not valid yaml\n\t- [', 'utf8')
    await expect(loadLeverSettings({ path: settingsPath })).rejects.toBeInstanceOf(
      LeverSettingsCorruptError,
    )
  })

  it('throws LeverSettingsCorruptError when schema-invalid', async () => {
    await fs.mkdir(join(tmpDir, '.guildhall'), { recursive: true })
    // Valid YAML, but the shape is wrong (wrong version).
    await fs.writeFile(settingsPath, 'version: 99\nproject: {}\ndomains: {}\n', 'utf8')
    await expect(loadLeverSettings({ path: settingsPath })).rejects.toBeInstanceOf(
      LeverSettingsCorruptError,
    )
  })

  it('self-heals when the schema grew a new required lever (missing domain key)', async () => {
    // Start from a valid-at-the-time-of-writing settings file, then drop
    // `reviewer_fanout_policy` from domains.default to simulate an older
    // file that pre-dates a schema addition. The loader should fill the
    // missing key from defaults, rewrite the file, and return successfully.
    const settings = makeDefaultSettings()
    await saveLeverSettings({ path: settingsPath, settings })

    const raw = (await fs.readFile(settingsPath, 'utf8')).replace(
      /\n  reviewer_fanout_policy:[\s\S]*?(?=\n  [a-z]|\n[a-z]|$)/,
      '\n',
    )
    await fs.writeFile(settingsPath, raw, 'utf8')

    // First load should heal instead of throwing.
    const healed = await loadLeverSettings({ path: settingsPath })
    expect(healed.domains.default.reviewer_fanout_policy).toBeDefined()
    // And the on-disk file is now valid for subsequent reads.
    const reloaded = await loadLeverSettings({ path: settingsPath })
    expect(reloaded.domains.default.reviewer_fanout_policy).toBeDefined()
  })

  it('still throws when the file is wrong-shaped (not just missing keys)', async () => {
    await fs.mkdir(join(tmpDir, '.guildhall'), { recursive: true })
    // Bad primitive type — self-heal can't recover this.
    await fs.writeFile(settingsPath, 'version: "one"\nproject: {}\ndomains: {}\n', 'utf8')
    await expect(loadLeverSettings({ path: settingsPath })).rejects.toBeInstanceOf(
      LeverSettingsCorruptError,
    )
  })

  it('throws when fanout dispatch is combined with no worktree isolation', async () => {
    const settings = makeDefaultSettings()
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 4 },
      rationale: 'parallelize worker dispatch',
      setAt: '2026-05-11T00:00:00.000Z',
      setBy: 'user-direct',
    }
    settings.project.worktree_isolation = {
      position: 'none',
      rationale: 'invalid test combo',
      setAt: '2026-05-11T00:00:00.000Z',
      setBy: 'user-direct',
    }
    await expect(saveLeverSettings({ path: settingsPath, settings })).rejects.toBeInstanceOf(
      LeverSettingsCorruptError,
    )
  })
})

describe('resolveDomainLevers', () => {
  it('returns default when no override exists for the domain', async () => {
    const settings = await loadLeverSettings({ path: settingsPath })
    const resolved = resolveDomainLevers(settings, 'Looma')
    expect(resolved).toEqual(settings.domains.default)
  })

  it('merges per-domain overrides onto the default', async () => {
    const settings = await loadLeverSettings({ path: settingsPath })
    settings.domains.overrides = {
      Knit: {
        max_revisions: {
          position: 5,
          rationale: 'Knit tolerates more iteration',
          setAt: '2026-04-20T00:00:00.000Z',
          setBy: 'coordinator:knit',
        },
      },
    }
    const resolved = resolveDomainLevers(settings, 'Knit')
    expect(resolved.max_revisions.position).toBe(5)
    expect(resolved.max_revisions.setBy).toBe('coordinator:knit')
    // Unspecified fields still come from default:
    expect(resolved.task_origination).toEqual(settings.domains.default.task_origination)
  })

  it('throws LeverSettingsCorruptError when an override is schema-invalid', async () => {
    const settings = await loadLeverSettings({ path: settingsPath })
    settings.domains.overrides = {
      Looma: {
        max_revisions: {
          position: -1, // invalid: must be >= 0
          rationale: 'nope',
          setAt: '2026-04-20T00:00:00.000Z',
          setBy: 'coordinator:looma',
        },
      },
    }
    expect(() => resolveDomainLevers(settings, 'Looma')).toThrow(LeverSettingsCorruptError)
  })
})

describe('projectLever', () => {
  it('returns the entry for the named project lever', async () => {
    const settings = await loadLeverSettings({ path: settingsPath })
    const entry = projectLever(settings, 'runtime_isolation')
    expect(entry.position).toBe('none')
    expect(entry.setBy).toBe('system-default')
  })
})

describe('projectLeverInvariantError', () => {
  it('returns a clear error when fanout is configured without worktree isolation', async () => {
    const settings = await loadLeverSettings({ path: settingsPath })
    settings.project.concurrent_task_dispatch.position = { kind: 'fanout', n: 3 }
    settings.project.worktree_isolation.position = 'none'
    expect(projectLeverInvariantError(settings.project)).toContain('fanout_N requires worktree_isolation')
  })
})

describe('defaultAgentSettingsPath', () => {
  it('builds the expected system-local project-state path', () => {
    const resolved = defaultAgentSettingsPath('/tmp/proj')
    expect(resolved).toContain('/.guildhall/data/projects/')
    expect(resolved).toContain('/project-state/')
    expect(resolved).toMatch(/\/agent-settings\.yaml$/)
    expect(resolved).not.toBe('/tmp/proj/.guildhall/agent-settings.yaml')
  })
})
