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
    expect(draft.tasks[0]?.scope).toBe('current')
  })

  it('preserves later-scope planning work as deferred task candidates instead of dropping it', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement dialogue-and-character-voice reviewer lane',
          evidence: 'remaining inventory recommendation',
          domainHint: 'coherence',
          scopeHint: 'later',
          confidence: 'high',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(draft.tasks[0]).toMatchObject({
      title: 'Implement dialogue-and-character-voice reviewer lane',
      domain: 'coherence',
      scope: 'later',
    })
  })

  it('carries explicit release scope from current work signals into draft tasks', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Build fixture-driven author voice shaping',
          evidence: 'docs/release-plan.md: - Build fixture-driven author voice shaping',
          scopeHint: 'current',
          releaseId: 'headless-mvp',
          confidence: 'high',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Add browser drafting workspace',
          evidence: 'docs/release-plan.md: - Add browser drafting workspace',
          scopeHint: 'later',
          releaseId: 'headless-mvp',
          confidence: 'high',
        },
      ]),
    )

    expect(draft.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Build fixture-driven author voice shaping',
        scope: 'current',
        releaseIds: ['headless-mvp'],
      }),
      expect.objectContaining({
        title: 'Add browser drafting workspace',
        scope: 'later',
      }),
    ]))
    expect(draft.tasks.find(task => task.title === 'Add browser drafting workspace')?.releaseIds).toBeUndefined()
  })

  it('lets explicit later scope win when duplicate planning signals disagree', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Version diff view',
          evidence: 'PROJECT_STATE.md: Version diff view',
          references: ['/repo/PROJECT_STATE.md'],
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Version diff view (deferred)',
          evidence: 'PROJECT_STATE.md: - [ ] Version diff view (deferred)',
          references: ['/repo/PROJECT_STATE.md'],
          scopeHint: 'later',
          confidence: 'high',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(draft.tasks[0]).toMatchObject({
      title: 'Version diff view (deferred)',
      scope: 'later',
    })
  })

  it('does not collapse distinct planning-doc reviewer lanes just because they share generic wording', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement dialogue-and-character-voice reviewer lane',
          evidence: 'inventory recommendation',
          domainHint: 'coherence',
          scopeHint: 'later',
          confidence: 'high',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement reader-knowledge-and-revelation reviewer lane',
          evidence: 'inventory recommendation',
          domainHint: 'coherence',
          scopeHint: 'later',
          confidence: 'high',
        },
      ]),
    )

    expect(draft.tasks.map(task => task.title)).toEqual([
      'Implement dialogue-and-character-voice reviewer lane',
      'Implement reader-knowledge-and-revelation reviewer lane',
    ])
  })

  it('does not collapse distinct reviewer lanes that are recommended from the same planning doc', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement dialogue-and-character-voice reviewer lane',
          evidence: 'remaining inventory recommendation',
          references: ['/repo/docs/harness/remaining-spec-decomposition-inventory.md'],
          domainHint: 'coherence',
          scopeHint: 'later',
          confidence: 'high',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement reader-knowledge-and-revelation reviewer lane',
          evidence: 'remaining inventory recommendation',
          references: ['/repo/docs/harness/remaining-spec-decomposition-inventory.md'],
          domainHint: 'coherence',
          scopeHint: 'later',
          confidence: 'high',
        },
      ]),
    )

    expect(draft.tasks.map(task => task.title)).toEqual([
      'Implement dialogue-and-character-voice reviewer lane',
      'Implement reader-knowledge-and-revelation reviewer lane',
    ])
  })

  it('does not collapse distinct same-file checklist siblings into one task', () => {
    const sharedReference = ['/repo/docs/roadmap.md']
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Detector task one',
          evidence: '- [ ] Detector task one',
          references: sharedReference,
          confidence: 'high',
        },
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Detector task two',
          evidence: '- [ ] Detector task two',
          references: sharedReference,
          confidence: 'high',
        },
        {
          source: 'roadmap',
          kind: 'open_work',
          title: 'Detector task three',
          evidence: '- [ ] Detector task three',
          references: sharedReference,
          confidence: 'high',
        },
      ]),
    )

    expect(draft.tasks.map(task => task.title)).toEqual([
      'Detector task one',
      'Detector task two',
      'Detector task three',
    ])
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

  it('preserves domain hints from multi-project workspace signals', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Fix selection drift',
          evidence: 'looma/docs/editor-bugs.md: - [ ] Fix selection drift',
          domainHint: 'looma',
          confidence: 'high',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Redirect auth callback',
          evidence: 'knit/PROJECT_STATE.md: - [ ] Redirect auth callback',
          domainHint: 'knit',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks.map((task) => task.domain)).toEqual(['looma', 'knit'])
  })

  it('filters obvious formatting debris before creating draft tasks', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: '(none)',
          evidence: 'placeholder',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Numbered Given/When/Then acceptance criteria',
          evidence: 'summary line',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Fix import review affordance',
          evidence: 'real work item',
          confidence: 'medium',
        },
      ]),
    )
    expect(draft.tasks.map((task) => task.title)).toEqual(['Fix import review affordance'])
  })

  it('filters umbrella placeholders that say child specs own the real work', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: '*(none — umbrella doc, covered by child specs)*',
          evidence: 'recommended first task title',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement packet-builder implementation for the first writer/editor packet types',
          evidence: 'real backlog item',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks.map((task) => task.title)).toEqual([
      'Implement packet-builder implementation for the first writer/editor packet types',
    ])
  })

  it('filters colon-ended grouping headers from task backlog', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Add missing high-frequency primitives:',
          evidence: 'group heading',
          domainHint: 'looma',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Listbox',
          evidence: 'child item',
          domainHint: 'looma',
          confidence: 'medium',
        },
      ]),
    )
    expect(draft.tasks.map((task) => task.title)).toEqual(['Listbox'])
  })

  it('keeps explanatory planning bullets as context instead of task backlog', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Strong recurrence in BlockNote and Plate',
          evidence: 'comparative editor note',
          domainHint: 'looma',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Realtime presence config: supabase.realtime must be enabled in Supabase dashboard for the channel to connect.',
          evidence: 'environment note',
          domainHint: 'knit',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement inline comments',
          evidence: 'real backlog item',
          domainHint: 'knit',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks.map((task) => task.title)).toEqual(['Implement inline comments'])
    expect(draft.context.map((entry) => entry.label)).toEqual([
      'Strong recurrence in BlockNote and Plate',
      'Realtime presence config: supabase.realtime must be enabled in Supabase dashboard for the channel to connect.',
    ])
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

  it('fuzzily dedupes near-identical tasks from the same planning file', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'TypeScript: generate proper types from Supabase (pnpm db:types)',
          evidence: 'first wording',
          references: ['/repo/knit/PROJECT_STATE.md'],
          domainHint: 'knit',
          confidence: 'high',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'pnpm db:types — generate TypeScript types from Supabase schema',
          evidence: 'second wording',
          references: ['/repo/knit/PROJECT_STATE.md'],
          domainHint: 'knit',
          confidence: 'high',
        },
      ]),
    )
    expect(draft.tasks).toHaveLength(1)
  })

  it('dedupes component roadmap wording across canonical ui tag and human component names', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Button: loading and icon-placement guidance',
          evidence: 'looma/docs/component-roadmap.md: - `Button`: loading and icon-placement guidance',
          references: ['/repo/looma/docs/component-roadmap.md'],
          domainHint: 'looma',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'ui-button: loading and icon-placement guidance',
          evidence: 'looma/apps/docs/docs/component-library-audit.md: - `ui-button`: loading and icon-placement guidance',
          references: ['/repo/looma/apps/docs/docs/component-library-audit.md'],
          domainHint: 'looma',
          confidence: 'medium',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(new Set(draft.tasks[0]!.references)).toEqual(
      new Set([
        '/repo/looma/docs/component-roadmap.md',
        '/repo/looma/apps/docs/docs/component-library-audit.md',
      ]),
    )
  })

  it('dedupes high-overlap planning tasks across related docs in the same domain', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Combobox after select/listbox baseline is stable',
          evidence: 'looma/docs/component-roadmap.md: - `Combobox` after select/listbox baseline is stable',
          references: ['/repo/looma/docs/component-roadmap.md'],
          domainHint: 'looma',
          confidence: 'medium',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Combobox after the simpler select path is stable',
          evidence: 'looma/apps/docs/docs/component-library-audit.md: - `Combobox` after the simpler select path is stable',
          references: ['/repo/looma/apps/docs/docs/component-library-audit.md'],
          domainHint: 'looma',
          confidence: 'medium',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
  })

  it('dedupes roadmap starter work with matching schema-spec implementation work', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          references: ['/repo/docs/harness/implementation-roadmap.md'],
          domainHint: 'harness',
          confidence: 'high',
          scopeHint: 'current',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
          evidence: 'docs/specs/schema-contract-roadmap.md: Recommended next spec for the current fixture harness.',
          references: ['/repo/docs/specs/schema-contract-roadmap.md'],
          domainHint: 'harness',
          confidence: 'medium',
          scopeHint: 'current',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(draft.tasks[0]).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      scope: 'current',
      domain: 'harness',
    })
    expect(new Set(draft.tasks[0]!.references)).toEqual(
      new Set([
        '/repo/docs/harness/implementation-roadmap.md',
        '/repo/docs/specs/schema-contract-roadmap.md',
      ]),
    )
  })

  it('dedupes current roadmap starter work with remaining-spec inventory recommendations for the same slice', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          references: ['/repo/docs/harness/implementation-roadmap.md'],
          domainHint: 'harness',
          confidence: 'high',
          scopeHint: 'current',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
          evidence: 'Recommended first task title: Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
          references: [
            '/repo/docs/harness/remaining-spec-decomposition-inventory.md',
            '/repo/docs/specs/schema-contract-roadmap.md',
            '/repo/docs/harness/implementation-roadmap.md',
          ],
          domainHint: 'harness',
          confidence: 'high',
          scopeHint: 'current',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(draft.tasks[0]).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      scope: 'current',
      domain: 'harness',
    })
    expect(new Set(draft.tasks[0]!.references)).toEqual(
      new Set([
        '/repo/docs/harness/implementation-roadmap.md',
        '/repo/docs/harness/remaining-spec-decomposition-inventory.md',
        '/repo/docs/specs/schema-contract-roadmap.md',
      ]),
    )
  })

  it('dedupes current roadmap starter work with section-indexed decomposition recommendations from real inventory prose', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          references: ['/repo/docs/harness/implementation-roadmap.md'],
          domainHint: 'harness',
          confidence: 'medium',
          scopeHint: 'current',
        },
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
          evidence: 'docs/harness/remaining-spec-decomposition-inventory.md: 2.10 schema-contract-roadmap.md',
          references: [
            '/repo/docs/harness/remaining-spec-decomposition-inventory.md',
            '/repo/docs/specs/schema-contract-roadmap.md',
          ],
          domainHint: 'harness',
          confidence: 'high',
          scopeHint: 'current',
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(draft.tasks[0]).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      scope: 'current',
      domain: 'harness',
    })
    expect(new Set(draft.tasks[0]!.references)).toEqual(
      new Set([
        '/repo/docs/harness/implementation-roadmap.md',
        '/repo/docs/harness/remaining-spec-decomposition-inventory.md',
        '/repo/docs/specs/schema-contract-roadmap.md',
      ]),
    )
  })

  it('enriches current roadmap tasks with related spec and harness references', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'open_work',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          confidence: 'high',
          scopeHint: 'current',
          references: ['/repo/docs/harness/implementation-roadmap.md'],
        },
        {
          source: 'planning-docs',
          kind: 'context',
          title: 'Spec: Story Memory Schemas',
          evidence: 'These schemas turn the story-intelligence specs into buildable contracts.',
          confidence: 'high',
          references: ['/repo/docs/specs/story-memory-schemas.md'],
        },
        {
          source: 'planning-docs',
          kind: 'context',
          title: 'Spec: Schema Contract Roadmap',
          evidence: 'Immediate schema work covers fixture, expected-record, prototype run, and evaluation contracts.',
          confidence: 'high',
          references: ['/repo/docs/specs/schema-contract-roadmap.md'],
        },
        {
          source: 'text-corpus',
          kind: 'context',
          title: 'Text document (docs/harness/prototype-iteration-workflow.md): Prototype Iteration Workflow',
          evidence: 'The first usable proof should be a harness that can test story-memory model, packet builder, editor agents, and writer agents.',
          confidence: 'high',
          references: ['/repo/docs/harness/prototype-iteration-workflow.md'],
        },
      ]),
    )

    expect(draft.tasks).toHaveLength(1)
    expect(new Set(draft.tasks[0]!.references)).toEqual(
      new Set([
        '/repo/docs/harness/implementation-roadmap.md',
        '/repo/docs/specs/story-memory-schemas.md',
        '/repo/docs/specs/schema-contract-roadmap.md',
        '/repo/docs/harness/prototype-iteration-workflow.md',
      ]),
    )
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

  it('merges duplicate structural records across sources into one brief record context', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'context',
          title: 'Book brief',
          evidence: 'author voice, premise, genre, themes, constraints',
          confidence: 'high',
          references: ['/repo/docs/harness/architecture-notes.md'],
          role: 'brief_input',
          structure: 'record',
        },
        {
          source: 'planning-docs',
          kind: 'context',
          title: 'Book brief',
          evidence: 'premise, genre/form, intended audience, age bracket, target reader experience, themes, constraints',
          confidence: 'high',
          references: ['/repo/docs/specs/agent-context-packets-and-compaction.md'],
          role: 'brief_input',
          structure: 'record',
        },
      ]),
    )

    expect(draft.context).toHaveLength(1)
    expect(draft.context[0]).toMatchObject({
      label: 'Book brief',
      role: 'brief_input',
      structure: 'record',
    })
    expect(new Set(draft.context[0]!.references)).toEqual(new Set([
      '/repo/docs/harness/architecture-notes.md',
      '/repo/docs/specs/agent-context-packets-and-compaction.md',
    ]))
    expect(draft.context[0]!.excerpt).toContain('intended audience')
  })

  it('keeps multiple context entries when they come from the same file but describe different structure', () => {
    const draft = formWorkspaceHypothesis(
      invFrom([
        {
          source: 'planning-docs',
          kind: 'context',
          title: 'Stage 0: Spec Baseline',
          evidence: 'roadmap stage heading',
          confidence: 'medium',
          references: ['/repo/docs/harness/implementation-roadmap.md'],
        },
        {
          source: 'planning-docs',
          kind: 'context',
          title: 'Stage 1: Fixture And Evaluation Harness',
          evidence: 'roadmap stage heading',
          confidence: 'medium',
          references: ['/repo/docs/harness/implementation-roadmap.md'],
        },
      ]),
    )

    expect(draft.context.map((entry) => entry.label)).toEqual([
      'Stage 0: Spec Baseline',
      'Stage 1: Fixture And Evaluation Harness',
    ])
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
