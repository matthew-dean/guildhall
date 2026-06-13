import { describe, expect, it } from 'vitest'

import { buildServeApp, dashboardHtml } from '../serve.js'

describe('dashboardHtml', () => {
  it('renders the Svelte app shell with cache-busted assets and noscript fallback', () => {
    const html = dashboardHtml()

    expect(html).toContain('<title>Guildhall</title>')
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />')
    expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/genfavicon-32.png" />')
    expect(html).toContain('<link rel="icon" type="image/png" sizes="16x16" href="/icons/genfavicon-16.png" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />')
    expect(html).toContain('<div id="svelte-root"></div>')
    expect(html).toMatch(/href="\/web\/app\.css\?v=[^"]+"/)
    expect(html).toMatch(/src="\/web\/app\.js\?v=[^"]+"/)
    expect(html).toContain('Guildhall requires JavaScript.')
  })
})

describe('dashboard static assets', () => {
  it('serves PNG icons without text encoding corruption', async () => {
    const { app } = buildServeApp({})

    const res = await app.fetch(new Request('http://localhost/icons/genfavicon-64.png'))
    const bytes = new Uint8Array(await res.arrayBuffer())

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
})
