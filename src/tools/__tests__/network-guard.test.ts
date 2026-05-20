import { afterEach, describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import { promises as dns } from 'node:dns'
import type { AddressInfo } from 'node:net'

import {
  NetworkGuardError,
  validateHttpUrl,
  ensurePublicHttpUrl,
  fetchPublicHttpResponse,
  isGlobal,
} from '../network-guard.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateHttpUrl', () => {
  it('accepts well-formed http and https URLs', () => {
    expect(() => validateHttpUrl('https://example.com/')).not.toThrow()
    expect(() => validateHttpUrl('http://example.com/path?q=1')).not.toThrow()
  })

  it('rejects non-http schemes', () => {
    expect(() => validateHttpUrl('file:///etc/passwd')).toThrow(NetworkGuardError)
    expect(() => validateHttpUrl('ftp://example.com/')).toThrow(NetworkGuardError)
  })

  it('rejects URLs with embedded credentials', () => {
    expect(() => validateHttpUrl('https://user:pass@example.com/')).toThrow(
      /credentials/,
    )
  })

  it('rejects malformed URLs', () => {
    expect(() => validateHttpUrl('not a url')).toThrow(NetworkGuardError)
  })
})

describe('isGlobal', () => {
  it('marks loopback and private IPv4 as non-global', () => {
    expect(isGlobal('127.0.0.1')).toBe(false)
    expect(isGlobal('10.0.0.1')).toBe(false)
    expect(isGlobal('192.168.1.1')).toBe(false)
    expect(isGlobal('172.16.0.1')).toBe(false)
    expect(isGlobal('169.254.1.1')).toBe(false)
    expect(isGlobal('0.0.0.0')).toBe(false)
    expect(isGlobal('255.255.255.255')).toBe(false)
  })

  it('marks public IPv4 as global', () => {
    expect(isGlobal('8.8.8.8')).toBe(true)
    expect(isGlobal('1.1.1.1')).toBe(true)
    expect(isGlobal('93.184.216.34')).toBe(true) // example.com range
  })

  it('marks IPv6 loopback / link-local / ULA as non-global', () => {
    expect(isGlobal('::1')).toBe(false)
    expect(isGlobal('fe80::1')).toBe(false)
    expect(isGlobal('fc00::1')).toBe(false)
    expect(isGlobal('fd12:3456:789a::1')).toBe(false)
    expect(isGlobal('ff02::1')).toBe(false)
  })

  it('marks public IPv6 as global', () => {
    expect(isGlobal('2606:4700:4700::1111')).toBe(true) // 1.1.1.1 v6
  })

  it('returns false for non-IP strings', () => {
    expect(isGlobal('not-an-ip')).toBe(false)
  })
})

describe('ensurePublicHttpUrl', () => {
  it('rejects a URL that resolves to loopback', async () => {
    await expect(ensurePublicHttpUrl('http://127.0.0.1/')).rejects.toThrow(
      /non-public/,
    )
  })

  it('rejects localhost by name', async () => {
    await expect(ensurePublicHttpUrl('http://localhost/')).rejects.toThrow(
      /non-public/,
    )
  })

  it('rejects private IPv4 literal', async () => {
    await expect(ensurePublicHttpUrl('http://192.168.1.1/')).rejects.toThrow(
      /non-public/,
    )
  })

  it('rejects IPv6 loopback literal', async () => {
    await expect(ensurePublicHttpUrl('http://[::1]/')).rejects.toThrow(
      /non-public/,
    )
  })

  it('accepts hosts that resolve only to public addresses', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>)

    const parsed = await ensurePublicHttpUrl('https://example.com/docs')

    expect(parsed.hostname).toBe('example.com')
  })

  it('reports DNS resolution failures as guard errors', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'))

    await expect(ensurePublicHttpUrl('https://missing.example.test/')).rejects.toThrow(
      /could not resolve target host missing.example.test: ENOTFOUND/,
    )
  })
})

describe('fetchPublicHttpResponse (loopback bypass for test server)', () => {
  it('blocks loopback requests', async () => {
    // Spin up a server so there's *something* listening, but the guard
    // should refuse to talk to it because it resolves to 127.0.0.1.
    const server = http.createServer((_, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    try {
      await expect(
        fetchPublicHttpResponse(`http://127.0.0.1:${port}/`),
      ).rejects.toThrow(/non-public/)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('applies query params and returns successful public responses', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof dns.lookup>>)
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe('https://example.com/search?q=guildhall')
      expect(init?.headers).toEqual({ Accept: 'text/plain' })
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPublicHttpResponse('https://example.com/search', {
      params: { q: 'guildhall' },
      headers: { Accept: 'text/plain' },
    })

    expect(result).toMatchObject({
      url: 'https://example.com/search?q=guildhall',
      status: 200,
      text: 'ok',
    })
  })

  it('follows relative redirects and enforces the redirect limit', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof dns.lookup>>)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: '/final' } }))
        .mockResolvedValueOnce(new Response('done', { status: 200 })),
    )

    const result = await fetchPublicHttpResponse('https://example.com/start')
    expect(result.url).toBe('https://example.com/final')
    expect(result.text).toBe('done')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 302, headers: { location: '/again' } })),
    )
    await expect(fetchPublicHttpResponse('https://example.com/start', { maxRedirects: 0 })).rejects.toThrow(
      /too many redirects/,
    )
  })

  it('wraps transport failures in NetworkGuardError', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof dns.lookup>>)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket closed')
    }))

    await expect(fetchPublicHttpResponse('https://example.com/')).rejects.toThrow(
      /fetch failed: socket closed/,
    )
  })
})
