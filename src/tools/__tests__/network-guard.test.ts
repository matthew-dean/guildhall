import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  NetworkGuardError,
  validateHttpUrl,
  ensurePublicHttpUrl,
  fetchPublicHttpResponse,
  isGlobal,
} from '../network-guard.js'

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
})
