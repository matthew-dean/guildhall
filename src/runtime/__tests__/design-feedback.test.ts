import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildDesignDecisionPacket,
  captureOwnerDesignFeedback,
  DESIGN_FEEDBACK_FILE,
  classifyDesignFinding,
  discoverLoomaDevelopmentHook,
  recordDesignFinding,
  readDesignFeedbackStore,
  routeDesignFinding,
} from '../design-feedback.js'

describe('design feedback loop', () => {
  it('routes project-specific findings into project design decisions', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-feedback-project-'))
    try {
      const finding = await recordDesignFinding({
        memoryDir,
        finding: {
          id: 'finding-pantry-palette',
          summary: 'Pantry Pulse needs a warmer domestic food palette.',
          source: { kind: 'reviewer', artifactId: 'design-proof-pantry' },
          severity: 'medium',
          dimension: 'palette',
          evidenceRefs: [{ kind: 'screenshot', ref: 'mobile.png', summary: 'Mobile pantry screen' }],
          suggestedClassification: 'project-specific',
        },
      })

      const routed = await routeDesignFinding({ memoryDir, findingId: finding.id })

      expect(routed.decision?.summary).toContain('warmer domestic food palette')
      expect(routed.candidate).toBeUndefined()
      const store = await readDesignFeedbackStore(memoryDir)
      expect(store.findings).toHaveLength(1)
      expect(store.decisions).toHaveLength(1)
      expect(store.candidates).toHaveLength(0)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('routes reusable Looma findings into portable candidates and Looma improvements', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-feedback-looma-'))
    try {
      const finding = await recordDesignFinding({
        memoryDir,
        finding: {
          id: 'finding-segmented-filter',
          summary: 'Segmented filter selected state is unclear in compact mobile layouts.',
          source: { kind: 'owner-feedback', artifactId: 'pantry-filter.default', selector: '[data-filter]' },
          severity: 'high',
          dimension: 'interaction-semantics',
          designSystem: 'looma',
          targetPackage: 'core',
          evidenceRefs: [{ kind: 'story', ref: 'pantry-filter.default', summary: 'Portable story' }],
          suggestedClassification: 'reusable-pattern',
        },
      })

      const routed = await routeDesignFinding({ memoryDir, findingId: finding.id })

      expect(routed.decision).toBeUndefined()
      expect(routed.candidate).toMatchObject({
        targetDesignSystem: 'looma',
        classification: 'reusable-pattern',
      })
      expect(routed.loomaImprovement).toMatchObject({
        targetPackage: 'core',
        findingIds: ['finding-segmented-filter'],
      })
      const raw = await fs.readFile(path.join(memoryDir, DESIGN_FEEDBACK_FILE), 'utf-8')
      expect(raw).toContain('finding-segmented-filter')
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('classifies common design misses without requiring owner triage', () => {
    expect(classifyDesignFinding({
      summary: 'Radius scale feels inconsistent across generated apps.',
      dimension: 'radius',
    })).toBe('token-system-gap')

    expect(classifyDesignFinding({
      summary: 'Documented Looma switch focus state fails in Storybook.',
      dimension: 'state',
      designSystem: 'looma',
      sourceKind: 'automated-visual-check',
    })).toBe('design-system-defect')
  })

  it('classifies broader design dependency pivots as architecture opportunities', () => {
    expect(classifyDesignFinding({
      summary: 'Replace the bespoke autocomplete dropdown with a tested combobox primitive because keyboard support and async positioning are brittle.',
      dimension: 'control-architecture',
    })).toBe('architecture-opportunity')

    expect(classifyDesignFinding({
      summary: 'Remove the third-party carousel package because its bundle overhead exceeds the simple gallery product need.',
      dimension: 'dependency-overhead',
    })).toBe('architecture-opportunity')
  })

  it('captures owner feedback against rendered proof and routes it into a design decision', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-owner-feedback-'))
    try {
      const feedback = await captureOwnerDesignFeedback({
        memoryDir,
        feedback: {
          id: 'owner-filter-toggle',
          summary: 'The Show all control reads like a command, but it behaves like persistent state.',
          sentiment: 'revise',
          status: 'accepted',
          target: {
            artifactId: 'design-proof-pantry',
            screenshotRef: 'proof/mobile-filter.png',
            selector: '[data-testid="show-all"]',
            componentName: 'ShowAllFilter',
            viewport: 'mobile-390',
            coordinates: { x: 342, y: 72 },
          },
          rationaleTags: ['better-controls', 'clearer-hierarchy'],
        },
      })

      expect(feedback.target).toMatchObject({
        screenshotRef: 'proof/mobile-filter.png',
        selector: '[data-testid="show-all"]',
        viewport: 'mobile-390',
      })
      const store = await readDesignFeedbackStore(memoryDir)
      expect(store.ownerFeedback).toHaveLength(1)
      expect(store.findings[0]).toMatchObject({
        id: 'finding-owner-filter-toggle',
        source: {
          kind: 'owner-feedback',
          artifactId: 'design-proof-pantry',
          selector: '[data-testid="show-all"]',
          viewport: 'mobile-390',
        },
        classification: 'project-specific',
      })
      expect(store.findings[0]?.evidenceRefs.map(ref => ref.kind)).toEqual(expect.arrayContaining([
        'screenshot',
        'selector',
        'component',
        'viewport',
        'coordinates',
      ]))
      expect(store.decisions[0]?.summary).toContain('Show all control')
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('builds a worker-readable decision packet from accepted owner feedback', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-decision-packet-'))
    try {
      await captureOwnerDesignFeedback({
        memoryDir,
        feedback: {
          id: 'owner-filter-toggle',
          summary: 'Use a segmented control for mutually exclusive pantry filters.',
          sentiment: 'prefer',
          status: 'accepted',
          target: { componentName: 'PantryFilter', viewport: 'desktop-1280' },
          rationaleTags: ['better-controls'],
        },
      })
      await captureOwnerDesignFeedback({
        memoryDir,
        feedback: {
          id: 'owner-muted-card',
          summary: 'Keep the dense grocery list calmer and less card-heavy.',
          sentiment: 'note',
          status: 'captured',
          target: { artifactId: 'design-proof-pantry' },
          rationaleTags: ['calmer'],
        },
      })

      const packet = await buildDesignDecisionPacket({ memoryDir })

      expect(packet.feedbackIds).toEqual(['owner-filter-toggle'])
      expect(packet.decisionIds).toEqual(['design-decision-finding-owner-filter-toggle'])
      expect(packet.constraints).toEqual(expect.arrayContaining([
        expect.stringContaining('Use a segmented control for mutually exclusive pantry filters.'),
      ]))
      expect(packet.reviewChecklist).toEqual(expect.arrayContaining([
        'Verify accepted owner feedback is reflected in the UI.',
        'Verify better control semantics.',
      ]))
      expect(packet.workerContext).toContain('Accepted design feedback')
      expect(packet.workerContext).toContain('PantryFilter')

      const store = await readDesignFeedbackStore(memoryDir)
      expect(store.decisionPackets).toHaveLength(1)
      expect(store.decisionPackets[0]?.id).toBe(packet.id)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })
})

describe('discoverLoomaDevelopmentHook', () => {
  it('stays inactive when experimental Looma development is not configured', async () => {
    const status = await discoverLoomaDevelopmentHook({ globalConfig: {} })

    expect(status).toMatchObject({
      enabled: false,
      status: 'inactive',
      reason: expect.stringContaining('not configured'),
    })
  })

  it('stays inactive when the configured path is not a valid Looma checkout', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-not-looma-'))
    try {
      const status = await discoverLoomaDevelopmentHook({
        globalConfig: {
          experimental: {
            designSystemDevelopment: {
              looma: {
                enabled: true,
                path: dir,
                writeThrough: 'queue',
              },
            },
          },
        },
      })

      expect(status).toMatchObject({
        enabled: true,
        status: 'inactive',
        path: dir,
      })
      expect(status.reason).toContain('not a Git worktree')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('activates only for an explicitly configured valid Looma checkout', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-looma-hook-'))
    try {
      await fs.mkdir(path.join(dir, '.git'))
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'looma-monorepo', private: true }, null, 2),
        'utf-8',
      )

      const status = await discoverLoomaDevelopmentHook({
        globalConfig: {
          experimental: {
            designSystemDevelopment: {
              looma: {
                enabled: true,
                path: dir,
                writeThrough: 'queue',
              },
            },
          },
        },
      })

      expect(status).toMatchObject({
        enabled: true,
        status: 'active',
        path: dir,
        writeThrough: 'queue',
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
