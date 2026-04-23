import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  BUILTIN_GUILDS,
  composeGuildRoster,
  loadProjectGuildRoster,
  loadGuildComposition,
  type GuildsYaml,
} from '../index.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-composition-test-'))
})
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeYaml(body: string): Promise<void> {
  await fs.writeFile(path.join(tmpDir, 'guilds.yaml'), body, 'utf-8')
}

describe('loadGuildComposition', () => {
  it('returns {spec: null} when no guilds.yaml exists', () => {
    const { spec, errors } = loadGuildComposition(tmpDir)
    expect(spec).toBeNull()
    expect(errors).toEqual([])
  })

  it('parses a full valid spec', async () => {
    await writeYaml(`enabled:
  - project-manager
  - frontend-engineer
disabled:
  - performance-engineer
custom:
  - slug: house-copy
    extends: copywriter
    overridePrinciples: |
      I enforce our house voice. Plain, warm, brief.
`)
    const { spec, errors } = loadGuildComposition(tmpDir)
    expect(errors).toEqual([])
    expect(spec?.enabled).toEqual(['project-manager', 'frontend-engineer'])
    expect(spec?.disabled).toEqual(['performance-engineer'])
    expect(spec?.custom).toHaveLength(1)
    expect(spec?.custom?.[0]?.slug).toBe('house-copy')
  })

  it('surfaces schema errors rather than throwing', async () => {
    await writeYaml(`enabled: "not an array"`)
    const { spec, errors } = loadGuildComposition(tmpDir)
    expect(spec).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('composeGuildRoster', () => {
  it('returns the full built-in roster when no enabled/disabled are set', () => {
    const { guilds } = composeGuildRoster({})
    expect(guilds.length).toBe(BUILTIN_GUILDS.length)
  })

  it('enabled restricts to an allowlist', () => {
    const { guilds } = composeGuildRoster({
      enabled: ['project-manager', 'frontend-engineer'],
    })
    expect(guilds.map((g) => g.slug).sort()).toEqual([
      'frontend-engineer',
      'project-manager',
    ])
  })

  it('disabled wins over enabled', () => {
    const { guilds } = composeGuildRoster({
      enabled: ['project-manager', 'performance-engineer'],
      disabled: ['performance-engineer'],
    })
    expect(guilds.map((g) => g.slug)).toEqual(['project-manager'])
  })

  it('warns when enabled references an unknown slug', () => {
    const { warnings } = composeGuildRoster({ enabled: ['not-a-real-guild'] })
    expect(warnings.some((w) => w.includes('not-a-real-guild'))).toBe(true)
  })

  it('custom entry extending a base inherits rubric and applicable', () => {
    const spec: GuildsYaml = {
      custom: [
        {
          slug: 'house-copy',
          extends: 'copywriter',
          overridePrinciples: 'I enforce the house voice.',
        },
      ],
    }
    const { guilds } = composeGuildRoster(spec)
    const houseCopy = guilds.find((g) => g.slug === 'house-copy')!
    expect(houseCopy).toBeDefined()
    expect(houseCopy.role).toBe('designer') // inherited from copywriter
    expect(houseCopy.principles).toBe('I enforce the house voice.')
    expect(houseCopy.rubric).toBeDefined()
    expect(houseCopy.rubric!.length).toBeGreaterThan(0)
  })

  it('custom entry additionalPrinciples appends to base principles', () => {
    const spec: GuildsYaml = {
      custom: [
        {
          slug: 'vue-commerce',
          extends: 'frontend-engineer',
          additionalPrinciples: 'We use Pinia for state, VueUse for composables.',
        },
      ],
    }
    const { guilds } = composeGuildRoster(spec)
    const vue = guilds.find((g) => g.slug === 'vue-commerce')!
    expect(vue.principles).toContain('Pinia')
    // Still contains the base principles (not fully replaced).
    expect(vue.principles).toContain("I'm the Frontend Engineer")
  })

  it('custom slug that shadows a built-in replaces the built-in', () => {
    const spec: GuildsYaml = {
      custom: [
        {
          slug: 'project-manager',
          overridePrinciples: 'I am the custom PM.',
        },
      ],
    }
    const { guilds } = composeGuildRoster(spec)
    const pms = guilds.filter((g) => g.slug === 'project-manager')
    expect(pms).toHaveLength(1)
    expect(pms[0]!.principles).toBe('I am the custom PM.')
  })

  it('warns on unknown extends and builds standalone', () => {
    const spec: GuildsYaml = {
      custom: [
        {
          slug: 'ghost',
          extends: 'nonexistent',
          overridePrinciples: 'I am a ghost.',
        },
      ],
    }
    const { guilds, warnings } = composeGuildRoster(spec)
    expect(warnings.some((w) => w.includes('ghost'))).toBe(true)
    const ghost = guilds.find((g) => g.slug === 'ghost')!
    expect(ghost).toBeDefined()
    expect(ghost.principles).toBe('I am a ghost.')
  })
})

describe('loadProjectGuildRoster', () => {
  it('returns BUILTIN_GUILDS unchanged when no file exists', () => {
    const { guilds, warnings } = loadProjectGuildRoster(tmpDir)
    expect(guilds).toBe(BUILTIN_GUILDS)
    expect(warnings).toEqual([])
  })

  it('applies composition when guilds.yaml exists', async () => {
    await writeYaml(`enabled:
  - project-manager
disabled:
  - frontend-engineer
custom:
  - slug: strict-pm
    extends: project-manager
    additionalPrinciples: No revisions past round 2.
`)
    const { guilds } = loadProjectGuildRoster(tmpDir)
    // project-manager is enabled, and strict-pm is a new custom entry.
    const slugs = guilds.map((g) => g.slug).sort()
    expect(slugs).toContain('project-manager')
    expect(slugs).toContain('strict-pm')
    expect(slugs).not.toContain('frontend-engineer')
  })

  it('forwards parse errors as warnings', async () => {
    await writeYaml(`enabled: 42`)
    const { guilds, warnings } = loadProjectGuildRoster(tmpDir)
    // Fell back to built-in roster.
    expect(guilds.length).toBe(BUILTIN_GUILDS.length)
    expect(warnings.length).toBeGreaterThan(0)
  })
})
