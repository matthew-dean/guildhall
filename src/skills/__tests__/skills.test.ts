import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SkillRegistry,
  activateProjectSkillProposal,
  dismissProjectSkillProposal,
  getBundledSkills,
  getUserSkillsDir,
  loadSkillRegistry,
  loadSkillsFromDirs,
  parseSkillFrontmatter,
  proposeProjectSkill,
  readProjectSkillProposals,
  selectRelevantProjectSkills,
} from '../index.js'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'guildhall-skills-'))
  process.env.GUILDHALL_CONFIG_DIR = baseDir
})

afterEach(() => {
  delete process.env.GUILDHALL_CONFIG_DIR
  rmSync(baseDir, { recursive: true, force: true })
})

describe('parseSkillFrontmatter', () => {
  it('reads name and description from YAML frontmatter', () => {
    const md = '---\nname: tidy\ndescription: keep things tidy\n---\n\n# body\n'
    expect(parseSkillFrontmatter('fallback', md)).toEqual({
      name: 'tidy',
      description: 'keep things tidy',
    })
  })

  it('strips single and double quotes from frontmatter values', () => {
    const md = `---\nname: "planner"\ndescription: 'plan tasks'\n---\nbody\n`
    expect(parseSkillFrontmatter('fallback', md)).toEqual({
      name: 'planner',
      description: 'plan tasks',
    })
  })

  it('falls back to heading + first paragraph when frontmatter missing', () => {
    const md = '# Plan\n\nbreak work into steps before starting\n'
    const { name, description } = parseSkillFrontmatter('fallback', md)
    expect(name).toBe('Plan')
    expect(description).toBe('break work into steps before starting')
  })

  it('defaults description when none can be extracted', () => {
    const md = '# Only A Heading\n'
    const { name, description } = parseSkillFrontmatter('fallback', md)
    expect(name).toBe('Only A Heading')
    expect(description).toBe('Skill: Only A Heading')
  })

  it('truncates long descriptions to 200 characters', () => {
    const long = 'x'.repeat(300)
    const md = `${long}\n`
    const { description } = parseSkillFrontmatter('fallback', md)
    expect(description).toHaveLength(200)
  })
})

describe('SkillRegistry', () => {
  it('stores skills by name and returns them sorted', () => {
    const registry = new SkillRegistry()
    registry.register({ name: 'zebra', description: 'z', content: '', source: 'test' })
    registry.register({ name: 'alpha', description: 'a', content: '', source: 'test' })
    const names = registry.listSkills().map((s) => s.name)
    expect(names).toEqual(['alpha', 'zebra'])
  })

  it('replaces entries on re-registration', () => {
    const registry = new SkillRegistry()
    registry.register({ name: 'x', description: 'old', content: '', source: 'a' })
    registry.register({ name: 'x', description: 'new', content: '', source: 'b' })
    expect(registry.get('x')?.description).toBe('new')
    expect(registry.listSkills()).toHaveLength(1)
  })

  it('get returns undefined for unknown skills', () => {
    expect(new SkillRegistry().get('missing')).toBeUndefined()
  })
})

describe('getBundledSkills', () => {
  it('loads the markdown files bundled with the package', () => {
    const skills = getBundledSkills()
    expect(skills.length).toBeGreaterThan(0)
    for (const s of skills) {
      expect(s.source).toBe('bundled')
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(s.content).toContain(' ')
    }
    const names = skills.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('loadSkillsFromDirs', () => {
  it('reads SKILL.md from each skill directory', () => {
    const skillsRoot = join(baseDir, 'my-skills')
    mkdirSync(join(skillsRoot, 'refactor'), { recursive: true })
    writeFileSync(
      join(skillsRoot, 'refactor', 'SKILL.md'),
      '---\nname: refactor\ndescription: small safe edits\n---\n\nbody\n',
    )
    mkdirSync(join(skillsRoot, 'nop'), { recursive: true })

    const skills = loadSkillsFromDirs([skillsRoot], 'user')
    expect(skills).toHaveLength(1)
    const [only] = skills
    expect(only?.name).toBe('refactor')
    expect(only?.description).toBe('small safe edits')
    expect(only?.source).toBe('user')
  })

  it('dedupes the same SKILL.md across overlapping roots', () => {
    const sharedRoot = join(baseDir, 'shared')
    mkdirSync(join(sharedRoot, 'dup'), { recursive: true })
    writeFileSync(join(sharedRoot, 'dup', 'SKILL.md'), '# dup\n\ndescription\n')

    const skills = loadSkillsFromDirs([sharedRoot, sharedRoot], 'user')
    expect(skills).toHaveLength(1)
  })

  it('returns an empty array when given nothing', () => {
    expect(loadSkillsFromDirs(undefined, 'user')).toEqual([])
    expect(loadSkillsFromDirs([], 'user')).toEqual([])
  })
})

describe('loadSkillRegistry', () => {
  it('combines bundled skills with user + extra directory skills', () => {
    const userDir = getUserSkillsDir()
    mkdirSync(join(userDir, 'tidy-user'), { recursive: true })
    writeFileSync(
      join(userDir, 'tidy-user', 'SKILL.md'),
      '---\nname: tidy-user\ndescription: user skill\n---\n',
    )

    const extraDir = join(baseDir, 'extras')
    mkdirSync(join(extraDir, 'tidy-extra'), { recursive: true })
    writeFileSync(
      join(extraDir, 'tidy-extra', 'SKILL.md'),
      '---\nname: tidy-extra\ndescription: extra skill\n---\n',
    )

    const registry = loadSkillRegistry({ extraSkillDirs: [extraDir] })
    const names = registry.listSkills().map((s) => s.name)
    expect(names).toContain('tidy-user')
    expect(names).toContain('tidy-extra')
    // bundled skills should also be present
    expect(getBundledSkills().length).toBeGreaterThan(0)
    expect(names.length).toBeGreaterThan(2)
  })

  it('lets user skills override bundled skills with the same name', () => {
    const bundled = getBundledSkills()
    if (bundled.length === 0) return // defensive; bundled dir should always ship content
    const collidedName = bundled[0]?.name
    if (!collidedName) return
    const userDir = getUserSkillsDir()
    mkdirSync(join(userDir, 'override'), { recursive: true })
    writeFileSync(
      join(userDir, 'override', 'SKILL.md'),
      `---\nname: ${collidedName}\ndescription: from user\n---\n`,
    )
    const registry = loadSkillRegistry()
    expect(registry.get(collidedName)?.source).toBe('user')
    expect(registry.get(collidedName)?.description).toBe('from user')
  })
})

describe('project skill proposals', () => {
  it('keeps project skill proposals inspectable and inactive until approved', async () => {
    await proposeProjectSkill({
      memoryDir: baseDir,
      proposal: {
        id: 'nuxt-invite-skill',
        name: 'nuxt-invite-skill',
        description: 'Repair Nuxt invite routes',
        routingKeys: ['domain:invite'],
        content: 'Use the existing workspace route helpers before adding new utilities.',
        risk: 'medium',
        requiresApproval: true,
      },
    })

    const proposals = readProjectSkillProposals(baseDir)
    expect(proposals[0]).toMatchObject({
      id: 'nuxt-invite-skill',
      status: 'suggested',
      requiresApproval: true,
    })
    expect(selectRelevantProjectSkills(proposals, ['domain:invite'])).toEqual([])

    await expect(activateProjectSkillProposal({
      memoryDir: baseDir,
      id: 'nuxt-invite-skill',
    })).rejects.toThrow(/approval/i)

    await activateProjectSkillProposal({
      memoryDir: baseDir,
      id: 'nuxt-invite-skill',
      approved: true,
    })

    const active = selectRelevantProjectSkills(
      readProjectSkillProposals(baseDir),
      ['domain:invite'],
    )
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({
      name: 'nuxt-invite-skill',
      source: 'project',
    })
  })

  it('does not select dismissed project skills or skills from another project', async () => {
    await proposeProjectSkill({
      memoryDir: baseDir,
      proposal: {
        id: 'dismissed-skill',
        name: 'dismissed-skill',
        description: 'Dismissed',
        routingKeys: ['domain:billing'],
        content: 'Do billing-specific steps.',
        risk: 'low',
        requiresApproval: false,
      },
    })
    await activateProjectSkillProposal({ memoryDir: baseDir, id: 'dismissed-skill' })
    await dismissProjectSkillProposal({ memoryDir: baseDir, id: 'dismissed-skill' })

    const otherProject = join(baseDir, 'other-memory')
    await proposeProjectSkill({
      memoryDir: otherProject,
      proposal: {
        id: 'other-skill',
        name: 'other-skill',
        description: 'Other project only',
        routingKeys: ['domain:billing'],
        content: 'Only the other project should see this.',
        risk: 'low',
        requiresApproval: false,
      },
    })
    await activateProjectSkillProposal({ memoryDir: otherProject, id: 'other-skill' })

    expect(selectRelevantProjectSkills(readProjectSkillProposals(baseDir), ['domain:billing'])).toEqual([])
    expect(selectRelevantProjectSkills(readProjectSkillProposals(otherProject), ['domain:billing']))
      .toHaveLength(1)
  })
})
