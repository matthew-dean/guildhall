import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { editFile, editFileTool, readFile, readFileTool, writeFile, writeFileTool } from '../files.js'

async function mkSandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-files-test-'))
}

describe('editFile', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkSandbox()
    file = path.join(dir, 'target.txt')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('replaces a unique match once', async () => {
    await fs.writeFile(file, 'hello world', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: 'world',
      newString: 'there',
    })
    expect(result).toEqual({ success: true, replacements: 1 })
    expect(await fs.readFile(file, 'utf-8')).toBe('hello there')
  })

  it('refuses to edit when oldString is ambiguous without replaceAll', async () => {
    await fs.writeFile(file, 'foo bar foo bar foo', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: 'foo',
      newString: 'baz',
    })
    expect(result.success).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.error).toContain('3 times')
    // File must be untouched.
    expect(await fs.readFile(file, 'utf-8')).toBe('foo bar foo bar foo')
  })

  it('replaces every occurrence when replaceAll is true', async () => {
    await fs.writeFile(file, 'foo bar foo bar foo', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: 'foo',
      newString: 'baz',
      replaceAll: true,
    })
    expect(result).toEqual({ success: true, replacements: 3 })
    expect(await fs.readFile(file, 'utf-8')).toBe('baz bar baz bar baz')
  })

  it('errors when oldString is not found', async () => {
    await fs.writeFile(file, 'hello world', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: 'absent',
      newString: 'whatever',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(await fs.readFile(file, 'utf-8')).toBe('hello world')
  })

  it('errors when the file does not exist', async () => {
    const result = await editFile({
      filePath: path.join(dir, 'missing.txt'),
      oldString: 'x',
      newString: 'y',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('File not found')
  })

  it('errors when oldString is empty', async () => {
    await fs.writeFile(file, 'content', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: '',
      newString: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('empty')
    expect(await fs.readFile(file, 'utf-8')).toBe('content')
  })

  it('supports newString longer than oldString', async () => {
    await fs.writeFile(file, 'a', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: 'a',
      newString: 'alpha-beta-gamma',
    })
    expect(result.success).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('alpha-beta-gamma')
  })

  it('supports newString shorter than oldString (including empty → deletion)', async () => {
    await fs.writeFile(file, 'keep-remove-keep', 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: '-remove-',
      newString: '',
    })
    expect(result.success).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('keepkeep')
  })

  it('preserves multiline content around the edit', async () => {
    const original = 'line one\nTARGET\nline three\n'
    await fs.writeFile(file, original, 'utf-8')
    const result = await editFile({
      filePath: file,
      oldString: 'TARGET',
      newString: 'line two',
    })
    expect(result.success).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('line one\nline two\nline three\n')
  })
})

describe('editFileTool.execute', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkSandbox()
    file = path.join(dir, 'target.txt')
    await fs.writeFile(file, 'the quick brown fox', 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns structured output on success', async () => {
    const result = await editFileTool.execute(
      { filePath: file, oldString: 'quick', newString: 'slow' },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Edited')
    expect(result.output).toContain('1 replacement')
    expect(await fs.readFile(file, 'utf-8')).toBe('the slow brown fox')
  })

  it('returns is_error=true when the match is ambiguous', async () => {
    await fs.writeFile(file, 'x x x', 'utf-8')
    const result = await editFileTool.execute(
      { filePath: file, oldString: 'x', newString: 'y' },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('matches 3 times')
  })
})

describe('readFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns raw content for an existing text file', async () => {
    const file = path.join(dir, 'hello.txt')
    await fs.writeFile(file, 'alpha\nbeta\n', 'utf-8')
    const result = await readFile({ filePath: file })
    expect(result.exists).toBe(true)
    expect(result.content).toBe('alpha\nbeta\n')
    expect(result.isDirectory).toBeUndefined()
    expect(result.isBinary).toBeUndefined()
  })

  it('flags directories and binaries without reading their bytes as text', async () => {
    const subdir = path.join(dir, 'subdir')
    await fs.mkdir(subdir)
    const dirResult = await readFile({ filePath: subdir })
    expect(dirResult.exists).toBe(true)
    expect(dirResult.isDirectory).toBe(true)

    const bin = path.join(dir, 'bin.dat')
    await fs.writeFile(bin, Buffer.from([0x00, 0x01, 0x02]))
    const binResult = await readFile({ filePath: bin })
    expect(binResult.exists).toBe(true)
    expect(binResult.isBinary).toBe(true)
  })
})

describe('writeFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes to an absolute path and creates missing parents', async () => {
    const target = path.join(dir, 'a', 'b', 'c.txt')
    const result = await writeFile({ filePath: target, content: 'hello' })
    expect(result.success).toBe(true)
    expect(result.path).toBe(target)
    expect(await fs.readFile(target, 'utf-8')).toBe('hello')
  })

  it('resolves cwd-relative paths when cwd option is provided', async () => {
    const result = await writeFile(
      { filePath: 'nested/out.txt', content: 'x' },
      { cwd: dir },
    )
    expect(result.success).toBe(true)
    expect(result.path).toBe(path.join(dir, 'nested', 'out.txt'))
    expect(await fs.readFile(result.path, 'utf-8')).toBe('x')
  })

  it('refuses to create parents when createDirectories is false', async () => {
    const target = path.join(dir, 'missing', 'leaf.txt')
    const result = await writeFile({
      filePath: target,
      content: 'never written',
      createDirectories: false,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('writeFileTool.execute', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('resolves relative filePath against ctx.cwd', async () => {
    const result = await writeFileTool.execute(
      { filePath: 'rel.txt', content: 'ok' },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    const abs = path.join(dir, 'rel.txt')
    expect(result.output).toContain(abs)
    expect(await fs.readFile(abs, 'utf-8')).toBe('ok')
  })
})

describe('readFileTool.execute', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('renders cat -n style line numbers', async () => {
    const file = path.join(dir, 'a.txt')
    await fs.writeFile(file, 'first\nsecond\nthird', 'utf-8')
    const result = await readFileTool.execute(
      { filePath: file },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toBe('     1\tfirst\n     2\tsecond\n     3\tthird')
  })

  it('honors offset and limit', async () => {
    const file = path.join(dir, 'b.txt')
    await fs.writeFile(file, 'l1\nl2\nl3\nl4\nl5', 'utf-8')
    const result = await readFileTool.execute(
      { filePath: file, offset: 2, limit: 2 },
      { cwd: dir, metadata: {} },
    )
    // Line numbers are 1-based starting from `offset + 1`.
    expect(result.output).toBe('     3\tl3\n     4\tl4')
  })

  it('returns the empty-range notice when offset is past end of file', async () => {
    const file = path.join(dir, 'c.txt')
    await fs.writeFile(file, 'only', 'utf-8')
    const result = await readFileTool.execute(
      { filePath: file, offset: 5 },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('no content in selected range')
  })

  it('returns is_error=true when the path is a directory', async () => {
    const result = await readFileTool.execute(
      { filePath: dir },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('cannot read directory')
  })

  it('returns is_error=true for a binary file', async () => {
    const file = path.join(dir, 'bin.dat')
    await fs.writeFile(file, Buffer.from([0x00, 0xff]))
    const result = await readFileTool.execute(
      { filePath: file },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('binary file')
  })

  it('returns is_error=true when the file is missing', async () => {
    const result = await readFileTool.execute(
      { filePath: path.join(dir, 'nope.txt') },
      { cwd: dir, metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('file not found')
  })
})
