import { expect, test, type Locator } from '@playwright/test'
import {
  defineFlowUserJob,
  expectProjectFlowStateAgreement,
  expectProjectOrientationSpineAgreement,
  expectNoClippedContent,
  expectProgressiveScopeWorkCount,
  readProjectFlowState,
} from './flow-audit-assertions'

async function expectMapScopeDisclosure(
  projectMap: Locator,
  expected: { label: string; included: number; boundaries: number; deferred: number },
): Promise<void> {
  const escapedLabel = expected.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const summaryPattern = new RegExp(
    `^${escapedLabel} has 0/${expected.included} executable work items complete across ${expected.boundaries} product boundaries, with \\d+ later work items\\.$`,
  )
  const summary = projectMap.getByText(summaryPattern)
  await expect(summary).toBeVisible()
  const deferred = Number((await summary.textContent())?.match(/with (\d+) later work items\.$/)?.[1])
  expect(deferred).toBe(expected.deferred)
  await expect(
    projectMap.getByText(`${expected.boundaries} product boundaries · ${deferred} later work items`, { exact: false }).first(),
  ).toBeVisible()
}

async function applyRequiredProjectUpdates(page: import('@playwright/test').Page): Promise<void> {
  const gate = page.getByRole('region', { name: 'Project update required' })
  const workList = page.getByRole('heading', { name: 'Work list' })
  await expect(gate.or(workList)).toBeVisible()
  if (await workList.isVisible()) return

  await page.getByRole('button', { name: 'Review project update' }).click()
  const modal = page.getByRole('dialog', { name: 'Migrate project' })
  await expect(modal).toBeVisible()

  for (let applied = 0; applied < 8; applied += 1) {
    const apply = modal.getByRole('button', { name: 'Apply required updates' })
    await expect(apply).toBeEnabled()
    await apply.click()

    const complete = modal.getByText('Migration complete.', { exact: true })
    const continuing = modal.getByText('Update applied. Another project update is required.', { exact: true })
    await expect(complete.or(continuing)).toBeVisible()
    if (await complete.isVisible()) {
      await modal.getByRole('contentinfo').getByRole('button', { name: 'Close' }).click()
      await expect(modal).toHaveCount(0)
      return
    }
    await expect(modal.getByText('Project update applied', { exact: true })).toBeVisible()
  }

  throw new Error('Expected the project update sequence to complete within eight migrations.')
}

const projectSurfaceRoutes = [
  {
    name: 'global needs-you',
    path: '/needs-you',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Needs-you summary' })).toBeVisible()
    },
  },
  {
    name: 'global providers',
    path: '/providers',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Providers', exact: true }).first()).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Global model defaults' })).toBeVisible()
    },
  },
  {
    name: 'overview inbox',
    path: '/projects/looma-knit/overview/inbox',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Project navigation' })).toBeVisible()
    },
  },
  {
    name: 'workspace import',
    path: '/projects/font-something/workspace-import',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Review existing project work' })).toBeVisible()
    },
  },
  {
    name: 'structure',
    path: '/projects/looma-knit/structure',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Structure' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Project map' })).toBeVisible()
    },
  },
  {
    name: 'release',
    path: '/projects/fair-labor-license/release',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: /^(Release|Scope) readiness$/ })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Inspect release details' })).toBeVisible()
    },
  },
  {
    name: 'release criteria',
    path: '/projects/looma-knit/release/criteria',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: /^(Release|Scope) checks$/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Criteria' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Task-state tally' })).toBeVisible()
    },
  },
  {
    name: 'project setup',
    path: '/projects/tiny-demo/setup',
    assertions: async (page) => {
      await expect(page.getByRole('button', { name: 'Identity', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Ready to start?' })).toBeVisible()
      await expect(page.getByText('LLM provider')).toBeVisible()
    },
  },
  {
    name: 'docs-only overview',
    path: '/projects/docs-compass/overview',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Docs Compass' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
    },
  },
  {
    name: 'docs-only structure',
    path: '/projects/docs-compass/structure',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Structure' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Project map' })).toBeVisible()
      await expect(page.getByTitle('Docs Compass')).toBeVisible()
    },
  },
  {
    name: 'infra release criteria',
    path: '/projects/pipeline-ops/release/criteria',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: /^(Release|Scope) checks$/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Task-state tally' })).toBeVisible()
      await expect(page.getByTitle('Pipeline Ops')).toBeVisible()
    },
  },
  {
    name: 'native mobile work',
    path: '/projects/mobile-kit/work?view=columns',
    assertions: async (page) => {
      await expect(page.getByRole('region', { name: 'Project update required' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'One update is needed' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Review project update' })).toBeVisible()
      await expect(page.getByTitle('Mobile Kit')).toBeVisible()
    },
  },
  {
    name: 'service thread',
    path: '/projects/api-broker/thread',
    assertions: async (page) => {
      await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Selected thread' })).toBeVisible()
      await expect(page.getByTitle('API Broker')).toBeVisible()
    },
  },
  {
    name: 'timeline',
    path: '/projects/api-broker/timeline',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Project activity' })).toBeVisible()
      await expect(page.getByTitle('API Broker')).toBeVisible()
    },
  },
  {
    name: 'setup-pending work',
    path: '/projects/scratch-setup-pending/work',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'scratch-setup-pending is attached, but not initialized yet' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Initialize this project' })).toBeVisible()
      await expect(page.getByText(/Setup is intentionally pending/)).toHaveCount(0)
    },
  },
  {
    name: 'dirty service release',
    path: '/projects/dirty-service/release',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: /^(Release|Scope) readiness$/ })).toBeVisible()
      await expect(page.locator('p').filter({ hasText: /^Current task scope$/ })).toBeVisible()
      await expect(page.getByTitle('Dirty Service')).toBeVisible()
    },
  },
  {
    name: 'consumer handoff structure',
    path: '/projects/consumer-app/structure',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Structure', exact: true })).toBeVisible()
      await expect(page.getByText('Consumer App is waiting on Provider Library')).toBeVisible()
      await expect(page.getByText('Consumer App needs launch-window math from Provider Library.')).toBeVisible()
      await expect(page.getByText('This project is consumer')).toBeVisible()
      await expect(page.getByText('1 contract')).toBeVisible()
      await expect(page.getByText('Unrelated Indexed Project')).toHaveCount(0)
    },
  },
  {
    name: 'provider handoff structure',
    path: '/projects/provider-library/structure',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Structure', exact: true })).toBeVisible()
      await expect(page.getByText('Consumer App is asking this project for work')).toBeVisible()
      await expect(page.getByText('This project is provider')).toBeVisible()
      await expect(page.getByText('1 contract')).toBeVisible()
    },
  },
  {
    name: 'capability request thread',
    path: '/projects/capability-boundary/thread',
    assertions: async (page) => {
      await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Selected thread' })).toBeVisible()
      await expect(page.getByText('Access requests')).toBeVisible()
      await expect(page.getByText('Capability Boundary needs read access to ../fixtures/packets.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Approve read-only' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Approve read-write' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Use fallback' })).toBeVisible()
    },
  },
]

for (const surface of projectSurfaceRoutes) {
  test(`${surface.name} route loads as part of the user-test matrix`, async ({ page }) => {
    await page.goto(surface.path)
    await surface.assertions(page)
  })
}

test('projects home scrolls at mobile size and opens explicit project routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 })
  await page.goto('/projects')

  await expect(page.getByRole('heading', { name: 'Projects & Workspaces' })).toBeVisible()
  await expect(page.getByText('Tiny demo')).toBeVisible()
  await expect(page.getByText('Docs Compass')).toBeVisible()

  await page
    .locator('section.project-card')
    .filter({ has: page.getByRole('heading', { name: 'Looma + Knit' }) })
    .getByRole('button', { name: 'Review next spec' })
    .click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/(task|work)/)
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390)
})

test('projects home keeps project cards compact for scanability', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects')

  await expect(page.getByRole('heading', { name: 'Projects & Workspaces' })).toBeVisible()
  const cards = page.locator('section.project-card')
  await expect(cards).toHaveCount(18)
  await expect(page.getByText('Loading project status...')).toHaveCount(0)
  await expect(page.getByText('Still loading project state')).toHaveCount(0)
  for (const projectName of [
    'Docs Compass',
    'Pipeline Ops',
    'Mobile Kit',
    'API Broker',
    'Scratch Setup Pending',
    'Dirty Service',
    'Release Consumed',
    'Consumer App',
    'Provider Library',
    'Capability Boundary',
  ]) {
    await expect(cards.filter({ has: page.getByRole('heading', { name: projectName }) })).toHaveCount(1)
  }

  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { height: box.height, width: box.width, top: box.top, left: box.left, right: box.right }
    }),
  )
  expect(Math.max(...boxes.map(box => box.height))).toBeLessThan(270)
  expect(new Set(boxes.map(box => Math.round(box.top))).size).toBeGreaterThan(1)
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 1440)

  const rows = new Map<number, typeof boxes>()
  for (const box of boxes) {
    const top = Math.round(box.top)
    rows.set(top, [...(rows.get(top) ?? []), box])
  }
  const singletonRows = Array.from(rows.values()).filter(row => row.length === 1)
  expect(singletonRows.length).toBeLessThanOrEqual(1)
  for (const row of rows.values()) {
    if (row.length < 3) continue
    expect(Math.min(...row.map(box => box.width))).toBeGreaterThan(420)
    expect(Math.max(...row.map(box => box.right))).toBeLessThanOrEqual(1441)
  }
})

test('legacy project routes fall back to project selection', async ({ page }) => {
  await page.goto('/project/thread')
  await expect(page.getByRole('heading', { name: 'Projects & Workspaces' })).toBeVisible()
})

test('managed project state keeps Thread readable after migration', async ({ page }) => {
  await page.goto('/projects/looma-knit/thread')

  await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected thread' })).toBeVisible()
  await page.getByRole('complementary', { name: 'Thread list' }).getByRole('button', { name: /Unit tests: use-collections/ }).click()
  const composer = page.getByRole('region', { name: 'Selected thread' }).getByRole('textbox')
  if (await composer.count() > 0) {
    await expect(composer).toBeVisible()
    await composer.fill('Review the current spec draft and keep the menu behavior need-driven.')
    await composer.press('Enter')
  } else {
    await page.getByRole('region', { name: 'Selected thread' }).getByRole('button', { name: 'URL input + Display text input' }).click()
  }
  await expect(page.getByText('This bounded chat objective is not supported here yet.')).toHaveCount(0)
})

test('pinned project rail reserves layout width at medium desktop sizes', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 700 })
  await page.goto('/projects/looma-knit/work')

  const pin = page.getByRole('button', { name: 'Pin project navigation open' })
  await expect(pin).toBeVisible()

  const collapsedRail = await page.locator('.app-shell-rail').boundingBox()
  const collapsedMain = await page.locator('.app-shell-main').boundingBox()
  expect(collapsedRail).not.toBeNull()
  expect(collapsedMain).not.toBeNull()
  expect(collapsedRail!.width).toBeLessThanOrEqual(70)
  expect(collapsedMain!.x).toBeLessThanOrEqual(70)

  await pin.click()
  await expect(page.getByRole('button', { name: 'Collapse project navigation' })).toBeVisible()

  const expandedRail = await page.locator('.app-shell-rail').boundingBox()
  const expandedMain = await page.locator('.app-shell-main').boundingBox()
  expect(expandedRail).not.toBeNull()
  expect(expandedMain).not.toBeNull()
  expect(expandedRail!.width).toBeGreaterThanOrEqual(230)
  expect(expandedMain!.x).toBeGreaterThanOrEqual(expandedRail!.width - 1)
})

test('work view switcher keeps list as default and board as the secondary surface', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/projects/looma-knit/work?view=columns')

  await expect(page.getByRole('toolbar', { name: 'Work view controls' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Columns' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeVisible()
  await expect(page.getByLabel('Work hierarchy columns')).toHaveCount(0)

  await page.getByRole('button', { name: /Inspect work/ }).first().click()
  await expect(page.getByLabel('Selected work inspector')).toBeVisible()

  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/work\?view=board$/)
  await expect(page.getByText('Next focus')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Columns' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeVisible()
})

test('work list columns fit normal split-screen widths and scroll only when genuinely narrow', async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 692 })
  await page.goto('/projects/narrative-harness/work')

  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  const normalMetrics = await page.locator('.work-list-stack').evaluate((stack) => {
    const scrollRegion = stack.parentElement
    const card = stack.closest('.gh-ui-compat-card')
    if (!scrollRegion || !card) return null
    const scrollStyle = getComputedStyle(scrollRegion)
    const scrollBox = scrollRegion.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    const rowBoxes = Array.from(stack.querySelectorAll('.work-list-row')).map(row => row.getBoundingClientRect())
    return {
      scrollClass: scrollRegion.className,
      scrollAriaLabel: scrollRegion.getAttribute('aria-label'),
      overflowX: scrollStyle.overflowX,
      scrollRight: scrollBox.right,
      cardRight: cardBox.right,
      stackScrollWidth: stack.scrollWidth,
      scrollClientWidth: scrollRegion.clientWidth,
      rowMaxRight: Math.max(...rowBoxes.map(box => box.right)),
    }
  })

  expect(normalMetrics).not.toBeNull()
  expect(normalMetrics!.scrollClass).toContain('work-list-scroll')
  expect(normalMetrics!.scrollAriaLabel).toBe('Scrollable work list columns')
  expect(['auto', 'scroll']).toContain(normalMetrics!.overflowX)
  expect(normalMetrics!.scrollRight).toBeLessThanOrEqual(normalMetrics!.cardRight + 1)
  expect(normalMetrics!.stackScrollWidth).toBeLessThanOrEqual(normalMetrics!.scrollClientWidth + 1)
  expect(normalMetrics!.rowMaxRight).toBeLessThanOrEqual(normalMetrics!.cardRight + 1)

  await page.setViewportSize({ width: 900, height: 692 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  const narrowMetrics = await page.locator('.work-list-stack').evaluate((stack) => {
    const scrollRegion = stack.parentElement
    const card = stack.closest('.gh-ui-compat-card')
    if (!scrollRegion || !card) return null
    const scrollStyle = getComputedStyle(scrollRegion)
    const scrollBox = scrollRegion.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    return {
      scrollClass: scrollRegion.className,
      scrollAriaLabel: scrollRegion.getAttribute('aria-label'),
      overflowX: scrollStyle.overflowX,
      scrollRight: scrollBox.right,
      cardRight: cardBox.right,
      stackScrollWidth: stack.scrollWidth,
      scrollClientWidth: scrollRegion.clientWidth,
    }
  })

  expect(narrowMetrics).not.toBeNull()
  expect(narrowMetrics!.scrollClass).toContain('work-list-scroll')
  expect(narrowMetrics!.scrollAriaLabel).toBe('Scrollable work list columns')
  expect(['auto', 'scroll']).toContain(narrowMetrics!.overflowX)
  expect(narrowMetrics!.scrollRight).toBeLessThanOrEqual(narrowMetrics!.cardRight + 1)
  expect(narrowMetrics!.stackScrollWidth).toBeGreaterThan(narrowMetrics!.scrollClientWidth)
})

test('flow audit protocol reconciles user job, visible state, and layout evidence', async ({ page }) => {
  defineFlowUserJob({
    route: '/projects/narrative-harness/work',
    projectId: 'narrative-harness',
    expectation: 'A user looking at route X should be able to tell what is happening now, what is queued, what is blocked, what they can do next, and whether the system is actually working.',
  })

  await page.setViewportSize({ width: 1114, height: 692 })
  await page.goto('/projects/narrative-harness/work')
  await applyRequiredProjectUpdates(page)
  await expect(page.getByRole('region', { name: 'Current work' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open task' })).toBeVisible()
  await expectNoClippedContent(page, {
    containerSelector: 'section.work-focus',
    itemSelector: 'section.work-focus button',
  })

  await page.setViewportSize({ width: 900, height: 692 })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Current work' })).toBeVisible()
  await expectNoClippedContent(page, {
    containerSelector: 'section.work-focus',
    itemSelector: 'section.work-focus button',
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Current work' })).toBeVisible()
  await expectNoClippedContent(page, {
    containerSelector: 'section.work-focus',
    itemSelector: 'section.work-focus button',
  })

  const state = await readProjectFlowState(page, 'narrative-harness')
  expect(state.visibleTotal).toBeGreaterThan(0)
  expect(state.focusTaskTitle).toBeTruthy()
  await expect(page.getByRole('region', { name: 'Current work' })).toContainText(state.focusTaskTitle!)
  if (state.startCanStart) {
    expect(state.focusTaskId ?? state.firstRunnableId).not.toBeNull()
  }
})

test('project orientation spine agrees across overview, work, thread, release, and structure', async ({ page }) => {
  await expectProjectOrientationSpineAgreement(page, {
    projectId: 'narrative-harness',
    requireInferredPurpose: true,
  })
  await expectProjectOrientationSpineAgreement(page, {
    projectId: 'looma-knit',
    requireInferredPurpose: true,
  })
  await expectProjectOrientationSpineAgreement(page, {
    projectId: 'jess',
    minIncludedWorkCount: 1,
    requireInferredPurpose: true,
  })
  await expectProjectOrientationSpineAgreement(page, {
    projectId: 'fair-labor-license',
    minIncludedWorkCount: 1,
    requireInferredPurpose: true,
  })
})

test('Narrative Harness overview and map show the documented current release scope', async ({ page }) => {
  const response = await page.request.get('/api/project?projectId=narrative-harness')
  expect(response.ok()).toBe(true)
  const detail = await response.json()
  const summary = detail.orientationSpine?.summary ?? {}
  const included = summary.includedWorkCount
  const deferred = summary.deferredWorkCount
  const pausedTask = 'Shape fixture and expected-record ground truth'

  expect(summary.selectedReleaseLabel).toBe('Stage 1: Fixture And Evaluation Harness')
  expect(included).toBe(6)
  expect(deferred).toBeGreaterThanOrEqual(8)
  expect(detail.startReadiness).toMatchObject({
    canStart: true,
    code: 'paused_live_work',
    focusKind: 'paused_work',
  })
  expect(detail.startReadiness?.message).toContain(pausedTask)
  expect(detail.actionModel?.runControl).toMatchObject({
    label: 'Resume',
  })
  expect(summary.topBlocker).toBeNull()
  expect(detail.orientationSpine?.release?.blockers ?? []).toEqual([])

  await page.goto('/projects/narrative-harness/overview')
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  await expect(page.getByText('Stage 1: Fixture And Evaluation Harness').first()).toBeVisible()
  await expect(page.getByRole('button', { name: `${included} Current scope`, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `${deferred} Deferred`, exact: true })).toBeVisible()
  await expect(page.getByText(`${included} work items in view`)).toHaveCount(0)
  await expect(page.getByText(pausedTask).first()).toBeVisible()
  await expect(page.getByText('Resume', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/specs are waiting for review before work can start/i)).toHaveCount(0)
  await expect(page.getByText(/needs a clearer brief|need fuller briefs|brief cleanup/i)).toHaveCount(0)
  await expect(page.getByText('Review stale proof records')).toHaveCount(0)
  await expect(page.getByText('Clean up archived author voice proof')).toHaveCount(0)

  await page.goto('/projects/narrative-harness/overview/inbox')
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
  await expect(page.getByText('Review stale proof records')).toHaveCount(0)
  await expect(page.getByText('Clean up archived author voice proof')).toHaveCount(0)

  await page.goto('/projects/narrative-harness/map')
  await expect(page.getByRole('heading', { name: 'Project map' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Release scope' })).toBeVisible()
  const projectMap = page.locator('.project-map')
  await expect(projectMap.getByText('Stage 1: Fixture And Evaluation Harness').first()).toBeVisible()
  await expect(projectMap.getByText('Define fixture, expected-record, prototype-run, and evaluation schemas.').first()).toBeVisible()
  await expect(projectMap.getByText('Implement a no-UI runner that builds a packet from fixture records.').first()).toBeVisible()
  await expectMapScopeDisclosure(projectMap, {
    label: 'Stage 1: Fixture And Evaluation Harness',
    included,
    boundaries: included,
    deferred,
  })
  await expect(page.getByRole('heading', { name: 'Scope ledger' })).toBeVisible()
  await expect(projectMap.getByText(pausedTask).first()).toBeVisible()
  await expect(projectMap.getByText(/Paused .* Source: implementation-roadmap\.md/i).first()).toBeVisible()
  await expect(projectMap.getByText(/specs are waiting for review before work can start/i)).toHaveCount(0)
  await expect(projectMap.getByText(/needs a clearer brief|need fuller briefs|brief cleanup/i)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Source trail' })).toBeVisible()
  await expect(projectMap.getByText('implementation-roadmap.md').first()).toBeVisible()

  await page.goto('/projects/narrative-harness/work')
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Current scope' })
  await expectProgressiveScopeWorkCount(page, { current: included, deferred })
})

test('Looma + Knit map shows V1 hardening as current and Looma convergence as later', async ({ page }) => {
  await expectProjectOrientationSpineAgreement(page, {
    projectId: 'looma-knit',
    requireInferredPurpose: true,
  })

  const response = await page.request.get('/api/project?projectId=looma-knit')
  expect(response.ok()).toBe(true)
  const detail = await response.json()

  expect(detail.orientationSpine?.summary?.selectedReleaseLabel).toBe('Stage 1: V1 Release Hardening')
  const included = detail.orientationSpine?.summary?.includedWorkCount
  const deferred = detail.orientationSpine?.summary?.deferredWorkCount
  expect(included).toBe(5)
  expect(deferred).toBeGreaterThanOrEqual(8)

  const overviewResponse = await page.request.get('/api/project?projectId=looma-knit&surface=overview')
  expect(overviewResponse.ok()).toBe(true)
  const overviewDetail = await overviewResponse.json()
  if (overviewDetail.startReadiness?.canStart === false && overviewDetail.startReadiness?.message) {
    expect(overviewDetail.orientationSpine?.summary?.nextAction).toBe(overviewDetail.startReadiness.message)
  }

  await page.goto('/projects/looma-knit/overview')
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  await expect(page.getByText('Stage 1: V1 Release Hardening').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '5 Current scope', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `${deferred} Deferred`, exact: true })).toBeVisible()
  await expect(page.getByText('5 work items in view')).toHaveCount(0)

  await page.goto('/projects/looma-knit/map')
  await expect(page.getByRole('heading', { name: 'Project map' })).toBeVisible()
  const projectMap = page.locator('.project-map')
  await expect(projectMap.getByText('Stage 1: V1 Release Hardening').first()).toBeVisible()
  await expect(projectMap.getByText('Unit tests: use-collections, use-presence, subdomain utils').first()).toBeVisible()
  await expect(projectMap.getByText('E2E tests: login -> create page -> edit -> search flow').first()).toBeVisible()
  await expectMapScopeDisclosure(projectMap, {
    label: 'Stage 1: V1 Release Hardening',
    included,
    boundaries: included,
    deferred,
  })
  await expect(projectMap.getByText('Looma Primitive Convergence').first()).toBeVisible()
  await expect(projectMap.getByText('Looma Editor Integration').first()).toBeVisible()
  await expect(projectMap.getByText('release-plan.md').first()).toBeVisible()
  await expect(projectMap.getByText('PROJECT_STATE.md').first()).toBeVisible()

  await page.goto('/projects/looma-knit/work')
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Current scope' })
  await expectProgressiveScopeWorkCount(page, { current: included, deferred })
})

test('consumed selected release is visible as complete while later work stays deferred', async ({ page }) => {
  const response = await page.request.get('/api/project?projectId=release-consumed')
  expect(response.ok()).toBe(true)
  const detail = await response.json()

  expect(detail.orientationSpine?.summary?.selectedReleaseLabel).toBe('Headless MVP')
  expect(detail.startReadiness).toMatchObject({
    canStart: false,
    code: 'all_terminal',
    message: 'Headless MVP has no runnable work remaining.',
  })
  expect(detail.orientationSpine?.summary?.topBlocker).toBeNull()

  await page.goto('/projects/release-consumed/overview')
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  await expect(page.getByText('Headless MVP').first()).toBeVisible()
  await expect(page.getByText('Headless MVP has no runnable work remaining.').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open item' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open Release', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Work' })).toHaveCount(0)
  await expect(page.getByText('1 Deferred').first()).toBeVisible()
  const scopeStatus = page.locator('.overview-priority-card')
  await expect(scopeStatus).toContainText('Release is ready')
  await expect(scopeStatus).toContainText('Headless MVP has no runnable work remaining.')
  await expect(scopeStatus).not.toContainText('Start next release feature')

  await page.goto('/projects/release-consumed/work')
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  await expect(page.getByText('Headless MVP has no runnable work remaining.').first()).toBeVisible()
  await expect(page.getByText('Start next release feature').first()).toBeVisible()
})

test('project shell uses stopped-project language consistently across flow surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 692 })
  const state = await readProjectFlowState(page, 'looma-knit')
  await page.goto('/projects/looma-knit')

  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  if (state.startCanStart && state.visibleActive > 0) {
    const resumeLabel = state.visibleActive === 1
      ? 'Resume 1 ready work item'
      : `Resume ${state.visibleActive} ready work items`
    await expect(page.getByRole('button', { name: resumeLabel })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ready to resume' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Moving now' })).toHaveCount(0)
  }

  await page.goto('/projects/looma-knit/work')
  if (state.startCanStart && state.runnableCount > 0) {
    await expect(page.getByRole('region', { name: 'Delivery queue' })).toContainText('Ready when resumed')
    await expect(page.getByRole('region', { name: 'Delivery queue' })).toContainText(`${state.runnableCount} ready to resume`)
    await expect(page.getByRole('region', { name: 'Delivery queue' })).not.toContainText('Runnable project work.')
  }

  const revsHeader = page.getByRole('button', { name: 'Revs' })
  await expect(revsHeader).toBeVisible()
  const revsMetrics = await revsHeader.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  expect(revsMetrics.scrollWidth).toBeLessThanOrEqual(revsMetrics.clientWidth)
})

test('selecting a work row does not make the passive Work list card look selected', async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 692 })
  await page.goto('/projects/narrative-harness/work')

  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  const before = await page.locator('.work-list-stack').evaluate((stack) => {
    const card = stack.closest('.gh-frame-card')
    if (!card) return null
    const style = getComputedStyle(card)
    return {
      borderColor: style.borderColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    }
  })

  await page.locator('.work-list-row').first().click()

  const after = await page.locator('.work-list-stack').evaluate((stack) => {
    const card = stack.closest('.gh-frame-card')
    const selectedRows = Array.from(stack.querySelectorAll('.work-list-row[aria-current="true"]'))
    if (!card) return null
    const style = getComputedStyle(card)
    return {
      borderColor: style.borderColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      selectedRowCount: selectedRows.length,
    }
  })

  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(after!.selectedRowCount).toBe(1)
  expect(after!.borderColor).toBe(before!.borderColor)
  expect(after!.outlineStyle).toBe(before!.outlineStyle)
  expect(after!.outlineWidth).toBe(before!.outlineWidth)
})

test('developer settings exposes migrations levers and design feedback state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/projects/looma-knit/settings/advanced')

  await expect(page.getByRole('heading', { name: 'Developer tools' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project migrations' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Raw behavior levers' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Design feedback' })).toBeVisible()
  await expect(page.getByText('Owner feedback', { exact: true })).toBeVisible()
  await expect(page.getByText('Decision packets', { exact: true })).toBeVisible()
})

test('settings subroutes keep focused panels in the project shell', async ({ page }) => {
  const settingsRoutes = [
    ['/projects/looma-knit/settings/ready', 'Ready to start?'],
    ['/projects/looma-knit/settings/providers', 'Project provider'],
    ['/projects/looma-knit/settings/coordinators', 'Coordinators'],
    ['/projects/looma-knit/settings/identity', 'Project identity'],
    ['/projects/looma-knit/settings/profile', 'Operating profile'],
    ['/projects/looma-knit/settings/advanced', 'Developer tools'],
  ] as const

  for (const [path, heading] of settingsRoutes) {
    await page.goto(path)
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
})

test('task drawer direct route renders tabs and closes to the overview background', async ({ page }) => {
  await page.goto('/projects/looma-knit/task/task-workspace-import?tab=spec')

  await expect(page.getByRole('complementary', { name: 'Task drawer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review existing project work' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Task drawer' }).getByRole('tab', { name: 'Spec' })).toBeVisible()

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/overview$/)
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
})

test('Narrative Harness re-intake mutation reports its migration prerequisite', async ({ page }) => {
  const rerun = await page.request.post('/api/project/reintake/rerun?projectId=narrative-harness')
  expect(rerun.status()).toBe(409)
  expect(await rerun.json()).toMatchObject({
    code: 'required_migration_pending',
    actionHref: '/migrations',
  })
})
