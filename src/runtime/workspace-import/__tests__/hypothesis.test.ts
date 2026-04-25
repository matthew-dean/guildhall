import { describe, it, expect } from 'vitest'
import { formWorkspaceHypothesis } from '../hypothesis.js'
import type { WorkspaceInventory } from '../detect.js'
import type { WorkspaceSignal } from '../types.js'

function invFrom(signals: WorkspaceSignal[]): WorkspaceInventory {
  const bySource: Record<string, WorkspaceSignal[]> = {}
  const sourceIds = new Set<string>()
  for (const s of signals) {
    sourceIds.add(s.source)
    ;(bySource[s.source] ??= []).push(s)
  }
  return {
    signals,
    bySource,
    ran: [...sourceIds],
    failed: [],
  }
}

describe('formWorkspaceHypothesis', () => {
  it('returns an empty draft for an empty inventory', () => {
    const draft = formWorkspaceHypothesis(invFrom([]))
    expect(draft).toEqual({
      goals: [],
      tasks: [],
      milestones: [],
      context: [],
      stats: { inputSignals: 0, drafted: 0, deduped: 0 },
    })
  })

  it('routes signals into buckets by kind', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'readme',
          kind: 'goal',
          title: 'Ship multi-agent orchestrator',
          evidence: 'Described in README.md',
          confidence: 'high',
        },
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Wire dashboard card',
          evidence: '- [ ] Wire dashboard card',
          confidence: 'high',
        },
        {
          source: 'git-log',
          kind: 'milestone',
          title: 'Ship v0.1.0',
          evidence: 'abc12345 Ship v0.1.0',
          confidence: 'high',
          references: ['abc12345'],
        },
        {
          source: 'agents-md',
          kind: 'context',
          title: 'Agent conventions (CLAUDE.md)',
          evidence: 'use pnpm; tests next to source',
          confidence: 'high',
          references: ['CLAUDE.md'],
        },
      ]),
    )
    expect(draft.goals).toHaveLength(1)
    expect(draft.tasks).toHaveLength(1)
    expect(draft.milestones).toHaveLength(1)
    expect(draft.context).toHaveLength(1)
    expect(draft.stats).toEqual({ inputSignals: 4, drafted: 4, deduped: 0 })
  })

  it('does not copy identical evidence into goal rationale or task description', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'readme',
          kind: 'goal',
          title: '✨ **Live conversion** - See changes',
          evidence: '✨ **Live conversion** - See changes',
          confidence: 'medium',
        },
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'Consider caching',
          evidence: 'Consider caching',
          confidence: 'low',
        },
      ]),
    )
    expect(draft.goals[0]!.rationale).toBe('')
    expect(draft.tasks[0]!.description).toBe('')
  })

  it('does not promote generic TODOs or bootstrap chores into starter tasks', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'TODO: Add more features:',
          evidence: 'TODO: Add more features:',
          confidence: 'low',
        },
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'TODO: Could clean up visible type tags here if needed',
          evidence: 'TODO: Could clean up visible type tags here if needed',
          confidence: 'low',
        },
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Verify bootstrap: pnpm install → build → test',
          evidence: '- [ ] Verify bootstrap: pnpm install → build → test',
          confidence: 'high',
        },
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Implement declaration file generation',
          evidence: '- [ ] Implement declaration file generation',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks.map(t => t.title)).toEqual(['Implement declaration file generation'])
  })

  it('produces stable suggestedId slugs', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Add dark-mode toggle',
          evidence: '- [ ] Add dark-mode toggle',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks[0]!.suggestedId).toMatch(/^task-import-[a-z0-9]{1,7}$/)
    const draft2 = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Add dark-mode toggle',
          evidence: 'v2',
          confidence: 'high',
        },
      ]),
    )
    expect(draft2.tasks[0]!.suggestedId).toBe(draft.tasks[0]!.suggestedId)
  })

  it('dedupes repeated open_work across sources and merges references', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Add dark mode',
          evidence: 'from roadmap',
          confidence: 'high',
          references: ['ROADMAP.md'],
        },
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'Add dark mode',
          evidence: '// TODO: Add dark mode',
          confidence: 'low',
          references: ['src/theme.ts:42'],
        },
      ]),
    )
    expect(draft.tasks).toHaveLength(1)
    const t = draft.tasks[0]!
    // Highest confidence wins (high beats low).
    expect(t.confidence).toBe('high')
    expect(t.source).toBe('roadmap')
    expect(t.description).toBe('from roadmap')
    // References merged from both.
    expect(new Set(t.references)).toEqual(
      new Set(['ROADMAP.md', 'src/theme.ts:42']),
    )
    expect(draft.stats.deduped).toBe(1)
  })

  it('upgrades confidence when a later signal is stronger', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'Ship billing',
          evidence: 'low signal',
          confidence: 'low',
        },
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Ship billing',
          evidence: 'high signal',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks).toHaveLength(1)
    expect(draft.tasks[0]!.confidence).toBe('high')
    expect(draft.tasks[0]!.priority).toBe('normal')
    expect(draft.tasks[0]!.description).toBe('high signal')
    expect(draft.tasks[0]!.source).toBe('roadmap')
  })

  it('does not downgrade when a later signal is weaker', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Ship billing',
          evidence: 'high signal',
          confidence: 'high',
        },
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'Ship billing',
          evidence: 'low signal',
          confidence: 'low',
        },
      ]),
    )
    expect(draft.tasks[0]!.confidence).toBe('high')
    expect(draft.tasks[0]!.description).toBe('high signal')
  })

  it('low-confidence tasks get low priority', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'todo-comments',
          kind: 'open_work',
          title: 'Consider caching',
          evidence: 'TODO',
          confidence: 'low',
        },
      ]),
    )
    expect(draft.tasks[0]!.priority).toBe('low')
  })

  it('keeps multiple context entries when they come from different files', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'agents-md',
          kind: 'context',
          title: 'Agent conventions (CLAUDE.md)',
          evidence: 'a',
          confidence: 'high',
          references: ['CLAUDE.md'],
        },
        {
          source: 'agents-md',
          kind: 'context',
          title: 'Agent conventions (AGENTS.md)',
          evidence: 'b',
          confidence: 'high',
          references: ['AGENTS.md'],
        },
      ]),
    )
    expect(draft.context).toHaveLength(2)
  })

  it('ignores signals with empty titles', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'readme',
          kind: 'goal',
          title: '',
          evidence: 'nothing',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.goals).toEqual([])
    expect(draft.stats.drafted).toBe(0)
  })

  it('produces identical output across repeated calls (stable)', () => {
    const inv = invFrom([
      {
        source: 'roadmap',
        kind: 'open_work',
        title: 'Wire dashboard card',
        evidence: 'x',
        confidence: 'high',
      },
      {
        source: 'todo-comments',
        kind: 'open_work',
        title: 'Wire dashboard card',
        evidence: 'y',
        confidence: 'low',
      },
    ])
    const a = formWorkspaceHypothesis(inv)
    const b = formWorkspaceHypothesis(inv)
    expect(a).toEqual(b)
  })
})
