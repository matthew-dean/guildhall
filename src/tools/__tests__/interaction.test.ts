import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  askUserQuestionTool,
  runTodoWrite,
  todoWriteTool,
} from '../interaction.js'

async function mkSandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-interaction-test-'))
}

describe('askUserQuestionTool', () => {
  it('returns the prompt callback response, trimmed', async () => {
    const result = await askUserQuestionTool.execute(
      { question: 'Pick one?' },
      {
        cwd: '/tmp',
        metadata: {
          ask_user_prompt: async (q: string) => `  echo:${q}  `,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toBe('echo:Pick one?')
  })

  it('reports unavailable when no prompt callback is threaded', async () => {
    const result = await askUserQuestionTool.execute(
      { question: 'Pick one?' },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('unavailable')
  })

  it("returns '(no response)' when the user answers empty", async () => {
    const result = await askUserQuestionTool.execute(
      { question: 'Pick one?' },
      {
        cwd: '/tmp',
        metadata: { ask_user_prompt: async () => '   ' },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toBe('(no response)')
  })
})

describe('runTodoWrite', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('creates TODO.md with a new unchecked item when the file is missing', async () => {
    const result = await runTodoWrite(cwd, { item: 'Write tests' })
    expect(result.action).toBe('added')
    const body = await fs.readFile(path.join(cwd, 'TODO.md'), 'utf-8')
    expect(body).toContain('# TODO')
    expect(body).toContain('- [ ] Write tests')
  })

  it('appends a second item without clobbering the first', async () => {
    await runTodoWrite(cwd, { item: 'First' })
    await runTodoWrite(cwd, { item: 'Second' })
    const body = await fs.readFile(path.join(cwd, 'TODO.md'), 'utf-8')
    expect(body).toContain('- [ ] First')
    expect(body).toContain('- [ ] Second')
  })

  it('flips an existing unchecked item to checked', async () => {
    await runTodoWrite(cwd, { item: 'Do the thing' })
    const result = await runTodoWrite(cwd, { item: 'Do the thing', checked: true })
    expect(result.action).toBe('checked')
    const body = await fs.readFile(path.join(cwd, 'TODO.md'), 'utf-8')
    expect(body).toContain('- [x] Do the thing')
    expect(body).not.toContain('- [ ] Do the thing')
  })

  it('is a no-op when the item already exists in the requested state', async () => {
    await runTodoWrite(cwd, { item: 'Already there' })
    const result = await runTodoWrite(cwd, { item: 'Already there' })
    expect(result.action).toBe('noop')
  })

  it('writes to a custom path when specified', async () => {
    const custom = 'docs/ROADMAP.md'
    await runTodoWrite(cwd, { item: 'Ship v1', path: custom })
    const body = await fs.readFile(path.join(cwd, custom), 'utf-8')
    expect(body).toContain('- [ ] Ship v1')
  })

  it('accepts an absolute path', async () => {
    const abs = path.join(cwd, 'list.md')
    const result = await runTodoWrite(cwd, { item: 'absolute ok', path: abs })
    expect(result.path).toBe(abs)
    const body = await fs.readFile(abs, 'utf-8')
    expect(body).toContain('- [ ] absolute ok')
  })
})

describe('todoWriteTool.execute', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkSandbox()
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('returns structured output on append', async () => {
    const result = await todoWriteTool.execute(
      { item: 'a' },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Appended')
  })

  it("reports 'No change needed' on a no-op", async () => {
    await todoWriteTool.execute({ item: 'x' }, { cwd, metadata: {} })
    const result = await todoWriteTool.execute(
      { item: 'x' },
      { cwd, metadata: {} },
    )
    expect(result.output).toContain('No change needed')
  })
})
