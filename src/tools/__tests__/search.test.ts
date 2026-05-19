import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { globTool, grepTool, runGlob, runGrep, __resetRgCacheForTests } from '../search.js'

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

async function writeFakeRg(root: string, source: string): Promise<string> {
  const bin = path.join(root, 'fake-rg.mjs')
  await fs.writeFile(bin, `#!/usr/bin/env node\n${source}`, 'utf-8')
  await fs.chmod(bin, 0o755)
  return bin
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

  it('resolves cwd-relative and home-relative roots before walking', async () => {
    const previousHome = process.env.HOME
    process.env.HOME = root
    try {
      await writeTree(root, {
        'workspace/src/a.ts': '',
        'workspace/src/a.test.ts': '',
        'workspace/docs/readme.md': '',
      })

      const relative = await runGlob(root, { root: 'workspace', pattern: 'src/*.ts' })
      expect(relative.matches).toEqual(['src/a.test.ts', 'src/a.ts'])

      const home = await runGlob('/tmp', { root: '~/workspace', pattern: 'docs/*.md' })
      expect(home.matches).toEqual(['docs/readme.md'])
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('tool output reports no matches and truncation in the same shape agents read', async () => {
    await writeTree(root, {
      'a.ts': '',
      'b.ts': '',
      'c.ts': '',
    })

    const none = await globTool.execute({ pattern: '*.md' }, { cwd: root, metadata: {} })
    expect(none.is_error).toBe(false)
    expect(none.output).toBe('(no matches)')
    expect(none.metadata?.matches).toEqual([])

    const truncated = await globTool.execute(
      { pattern: '*.ts', limit: 2 },
      { cwd: root, metadata: {} },
    )
    expect(truncated.output).toContain('[truncated at 2 matches]')
    expect(truncated.metadata?.truncated).toBe(true)
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

  it('returns no matches for invalid regular expressions instead of throwing', async () => {
    await writeTree(root, { 'a.ts': 'target\n' })
    const { matches, timedOut, truncated } = await runGrep(root, { pattern: '[' })
    expect(matches).toEqual([])
    expect(timedOut).toBe(false)
    expect(truncated).toBe(false)
  })

  it('returns no matches for missing roots instead of throwing', async () => {
    const { matches } = await runGrep(root, {
      pattern: 'target',
      root: path.join(root, 'does-not-exist'),
    })
    expect(matches).toEqual([])
  })

  it('tool output includes truncation metadata and human-readable no-match text', async () => {
    await writeTree(root, {
      'a.ts': 'target 1\ntarget 2\ntarget 3\n',
    })

    const none = await grepTool.execute(
      { pattern: 'missing' },
      { cwd: root, metadata: {} },
    )
    expect(none.is_error).toBe(false)
    expect(none.output).toBe('(no matches)')
    expect(none.metadata?.matches).toEqual([])

    const truncated = await grepTool.execute(
      { pattern: 'target', limit: 2 },
      { cwd: root, metadata: {} },
    )
    expect(truncated.output).toContain('[truncated at 2 matches]')
    expect(truncated.metadata?.truncated).toBe(true)
  })
})

describe('runGlob and runGrep (rg subprocess path)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
    __resetRgCacheForTests()
  })

  it('passes hidden git repo glob searches through rg and sorts the subprocess output', async () => {
    const logPath = path.join(root, 'rg-call.json')
    await fs.mkdir(path.join(root, '.git'))
    const fakeRg = await writeFakeRg(
      root,
      `
        import fs from 'node:fs'
        fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }))
        process.stdout.write('src/z.ts\\nsrc/a.ts\\n')
      `,
    )
    __resetRgCacheForTests(fakeRg)

    const result = await runGlob('/tmp', { root, pattern: 'src/**/*.ts' })

    expect(result).toEqual({ matches: ['src/a.ts', 'src/z.ts'], truncated: false })
    const call = JSON.parse(await fs.readFile(logPath, 'utf-8')) as { cwd: string; argv: string[] }
    expect(call.cwd).toBe(await fs.realpath(root))
    expect(call.argv).toEqual(['--files', '--hidden', '--glob', 'src/**/*.ts', '.'])
  })

  it('passes grep options through rg and reports truncated output from the subprocess limit', async () => {
    const logPath = path.join(root, 'rg-grep-call.json')
    await writeTree(root, { 'src/a.ts': 'Alpha\nalpha\n', 'src/a.md': 'alpha\n' })
    const fakeRg = await writeFakeRg(
      root,
      `
        import fs from 'node:fs'
        fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }))
        process.stdout.write('src/a.ts:1:Alpha\\nsrc/a.ts:2:alpha\\nsrc/a.ts:3:another\\n')
      `,
    )
    __resetRgCacheForTests(fakeRg)

    const result = await runGrep(root, {
      pattern: 'alpha',
      caseSensitive: false,
      fileGlob: '*.ts',
      limit: 2,
    })

    expect(result.matches).toEqual(['src/a.ts:1:Alpha', 'src/a.ts:2:alpha'])
    expect(result.truncated).toBe(true)
    const call = JSON.parse(await fs.readFile(logPath, 'utf-8')) as { cwd: string; argv: string[] }
    expect(call.cwd).toBe(await fs.realpath(root))
    expect(call.argv).toEqual([
      '--no-heading',
      '--line-number',
      '--color',
      'never',
      '-i',
      '--glob',
      '*.ts',
      '--',
      'alpha',
      '.',
    ])
  })

  it('formats rg single-file grep output with the searched file path', async () => {
    const file = path.join(root, 'only.ts')
    await fs.writeFile(file, 'target\n', 'utf-8')
    const fakeRg = await writeFakeRg(
      root,
      `
        process.stdout.write('1:target\\n')
      `,
    )
    __resetRgCacheForTests(fakeRg)

    const result = await runGrep(root, { root: file, pattern: 'target' })

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toContain('only.ts:1:target')
    expect(result.timedOut).toBe(false)
  })

  it('marks grep tool results as errors when rg times out', async () => {
    await writeTree(root, { 'src/a.ts': 'target\n' })
    const fakeRg = await writeFakeRg(
      root,
      `
        setInterval(() => {}, 1000)
      `,
    )
    __resetRgCacheForTests(fakeRg)

    const result = await grepTool.execute(
      { pattern: 'target', timeoutSeconds: 1 },
      { cwd: root, metadata: {} },
    )

    expect(result.is_error).toBe(true)
    expect(result.output).toContain('[grep timed out after 1 seconds]')
    expect(result.metadata?.timedOut).toBe(true)
  })
})
