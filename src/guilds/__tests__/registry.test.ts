import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Task, DesignSystem } from '@guildhall/core'
import {
  BUILTIN_GUILDS,
  selectApplicableGuilds,
  pickPrimaryEngineer,
  renderPersonaPrompt,
  renderSpecContributions,
  reviewersForTask,
  collectGuildRubrics,
  runGuildDeterministicChecks,
} from '../index.js'

const baseTask: Task = {
  id: 't1',
  title: 'Add ghost button variant',
  description: 'Add a ghost variant to ui-button for toolbar use.',
  domain: 'ui',
  projectPath: '/tmp/project',
  status: 'in_progress',
  priority: 'normal',
  dependsOn: [],
  outOfScope: [],
  acceptanceCriteria: [],
  notes: [],
  gateResults: [],
  reviewVerdicts: [],
  escalations: [],
  agentIssues: [],
  revisionCount: 0,
  remediationAttempts: 0,
  origination: 'human',
  createdAt: '2026-04-23T00:00:00Z',
  updatedAt: '2026-04-23T00:00:00Z',
}

const designSystemWithFailingPair: DesignSystem = {
  version: 1,
  revision: 1,
  tokens: {
    color: [
      { name: 'text.body', value: '#777777' },
      { name: 'bg.surface', value: '#ffffff' },
      // Near-duplicate of text.body (same exact value on purpose)
      { name: 'text.muted', value: '#777777' },
    ],
    spacing: [],
    typography: [],
    radius: [],
    shadow: [],
  },
  primitives: [],
  interactions: { motionDurationsMs: [], hoverRules: [] },
  a11y: {
    minContrastRatio: 4.5,
    focusOutlineRequired: true,
    keyboardRules: [],
    reducedMotionRespected: true,
  },
  copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
}

describe('BUILTIN_GUILDS', () => {
  it('includes personas with distinct slugs', () => {
    const slugs = BUILTIN_GUILDS.map((g) => g.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    const expected = [
      'project-manager',
      'component-designer',
      'visual-designer',
      'copywriter',
      'color-theorist',
      'api-designer',
      'accessibility-specialist',
      'security-engineer',
      'test-engineer',
      'performance-engineer',
      'frontend-engineer',
      'backend-engineer',
      'typescript-engineer',
    ]
    for (const slug of expected) {
      expect(slugs, `missing ${slug}`).toContain(slug)
    }
  })

  it('has 13 built-in personas', () => {
    expect(BUILTIN_GUILDS).toHaveLength(13)
  })
  it('every guild has non-empty principles content', () => {
    for (const g of BUILTIN_GUILDS) {
      expect(g.principles.length, `${g.slug} has empty principles`).toBeGreaterThan(50)
    }
  })
  it('every guild declares a valid role', () => {
    const validRoles = new Set(['engineer', 'designer', 'specialist', 'overseer'])
    for (const g of BUILTIN_GUILDS) {
      expect(validRoles.has(g.role), `${g.slug} has invalid role ${g.role}`).toBe(true)
    }
  })
  it('Project Manager is the overseer', () => {
    const pm = BUILTIN_GUILDS.find((g) => g.slug === 'project-manager')!
    expect(pm.role).toBe('overseer')
  })
  it('all engineers declare role=engineer', () => {
    for (const slug of ['typescript-engineer', 'frontend-engineer', 'backend-engineer']) {
      const g = BUILTIN_GUILDS.find((x) => x.slug === slug)!
      expect(g.role, `${slug} role`).toBe('engineer')
    }
  })
  it('all designers declare role=designer', () => {
    for (const slug of [
      'component-designer',
      'visual-designer',
      'copywriter',
      'color-theorist',
      'api-designer',
    ]) {
      const g = BUILTIN_GUILDS.find((x) => x.slug === slug)!
      expect(g.role, `${slug} role`).toBe('designer')
    }
  })
  it('all specialists declare role=specialist', () => {
    for (const slug of [
      'accessibility-specialist',
      'security-engineer',
      'test-engineer',
      'performance-engineer',
    ]) {
      const g = BUILTIN_GUILDS.find((x) => x.slug === slug)!
      expect(g.role, `${slug} role`).toBe('specialist')
    }
  })
  it('designers and specialists carry specContribution for exploring', () => {
    for (const g of BUILTIN_GUILDS) {
      if (g.role === 'designer' || g.role === 'specialist') {
        expect(
          g.specContribution && g.specContribution.length > 0,
          `${g.slug} missing specContribution`,
        ).toBe(true)
      }
    }
  })
})

describe('selectApplicableGuilds', () => {
  it('always seats the Project Manager', () => {
    const sel = selectApplicableGuilds({
      task: baseTask,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    expect(sel.some((g) => g.slug === 'project-manager')).toBe(true)
  })
  it('seats UI experts when a design system exists', () => {
    const sel = selectApplicableGuilds({
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    const slugs = sel.map((g) => g.slug)
    expect(slugs).toContain('component-designer')
    expect(slugs).toContain('accessibility-specialist')
    expect(slugs).toContain('color-theorist')
  })
  it('omits TS engineer for a non-TS project', () => {
    const sel = selectApplicableGuilds({
      task: { ...baseTask, title: 'Paint the bikeshed', description: 'no tech keywords' },
      memoryDir: '/tmp',
      projectPath: '/nonexistent-directory-should-not-be-a-ts-project',
    })
    expect(sel.some((g) => g.slug === 'typescript-engineer')).toBe(false)
  })
})

describe('pickPrimaryEngineer', () => {
  it('returns null when no engineer applies', () => {
    const picked = pickPrimaryEngineer(
      selectApplicableGuilds({
        task: { ...baseTask, title: 'no tech', description: 'nope' },
        memoryDir: '/tmp',
        projectPath: '/nonexistent-should-not-be-a-ts-project',
      }),
    )
    expect(picked).toBeNull()
  })
  it('prefers frontend-engineer over typescript-engineer on UI tasks', () => {
    const applicable = selectApplicableGuilds({
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: '/tmp',
      projectPath: process.cwd(), // this worktree has a tsconfig
    })
    const picked = pickPrimaryEngineer(applicable)
    expect(picked?.slug).toBe('frontend-engineer')
  })
})

describe('renderPersonaPrompt', () => {
  it('renders one persona with a Persona header', () => {
    const pm = BUILTIN_GUILDS.find((g) => g.slug === 'project-manager')!
    const text = renderPersonaPrompt(pm, {
      task: baseTask,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    expect(text).toContain('## Persona: The Project Manager')
  })
  it('applies specializePrinciples when the guild provides it', () => {
    const pm = BUILTIN_GUILDS.find((g) => g.slug === 'project-manager')!
    const text = renderPersonaPrompt(pm, {
      task: baseTask, // in_progress
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    expect(text).toContain('Playbook for status `in_progress`')
  })
})

describe('memory-dir overrides', () => {
  let tmpDir: string
  beforeEach(async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-override-test-'))
  })
  afterEach(async () => {
    const fs = await import('node:fs/promises')
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('renderPersonaPrompt uses memoryDir override when present', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const dir = path.join(tmpDir, 'guilds', 'component-designer')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'principles.md'),
      "I'm the project-specific Component Designer. We use kebab-case props here.\n",
      'utf-8',
    )
    const cd = BUILTIN_GUILDS.find((g) => g.slug === 'component-designer')!
    const rendered = renderPersonaPrompt(cd, {
      task: baseTask,
      memoryDir: tmpDir,
      projectPath: '/tmp/project',
    })
    expect(rendered).toContain('project-specific Component Designer')
    expect(rendered).toContain('kebab-case props')
    // Bundled prose not present when override wins.
    expect(rendered).not.toContain('atomic layers are real')
  })

  it('renderPersonaPrompt falls back to specializePrinciples + bundled when no override', () => {
    const cd = BUILTIN_GUILDS.find((g) => g.slug === 'component-designer')!
    const rendered = renderPersonaPrompt(cd, {
      task: baseTask,
      memoryDir: tmpDir,
      projectPath: '/tmp/project',
    })
    expect(rendered).toContain('Component Designer')
  })

  it('renderSpecContributions uses memoryDir override for specContribution', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const dir = path.join(tmpDir, 'guilds', 'accessibility-specialist')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'spec-contribution.md'),
      'Project-override a11y questions: SR testing matrix; RTL? high-contrast mode?',
      'utf-8',
    )
    const text = renderSpecContributions(BUILTIN_GUILDS, {
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: tmpDir,
      projectPath: '/tmp/project',
    })
    expect(text).toContain('Project-override a11y questions')
    expect(text).toContain('SR testing matrix')
  })
})

describe('renderSpecContributions', () => {
  const signals = {
    task: baseTask,
    memoryDir: '/tmp',
    projectPath: '/tmp/project',
  }
  it('is empty when no designer/specialist applies', () => {
    const applicable = [BUILTIN_GUILDS.find((g) => g.slug === 'project-manager')!]
    expect(renderSpecContributions(applicable, signals)).toBe('')
  })
  it('includes designers and specialists, excludes engineers and overseer', () => {
    const text = renderSpecContributions(BUILTIN_GUILDS, signals)
    expect(text).toContain('The Component Designer')
    expect(text).toContain('The Color Theorist')
    expect(text).toContain('The Accessibility Specialist')
    expect(text).not.toContain('The Project Manager')
    expect(text).not.toContain('The TypeScript Engineer')
    expect(text).not.toContain('The Frontend Engineer')
  })
})

describe('reviewersForTask', () => {
  it('returns every persona that carries a rubric', () => {
    const reviewers = reviewersForTask(BUILTIN_GUILDS)
    const slugs = reviewers.map((r) => r.slug)
    // Every built-in persona ships a rubric in this roster.
    for (const g of BUILTIN_GUILDS) {
      expect(slugs, `${g.slug} reviewer coverage`).toContain(g.slug)
    }
  })
})

describe('collectGuildRubrics', () => {
  it('tags each rubric item with its guild slug', () => {
    const pm = BUILTIN_GUILDS.find((g) => g.slug === 'project-manager')!
    const items = collectGuildRubrics([pm])
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.guildSlug === 'project-manager')).toBe(true)
  })
})

describe('runGuildDeterministicChecks', () => {
  it('a11y contrast matrix fails on a poor fg/bg pair', async () => {
    const guilds = selectApplicableGuilds({
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    const results = await runGuildDeterministicChecks(guilds, {
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    const contrast = results.find((r) => r.checkId === 'a11y.contrast-matrix')
    expect(contrast).toBeDefined()
    expect(contrast!.pass).toBe(false)
    expect(contrast!.detail ?? '').toMatch(/text\.body/)
  })
  it('color near-duplicate check flags identical tokens', async () => {
    const guilds = selectApplicableGuilds({
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    const results = await runGuildDeterministicChecks(guilds, {
      task: baseTask,
      designSystem: designSystemWithFailingPair,
      memoryDir: '/tmp',
      projectPath: '/tmp/project',
    })
    const dup = results.find((r) => r.checkId === 'color.near-duplicate-roles')
    expect(dup).toBeDefined()
    expect(dup!.pass).toBe(false)
    expect(dup!.detail ?? '').toMatch(/text\.body.*text\.muted|text\.muted.*text\.body/)
  })
})
