import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'guildhall-ui-primitive-scan-'))
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function run(root: string): string {
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), 'scripts/ui-primitive-scan.mjs'), root], {
      cwd: root,
      stdio: 'pipe',
    })
    return ''
  } catch (err) {
    return String((err as { stderr?: Buffer }).stderr ?? err)
  }
}

describe('ui primitive scan', () => {
  it('rejects direct imports of legacy local Card and NoticeBand primitives', () => {
    const root = repo({
      'src/web/surfaces/Foo.svelte': `
        <script>
          import Card from '../lib/Card.svelte'
          import NoticeBand from '$lib/NoticeBand.svelte'
        </script>
      `,
      'src/web/lib/Bar.svelte': `
        <script>
          import Card from './Card.svelte'
        </script>
      `,
      'src/web/lib/ui-compat/Card.svelte': `
        <script>
          import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
        </script>
      `,
    })

    const stderr = run(root)

    expect(stderr).toContain('src/web/surfaces/Foo.svelte')
    expect(stderr).toContain('src/web/lib/Bar.svelte')
    expect(stderr).not.toContain('src/web/lib/ui-compat/Card.svelte')
  })

  it('permits package primitives and ui-compat wrappers', () => {
    const root = repo({
      'src/web/surfaces/Good.svelte': `
        <script>
          import Card from '../lib/ui-compat/Card.svelte'
          import NoticeBand from '../../../packages/ui/src/components/NoticeBand.svelte'
        </script>
      `,
      'src/web/lib/ui-compat/NoticeBand.svelte': `
        <script>
          import PackageNoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
        </script>
      `,
    })

    expect(run(root)).toBe('')
  })

  it('rejects local bespoke chip and status-pill styling outside shared chip primitives', () => {
    const root = repo({
      'src/web/surfaces/Foo.svelte': `
        <span class="status-pill">Open</span>
        <style>
          .status-pill { border-radius: 999px; }
        </style>
      `,
      'src/web/surfaces/Bar.svelte': `
        <style>
          .chip-danger { color: red; }
        </style>
      `,
      'src/web/surfaces/Baz.svelte': `
        <style>
          .task-chip { border: 1px solid red; }
        </style>
      `,
    })

    const stderr = run(root)

    expect(stderr).toContain('src/web/surfaces/Foo.svelte')
    expect(stderr).toContain('src/web/surfaces/Bar.svelte')
    expect(stderr).toContain('src/web/surfaces/Baz.svelte')
  })

  it('permits shared chip primitives, chip containers, and named legacy chip debt only', () => {
    const root = repo({
      'src/web/lib/Chip.svelte': `
        <style>
          .chip-count { border-radius: 999px; }
        </style>
      `,
      'src/web/lib/IdentifierChip.svelte': `
        <style>
          .identifier-chip-danger .identifier-dot { background: red; }
        </style>
      `,
      'src/web/surfaces/project/ThreadTab.svelte': `
        <style>
          .thread-index-row-chips { display: flex; }
          .task-chip { border: 1px solid var(--border); }
          .task-chip-text { overflow: hidden; }
        </style>
      `,
      'src/web/surfaces/Good.svelte': `
        <style>
          .top-chips { display: flex; }
        </style>
      `,
    })

    expect(run(root)).toBe('')
  })
})
