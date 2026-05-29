import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = (process.env.GUILDHALL_SMOKE_URL ?? 'http://localhost:7777').replace(/\/$/, '')
const releaseManifestPath = resolve(process.cwd(), 'dist/release-manifest.json')

async function readJson(path) {
  const url = `${base}${path}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} did not return JSON. Restart the local service so the release-smoke endpoints match this checkout.`)
  }
}

try {
  const releaseManifest = readReleaseManifest()
  const health = await readJson('/api/health')
  if (health?.served?.stale) {
    console.error('Guildhall served bundle is stale. Restart the local service before release smoke.')
    console.error(`Started at: ${health.served.processStartedAt ?? 'unknown'}`)
    console.error(`Dist path: ${health.served.distPath ?? 'unknown'}`)
    process.exitCode = 1
  } else {
    const version = health.version ?? 'unknown'
    const commit = health.git?.shortCommit ?? health.git?.commit ?? 'unknown commit'
    const branch = health.git?.branch ?? 'unknown branch'
    const dirty = health.git?.dirty ? 'dirty' : 'clean'
    console.log(`Guildhall ${version} (${branch} ${commit}, ${dirty}) served bundle is fresh at ${base}.`)
    console.log(
      `Default runtime image: ${releaseManifest.runtime.defaultImage.repository}:${releaseManifest.runtime.defaultImage.immutableTag}`,
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function readReleaseManifest() {
  if (!existsSync(releaseManifestPath)) {
    throw new Error(`${releaseManifestPath} is missing. Run pnpm build before release smoke.`)
  }

  const manifest = JSON.parse(readFileSync(releaseManifestPath, 'utf8'))
  if (!manifest?.runtime?.defaultImage?.repository || !manifest?.runtime?.defaultImage?.immutableTag) {
    throw new Error(`${releaseManifestPath} does not describe a default runtime image.`)
  }

  return manifest
}
