import { describe, it, expect } from 'vitest'
import { classifyDiffScope } from '../diff-scope.js'

describe('classifyDiffScope', () => {
  it('empty list → doc_only (nothing changed, nothing to gate)', () => {
    expect(classifyDiffScope([])).toBe('doc_only')
  })

  it('pure .md → doc_only', () => {
    expect(classifyDiffScope(['README.md', 'docs/setup.md'])).toBe('doc_only')
  })

  it('docs/ directory files → doc_only', () => {
    expect(classifyDiffScope(['docs/api.html', 'docs/img/screenshot.png'])).toBe('doc_only')
  })

  it('LICENSE / CHANGELOG / README count as docs', () => {
    expect(classifyDiffScope(['LICENSE', 'CHANGELOG', 'README'])).toBe('doc_only')
  })

  it('only package.json → config_only', () => {
    expect(classifyDiffScope(['package.json'])).toBe('config_only')
  })

  it('mixed config files → config_only', () => {
    expect(classifyDiffScope(['package.json', 'tsconfig.json', '.editorconfig', 'pnpm-workspace.yaml'])).toBe('config_only')
  })

  it('mixed .md + .ts → code', () => {
    expect(classifyDiffScope(['README.md', 'src/foo.ts'])).toBe('code')
  })

  it('mixed config + code → code', () => {
    expect(classifyDiffScope(['package.json', 'src/foo.ts'])).toBe('code')
  })

  it('pure code → code', () => {
    expect(classifyDiffScope(['src/a.ts', 'src/b.tsx'])).toBe('code')
  })

  it('mixed doc + config → config_only (stricter of the two lightweight scopes)', () => {
    expect(classifyDiffScope(['README.md', 'package.json'])).toBe('config_only')
  })

  it('ignores blank entries', () => {
    expect(classifyDiffScope(['', '  ', 'README.md'])).toBe('doc_only')
  })
})
