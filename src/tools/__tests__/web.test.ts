import { describe, it, expect } from 'vitest'

import {
  webFetchTool,
  webSearchTool,
  htmlToText,
  parseSearchResults,
} from '../web.js'

describe('htmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    const out = htmlToText('<p>Hello   <b>world</b></p>')
    expect(out).toBe('Hello world')
  })

  it('drops script bodies', () => {
    const out = htmlToText('<p>visible</p><script>alert("hidden")</script>')
    expect(out).toContain('visible')
    expect(out).not.toContain('hidden')
    expect(out).not.toContain('alert')
  })

  it('drops style bodies', () => {
    const out = htmlToText('<p>visible</p><style>body { color: red }</style>')
    expect(out).toContain('visible')
    expect(out).not.toContain('color')
  })

  it('decodes common entities', () => {
    expect(htmlToText('&amp;&lt;&gt;&nbsp;&quot;&#39;')).toBe(`&<> "'`)
  })

  it('strips HTML comments', () => {
    const out = htmlToText('<p>keep</p><!-- drop me --><p>keep2</p>')
    expect(out).toContain('keep')
    expect(out).toContain('keep2')
    expect(out).not.toContain('drop me')
  })
})

describe('parseSearchResults', () => {
  it('extracts DuckDuckGo-style anchors with snippets', () => {
    const html = `
      <html><body>
        <a class="result__a" href="https://a.example.com/x">First <b>Title</b></a>
        <div class="result__snippet">About the first result</div>
        <a class="result__a" href="https://b.example.com/y">Second Title</a>
        <div class="result__snippet">About the second result</div>
      </body></html>
    `
    const results = parseSearchResults(html, 5)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'First Title',
      url: 'https://a.example.com/x',
      snippet: 'About the first result',
    })
    expect(results[1]?.title).toBe('Second Title')
  })

  it('decodes the uddg redirect wrapper', () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freal">Real</a>
      <div class="result__snippet">snip</div>
    `
    const results = parseSearchResults(html, 5)
    expect(results[0]?.url).toBe('https://example.com/real')
  })

  it('respects the limit', () => {
    const row = (i: number) =>
      `<a class="result__a" href="https://e${i}.example.com/">E${i}</a><div class="result__snippet">s${i}</div>`
    const html = `<body>${row(1)}${row(2)}${row(3)}${row(4)}</body>`
    const results = parseSearchResults(html, 2)
    expect(results).toHaveLength(2)
  })

  it('skips anchors without the result class', () => {
    const html = `
      <a class="nav" href="https://nav.example.com/">Nav</a>
      <a class="result__a" href="https://hit.example.com/">Hit</a>
      <div class="result__snippet">snip</div>
    `
    const results = parseSearchResults(html, 5)
    expect(results).toHaveLength(1)
    expect(results[0]?.url).toBe('https://hit.example.com/')
  })
})

describe('webFetchTool.execute', () => {
  it('rejects loopback targets', async () => {
    const result = await webFetchTool.execute(
      { url: 'http://127.0.0.1/' },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/non-public/)
  })

  it('rejects non-http schemes', async () => {
    const result = await webFetchTool.execute(
      { url: 'file:///etc/passwd' },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/only http and https/)
  })

  it('rejects URLs with embedded credentials', async () => {
    const result = await webFetchTool.execute(
      { url: 'https://user:pw@example.com/' },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/credentials/)
  })
})

describe('webSearchTool.execute', () => {
  it('rejects loopback search endpoints', async () => {
    const result = await webSearchTool.execute(
      { query: 'hello', searchUrl: 'http://127.0.0.1/' },
      { cwd: '/tmp', metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/non-public/)
  })
})
