import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8')
}

describe('Guildhall glass design system', () => {
  it('defines shared glass and emitted-light tokens for the app shell', () => {
    const tokens = read('src/web/tokens.css')

    expect(tokens).toContain('--glass-bg:')
    expect(tokens).toContain('--glass-blur:')
    expect(tokens).toContain('--glass-reflect-violet:')
    expect(tokens).toContain('--light-emitted-accent:')
    expect(tokens).toContain('--signal-warn-strong:')
  })

  it('uses a dependable system UI font stack instead of rounded fonts with bad ellipsis metrics', () => {
    const tokens = read('src/web/tokens.css')

    expect(tokens).toContain('font-family: system-ui')
    expect(tokens).not.toContain('ui-rounded')
    expect(tokens).not.toContain('Arial Rounded')
  })

  it('applies glass surfaces through shared components instead of one-off dashboard CSS', () => {
    const card = read('src/web/lib/Card.svelte')
    const button = read('src/web/lib/Button.svelte')
    const projectsHome = read('src/web/surfaces/ProjectsHome.svelte')

    expect(card).toContain('var(--glass-bg)')
    expect(card).toContain('backdrop-filter: var(--glass-blur)')
    expect(button).toContain('var(--light-emitted-accent)')
    expect(projectsHome).toContain('var(--glass-bg)')
  })

  it('renders toasts with the shared glass background and blur tokens', () => {
    const toastHost = read('src/web/lib/ToastHost.svelte')

    expect(toastHost).toContain('var(--glass-bg')
    expect(toastHost).toContain('backdrop-filter: var(--glass-blur)')
    expect(toastHost).toContain('-webkit-backdrop-filter: var(--glass-blur)')
    expect(toastHost).toContain("import { fly } from 'svelte/transition'")
    expect(toastHost).toContain('transition:fly={{ y: 8, opacity: 0.04, duration: 170 }}')
    expect(toastHost).toContain('border: 1px solid var(--glass-border)')
    expect(toastHost).toContain('color-mix(in srgb, var(--ok) 24%, var(--glass-border))')
    expect(toastHost).toContain('color-mix(in srgb, var(--danger) 30%, var(--glass-border))')
    expect(toastHost).toContain('color-mix(in srgb, var(--accent) 24%, var(--glass-border))')
    expect(toastHost).not.toContain('--glass-filter')
    expect(toastHost).not.toContain('var(--glass-border-strong)')
  })

  it('documents the same glass language in VitePress and the UI design-token reference', () => {
    const docsCss = read('docs/.vitepress/theme/custom.css')
    const designTokens = read('docs/web-ui/design-tokens.md')

    expect(docsCss).toContain('--gh-glass-bg')
    expect(docsCss).toContain('backdrop-filter: var(--gh-glass-blur)')
    expect(designTokens).toContain('Guild glass')
    expect(designTokens).toContain('Strong controls emit light')
  })
})
