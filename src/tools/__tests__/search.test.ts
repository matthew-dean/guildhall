import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runGlob, runGrep, __resetRgCacheForTests } from '../search.js'

async function mkSandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-search-test-'))
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf-8')
  }
}

describe('runGlob (Node fallback path)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkSandbox()
    // Pin the fallback path so the tests are deterministic regardless of
    // whether rg happens to be installed on the dev machine.
    __resetRgCacheForTests(null)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
    __resetRgCacheForTests()
  })

  it('finds files matching a **/*.ext pattern', async () => {
    await writeTree(root, {
      'src/a.ts': '',
      'src/nested/b.ts': '',
      'src/c.js': '',
      'docs/d.md': '',
    })
    const { matches } = await runGlob(root, { pattern: 'src/**/*.ts' })
    expect(matches).toEqual(['src/a.ts', 'src/nested/b.ts'])
  })

  it('skips node_modules / .git / dist', async () => {
    await writeTree(root, {
      'a.ts': '',
      'node_modules/ignored.ts': '',
      '.git/HEAD': '',
      'dist/built.ts': '',
    })
    const { matches } = await runGlob(root, { pattern: '**/*.ts' })
    expect(matches).toEqual(['a.ts'])
  })

  it('honors limit', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 10; i++) files[`f${i}.ts`] = ''
    await writeTree(root, files)
    const { matches, truncated } = await runGlob(root, {
      pattern: '*.ts',
      limit: 3,
    })
    expect(matches.length).toBe(3)
    expect(truncated).toBe(true)
  })

  it('returns an empty list when nothing matches', async () => {
    await writeTree(root, { 'a.ts': '' })
    const { matches, truncated } = await runGlob(root, { pattern: '**/*.py' })
    expect(matches).toEqual([])
    expect(truncated).toBe(false)
  })

  it('supports brace alternation in the pattern', async () => {
    await writeTree(root, {
      'a.ts': '',
      'a.tsx': '',
      'a.js': '',
    })
    const { matches } = await runGlob(root, { pattern: '*.{ts,tsx}' })
    expect(matches.sort()).toEqual(['a.ts', 'a.tsx'])
  })
})

describe('runGrep (Node fallback path)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkSandbox()
    __resetRgCacheForTests(null)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
    __resetRgCacheForTests()
  })

  it('returns file:line:match rows for matches', async () => {
    await writeTree(root, {
      'a.ts': 'import { foo } from "bar"\nconst x = foo()\n',
      'b.ts': 'nothing here\n',
    })
    const { matches } = await runGrep(root, { pattern: 'foo' })
    expect(matches.length).toBe(2)
    expect(matches[0]).toContain('a.ts:1')
    expect(matches[1]).toContain('a.ts:2')
  })

  it('is case-sensitive by default and case-insensitive when flagged', async () => {
    await writeTree(root, { 'a.ts': 'Foo\nFOO\nfoo\n' })
    const sensitive = await runGrep(root, { pattern: 'foo' })
    expect(sensitive.matches.length).toBe(1)
    const insensitive = await runGrep(root, { pattern: 'foo', caseSensitive: false })
    expect(insensitive.matches.length).toBe(3)
  })

  it('restricts to files matching fileGlob', async () => {
    await writeTree(root, {
      'a.ts': 'target\n',
      'a.md': 'target\n',
    })
    const { matches } = await runGrep(root, { pattern: 'target', fileGlob: '*.ts' })
    expect(matches.length).toBe(1)
    expect(matches[0]).toContain('a.ts')
  })

  it('skips binary files (bytes containing NUL)', async () => {
    const bin = path.join(root, 'blob.bin')
    await fs.writeFile(bin, Buffer.from([0x00, 0x66, 0x6f, 0x6f, 0x00]))
    await writeTree(root, { 'a.ts': 'foo\n' })
    const { matches } = await runGrep(root, { pattern: 'foo' })
    expect(matches.length).toBe(1)
    expect(matches[0]).toContain('a.ts')
  })

  it('honors limit', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `hit-${i}`).join('\n')
    await writeTree(root, { 'big.txt': lines })
    const { matches, truncated } = await runGrep(root, { pattern: 'hit', limit: 3 })
    expect(matches.length).toBe(3)
    expect(truncated).toBe(true)
  })

  it('returns empty when nothing matches', async () => {
    await writeTree(root, { 'a.ts': 'nothing here\n' })
    const { matches } = await runGrep(root, { pattern: 'absent' })
    expect(matches).toEqual([])
  })

  it('searches a single file when root is a file path', async () => {
    const file = path.join(root, 'only.ts')
    await fs.writeFile(file, 'alpha\nbeta\ngamma\n', 'utf-8')
    const { matches } = await runGrep(root, { pattern: 'beta', root: file })
    expect(matches.length).toBe(1)
    expect(matches[0]).toContain(':2:')
  })
})
