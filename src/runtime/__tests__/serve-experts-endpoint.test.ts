import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { bootstrapWorkspace } from '@guildhall/config'
import { buildServeApp } from '../serve.js'

// GET /api/project/task/:id/experts — surface applicable personas, their
// verdicts, and their namespaced gate results for the drawer's Experts tab.

let tmpDir: string
let memoryDir: string

async function seedTask(
  id: string,
  overrides: Record<string, any> = {},
): Promise<void> {
  const tasksPath = path.join(memoryDir, 'TASKS.json')
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [
      {
        id,
        title: 'Seeded UI task',
        description: 'Add ghost button variant to the Button component',
        domain: 'looma',
        projectPath: tmpDir,
        status: 'review',
        priority: 'normal',
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        escalations: [],
        agentIssues: [],
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
      },
    ],
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
}

async function seedDesignSystem(): Promise<void> {
  const ds = {
    version: 1,
    revision: 1,
    tokens: {
      color: [
        { name: 'text.body', value: '#111111' },
        { name: 'bg.surface', value: '#ffffff' },
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
    copyVoice: {
      tone: 'plain',
      bannedTerms: [],
      preferredTerms: [],
      examples: [],
    },
  }
  await fs.writeFile(
    path.join(memoryDir, 'design-system.yaml'),
    yaml.dump(ds),
    'utf8',
  )
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-experts-'))
  bootstrapWorkspace(tmpDir, { name: 'Experts Endpoint Test' })
  memoryDir = path.join(tmpDir, 'memory')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/project/task/:id/experts', () => {
  it('returns applicable personas and primary engineer for a UI task', async () => {
    await seedDesignSystem()
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/experts'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    // Project Manager is always applicable.
    const slugs = body.applicable.map((e: { slug: string }) => e.slug)
    expect(slugs).toContain('project-manager')
    // UI task + design system → designers and a11y specialist apply.
    expect(slugs).toContain('component-designer')
    expect(slugs).toContain('accessibility-specialist')
    // Every applicable expert has name/role/blurb.
    for (const e of body.applicable) {
      expect(e.name).toBeTruthy()
      expect(['engineer', 'designer', 'specialist', 'overseer']).toContain(e.role)
      expect(e.blurb).toBeTruthy()
    }
    // Reviewers is a subset with rubrics — all personas in the built-in
    // roster ship rubrics, so reviewers match applicable length.
    expect(body.reviewers.length).toBe(body.applicable.length)
  })

  it('groups review verdicts by guild slug via failingSignals', async () => {
    await seedDesignSystem()
    await seedTask('task-1', {
      reviewVerdicts: [
        {
          verdict: 'revise',
          reviewerPath: 'llm',
          reason: 'The Accessibility Specialist requested revision',
          reasoning: 'Contrast fails on text.muted.',
          failingSignals: ['accessibility-specialist'],
          recordedAt: new Date().toISOString(),
        },
        {
          verdict: 'approve',
          reviewerPath: 'llm',
          reason: 'The Component Designer approved',
          reasoning: 'Prop API matches the catalog.',
          failingSignals: [],
          recordedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/experts'),
    )
    const body = (await res.json()) as Record<string, any>
    expect(body.verdictsBySlug['accessibility-specialist']).toHaveLength(1)
    expect(body.verdictsBySlug['accessibility-specialist'][0].verdict).toBe(
      'revise',
    )
    // Approve verdict gets attributed by name-match to component-designer.
    expect(body.verdictsBySlug['component-designer']).toHaveLength(1)
    expect(body.verdictsBySlug['component-designer'][0].verdict).toBe(
      'approve',
    )
  })

  it('groups gate results by guild via gate-id prefix', async () => {
    await seedDesignSystem()
    await seedTask('task-1', {
      gateResults: [
        {
          gateId: 'a11y.contrast-matrix',
          type: 'soft',
          passed: false,
          output: '1/4 pairs fail',
          checkedAt: new Date().toISOString(),
        },
        {
          gateId: 'color.near-duplicate-roles',
          type: 'soft',
          passed: true,
          checkedAt: new Date().toISOString(),
        },
        {
          gateId: 'typecheck',
          type: 'hard',
          passed: true,
          checkedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/experts'),
    )
    const body = (await res.json()) as Record<string, any>
    expect(body.gateResultsBySlug['accessibility-specialist']).toHaveLength(1)
    expect(body.gateResultsBySlug['color-theorist']).toHaveLength(1)
    // Hard-gate results (typecheck) fall into "unattributed" so the audit
    // trail still shows them.
    expect(body.gateResultsBySlug['unattributed']).toHaveLength(1)
    expect(body.gateResultsBySlug['unattributed'][0].gateId).toBe('typecheck')
  })

  it('returns 404 for unknown task id', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/missing/experts'),
    )
    expect(res.status).toBe(404)
  })
})
