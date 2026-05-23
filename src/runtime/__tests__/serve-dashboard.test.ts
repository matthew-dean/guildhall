import { describe, expect, it } from 'vitest'

import { dashboardHtml } from '../serve.js'

describe('dashboardHtml', () => {
  it('renders the Svelte app shell with cache-busted assets and noscript fallback', () => {
    const html = dashboardHtml()

    expect(html).toContain('<title>Guildhall</title>')
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />')
    expect(html).toContain('<div id="svelte-root"></div>')
    expect(html).toMatch(/href="\/web\/app\.css\?v=[^"]+"/)
    expect(html).toMatch(/src="\/web\/app\.js\?v=[^"]+"/)
    expect(html).toContain('Guildhall requires JavaScript.')
  })
})
