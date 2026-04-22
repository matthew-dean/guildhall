import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { editFile, editFileTool } from '../files.js'

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
