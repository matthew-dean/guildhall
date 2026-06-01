import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'guildhall-design-audit-'))
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function run(root: string): string {
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), 'scripts/design-token-audit.mjs'), root], {
      cwd: root,
      stdio: 'pipe',
    })
    return ''
  } catch (err) {
    return String((err as { stderr?: Buffer }).stderr ?? err)
  }
}

describe('design token audit', () => {
  it('rejects raw typography, legacy app token families, and local component lookalikes', () => {
    const root = repo({
      'src/web/surfaces/Bad.svelte': `
        <style>
          .title { font-size: clamp(1.2rem, 2vw, 2rem); font-weight: 700; letter-spacing: -0.02em; }
          .panel { padding: 14px; border-radius: 10px; gap: 7px; }
          .copy { font-size: var(--fs-2); }
        </style>
      `,
      'src/web/lib/NoticeBand.svelte': '<style>.notice { font-size: var(--gh-type-size-body); }</style>',
    })

    const stderr = run(root)

    expect(stderr).toContain('raw font-size')
    expect(stderr).toContain('raw font-weight')
    expect(stderr).toContain('negative letter-spacing')
    expect(stderr).toContain('raw padding')
    expect(stderr).toContain('raw gap')
    expect(stderr).toContain('raw radius')
    expect(stderr).toContain('legacy token family')
    expect(stderr).toContain('duplicate primitive')
  })

  it('permits canonical package tokens and package primitives', () => {
    const root = repo({
      'packages/ui/src/styles.css': ':root { --gh-type-size-body: 13.5px; --gh-type-weight-strong: 600; }',
      'packages/ui/src/components/FrameCard.svelte': `
        <style>
          .frame { padding: var(--gh-layout-frame-padding-default); border-radius: var(--gh-radius-3); }
          .title { font-size: var(--gh-type-size-panel-title); font-weight: var(--gh-type-weight-strong); }
        </style>
      `,
      'src/web/surfaces/Good.svelte': `
        <style>
          .copy { font-size: var(--gh-type-size-body); font-weight: var(--gh-type-weight-body); }
        </style>
      `,
    })

    expect(run(root)).toBe('')
  })
})
