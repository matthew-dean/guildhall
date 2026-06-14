import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const auditReplayTargets = [
  {
    name: 'jess structural-review owner input',
    path: '/projects/jess/thread?thread=bc-jess-structural_review-8c11fc652d-2026-06-04T00-44-08-860Z',
    assertions: ['Jess', 'Thread list', 'Selected thread'],
  },
  {
    name: 'jess workspace import',
    path: '/projects/jess/workspace-import',
    assertions: ['Jess', 'Review existing project work'],
  },
  {
    name: 'commerce setup-pending thread',
    path: '/projects/commerce-project/thread',
    assertions: ['Commerce Project', 'Thread list', 'Selected thread'],
  },
  {
    name: 'looma-knit reconcile import',
    path: '/projects/looma-knit/workspace-import?mode=reconcile',
    assertions: ['Looma + Knit', 'Review existing project work'],
  },
  {
    name: 'looma-knit import spec drawer',
    path: '/projects/looma-knit/task/task-import-1l0mr2r?tab=spec',
    assertions: ['Looma + Knit', 'Task drawer', 'Spec', 'Context menu'],
  },
  {
    name: 'narrative-harness coherence reviewer spec drawer',
    path: '/projects/narrative-harness/task/coherence-reviewer-mvp?tab=spec',
    assertions: ['Narrative Harness', 'Task drawer', 'Spec', 'Build first coherence reviewer MVP'],
  },
  {
    name: 'narrative-harness decision trace spec drawer',
    path: '/projects/narrative-harness/task/decision-trace-pipeline?tab=spec',
    assertions: ['Narrative Harness', 'Task drawer', 'Spec', 'Build the decision trace pipeline'],
  },
  {
    name: 'narrative-harness task 009 spec drawer',
    path: '/projects/narrative-harness/task/task-009?tab=spec',
    assertions: ['Narrative Harness', 'Task drawer', 'Spec', 'Run task 009 story replay'],
  },
  {
    name: 'font-something import api serving task',
    path: '/projects/font-something/task/import-api-serving-mvp',
    assertions: ['Font something', 'Task drawer', 'Serve the import API MVP'],
  },
]

export function projectIdFromRoute(path) {
  const match = path.match(/^\/projects\/([^/?#]+)/)
  return match?.[1] ?? null
}

export function taskIdFromRoute(path) {
  const match = path.match(/^\/projects\/[^/]+\/task\/([^/?#]+)/)
  return match?.[1] ?? null
}

export function routeApiChecks(target) {
  const projectId = projectIdFromRoute(target.path)
  const taskId = taskIdFromRoute(target.path)
  const checks = [{ label: 'stale-server', path: '/api/stale-server' }]
  if (projectId) {
    checks.push({ label: 'project', path: `/api/project?projectId=${encodeURIComponent(projectId)}` })
  }
  if (projectId && target.path.includes('/thread')) {
    checks.push({ label: 'thread', path: `/api/project/thread?projectId=${encodeURIComponent(projectId)}` })
  }
  if (projectId && taskId) {
    checks.push({
      label: 'task',
      path: `/api/project/task/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`,
    })
  }
  return checks
}

export function classifyRouteProbe(probe) {
  const directHttpHealthy = probe.directHttp.ok && probe.directHttp.status >= 200 && probe.directHttp.status < 500
  const apiHealthy = probe.apiChecks.every(check => check.ok && check.status >= 200 && check.status < 500)
  const productRouteHealthy = directHttpHealthy && apiHealthy

  if (productRouteHealthy && (!probe.navigation.ok || !probe.dom.ok)) {
    return {
      classification: 'browser_bridge_failure',
      productRouteHealthy: true,
      reason: 'Browser control failed while direct route HTTP and API liveness checks stayed healthy.',
    }
  }

  if (!productRouteHealthy) {
    return {
      classification: 'product_route_lockup',
      productRouteHealthy: false,
      reason: 'Direct route HTTP or API liveness failed while probing the route.',
    }
  }

  return {
    classification: 'route_healthy',
    productRouteHealthy: true,
    reason: 'Browser navigation, DOM proof, direct route HTTP, and API liveness all passed.',
  }
}

export async function runRouteProof({ baseURL, target, browserType }) {
  const browser = await browserType.launch()
  const page = await browser.newPage()
  const url = new URL(target.path, baseURL).toString()
  const apiChecks = []
  let navigation = { ok: true }
  let dom = { ok: true, url, bodyText: '' }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 })
  } catch (error) {
    navigation = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  for (const assertion of target.assertions) {
    try {
      await page.getByText(assertion, { exact: false }).first().waitFor({ state: 'visible', timeout: 5_000 })
    } catch (error) {
      dom = {
        ok: false,
        url: page.url(),
        bodyText: (await page.locator('body').textContent().catch(() => '')) ?? '',
        error: error instanceof Error ? error.message : String(error),
      }
      break
    }
  }

  const directResponse = await page.request.get(url).catch(() => null)
  const directHttp = directResponse
    ? { ok: directResponse.ok(), status: directResponse.status() }
    : { ok: false, status: 0 }

  for (const check of routeApiChecks(target)) {
    const response = await page.request.get(new URL(check.path, baseURL).toString()).catch(() => null)
    apiChecks.push(response
      ? { label: check.label, ok: response.ok(), status: response.status(), path: check.path }
      : { label: check.label, ok: false, status: 0, path: check.path })
  }

  await browser.close()
  const classification = classifyRouteProbe({ navigation, directHttp, apiChecks, dom })
  return { target, url, navigation, directHttp, apiChecks, dom, ...classification }
}

async function main() {
  const { chromium } = await import('@playwright/test')
  const baseURL = process.env.GUILDHALL_PROOF_BASE_URL ?? 'http://127.0.0.1:7777'
  const outputPath = process.env.GUILDHALL_PROOF_OUTPUT ?? 'tmp/browser-route-proof.json'
  const results = []
  for (const target of auditReplayTargets) {
    results.push(await runRouteProof({ baseURL, target, browserType: chromium }))
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({
    baseURL,
    generatedAt: new Date().toISOString(),
    results,
  }, null, 2)}\n`, 'utf8')
  const failed = results.filter(result => result.classification !== 'route_healthy')
  if (failed.length > 0) {
    console.error(`Browser route proof found ${failed.length} non-healthy route(s). See ${outputPath}.`)
    process.exitCode = 1
    return
  }
  console.log(`Browser route proof passed ${results.length} route(s). Wrote ${outputPath}.`)
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
