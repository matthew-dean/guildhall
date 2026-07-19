import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectWorkspaceSignals,
  readmeSource,
  agentsMdSource,
  roadmapSource,
  planningDocsSource,
  textCorpusSource,
  todoCommentsSource,
  gitLogSource,
  BUILTIN_TASK_SOURCES,
} from '../index.js'
import type { TaskSource, TaskSourceContext, WorkspaceSignal } from '../types.js'

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'guildhall-wsimport-'))
}

type Exec = NonNullable<TaskSourceContext['exec']>

function fakeExec(
  handler: (
    cmd: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ) => { stdout: string; stderr?: string; code?: number },
): Exec {
  return async (cmd, args, opts) => {
    const res = handler(cmd, args, opts)
    return { stdout: res.stdout, stderr: res.stderr ?? '', code: res.code ?? 0 }
  }
}

describe('readmeSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] when no README is present', async () => {
    const sigs = await readmeSource.detect({ projectPath: dir })
    expect(sigs).toEqual([])
  })

  it('extracts an H1 and lead paragraph as a goal signal', async () => {
    writeFileSync(
      join(dir, 'README.md'),
      `# Forge\n\nA distributed task queue for multi-agent AI systems.\n`,
    )
    const sigs = await readmeSource.detect({ projectPath: dir })
    expect(sigs).toHaveLength(1)
    expect(sigs[0]).toMatchObject({
      source: 'readme',
      kind: 'goal',
      title: 'Forge',
      confidence: 'high',
    })
    expect(sigs[0]!.evidence).toContain('distributed task queue')
  })

  it('emits goal signals for bullets under a Goals section', async () => {
    writeFileSync(
      join(dir, 'README.md'),
      `# Forge

lead

## Goals

- Support local and hosted LLMs
- Ship without babysitting
`,
    )
    const sigs = await readmeSource.detect({ projectPath: dir })
    const bulletSigs = sigs.filter((s) => s.confidence === 'medium')
    expect(bulletSigs).toHaveLength(2)
    expect(bulletSigs[0]!.title).toBe('Support local and hosted LLMs')
    expect(bulletSigs[1]!.title).toBe('Ship without babysitting')
  })

})

describe('textCorpusSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('maps non-code text files with bounded deterministic excerpts', async () => {
    mkdirSync(join(dir, '.md'), { recursive: true })
    mkdirSync(join(dir, 'database'), { recursive: true })
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, '.md/README.md'),
      [
        '# Fair Labor License Platform',
        '',
        'Migration plan and architecture for moving from WordPress to a modern licensing platform.',
        '',
        '## Phase 3: Licensing System',
        '- [ ] Eligibility checker',
        '- [ ] Payment integration (Stripe)',
      ].join('\n'),
    )
    writeFileSync(
      join(dir, 'database/README.md'),
      '# Database Setup Guide\n\nFrom workspace root, run `supabase db push`.\n',
    )
    writeFileSync(join(dir, 'notes.txt'), 'Release notes\n\nDo the small launch things.\n')
    writeFileSync(join(dir, 'src/app.ts'), '// code files are not part of this text source\n')

    const sigs = await textCorpusSource.detect({ projectPath: dir })

    expect(sigs.map((s) => s.title)).toEqual(
      expect.arrayContaining([
        'Text document (.md/README.md): Fair Labor License Platform',
        'Text document (database/README.md): Database Setup Guide',
        'Text document (notes.txt): notes.txt',
        'Eligibility checker',
        'Payment integration (Stripe)',
      ]),
    )
    expect(sigs.find((s) => s.title.includes('Fair Labor License'))!.evidence).toBe(
      'Migration plan and architecture for moving from WordPress to a modern licensing platform.',
    )
    expect(sigs.some((s) => s.references?.[0]?.endsWith('src/app.ts'))).toBe(false)
  })

  it('keeps specs and feature catalogs as context instead of current work', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, 'specs'), { recursive: true })
    mkdirSync(join(dir, 'supabase'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'features.md'),
      [
        '# Feature Catalog',
        '',
        '- [ ] Inline comments',
        '- [ ] AI writing assistant',
      ].join('\n'),
    )
    writeFileSync(
      join(dir, 'specs', 'v1-editor.md'),
      [
        '# V1 Editor',
        '',
        '## Acceptance Criteria',
        '- [ ] AC1: User can write rich text.',
        '- [ ] AC2: User can insert tables.',
      ].join('\n'),
    )
    writeFileSync(
      join(dir, 'supabase', 'MIGRATION_GUIDE.md'),
      [
        '# Migration Guide',
        '',
        '- [ ] All CREATE statements use IF NOT EXISTS',
      ].join('\n'),
    )

    const sigs = await textCorpusSource.detect({ projectPath: dir })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        title: 'Text document (docs/features.md): Feature Catalog',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Text document (specs/v1-editor.md): V1 Editor',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Text document (supabase/MIGRATION_GUIDE.md): Migration Guide',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'open_work', title: 'Inline comments' }),
      expect.objectContaining({ kind: 'open_work', title: 'AI writing assistant' }),
      expect.objectContaining({ kind: 'open_work', title: 'AC1: User can write rich text.' }),
      expect.objectContaining({ kind: 'open_work', title: 'AC2: User can insert tables.' }),
      expect.objectContaining({ kind: 'open_work', title: 'All CREATE statements use IF NOT EXISTS' }),
    ]))
  })
})

describe('agentsMdSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] when no agent-convention docs exist', async () => {
    const sigs = await agentsMdSource.detect({ projectPath: dir })
    expect(sigs).toEqual([])
  })

  it('emits one context signal per discovered file', async () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'use pnpm; tests live next to source')
    writeFileSync(join(dir, 'AGENTS.md'), 'follow the style guide')
    const sigs = await agentsMdSource.detect({ projectPath: dir })
    expect(sigs).toHaveLength(2)
    expect(sigs.every((s) => s.kind === 'context')).toBe(true)
    expect(sigs.map((s) => s.title)).toEqual([
      'Agent conventions (CLAUDE.md)',
      'Agent conventions (AGENTS.md)',
    ])
  })

  it('skips empty files', async () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '   \n\n')
    const sigs = await agentsMdSource.detect({ projectPath: dir })
    expect(sigs).toEqual([])
  })
})

describe('roadmapSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits open_work for unchecked checklist items', async () => {
    writeFileSync(
      join(dir, 'ROADMAP.md'),
      `# Plan

- [ ] Build task detector
- [ ] Wire up dashboard card
`,
    )
    const sigs = await roadmapSource.detect({ projectPath: dir })
    expect(sigs).toHaveLength(2)
    expect(sigs.every((s) => s.kind === 'open_work')).toBe(true)
    expect(sigs[0]!.title).toBe('Build task detector')
  })

  it('emits milestone for checked items', async () => {
    writeFileSync(
      join(dir, 'ROADMAP.md'),
      `- [x] Ship v0.1
- [ ] Ship v0.2
`,
    )
    const sigs = await roadmapSource.detect({ projectPath: dir })
    const milestones = sigs.filter((s) => s.kind === 'milestone')
    const open = sigs.filter((s) => s.kind === 'open_work')
    expect(milestones.map((s) => s.title)).toEqual(['Ship v0.1'])
    expect(open.map((s) => s.title)).toEqual(['Ship v0.2'])
  })

  it('treats plain bullets as medium-confidence open work', async () => {
    writeFileSync(join(dir, 'TODO.md'), `- Write docs\n- Add CI\n`)
    const sigs = await roadmapSource.detect({ projectPath: dir })
    expect(sigs).toHaveLength(2)
    expect(sigs.every((s) => s.confidence === 'medium')).toBe(true)
  })

  it('scans docs/ROADMAP.md as well', async () => {
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'ROADMAP.md'), `- [ ] nested plan\n`)
    const sigs = await roadmapSource.detect({ projectPath: dir })
    expect(sigs).toHaveLength(1)
    expect(sigs[0]!.title).toBe('nested plan')
  })
})

describe('planningDocsSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('recurses nested project-state and roadmap docs instead of relying on root-only filenames', async () => {
    mkdirSync(join(dir, 'knit', 'docs'), { recursive: true })
    mkdirSync(join(dir, 'looma', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'knit', 'PROJECT_STATE.md'),
      `# Knit

## Next Up
- [ ] Add editor tests
- [ ] Test auth callback flow
`,
    )
    writeFileSync(
      join(dir, 'knit', 'docs', 'feature-roadmap.md'),
      `# Feature Roadmap

## Parity gaps
1. Inline comments
2. Version diff UI
`,
    )
    writeFileSync(
      join(dir, 'looma', 'docs', 'editor-roadmap.md'),
      `# Editor roadmap\n`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'knit/PROJECT_STATE.md',
          'knit/docs/feature-roadmap.md',
          'looma/docs/editor-roadmap.md',
        ].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.some((s) => s.title === 'Add editor tests' && s.kind === 'open_work')).toBe(true)
    expect(sigs.some((s) => s.title === 'Inline comments' && s.kind === 'open_work')).toBe(true)
    expect(sigs.find((s) => s.title === 'Add editor tests')?.domainHint).toBe('knit')
  })

  it('treats implementation tracker checklists as planning work signals', async () => {
    writeFileSync(
      join(dir, '2026-05-27-guildhall-0-9-implementation-tracker.md'),
      `# Implementation Tracker

## Milestone 1: Runtime Image Contract

- [x] Add a committed Containerfile.
- [ ] Add runtime smoke command.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['2026-05-27-guildhall-0-9-implementation-tracker.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'milestone',
      title: 'Add a committed Containerfile.',
    }))
    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Add runtime smoke command.',
    }))
  })

  it('treats nested specs as context signals', async () => {
    mkdirSync(join(dir, 'knit', 'specs'), { recursive: true })
    writeFileSync(
      join(dir, 'knit', 'specs', 'v1-editor.md'),
      `# V1 Editor\n\nDetails\n`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['knit/specs/v1-editor.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(
      expect.objectContaining({
        source: 'planning-docs',
        kind: 'context',
        title: 'Spec: V1 Editor',
        role: 'capability',
      }),
    )
  })

  it('dedupes spec prefixes and skips placeholder spec titles', async () => {
    mkdirSync(join(dir, 'knit', 'specs'), { recursive: true })
    writeFileSync(join(dir, 'knit', 'specs', 'page-editor.md'), `# Spec: Page Editor\n`)
    writeFileSync(join(dir, 'knit', 'specs', 'template.md'), `# Spec: [Feature Name]\n`)

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['knit/specs/page-editor.md', 'knit/specs/template.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(
      expect.objectContaining({
        title: 'Spec: Page Editor',
      }),
    )
    expect(sigs.some((s) => s.title.includes('[Feature Name]'))).toBe(false)
  })

  it('normalizes absolute rg --files output back to repo-relative paths', async () => {
    mkdirSync(join(dir, 'knit'), { recursive: true })
    const abs = join(dir, 'knit', 'PROJECT_STATE.md')
    writeFileSync(
      abs,
      `# Knit\n\n## Next Up\n- [ ] Add integration tests\n`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: abs,
        code: 0,
      })),
    })

    expect(sigs.some((s) => s.title === 'Add integration tests')).toBe(true)
  })

  it('attaches domain hints for nested subprojects and ignores obvious placeholder bullets later in hypothesis', async () => {
    mkdirSync(join(dir, 'looma', 'docs'), { recursive: true })
    mkdirSync(join(dir, 'knit', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'looma', 'docs', 'editor-bugs.md'),
      `# Editor Bugs\n\n## Open defects\n- [ ] Fix selection drift\n- [ ] (none)\n`,
    )
    writeFileSync(join(dir, 'knit', 'docs', 'feature-roadmap.md'), `# Knit roadmap\n`)

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['looma/docs/editor-bugs.md', 'knit/docs/feature-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.find((s) => s.title === 'Fix selection drift')?.domainHint).toBe('looma')
    expect(sigs.some((s) => s.title === '(none)')).toBe(true)
  })

  it('defaults to no domain hint when the workspace looks like a single project', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'feature-roadmap.md'),
      `# Feature Roadmap\n\n## Next Up\n- [ ] Add import review\n`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/feature-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.find((s) => s.title === 'Add import review')?.domainHint).toBeUndefined()
  })

  it('does not treat arbitrary guide checklists as backlog tasks by default', async () => {
    mkdirSync(join(dir, 'knit', 'supabase'), { recursive: true })
    writeFileSync(
      join(dir, 'knit', 'supabase', 'MIGRATION_GUIDE.md'),
      `# Migration Guide\n\n- [ ] All CREATE statements use IF NOT EXISTS\n`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['knit/supabase/MIGRATION_GUIDE.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual([])
  })

  it('does not promote roadmap section headings into task signals without checklist content', async () => {
    mkdirSync(join(dir, 'knit', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'knit', 'docs', 'looma-migration-inventory.md'),
      `# Inventory\n\n## Stage 1: V1 Release Hardening\n\nNarrative only.\n`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['knit/docs/looma-migration-inventory.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.filter((signal) => signal.kind === 'open_work' || signal.kind === 'milestone')).toEqual([])
  })

  it('keeps current roadmap deliverables as context and future roadmap deliverables as deferred release work', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Stage 1: Fixture And Evaluation Harness

Deliverables:

- fixture directory shape for at least one small story fixture
- typed fixture and expected-record contracts

## Stage 2: Mastra Agent Prototype

Deliverables:

- Mastra workflow for the prototype iteration loop
- specialist editor agent calls for the first review lanes

## Current Next Milestone

The next milestone is Stage 1: Fixture And Evaluation Harness.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/implementation-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'fixture directory shape for at least one small story fixture',
        scopeHint: 'current',
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'typed fixture and expected-record contracts',
        scopeHint: 'current',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Mastra workflow for the prototype iteration loop',
        scopeHint: 'later',
        releaseId: 'stage-2-mastra-agent-prototype',
        releaseLabel: 'Stage 2: Mastra Agent Prototype',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'specialist editor agent calls for the first review lanes',
        scopeHint: 'later',
        releaseId: 'stage-2-mastra-agent-prototype',
        releaseLabel: 'Stage 2: Mastra Agent Prototype',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'fixture directory shape for at least one small story fixture',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'typed fixture and expected-record contracts',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'fixture directory shape for at least one small story fixture',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'typed fixture and expected-record contracts',
      }),
    ]))
  })

  it('marks obvious future-section planning bullets as later scope', async () => {
    writeFileSync(
      join(dir, 'PROJECT_STATE.md'),
      `# Project State

## Next Up

### V1 polish + hardening
- [ ] Add smoke coverage.

### V2 priorities (post V1 launch)
- Inline comments
- Connections / backlinks graph
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['PROJECT_STATE.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Add smoke coverage.',
    }))
    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Inline comments',
      scopeHint: 'later',
    }))
    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Connections / backlinks graph',
      scopeHint: 'later',
    }))
  })

  it('uses the first numbered stage as current when a release plan has no explicit current milestone', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'release-plan.md'),
      `# Release Plan

## Stage 1: Release Hardening

Scope:

- Fill the most important unit and E2E gaps.

Done gate:

- \`pnpm test\`: pass

## Stage 2: Primitive Convergence

Scope:

- Finish remaining high-use primitive replacement.

Done gate:

- Replacement-wave items are complete or deferred.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/release-plan.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'Fill the most important unit and E2E gaps.',
        scopeHint: 'current',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Finish remaining high-use primitive replacement.',
        scopeHint: 'later',
        releaseId: 'stage-2-primitive-convergence',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'pnpm test: pass',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Replacement-wave items are complete or deferred.',
      }),
    ]))
  })

  it('does not treat every nested project Stage 1 as current in a multi-project workspace', async () => {
    mkdirSync(join(dir, 'knit/docs'), { recursive: true })
    mkdirSync(join(dir, 'looma/docs'), { recursive: true })
    writeFileSync(
      join(dir, 'knit/docs/release-plan.md'),
      `# Knit Release Plan

## Stage 1: V1 Release Hardening

Scope:

- Fill unit and E2E gaps.
`,
    )
    writeFileSync(
      join(dir, 'looma/docs/milestones.md'),
      `# Looma Milestones

## Stage 1: Finish Knit Primitive Replacement Wave

Scope:

- Finish remaining primitive replacement.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'knit/docs/release-plan.md',
          'looma/docs/milestones.md',
        ].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'context',
      title: 'Fill unit and E2E gaps.',
      scopeHint: 'current',
      releaseId: 'stage-1-v1-release-hardening',
      domainHint: 'knit',
    }))
    expect(sigs).toContainEqual(expect.objectContaining({
      title: 'Finish remaining primitive replacement.',
      scopeHint: 'later',
      domainHint: 'looma',
    }))
    expect(sigs).not.toContainEqual(expect.objectContaining({
      title: 'Finish remaining primitive replacement.',
      releaseId: 'stage-1-finish-knit-primitive-replacement-wave',
    }))
  })

  it('keeps fresh nested roadmap work current when no primary release scope is defined', async () => {
    mkdirSync(join(dir, 'knit/docs'), { recursive: true })
    mkdirSync(join(dir, 'looma/docs'), { recursive: true })
    writeFileSync(
      join(dir, 'knit/docs/feature-roadmap.md'),
      `# Feature Roadmap

- [ ] Auth callback redirect
- [ ] Collections parity
`,
    )
    writeFileSync(
      join(dir, 'looma/docs/component-roadmap.md'),
      `# Component Roadmap

- [ ] Listbox
- [ ] Combobox
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'knit/docs/feature-roadmap.md',
          'looma/docs/component-roadmap.md',
        ].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Auth callback redirect',
        domainHint: 'knit',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Listbox',
        domainHint: 'looma',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        scopeHint: 'later',
      }),
    ]))
  })

  it('attaches explicitly named release scope to current and later planning work without making later work current', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'release-plan.md'),
      `# Release Plan

## Release: Headless MVP

### Current Focus

- Build fixture-driven author voice shaping
- Generate synopsis to outline records

### Later

- Add browser drafting workspace
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/release-plan.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Build fixture-driven author voice shaping',
        scopeHint: 'current',
        releaseId: 'headless-mvp',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Generate synopsis to outline records',
        scopeHint: 'current',
        releaseId: 'headless-mvp',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Add browser drafting workspace',
        scopeHint: 'later',
        releaseId: 'headless-mvp',
      }),
    ]))
  })

  it('preserves explicit arbitrary release labels from planning headings', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'release-plan.md'),
      `# Release Plan

## Release: 2.0 alpha

### Current Focus

- Prove package migration dry run
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/release-plan.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Prove package migration dry run',
      scopeHint: 'current',
      releaseId: '2-0-alpha',
      releaseLabel: '2.0 alpha',
    }))
  })

  it('treats the current numbered stage as the release scope when no explicit release heading exists', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'release-plan.md'),
      `# Release Plan

## Stage 1: V1 Release Hardening

Scope:

- Fill the most important unit and E2E gaps.

## Stage 2: Primitive Convergence

Scope:

- Finish remaining high-use primitive replacement.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/release-plan.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'context',
      title: 'Fill the most important unit and E2E gaps.',
      scopeHint: 'current',
      releaseId: 'stage-1-v1-release-hardening',
      releaseLabel: 'Stage 1: V1 Release Hardening',
    }))
    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Finish remaining high-use primitive replacement.',
      scopeHint: 'later',
      releaseId: 'stage-2-primitive-convergence',
      releaseLabel: 'Stage 2: Primitive Convergence',
    }))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Finish remaining high-use primitive replacement.',
        releaseId: 'stage-1-v1-release-hardening',
      }),
    ]))
  })

  it('marks deferred checklist items as later even when they appear in status history', async () => {
    writeFileSync(
      join(dir, 'PROJECT_STATE.md'),
      `# Project State

## Done

### Version History
- [x] Version list UI
- [ ] Version diff view (deferred)
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['PROJECT_STATE.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toContainEqual(expect.objectContaining({
      kind: 'open_work',
      title: 'Version diff view (deferred)',
      scopeHint: 'later',
    }))
  })

  it('does not duplicate current-stage deliverables as open work when the roadmap already names explicit current milestone starter tasks', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Stage 1: Fixture And Evaluation Harness

Deliverables:

- fixture directory shape for at least one small story fixture
- typed fixture and expected-record contracts

## Stage 2: Mastra Agent Prototype

Deliverables:

- Mastra workflow for the prototype iteration loop
- specialist editor agent calls for the first review lanes

## Current Next Milestone

The next milestone is Stage 1: Fixture And Evaluation Harness.

1. Define fixture, expected-record, prototype-run, and evaluation schemas.
2. Add the first tiny fiction fixture and human-authored expected records.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/implementation-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Add the first tiny fiction fixture and human-authored expected records.',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'fixture directory shape for at least one small story fixture',
        role: 'capability',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'typed fixture and expected-record contracts',
        role: 'capability',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'Mastra workflow for the prototype iteration loop',
        scopeHint: 'later',
        releaseId: 'stage-2-mastra-agent-prototype',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'specialist editor agent calls for the first review lanes',
        scopeHint: 'later',
        releaseId: 'stage-2-mastra-agent-prototype',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'fixture directory shape for at least one small story fixture',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'typed fixture and expected-record contracts',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'fixture directory shape for at least one small story fixture',
      }),
      expect.objectContaining({
        kind: 'open_work',
        title: 'typed fixture and expected-record contracts',
      }),
    ]))
  })

  it('extracts architecture core-loop steps as capability-map context instead of runnable backlog work', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'architecture-notes.md'),
      `# Architecture Notes

## Core Loop

1. Author defines book intent, genre/form expectations, themes, and voice.
2. Author builds a house: premise, world, cast, outline, chapter goals, review standards.
3. Author drafts or imports chapters.
4. The coordinator chooses reviewers based on current phase.
5. Reviewers produce evidence-backed findings.
6. The coordinator summarizes conflicts and turns them into author decisions.
7. Accepted decisions update the story bible, outline, and manuscript tasks.

## System Records
| Record | Purpose |
| --- | --- |
| Book brief | author voice, premise, genre, themes, constraints |
| Outline | acts, chapters, scene goals, thread movement |
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/architecture-notes.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        role: 'brief_input',
        structure: 'record',
        title: 'Book brief',
        evidence: expect.stringContaining('author voice, premise, genre, themes, constraints'),
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        structure: 'record',
        title: 'Outline',
        evidence: expect.stringContaining('acts, chapters, scene goals, thread movement'),
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'brief_input',
        title: 'Author builds a house: premise, world, cast, outline, chapter goals, review standards.',
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'Author drafts or imports chapters.',
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'The coordinator chooses reviewers based on current phase.',
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'Accepted decisions update the story bible, outline, and manuscript tasks.',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Author defines book intent, genre/form expectations, themes, and voice.',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Author defines book intent, genre/form expectations, themes, and voice.',
      }),
    ]))
    expect(sigs.find(signal => signal.title === 'Book brief')?.evidence).toContain(
      'Also described as: Author defines book intent, genre/form expectations, themes, and voice.',
    )
  })

  it('extracts explicit spec-to-task coverage links from decomposition inventory tables', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    mkdirSync(join(dir, 'docs', 'specs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'specs', 'author-voice-system.md'), '# Author Voice System\n')
    writeFileSync(join(dir, 'docs', 'specs', 'world-and-object-continuity.md'), '# World And Object Continuity\n')
    writeFileSync(
      join(dir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      `# Remaining Spec Decomposition Inventory

## 1. Already-Decomposed Specs (Reference)

| Spec File | Matching Task(s) | Notes |
|-----------|------------------|-------|
| \`author-voice-system.md\` | \`author-voice-loop-mvp\` | done |
| \`world-and-object-continuity.md\` | \`coherence-reviewer-mvp\` | done |
| \`index.md\` | *(table of contents)* | ignore |
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'docs/harness/remaining-spec-decomposition-inventory.md',
          'docs/specs/author-voice-system.md',
          'docs/specs/world-and-object-continuity.md',
        ].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        role: 'reference',
        title: 'Spec coverage: Author Voice System',
        linkedTaskHints: ['author-voice-loop-mvp'],
        references: [
          join(dir, 'docs', 'specs', 'author-voice-system.md'),
          join(dir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
        ],
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'reference',
        title: 'Spec coverage: World And Object Continuity',
        linkedTaskHints: ['coherence-reviewer-mvp'],
        references: [
          join(dir, 'docs', 'specs', 'world-and-object-continuity.md'),
          join(dir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
        ],
      }),
    ]))
    expect(sigs.some((signal) => signal.title === 'Spec coverage: Index')).toBe(false)
  })

  it('keeps later decomposition inventory recommendations as capability context instead of runnable work', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    mkdirSync(join(dir, 'docs', 'specs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'specs', 'dialogue-and-character-voice.md'), '# Dialogue And Character Voice\n')
    writeFileSync(
      join(dir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      `# Remaining Spec Decomposition Inventory

## 2.2 \`dialogue-and-character-voice.md\`

- **Covers:** Dialogue review behavior.
- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane
- **Recommended domain:** coherence
- **Stage alignment:** Stage 2 (Agent Coordination)
`,
    )
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Stage 1: Fixture And Evaluation Harness

## Current Next Milestone

The next milestone is Stage 1: Fixture And Evaluation Harness.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'docs/harness/implementation-roadmap.md',
          'docs/harness/remaining-spec-decomposition-inventory.md',
          'docs/specs/dialogue-and-character-voice.md',
        ].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'Spec: Dialogue And Character Voice',
        scopeHint: 'later',
        references: [
          join(dir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
          join(dir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
        ],
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Implement dialogue-and-character-voice reviewer lane',
      }),
    ]))
  })

  it('does not fold indented completion annotations into current milestone task titles', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Current Next Milestone

The next milestone is Stage 1: Fixture And Evaluation Harness.

1. Use the first run to narrow the MVP story-memory schema.
   ✓ Completed — see [mvp-story-memory-schema-narrowing.md](../specs/mvp-story-memory-schema-narrowing.md)
     and the updated [schema-contract-roadmap.md](../specs/schema-contract-roadmap.md#mvp-contract-boundary).
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/implementation-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Use the first run to narrow the MVP story-memory schema.',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: expect.stringContaining('Completed'),
      }),
    ]))
  })

  it('keeps proof and status bullets as context instead of current milestone work', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Current Next Milestone

The next milestone is Stage 1: Headless Drafting And Evaluation MVP.

1. Generate a CLI-first story synopsis, outline, character and voice records, and one chapter draft from the selected model.
- Implementation: src/cli/generate.ts (CLI tool for story generation)
- Fixture: fixtures/story-output.json (expected output)
- Verification: scripts/prove-generation.mjs (proof script)
- STATUS: COMPLETE - CLI tool implemented with synopsis, outline, character and voice records, world-state, chapter draft, and review findings
- Files created:
  - src/cli/generate.ts
- Acceptance criteria:
  - AC1: met
- Review lanes: author_voice, character_voice, world_state, spatial_geographic
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/implementation-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.filter((signal) => signal.kind === 'open_work').map((signal) => signal.title)).toEqual([
      'Generate a CLI-first story synopsis, outline, character and voice records, and one chapter draft from the selected model.',
    ])
    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        title: 'Implementation: src/cli/generate.ts (CLI tool for story generation)',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Fixture: fixtures/story-output.json (expected output)',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Verification: scripts/prove-generation.mjs (proof script)',
      }),
      expect.objectContaining({
        kind: 'context',
        title: expect.stringContaining('STATUS: COMPLETE'),
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Files created',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Acceptance criteria',
      }),
      expect.objectContaining({
        kind: 'context',
        title: expect.stringContaining('Review lanes'),
      }),
    ]))
  })

  it('keeps full wrapped stage goals and every stage heading from one roadmap file', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Stage 0: Spec Baseline

Goal: make the product architecture explicit enough that implementation agents
can work without re-litigating the core design.

## Stage 1: Fixture And Evaluation Harness

Goal: build a no-UI test harness that proves the story-memory and packet
contracts against small fiction fixtures before any product UI is designed.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/implementation-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        title: 'Stage 0: Spec Baseline',
        role: 'capability',
        scopeHint: 'current',
        evidence: expect.stringContaining('make the product architecture explicit enough that implementation agents can work without re-litigating the core design.'),
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Stage 1: Fixture And Evaluation Harness',
        role: 'capability',
        scopeHint: 'current',
        evidence: expect.stringContaining('build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.'),
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Stage 0: Spec Baseline',
        scopeHint: 'current',
      }),
      expect.objectContaining({
        kind: 'context',
        title: 'Stage 1: Fixture And Evaluation Harness',
        scopeHint: 'current',
      }),
    ]))
  })

  it('keeps earlier stage deliverables as capability context instead of pretending they are completed milestones', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Stage 0: Spec Baseline

Status: current foundation.

Deliverables:

- story-memory schema draft
- agent packet and compaction spec

## Stage 1: Fixture And Evaluation Harness

Deliverables:

- fixture directory shape for at least one small story fixture

## Current Next Milestone

The next milestone is Stage 1: Fixture And Evaluation Harness.

1. Define fixture, expected-record, prototype-run, and evaluation schemas.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['docs/harness/implementation-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'story-memory schema draft',
      }),
      expect.objectContaining({
        kind: 'context',
        role: 'capability',
        title: 'agent packet and compaction spec',
      }),
    ]))
    expect(sigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'milestone',
        title: 'story-memory schema draft',
      }),
      expect.objectContaining({
        kind: 'milestone',
        title: 'agent packet and compaction spec',
      }),
    ]))
  })

  it('keeps nested explanatory bullets under a task candidate out of open work', async () => {
    mkdirSync(join(dir, 'looma', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'looma', 'docs', 'editor-roadmap.md'),
      `# Editor Roadmap

## P0

- **Block menu / block side menu**
  - Strong recurrence in BlockNote and Plate
  - Looma should ship a reusable gutter-side block affordance
- Add missing high-frequency form primitives:
  - \`Listbox\`
  - \`Combobox\`
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['looma/docs/editor-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.filter((s) => s.kind === 'open_work').map((s) => s.title)).toEqual([
      'Block menu / block side menu',
      'Listbox',
      'Combobox',
    ])
    expect(sigs.filter((s) => s.kind === 'context').map((s) => s.title)).toEqual([
      'Strong recurrence in BlockNote and Plate',
      'Looma should ship a reusable gutter-side block affordance',
    ])
  })

  it('treats PROJECT_STATE current focus bullets as context rather than backlog', async () => {
    mkdirSync(join(dir, 'looma'), { recursive: true })
    writeFileSync(
      join(dir, 'looma', 'PROJECT_STATE.md'),
      `# PROJECT_STATE

## Current Focus

- Keep planning docs aligned with actual shipped surface.
- Continue the migration wave where primitives are viable.

## Next Up

1. Finish the primitive replacement wave.
2. Close the open shared editor defects.
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['looma/PROJECT_STATE.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.filter((s) => s.kind === 'open_work').map((s) => s.title)).toEqual([
      'Finish the primitive replacement wave.',
      'Close the open shared editor defects.',
    ])
    expect(sigs.filter((s) => s.kind === 'context').map((s) => s.title)).toEqual([
      'Keep planning docs aligned with actual shipped surface.',
      'Continue the migration wave where primitives are viable.',
    ])
  })

  it('keeps action-oriented grouping bullets as one task unless the children name missing primitives', async () => {
    mkdirSync(join(dir, 'looma', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'looma', 'docs', 'component-roadmap.md'),
      `# Component Roadmap

## P1

- Document field strategy more explicitly:
  - \`ui-input\` is the control primitive
  - \`ui-form-field\` is the composed label/help/error wrapper
- Add missing high-frequency form primitives:
  - \`Listbox\`
  - \`Combobox\`
- Deepen existing high-frequency primitives:
  - \`Button\`: loading and icon-placement guidance
  - \`Input\`: clearable, size, and adornment strategy
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: ['looma/docs/component-roadmap.md'].join('\n'),
        code: 0,
      })),
    })

    expect(sigs.filter((s) => s.kind === 'open_work').map((s) => s.title)).toEqual([
      'Document field strategy more explicitly',
      'Listbox',
      'Combobox',
      'Button: loading and icon-placement guidance',
      'Input: clearable, size, and adornment strategy',
    ])
    expect(sigs.filter((s) => s.kind === 'context').map((s) => s.title)).toEqual([
      'ui-input is the control primitive',
      'ui-form-field is the composed label/help/error wrapper',
    ])
  })

  it('falls back to filesystem walking when rg is unavailable', async () => {
    mkdirSync(join(dir, 'looma', 'docs'), { recursive: true })
    writeFileSync(
      join(dir, 'looma', 'docs', 'component-roadmap.md'),
      `# Component Roadmap

## P1

- [ ] Listbox
- [ ] Combobox
`,
    )

    const sigs = await planningDocsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: '', stderr: 'rg: command not found', code: 127 })),
    })

    expect(sigs.filter((s) => s.kind === 'open_work').map((s) => s.title)).toEqual([
      'Listbox',
      'Combobox',
    ])
  })
})

describe('todoCommentsSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] when rg exits 127 (not installed)', async () => {
    const sigs = await todoCommentsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: '', stderr: 'not found', code: 127 })),
    })
    expect(sigs).toEqual([])
  })

  it('returns [] when rg finds nothing (exit 1)', async () => {
    const sigs = await todoCommentsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: '', code: 1 })),
    })
    expect(sigs).toEqual([])
  })

  it('parses rg output into open_work signals', async () => {
    const sigs = await todoCommentsSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'src/api.ts:42:// TODO: rate limit this endpoint',
          'src/db.ts:10:# FIXME: switch to prepared statements',
        ].join('\n'),
        code: 0,
      })),
    })
    expect(sigs).toHaveLength(2)
    expect(sigs[0]).toMatchObject({
      source: 'todo-comments',
      kind: 'open_work',
      confidence: 'low',
    })
    expect(sigs[0]!.references).toEqual(['src/api.ts:42'])
    expect(sigs[0]!.evidence).toContain('TODO')
    expect(sigs[1]!.references).toEqual(['src/db.ts:10'])
  })
})

describe('gitLogSource', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] when .git is not present', async () => {
    const sigs = await gitLogSource.detect({ projectPath: dir })
    expect(sigs).toEqual([])
  })

  it('reads immediate child git repos when the workspace root is not a git repo', async () => {
    mkdirSync(join(dir, 'knit', '.git'), { recursive: true })
    mkdirSync(join(dir, 'looma', '.git'), { recursive: true })
    const SEP = '\x1f'
    const sigs = await gitLogSource.detect({
      projectPath: dir,
      exec: fakeExec((_cmd, _args, opts) => {
        const cwd = String(opts?.cwd ?? '')
        const subject = cwd.endsWith('/knit')
          ? 'Ship Knit v1'
          : 'feat: add Looma toolbar primitive'
        return {
          stdout: [['abc12345', subject, 'Alice', '2026-04-20'].join(SEP)].join('\n'),
          code: 0,
        }
      }),
    })

    expect(sigs.map((s) => [s.domainHint, s.title])).toEqual([
      ['knit', 'Ship Knit v1'],
      ['looma', 'feat: add Looma toolbar primitive'],
    ])
    expect(sigs[0]!.references).toEqual(['knit:abc12345'])
    expect(sigs[1]!.evidence).toContain('looma: abc12345')
  })

  it('flags milestone-keyword commits as high-confidence milestones', async () => {
    mkdirSync(join(dir, '.git'))
    const SEP = '\x1f'
    const lines = [
      ['abc12345', 'Ship v0.1.0', 'Alice', '2026-04-20'].join(SEP),
      ['def67890', 'feat: add task detector', 'Bob', '2026-04-21'].join(SEP),
      ['000aaaaa', 'fix: typo in readme', 'Carol', '2026-04-22'].join(SEP),
      ['111bbbbb', 'Merge pull request #42 from feat/x', 'Dan', '2026-04-22'].join(SEP),
    ]
    const sigs = await gitLogSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: lines.join('\n'), code: 0 })),
    })
    expect(sigs.map((s) => s.title)).toEqual([
      'Ship v0.1.0',
      'feat: add task detector',
      'Merge pull request #42 from feat/x',
    ])
    expect(sigs[0]!.confidence).toBe('high')
    expect(sigs[1]!.confidence).toBe('medium')
    expect(sigs[2]!.confidence).toBe('medium')
    expect(sigs[0]!.references).toEqual(['abc12345'])
  })

  it('drops fix:/chore: commits entirely', async () => {
    mkdirSync(join(dir, '.git'))
    const SEP = '\x1f'
    const lines = [
      ['aaa', 'fix: broken build', 'Alice', '2026-04-20'].join(SEP),
      ['bbb', 'chore: bump deps', 'Bob', '2026-04-21'].join(SEP),
    ]
    const sigs = await gitLogSource.detect({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: lines.join('\n'), code: 0 })),
    })
    expect(sigs).toEqual([])
  })
})

describe('detectWorkspaceSignals (composition)', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty inventory for an empty workspace', async () => {
    const inv = await detectWorkspaceSignals({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: '', code: 1 })),
    })
    expect(inv.signals).toEqual([])
    expect(inv.ran).toEqual(BUILTIN_TASK_SOURCES.map((s) => s.id))
    expect(inv.failed).toEqual([])
  })

  it('aggregates signals across multiple sources and preserves source order', async () => {
    writeFileSync(join(dir, 'README.md'), `# Forge\n\nA task queue.\n`)
    writeFileSync(join(dir, 'TODO.md'), `- [ ] wire dashboard\n`)
    const inv = await detectWorkspaceSignals({
      projectPath: dir,
      exec: fakeExec(() => ({ stdout: '', code: 1 })),
    })
    expect(inv.signals.map((s) => s.source)).toEqual([
      'readme',
      'roadmap',
      'text-corpus',
      'text-corpus',
      'text-corpus',
    ])
    expect(inv.bySource['readme']!).toHaveLength(1)
    expect(inv.bySource['roadmap']!).toHaveLength(1)
    expect(inv.bySource['text-corpus']!).toHaveLength(3)
  })

  it('does not promote indented completion annotations into active work from any built-in source', async () => {
    mkdirSync(join(dir, 'docs', 'harness'), { recursive: true })
    mkdirSync(join(dir, 'docs', 'specs'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'harness', 'implementation-roadmap.md'),
      `# Implementation Roadmap

## Stage 1: Fixture And Evaluation Harness

## Current Next Milestone

The next milestone is Stage 1: Fixture And Evaluation Harness.

1. Use the first run to narrow the MVP story-memory schema.
   ✓ Completed — see [mvp-story-memory-schema-narrowing.md](../specs/mvp-story-memory-schema-narrowing.md)
     and the updated [schema-contract-roadmap.md](../specs/schema-contract-roadmap.md#mvp-contract-boundary).
`,
    )
    writeFileSync(join(dir, 'docs', 'specs', 'schema-contract-roadmap.md'), '# Schema Contract Roadmap\n')
    const inv = await detectWorkspaceSignals({
      projectPath: dir,
      exec: fakeExec(() => ({
        stdout: [
          'docs/harness/implementation-roadmap.md',
          'docs/specs/schema-contract-roadmap.md',
        ].join('\n'),
        code: 0,
      })),
    })

    expect(inv.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: 'Use the first run to narrow the MVP story-memory schema.',
      }),
    ]))
    expect(inv.signals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'open_work',
        title: expect.stringContaining('Completed'),
      }),
    ]))
  })

  it('does not abort the batch when one source throws', async () => {
    const boom: TaskSource = {
      id: 'boom',
      label: 'Boom',
      async detect() {
        throw new Error('kaboom')
      },
    }
    writeFileSync(join(dir, 'README.md'), `# X\n\ndesc\n`)
    const inv = await detectWorkspaceSignals({
      projectPath: dir,
      extraSources: [boom],
      exec: fakeExec(() => ({ stdout: '', code: 1 })),
    })
    expect(inv.failed).toEqual([{ id: 'boom', error: 'kaboom' }])
    expect(inv.bySource['readme']!).toHaveLength(1)
  })

  it("restricts to a subset of sources via `only`", async () => {
    writeFileSync(join(dir, 'README.md'), `# X\n\ndesc\n`)
    writeFileSync(join(dir, 'TODO.md'), `- open item\n`)
    const inv = await detectWorkspaceSignals({
      projectPath: dir,
      only: ['readme'],
      exec: fakeExec(() => ({ stdout: '', code: 1 })),
    })
    expect(inv.ran).toEqual(['readme'])
    expect(inv.signals.every((s) => s.source === 'readme')).toBe(true)
  })

  it('honors extraSources (e.g. a future Jira MCP adapter)', async () => {
    const fakeJira: TaskSource = {
      id: 'jira-mcp',
      label: 'Jira',
      async detect() {
        return [
          {
            source: 'jira-mcp',
            kind: 'open_work',
            title: 'PROJ-42: flaky test',
            evidence: 'PROJ-42',
            confidence: 'high',
          } satisfies WorkspaceSignal,
        ]
      },
    }
    const inv = await detectWorkspaceSignals({
      projectPath: dir,
      extraSources: [fakeJira],
      only: ['jira-mcp'],
      exec: fakeExec(() => ({ stdout: '', code: 1 })),
    })
    expect(inv.signals).toHaveLength(1)
    expect(inv.signals[0]!.source).toBe('jira-mcp')
  })
})
