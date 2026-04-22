/**
 * HTTP target validation helpers for outbound web tools (SSRF defense).
 *
 * Ported from
 *   openharness/src/openharness/utils/network_guard.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Uses Node `dns/promises.lookup` with `family: 0, all: true` instead of
 *     `socket.getaddrinfo` — same effect, TS-native.
 *   - IP-literal detection uses `node:net.isIP` (4/6/0) rather than the
 *     Python `ipaddress` parser. Private/loopback/link-local/etc. checks are
 *     expressed explicitly in `isGlobal` because Node has no `is_global`.
 *   - Redirect handling uses the built-in `fetch` + `redirect: 'manual'`
 *     rather than httpx's `follow_redirects=False`; the loop shape matches.
 */

import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

export class NetworkGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkGuardError'
  }
}

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }

export function validateHttpUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new NetworkGuardError(`invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new NetworkGuardError('only http and https URLs are allowed')
  }
  if (!parsed.hostname) {
    throw new NetworkGuardError('URL must include a host')
  }
  if (parsed.username || parsed.password) {
    throw new NetworkGuardError('URLs with embedded credentials are not allowed')
  }
  return parsed
}

export async function ensurePublicHttpUrl(url: string): Promise<URL> {
  const parsed = validateHttpUrl(url)
  const host = stripIpBrackets(parsed.hostname)
  const addresses = await resolveHostAddresses(host)
  if (addresses.length === 0) {
    throw new NetworkGuardError(`target host did not resolve: ${host}`)
  }
  const blocked = Array.from(new Set(addresses.filter((a) => !isGlobal(a)))).sort()
  if (blocked.length > 0) {
    const shown = blocked.slice(0, 3).join(', ')
    const suffix = blocked.length > 3 ? ', ...' : ''
    throw new NetworkGuardError(`target resolves to non-public address(es): ${shown}${suffix}`)
  }
  return parsed
}

export interface FetchOptions {
  headers?: Record<string, string>
  params?: Record<string, string>
  timeoutMs?: number
  maxRedirects?: number
}

export interface FetchResult {
  url: string
  status: number
  headers: Headers
  text: string
}

export async function fetchPublicHttpResponse(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const { headers, params, timeoutMs = 15_000, maxRedirects = 5 } = opts
  let currentUrl = applyParams(url, params)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await ensurePublicHttpUrl(currentUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        ...(headers ? { headers } : {}),
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      throw err instanceof NetworkGuardError
        ? err
        : new NetworkGuardError(`fetch failed: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
    const location = response.headers.get('location')
    const isRedirect = response.status >= 300 && response.status < 400 && location
    if (!isRedirect) {
      const text = await response.text()
      return {
        url: currentUrl,
        status: response.status,
        headers: response.headers,
        text,
      }
    }
    if (hop >= maxRedirects) {
      throw new NetworkGuardError(`too many redirects (>${maxRedirects})`)
    }
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw new NetworkGuardError('request failed before receiving a response')
}

function applyParams(url: string, params: Record<string, string> | undefined): string {
  if (!params) return url
  const u = new URL(url)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

function stripIpBrackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1)
  return host
}

async function resolveHostAddresses(host: string): Promise<string[]> {
  if (isIP(host) !== 0) return [host]
  try {
    const results = await dns.lookup(host, { all: true, family: 0 })
    return results.map((r) => r.address)
  } catch (err) {
    throw new NetworkGuardError(`could not resolve target host ${host}: ${(err as Error).message}`)
  }
}

/**
 * Replacement for Python ipaddress.is_global.
 *
 * Rejects: loopback, link-local, multicast, broadcast, unspecified, private,
 * IPv6 unique-local, IPv6 mapped/compat, reserved ranges. Everything else is
 * treated as global.
 */
export function isGlobal(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isGlobalV4(ip)
  if (version === 6) return isGlobalV6(ip)
  return false
}

function isGlobalV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false
  const a = parts[0] as number
  const b = parts[1] as number
  const c = parts[2] as number
  if (a === 0) return false // 0.0.0.0/8 (unspecified / "this")
  if (a === 10) return false // 10.0.0.0/8 private
  if (a === 127) return false // loopback
  if (a === 169 && b === 254) return false // link-local
  if (a === 172 && b >= 16 && b <= 31) return false // private
  if (a === 192 && b === 0 && c === 0) return false // 192.0.0.0/24 reserved
  if (a === 192 && b === 0 && c === 2) return false // TEST-NET-1
  if (a === 192 && b === 168) return false // private
  if (a === 198 && (b === 18 || b === 19)) return false // benchmark
  if (a === 198 && b === 51 && c === 100) return false // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false // TEST-NET-3
  if (a >= 224 && a <= 239) return false // multicast
  if (a >= 240) return false // reserved / broadcast
  return true
}

function isGlobalV6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return false
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return false // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false // unique-local fc00::/7
  if (lower.startsWith('ff')) return false // multicast
  if (lower.startsWith('::ffff:')) return false // mapped v4
  if (lower.startsWith('64:ff9b::')) return false // well-known NAT64
  if (lower.startsWith('2001:db8')) return false // docs
  return true
}
