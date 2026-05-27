import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const buttonSource = readFileSync(resolve(here, '../Button.svelte'), 'utf8')
const chipSource = readFileSync(resolve(here, '../Chip.svelte'), 'utf8')

describe('Button visual contract', () => {
  it('keeps small and medium buttons on the same font-size token', () => {
    const smallBlock = buttonSource.match(/\.s-sm\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(smallBlock).not.toMatch(/font-size\s*:/)
  })
})

describe('Chip visual contract', () => {
  it('documents automation-state chip tones separately from action buttons and human decisions', () => {
    expect(chipSource).toContain('agent: passive Guildhall automation state')
    expect(chipSource).toContain('agent-attention: Guildhall-owned state that needs a handoff')
    expect(chipSource).toContain('warn: human decision or risk state')
  })

  it('uses translucent white text on automation chips so their fills participate in the color', () => {
    const agentBlock = chipSource.match(/\.tone-agent\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const agentAttentionBlock = chipSource.match(/\.tone-agent-attention\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(agentBlock).toContain('color: var(--chip-status-on-dark-fg)')
    expect(agentAttentionBlock).toContain('color: var(--chip-status-on-dark-fg)')
  })
})
