#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  RUNTIME_IMAGE_REPOSITORY,
  RUNTIME_IMAGE_TAG_SUFFIX,
  buildReleaseManifest,
} from './release-manifest.mjs'

const ACCEPT_MANIFESTS = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_POLL_MS = 15 * 1000

export function runtimeImageRef(version) {
  return `${RUNTIME_IMAGE_REPOSITORY}:${version}-${RUNTIME_IMAGE_TAG_SUFFIX}`
}

export async function resolveRuntimeImageDigestFromRegistry({
  version,
  wait = false,
  timeoutMs = Number(process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  pollMs = Number(process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST_POLL_MS ?? DEFAULT_POLL_MS),
  log = () => {},
} = {}) {
  if (!version) throw new Error('version is required')

  const deadline = Date.now() + timeoutMs
  do {
    const fixtureDigest = readFixtureDigest()
    const digest = fixtureDigest === undefined ? await readRegistryDigest(version) : fixtureDigest
    if (digest) return digest
    if (!wait) return null
    log(`runtime image ${runtimeImageRef(version)} is not available yet`)
    await sleep(Math.max(250, pollMs))
  } while (Date.now() <= deadline)

  return null
}

function readFixtureDigest() {
  const fixture = process.env.GUILDHALL_RUNTIME_IMAGE_DIGEST_FIXTURE_FILE
  if (!fixture) return undefined
  if (!existsSync(fixture)) return null
  const lines = readFileSync(fixture, 'utf-8').split(/\r?\n/).filter(Boolean)
  const [next, ...rest] = lines
  writeFileSync(fixture, rest.length > 0 ? `${rest.join('\n')}\n` : '')
  if (!next || next === 'missing') return null
  return next
}

async function readRegistryDigest(version) {
  const repository = RUNTIME_IMAGE_REPOSITORY.replace(/^ghcr\.io\//, '')
  const tag = `${version}-${RUNTIME_IMAGE_TAG_SUFFIX}`
  const baseUrl = (process.env.GUILDHALL_RUNTIME_REGISTRY_BASE_URL ?? 'https://ghcr.io').replace(/\/$/, '')
  const manifestUrl = `${baseUrl}/v2/${repository}/manifests/${tag}`
  const anonymous = await fetchDigest(manifestUrl)
  if (anonymous.status === 200) return anonymous.digest
  if (anonymous.status !== 401) return null

  const challenge = parseBearerChallenge(anonymous.wwwAuthenticate)
  if (!challenge?.realm) return null
  const tokenUrl = new URL(challenge.realm)
  tokenUrl.searchParams.set('service', challenge.service ?? 'ghcr.io')
  tokenUrl.searchParams.set('scope', challenge.scope ?? `repository:${repository}:pull`)
  const tokenHeaders = {}
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (ghToken) tokenHeaders.authorization = `Bearer ${ghToken}`

  const tokenResponse = await fetch(tokenUrl, { headers: tokenHeaders })
  if (!tokenResponse.ok) return null
  const tokenPayload = await tokenResponse.json().catch(() => null)
  const token = tokenPayload?.token || tokenPayload?.access_token
  if (!token) return null

  const authenticated = await fetchDigest(manifestUrl, {
    authorization: `Bearer ${token}`,
  })
  return authenticated.status === 200 ? authenticated.digest : null
}

async function fetchDigest(url, extraHeaders = {}) {
  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      accept: ACCEPT_MANIFESTS,
      ...extraHeaders,
    },
  })
  return {
    status: response.status,
    digest: response.headers.get('docker-content-digest'),
    wwwAuthenticate: response.headers.get('www-authenticate'),
  }
}

function parseBearerChallenge(header) {
  if (!header || !/^Bearer\s+/i.test(header)) return null
  const values = {}
  const params = header.replace(/^Bearer\s+/i, '')
  for (const part of params.matchAll(/([a-zA-Z_][\w-]*)="([^"]*)"/g)) {
    values[part[1]] = part[2]
  }
  return values
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/resolve-runtime-image-digest.mjs <version> [--wait]')
    process.exit(0)
  }
  const version = args.find(arg => !arg.startsWith('--'))
    ?? JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version
  const releaseManifest = buildReleaseManifest({ guildhallVersion: version })
  const required = isRuntimeRequiredRelease(version)
  if (!required) process.exit(0)

  const digest = await resolveRuntimeImageDigestFromRegistry({
    version: releaseManifest.guildhallVersion,
    wait: args.includes('--wait'),
    log: message => console.error(`[guildhall runtime] ${message}`),
  })
  if (!digest) {
    console.error(`[guildhall runtime] Could not resolve ${runtimeImageRef(version)} digest from GHCR.`)
    process.exit(1)
  }
  console.log(digest)
}

function isRuntimeRequiredRelease(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 0 || minor >= 9
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
