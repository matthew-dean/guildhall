#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { auditNarrativeHarnessProof } from './narrative-harness-release-proof.mjs'

const baseUrl = (process.env.GUILDHALL_URL ?? 'http://localhost:7777').replace(/\/$/, '')
const projectId = process.env.GUILDHALL_ACCEPTANCE_PROJECT ?? 'narrative-harness'
const expectedReleaseId = process.env.GUILDHALL_ACCEPTANCE_RELEASE ?? 'stage-1-headless-drafting-and-evaluation-mvp'
const requiredProjects = ['narrative-harness', 'looma-knit', 'jess', 'fair-labor-license']
const checks = []

function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) })
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function projectBody(body) {
  return body?.summary && typeof body.summary === 'object' ? body.summary : body ?? {}
}

function releaseIdentity(value) {
  const release = value?.release ?? null
  return release
    ? { id: release.id ?? null, label: release.label ?? null, state: release.state ?? null }
    : null
}

function releaseCounts(value) {
  const counts = value?.counts ?? {}
  return {
    total: counts.total ?? 0,
    done: counts.done ?? 0,
    unfinished: counts.unfinished ?? 0,
    blocked: counts.blocked ?? 0,
    deferred: counts.deferred ?? 0,
    proofBlocked: counts.proofBlocked ?? 0,
  }
}

async function readJson(path) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  })
  const text = await response.text()
  const durationMs = Math.round((performance.now() - started) * 100) / 100
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return { value, durationMs, bytes: Buffer.byteLength(text) }
}

async function readRoute(path) {
  try {
    return await readJson(path)
  } catch (error) {
    check(`read ${path}`, false, error instanceof Error ? error.message : String(error))
    return { value: null, durationMs: 0, bytes: 0 }
  }
}

function cliStatus() {
  const output = execFileSync(process.execPath, ['dist/cli.js', 'status', projectId, '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  })
  return JSON.parse(output)
}

async function browserProof() {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const routeHeadings = {
    overview: 'Narrative Harness',
    map: 'Project map',
    work: 'Work list',
    release: 'Release readiness',
  }
  const results = []
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      for (const [route, heading] of Object.entries(routeHeadings)) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
        const path = `/projects/${projectId}/${route}`
        try {
          await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
          await page.locator('main').waitFor({ state: 'visible', timeout: 10_000 })
          await page.getByRole('heading', { name: heading, exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 })
          const geometry = await page.evaluate(() => {
            const viewportWidth = document.documentElement.clientWidth
            const overflowing = [...document.querySelectorAll('*')].filter(element => {
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1)
            }).length
            return {
              clientWidth: viewportWidth,
              scrollWidth: document.documentElement.scrollWidth,
              overflowing,
            }
          })
          const pass = geometry.clientWidth === viewport.width
            && geometry.scrollWidth === viewport.width
            && geometry.overflowing === 0
          results.push({ viewport: viewport.name, route, pass, geometry })
          check(`browser ${viewport.name} ${route}`, pass, geometry)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          results.push({ viewport: viewport.name, route, pass: false, error: detail })
          check(`browser ${viewport.name} ${route}`, false, detail)
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
  return results
}

async function main() {
  const stale = await readRoute('/api/stale-server')
  check('installed bundle is fresh', stale.value?.stale === false, stale.value?.startup ?? stale.value)
  check('startup has no refresh errors', stale.value?.startup?.errorCount === 0, stale.value?.startup)

  const fleet = await readRoute('/api/service/projects')
  const projects = Array.isArray(fleet.value?.projects) ? fleet.value.projects : []
  const fleetIds = projects.map(project => project.id)
  check('required projects are registered', requiredProjects.every(id => fleetIds.includes(id)), { requiredProjects, fleetIds })
  check('fleet summary is bounded and fast', fleet.durationMs <= 250 && fleet.bytes <= 131072, {
    durationMs: fleet.durationMs,
    bytes: fleet.bytes,
  })
  check('fleet cards are current', projects.every(project => project.projectStatusLoading !== true && typeof project.projectStatusError !== 'string'), projects)

  const surfaceReads = {}
  for (const surface of ['overview', 'work', 'map']) {
    surfaceReads[surface] = await readRoute(`/api/project?projectId=${encodeURIComponent(projectId)}&compact=true&surface=${surface}`)
  }
  const overview = projectBody(surfaceReads.overview.value)
  const expectedRelease = releaseIdentity(overview.releaseSummary)
  const expectedCounts = releaseCounts(overview.releaseSummary)
  check('Narrative Harness has the expected selected release', expectedRelease?.id === expectedReleaseId, expectedRelease)
  check('selected release is durably shipped', expectedRelease?.state === 'shipped', expectedRelease)
  check('selected release has complete current scope', same(expectedCounts, {
    total: 15,
    done: 15,
    unfinished: 0,
    blocked: 0,
    deferred: 24,
    proofBlocked: 0,
  }), expectedCounts)
  check('Overview readiness is complete', overview.releaseSummary?.state === 'ready' && overview.startReadiness?.canStart === false, {
    state: overview.releaseSummary?.state,
    start: overview.startReadiness,
  })

  const narrativeHarnessRoot = process.env.GUILDHALL_ACCEPTANCE_NARRATIVE_HARNESS_ROOT
    ?? resolve(process.cwd(), '../narrative-harness')
  const narrativeHarnessProof = auditNarrativeHarnessProof({
    root: narrativeHarnessRoot,
    expectedReleaseLabel: expectedRelease?.label,
    bakeoffPath: process.env.GUILDHALL_ACCEPTANCE_NH_BAKEOFF_ARTIFACT,
  })
  for (const proofCheck of narrativeHarnessProof.checks) {
    check(`Narrative Harness proof: ${proofCheck.name}`, proofCheck.pass, proofCheck.detail)
  }

  for (const [surface, read] of Object.entries(surfaceReads)) {
    const body = projectBody(read.value)
    const spineRelease = body.orientationSpine?.selectedRelease
    check(`${surface} projection is current`, body.summaryFreshness === 'current', body.summaryFreshness)
    check(`${surface} agrees on release identity`, same(releaseIdentity(body.releaseSummary), expectedRelease), releaseIdentity(body.releaseSummary))
    check(`${surface} agrees on release counts`, same(releaseCounts(body.releaseSummary), expectedCounts), releaseCounts(body.releaseSummary))
    check(`${surface} spine agrees on shipped lifecycle`, spineRelease?.state === 'shipped', spineRelease)
  }

  const [activity, spine, readinessSummary, readiness, thread] = await Promise.all([
    readRoute(`/api/project/activity?projectId=${encodeURIComponent(projectId)}`),
    readRoute(`/api/project/spine?projectId=${encodeURIComponent(projectId)}`),
    readRoute(`/api/project/release-readiness/summary?projectId=${encodeURIComponent(projectId)}`),
    readRoute(`/api/project/release-readiness?projectId=${encodeURIComponent(projectId)}`),
    readRoute(`/api/project/thread?projectId=${encodeURIComponent(projectId)}`),
  ])
  check('Activity agrees on release identity', same(releaseIdentity(activity.value?.releaseSummary), expectedRelease), releaseIdentity(activity.value?.releaseSummary))
  check('Activity projection is current', activity.value?.summaryFreshness === 'current', activity.value?.summaryFreshness)
  check('rich spine agrees on shipped lifecycle', spine.value?.spine?.selectedRelease?.state === 'shipped', spine.value?.spine?.selectedRelease)
  check('rich spine preserves deferred later scope', spine.value?.spine?.summary?.deferredWorkCount === 24, spine.value?.spine?.summary)
  check('release summary is database-backed and complete', readinessSummary.value?.currentStateAuthority === 'database'
    && readinessSummary.value?.completion?.state === 'complete'
    && readinessSummary.value?.release?.state === 'shipped', readinessSummary.value)
  check('release detail is aligned and ready', readiness.value?.verdict?.state === 'ready'
    && readiness.value?.stateConsistency === 'aligned'
    && readiness.value?.release?.state === 'shipped', readiness.value)
  check('Thread agrees on selected release', thread.value?.orientationSpine?.selectedRelease?.state === 'shipped', thread.value?.orientationSpine?.selectedRelease)

  const includedTaskId = overview.orientationSpine?.selectedRelease?.nodeIds?.[0]?.replace(/^work:/, '')
  const deferredTaskId = overview.orientationSpine?.selectedRelease?.deferredNodeIds?.[0]?.replace(/^work:/, '')
  const taskReads = await Promise.all([includedTaskId, deferredTaskId]
    .filter(Boolean)
    .map(async id => [id, await readRoute(`/api/project/task/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`)]))
  for (const [id, read] of taskReads) {
    check(`task detail is available for ${id}`, read.value?.task?.id === id && typeof read.value?.task?.title === 'string' && read.value.task.title.length > 0, read.value?.task)
  }

  try {
    const cli = cliStatus()
    check('CLI reads the same release identity', same(releaseIdentity(cli.release), expectedRelease), releaseIdentity(cli.release))
    check('CLI reads the same release counts', same(releaseCounts(cli.release), expectedCounts), releaseCounts(cli.release))
    check('CLI reads the same saved scope', cli.scope?.included === 15 && cli.scope?.deferred === 24, cli.scope)
    check('CLI uses the database projection', cli.authority === 'database' && cli.freshness === 'current', cli)
  } catch (error) {
    check('CLI status command is usable', false, error instanceof Error ? error.message : String(error))
  }

  try {
    await browserProof()
  } catch (error) {
    check('browser proof completed', false, error instanceof Error ? error.message : String(error))
  }

  const failed = checks.filter(check => !check.pass)
  const output = {
    projectId,
    expectedReleaseId,
    baseUrl,
    generatedAt: new Date().toISOString(),
    pass: failed.length === 0,
    checkCount: checks.length,
    failedCount: failed.length,
    checks,
  }
  console.log(JSON.stringify(output, null, 2))
  if (failed.length > 0) process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
