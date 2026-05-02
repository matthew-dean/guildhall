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
  ) => { stdout: string; stderr?: string; code?: number },
): Exec {
  return async (cmd, args) => {
    const res = handler(cmd, args)
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

    expect(sigs).toEqual([])
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
    expect(inv.signals.map((s) => s.source)).toEqual(['readme', 'roadmap'])
    expect(inv.bySource['readme']!).toHaveLength(1)
    expect(inv.bySource['roadmap']!).toHaveLength(1)
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
