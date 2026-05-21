// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import Markdown from '../Markdown.svelte'

describe('Markdown', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders ordinary markdown formatting', () => {
    render(Markdown, { source: '**Done** with `code` and [docs](https://example.test)' })

    expect(screen.getByText('Done').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.test')
  })

  it('removes raw script HTML from agent markdown', () => {
    render(Markdown, { source: 'Before<script>window.__bad = true</script>After' })

    expect(screen.getByText(/Before/)).toHaveTextContent('BeforeAfter')
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('window.__bad')
  })

  it('unwraps unsupported raw HTML and strips unsafe links', () => {
    render(Markdown, {
      source: '<x-guildhall-card onclick="bad()">Keep text</x-guildhall-card> [bad](javascript:alert(1))',
    })

    expect(screen.getByText(/Keep text/)).toBeInTheDocument()
    expect(document.querySelector('x-guildhall-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument()
    expect(screen.getByText(/bad/)).toBeInTheDocument()
  })
})
