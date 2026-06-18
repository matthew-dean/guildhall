import { describe, expect, it } from 'vitest'

import {
  classifySpine,
  markdownTable,
  renderMarkdown,
  summarizeSpine,
} from './project-orientation-spine-audit.mjs'

describe('project orientation spine audit', () => {
  it('classifies progressed, thin, and intake-needed project spines', () => {
    expect(classifySpine({
      charter: { goal: 'Build the thing.' },
      summary: { includedWorkCount: 12 },
      roots: [],
      activePins: [],
      gaps: [],
    })).toBe('rich-progressed')

    expect(classifySpine({
      charter: { goal: 'Build the thing.' },
      summary: { includedWorkCount: 1 },
      roots: [{ title: 'Review existing project work' }],
      activePins: [],
      gaps: [],
    })).toBe('thin-honest')

    expect(classifySpine({
      charter: { goal: null },
      summary: { includedWorkCount: 1 },
      roots: [],
      activePins: [],
      gaps: [{ kind: 'missing_charter' }],
    })).toBe('needs-intake')
  })

  it('summarizes spine proof without requiring every optional field', () => {
    const row = summarizeSpine(
      { id: 'narrative-harness', name: 'Narrative Harness' },
      {
        charter: {
          goal: 'Narrative Harness helps authors keep fiction coherent.',
          targetAudience: 'Authors',
        },
        scope: { label: 'Current MVP' },
        summary: {
          includedWorkCount: 8,
          deferredWorkCount: 0,
          progress: { briefed: 1, specced: 5, proven: 0, blocked: 3 },
        },
        roots: [
          { title: 'Build coherence reviewer MVP', maturity: 'active' },
        ],
        nodes: {
          'work:task-1': {},
        },
        activePins: [
          { label: 'Build coherence reviewer MVP', kind: 'active_work' },
          { label: 'Author voice feedback', kind: 'proof' },
          { label: 'Decision trace', kind: 'proof' },
        ],
        gaps: [
          { kind: 'proof_needed', severity: 'warn', label: 'Reviewer needs proof.' },
        ],
      },
    )

    expect(row).toMatchObject({
      projectId: 'narrative-harness',
      classification: 'rich-progressed',
      includedWorkCount: 8,
      rootCount: 1,
      nodeCount: 1,
      pinCount: 3,
      gapCount: 1,
    })
    expect(row.topRoots[0]).toEqual({
      title: 'Build coherence reviewer MVP',
      maturity: 'active',
    })
  })

  it('keeps markdown table cells one-line and pipe-safe', () => {
    const table = markdownTable([
      {
        projectName: 'Commerce project',
        classification: 'thin-honest',
        scope: 'Current MVP',
        includedWorkCount: 1,
        rootCount: 1,
        pinCount: 0,
        gapCount: 0,
        purpose: 'Keep the workspace operable:\nclarity | recoverability',
      },
    ])

    expect(table).toContain('clarity \\| recoverability')
    expect(table.split('\n')).toHaveLength(3)
  })

  it('renders compact markdown proof sections', () => {
    const markdown = renderMarkdown([
      {
        projectName: 'Looma + Knit',
        classification: 'rich-progressed',
        scope: 'Current MVP',
        includedWorkCount: 299,
        rootCount: 292,
        pinCount: 5,
        gapCount: 40,
        purpose: 'Keep Looma generic.',
        audience: 'Looma library; Knit app',
        progress: { briefed: 36, specced: 40, proven: 0, blocked: 1 },
        topRoots: [{ title: 'Floating toolbar', maturity: 'review' }],
        pins: [{ label: 'Floating toolbar', kind: 'review' }],
        gaps: [{ kind: 'proof_needed', label: 'Toolbar needs proof.' }],
      },
    ], 'http://localhost:7777')

    expect(markdown).toContain('# Project Orientation Spine Audit')
    expect(markdown).toContain('| Looma + Knit | rich-progressed |')
    expect(markdown).toContain('- Pins: Floating toolbar (review)')
    expect(markdown).toContain('- Gaps: proof_needed: Toolbar needs proof.')
  })
})
