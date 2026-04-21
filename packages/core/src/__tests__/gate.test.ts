import { describe, it, expect } from 'vitest'
import { HardGate, SoftGate, GateSet, STANDARD_TS_GATES, STANDARD_CODE_REVIEW_RUBRIC } from '../gate.js'

describe('HardGate', () => {
  it('parses a valid hard gate', () => {
    const gate = HardGate.parse({
      id: 'typecheck',
      label: 'TypeScript typecheck',
      command: 'pnpm typecheck',
    })
    expect(gate.id).toBe('typecheck')
    expect(gate.timeoutMs).toBe(120_000) // default
  })

  it('accepts custom timeout', () => {
    const gate = HardGate.parse({
      id: 'slow-test',
      label: 'Slow tests',
      command: 'pnpm test:slow',
      timeoutMs: 300_000,
    })
    expect(gate.timeoutMs).toBe(300_000)
  })

  it('rejects gate without command', () => {
    expect(() => HardGate.parse({ id: 'x', label: 'x' })).toThrow()
  })
})

describe('SoftGate', () => {
  it('parses a valid soft gate', () => {
    const gate = SoftGate.parse({
      id: 'code-review',
      label: 'Code review',
      rubric: [{ id: 'ac-met', question: 'Are all ACs met?', weight: 1 }],
    })
    expect(gate.passingThreshold).toBe(0.8) // default
    expect(gate.rubric).toHaveLength(1)
  })

  it('rejects threshold outside 0–1', () => {
    expect(() => SoftGate.parse({
      id: 'x',
      label: 'x',
      rubric: [],
      passingThreshold: 1.5,
    })).toThrow()
  })
})

describe('STANDARD_TS_GATES', () => {
  it('contains all expected standard gates', () => {
    expect(Object.keys(STANDARD_TS_GATES)).toContain('typecheck')
    expect(Object.keys(STANDARD_TS_GATES)).toContain('build')
    expect(Object.keys(STANDARD_TS_GATES)).toContain('test')
    expect(Object.keys(STANDARD_TS_GATES)).toContain('lint')
  })

  it('all standard gates are valid HardGate shapes', () => {
    for (const gate of Object.values(STANDARD_TS_GATES)) {
      expect(() => HardGate.parse(gate)).not.toThrow()
    }
  })

  it('all standard gates have non-empty commands', () => {
    for (const gate of Object.values(STANDARD_TS_GATES)) {
      expect(gate.command.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('STANDARD_CODE_REVIEW_RUBRIC', () => {
  it('contains at least 4 rubric items', () => {
    expect(STANDARD_CODE_REVIEW_RUBRIC.length).toBeGreaterThanOrEqual(4)
  })

  it('all items have weight between 0 and 1', () => {
    for (const item of STANDARD_CODE_REVIEW_RUBRIC) {
      expect(item.weight).toBeGreaterThanOrEqual(0)
      expect(item.weight).toBeLessThanOrEqual(1)
    }
  })

  it('includes acceptance-criteria-met with weight 1 (non-negotiable)', () => {
    const item = STANDARD_CODE_REVIEW_RUBRIC.find(i => i.id === 'acceptance-criteria-met')
    expect(item).toBeDefined()
    expect(item?.weight).toBe(1)
  })

  it('includes no-regressions with weight 1 (non-negotiable)', () => {
    const item = STANDARD_CODE_REVIEW_RUBRIC.find(i => i.id === 'no-regressions')
    expect(item).toBeDefined()
    expect(item?.weight).toBe(1)
  })
})
