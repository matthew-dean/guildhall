import { describe, it, expect } from 'vitest'
import type { Task, DesignSystem } from '@guildhall/core'
import { runGuildGates } from '../guild-gate-runner.js'

const baseTask: Task = {
  id: 't-1',
  title: 'Add ghost button',
  description: 'UI task — ghost variant',
  domain: 'ui',
  projectPath: '/tmp/project',
  status: 'gate_check',
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

const failingContrastDS: DesignSystem = {
  version: 1,
  revision: 1,
  tokens: {
    color: [
      { name: 'text.body', value: '#777777' },
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
  copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
}

const cleanDS: DesignSystem = {
  ...failingContrastDS,
  tokens: {
    ...failingContrastDS.tokens,
    color: [
      { name: 'text.body', value: '#111111' },
      { name: 'bg.surface', value: '#ffffff' },
    ],
  },
}

describe('runGuildGates', () => {
  it('produces GateResults only for checks that actually ran', async () => {
    const out = await runGuildGates({
      task: baseTask,
      signals: {
        task: baseTask,
        designSystem: failingContrastDS,
        memoryDir: '/tmp/memory',
        projectPath: '/tmp/project',
      },
      now: '2026-04-23T00:00:00Z',
    })
    // Skipped (no-op) checks are filtered out; only real signal-bearing
    // results become gates.
    expect(out.gateResults.length).toBeGreaterThan(0)
    for (const g of out.gateResults) {
      expect(g.type).toBe('soft')
      expect(g.checkedAt).toBe('2026-04-23T00:00:00Z')
    }
  })

  it('reports allPassed=false when contrast matrix fails', async () => {
    const out = await runGuildGates({
      task: baseTask,
      signals: {
        task: baseTask,
        designSystem: failingContrastDS,
        memoryDir: '/tmp/memory',
        projectPath: '/tmp/project',
      },
      now: '2026-04-23T00:00:00Z',
    })
    const contrast = out.gateResults.find((g) => g.gateId === 'a11y.contrast-matrix')
    expect(contrast).toBeDefined()
    expect(contrast!.passed).toBe(false)
    expect(out.allPassed).toBe(false)
  })

  it('reports allPassed=true when contrast passes and no near-duplicates', async () => {
    const out = await runGuildGates({
      task: baseTask,
      signals: {
        task: baseTask,
        designSystem: cleanDS,
        memoryDir: '/tmp/memory',
        projectPath: '/tmp/project',
      },
      now: '2026-04-23T00:00:00Z',
    })
    expect(out.allPassed).toBe(true)
  })

  it('tags gate ids with the guild namespace', async () => {
    const out = await runGuildGates({
      task: baseTask,
      signals: {
        task: baseTask,
        designSystem: failingContrastDS,
        memoryDir: '/tmp/memory',
        projectPath: '/tmp/project',
      },
      now: '2026-04-23T00:00:00Z',
    })
    const ids = out.gateResults.map((g) => g.gateId)
    expect(ids.some((i) => i.startsWith('a11y.'))).toBe(true)
  })
})
