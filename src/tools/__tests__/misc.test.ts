import { describe, it, expect } from 'vitest'

import { ToolRegistry, defineTool } from '@guildhall/engine'
import { z } from 'zod'

import { sleepTool, toolSearchTool, briefTool, runBrief } from '../misc.js'

describe('sleepTool.execute', () => {
  it('sleeps for roughly the requested duration', async () => {
    const started = Date.now()
    const result = await sleepTool.execute(
      { seconds: 0.05 },
      { cwd: '/tmp', metadata: {} },
    )
    const elapsed = Date.now() - started
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Slept for 0.05 seconds')
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('accepts zero seconds (no-op)', async () => {
    const result = await sleepTool.execute(
      { seconds: 0 },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(false)
  })
})

describe('toolSearchTool.execute', () => {
  function buildRegistry(): ToolRegistry {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: 'Read a file from disk.',
        inputSchema: z.object({}),
        execute: async () => ({ output: '', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'write-file',
        description: 'Write bytes to a file on disk.',
        inputSchema: z.object({}),
        execute: async () => ({ output: '', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'grep',
        description: 'Pattern search via ripgrep.',
        inputSchema: z.object({}),
        execute: async () => ({ output: '', is_error: false }),
      }),
    )
    return registry
  }

  it('matches by name substring', async () => {
    const result = await toolSearchTool.execute(
      { query: 'file' },
      { cwd: '/tmp', metadata: { tool_registry: buildRegistry() } },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('read-file')
    expect(result.output).toContain('write-file')
    expect(result.output).not.toContain('grep')
  })

  it('matches by description substring, case-insensitive', async () => {
    const result = await toolSearchTool.execute(
      { query: 'RIPGREP' },
      { cwd: '/tmp', metadata: { tool_registry: buildRegistry() } },
    )
    expect(result.output).toContain('grep')
    expect(result.output).not.toContain('read-file')
  })

  it('returns "(no matches)" when nothing matches', async () => {
    const result = await toolSearchTool.execute(
      { query: 'definitely-not-a-tool' },
      { cwd: '/tmp', metadata: { tool_registry: buildRegistry() } },
    )
    expect(result.output).toBe('(no matches)')
  })

  it('reports an error when no registry is threaded', async () => {
    const result = await toolSearchTool.execute(
      { query: 'x' },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('not available')
  })
})

describe('runBrief / briefTool', () => {
  it('passes text through unchanged when under the limit', () => {
    expect(runBrief('hello', 100)).toBe('hello')
  })

  it('trims leading and trailing whitespace before measuring', () => {
    expect(runBrief('   hi   ', 100)).toBe('hi')
  })

  it('truncates long text with ellipsis', () => {
    const out = runBrief('x'.repeat(500), 100)
    expect(out).toHaveLength(103)
    expect(out.endsWith('...')).toBe(true)
  })

  it('rstrips before appending the ellipsis', () => {
    const input = 'word ' + 'abc '.repeat(100)
    const out = runBrief(input, 20)
    expect(out).not.toContain(' ...')
    expect(out.endsWith('...')).toBe(true)
  })

  it('briefTool.execute returns the shortened text', async () => {
    const result = await briefTool.execute(
      { text: 'hello world', maxChars: 100 },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toBe('hello world')
  })
})
