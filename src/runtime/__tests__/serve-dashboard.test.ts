import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'

import { buildServeApp, dashboardHtml } from '../serve.js'

describe('dashboardHtml', () => {
  it('renders the SvelteKit app shell or a clear build fallback', () => {
    const html = dashboardHtml()

    expect(html).toContain('<title>Guildhall</title>')
    if (existsSync('dist/web/index.html')) {
      expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />')
      expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/genfavicon-32.png" />')
      expect(html).toContain('<link rel="icon" type="image/png" sizes="16x16" href="/icons/genfavicon-16.png" />')
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
      expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />')
      expect(html).toContain('/_app/')
      expect(html).toContain('Guildhall requires JavaScript.')
    } else {
      expect(html).toContain('web app not built: index.html')
    }
  })
})

describe('dashboard static assets', () => {
  it('serves PNG icons without text encoding corruption', async () => {
    const { app } = buildServeApp({})

    const res = await app.fetch(new Request('http://localhost/icons/genfavicon-64.png'))

    if (existsSync('dist/web/icons/genfavicon-64.png')) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/png')
      expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    } else {
      expect(res.status).toBe(404)
      expect(await res.text()).toContain('web asset not built: icons/genfavicon-64.png')
    }
  })

  it('serves SvelteKit chunk assets from the static web output', async () => {
    const { app } = buildServeApp({})

    const missing = await app.fetch(new Request('http://localhost/_app/immutable/missing.js'))

    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('web asset not built: _app/immutable/missing.js')
  })
})
