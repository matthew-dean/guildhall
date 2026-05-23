const base = (process.env.GUILDHALL_SMOKE_URL ?? 'http://localhost:7777').replace(/\/$/, '')

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
  const stale = await readJson('/api/stale-server')
  if (stale?.stale) {
    console.error('Guildhall served bundle is stale. Restart the local service before release smoke.')
    console.error(`Started at: ${stale.processStartedAt ?? 'unknown'}`)
    console.error(`Dist path: ${stale.distPath ?? 'unknown'}`)
    process.exitCode = 1
  } else {
    const version = await readJson('/api/version')
    console.log(`Guildhall ${version.version ?? 'unknown'} served bundle is fresh at ${base}.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
