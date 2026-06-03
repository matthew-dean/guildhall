import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const buttonSource = readFileSync(resolve(here, '../Button.svelte'), 'utf8')
const chipSource = readFileSync(resolve(here, '../Chip.svelte'), 'utf8')
const eyebrowSource = readFileSync(resolve(here, '../Eyebrow.svelte'), 'utf8')

describe('Button visual contract', () => {
  it('keeps small and medium buttons on the same font-size token', () => {
    const smallBlock = buttonSource.match(/\.s-sm\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(smallBlock).not.toMatch(/font-size\s*:/)
  })

  it('owns rounded icon-only button geometry in the shared button primitive', () => {
    const roundedIconBlock = buttonSource.match(/\.rounded\.icon-only\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const smallRoundedIconBlock = buttonSource.match(/\.s-sm\.rounded\.icon-only\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(buttonSource).toContain('rounded?: boolean')
    expect(buttonSource).toContain("${rounded ? 'rounded' : ''}")
    expect(roundedIconBlock).toContain('border-radius: var(--gh-radius-full)')
    expect(roundedIconBlock).toContain('padding: 0')
    expect(smallRoundedIconBlock).toContain('width: 32px')
    expect(smallRoundedIconBlock).toContain('height: 32px')
  })
})

describe('Chip visual contract', () => {
  it('keeps chip tones canonical and labels single-line', () => {
    const defaultBlock = chipSource.match(/\.chip\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(chipSource).not.toMatch(/agent-attention|tone-agent|chip-agent/)
    expect(defaultBlock).toContain('white-space: nowrap')
  })

  it('documents canonical chip tones separately from action buttons', () => {
    expect(chipSource).toContain('ok/running: healthy, available, queued, or Guildhall-owned continuation')
    expect(chipSource).toContain('warn: human decision or risk state')
    expect(chipSource).toContain('accent: current-step emphasis')
  })

  it('gives every chip a readable border instead of relying on fill contrast alone', () => {
    expect(chipSource).toContain('border: 1px solid var(--chip-neutral-border)')
    expect(chipSource).toContain('border-color: var(--chip-ok-border)')
    expect(chipSource).toContain('border-color: var(--chip-warn-border)')
    expect(chipSource).toContain('border-color: var(--chip-danger-border)')
    expect(chipSource).toContain('border-color: var(--chip-accent-border)')
  })

  it('owns compact chip sizing in the shared primitive instead of surface overrides', () => {
    const defaultBlock = chipSource.match(/\.chip\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const compactBlock = chipSource.match(/\.size-compact\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(chipSource).toContain("size?: 'default' | 'compact'")
    expect(defaultBlock).toContain('--chip-font-size: var(--gh-type-size-caption)')
    expect(defaultBlock).toContain('font-size: var(--chip-font-size)')
    expect(defaultBlock).toContain('line-height: var(--gh-type-line-height-control)')
    expect(defaultBlock).not.toMatch(/font-size:\s*var\(--fs-/)
    expect(compactBlock).toContain('padding: 0 var(--gh-space-1)')
    expect(compactBlock).toContain('font-size: var(--chip-font-size)')
    expect(compactBlock).not.toMatch(/\bpx\b/)
  })

  it('keeps chip labels on one line in the shared primitive', () => {
    const defaultBlock = chipSource.match(/\.chip\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(defaultBlock).toContain('display: inline-block')
    expect(defaultBlock).toContain('white-space: nowrap')
  })
})

describe('Eyebrow visual contract', () => {
  it('owns uppercase subheading typography as a shared primitive', () => {
    const baseBlock = eyebrowSource.match(/\.eyebrow\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(eyebrowSource).toContain("type Tone = 'neutral' | 'warn' | 'accent'")
    expect(baseBlock).toContain('font-size: var(--fs-0)')
    expect(baseBlock).toContain('font-weight: 800')
    expect(baseBlock).toContain('line-height: 1.25')
    expect(baseBlock).toContain('letter-spacing: 0.05em')
    expect(baseBlock).toContain('text-transform: uppercase')
  })

  it('uses the shared warn token for amber attention eyebrows', () => {
    const warnBlock = eyebrowSource.match(/\.tone-warn\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(warnBlock).toContain('color: var(--warn)')
  })
})
