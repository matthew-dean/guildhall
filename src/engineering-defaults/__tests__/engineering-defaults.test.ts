import { describe, expect, it } from 'vitest'

import { composeSystemPromptWithDefaults, loadEngineeringDefaults } from '../index.js'

describe('engineering defaults', () => {
  it('loads only known markdown topics in deterministic order', () => {
    const defaults = loadEngineeringDefaults()

    expect(defaults.length).toBeGreaterThan(0)
    expect(defaults.map(d => d.topic)).toEqual([...defaults.map(d => d.topic)].sort())
    expect(defaults.some(d => d.topic === 'testing')).toBe(true)
    expect(defaults.every(d => d.content.trim().length > 0)).toBe(true)
  })

  it('composes selected defaults into an agent prompt without trailing separators', () => {
    const prompt = composeSystemPromptWithDefaults('Base prompt\n', ['testing', 'security'])

    expect(prompt).toContain('Base prompt')
    expect(prompt).toContain('# Engineering defaults')
    expect(prompt).toContain('memory/engineering-defaults/*.md')
    expect(prompt).toContain('Coverage')
    expect(prompt).toContain('Security')
    expect(prompt.endsWith('---')).toBe(false)
  })

  it('returns the base prompt unchanged when no selected defaults exist', () => {
    expect(composeSystemPromptWithDefaults('Only this', [])).toBe('Only this')
  })
})
