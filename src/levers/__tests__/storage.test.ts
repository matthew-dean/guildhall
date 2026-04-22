import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

import {
  AGENT_SETTINGS_FILENAME,
  LeverSettingsCorruptError,
  defaultAgentSettingsPath,
  loadLeverSettings,
  projectLever,
  resolveDomainLevers,
  saveLeverSettings,
} from '../storage.js'
import { makeDefaultSettings } from '../defaults.js'

let tmpDir: string
let settingsPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'guildhall-levers-'))
  settingsPath = join(tmpDir, 'memory', AGENT_SETTINGS_FILENAME)
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

  it('round-trips through save/load', async () => {
    const seeded = makeDefaultSettings()
    await saveLeverSettings({ path: settingsPath, settings: seeded })
    const reloaded = await loadLeverSettings({ path: settingsPath })
    expect(reloaded).toEqual(seeded)
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
    await fs.mkdir(join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(settingsPath, ': : : not valid yaml\n\t- [', 'utf8')
    await expect(loadLeverSettings({ path: settingsPath })).rejects.toBeInstanceOf(
      LeverSettingsCorruptError,
    )
  })

  it('throws LeverSettingsCorruptError when schema-invalid', async () => {
    await fs.mkdir(join(tmpDir, 'memory'), { recursive: true })
    // Valid YAML, but the shape is wrong (wrong version).
    await fs.writeFile(settingsPath, 'version: 99\nproject: {}\ndomains: {}\n', 'utf8')
    await expect(loadLeverSettings({ path: settingsPath })).rejects.toBeInstanceOf(
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

describe('defaultAgentSettingsPath', () => {
  it('builds the expected path under memory/', () => {
    expect(defaultAgentSettingsPath('/tmp/proj')).toBe('/tmp/proj/memory/agent-settings.yaml')
  })
})
