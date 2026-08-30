import { expect, test } from '@playwright/test'
import {
  defineFlowUserJob,
  expectProjectFlowStateAgreement,
  expectProjectOrientationSpineAgreement,
  expectNoClippedContent,
  readProjectFlowState,
} from './flow-audit-assertions'

async function applyRequiredProjectUpdates(page: import('@playwright/test').Page): Promise<void> {
  const gate = page.getByRole('region', { name: 'Project update required' })
  const workList = page.getByRole('heading', { name: 'Work list' })
  const currentWork = page.getByRole('region', { name: 'Current work' })
  await expect(gate.or(workList).or(currentWork)).toBeVisible()
  if (await workList.isVisible() || await currentWork.isVisible()) return

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
    name: 'legacy structure link opens map',
    path: '/projects/looma-knit/structure',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Project map' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Project map summary' })).toBeVisible()
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
      await expect(page.getByRole('heading', { name: 'Release exceptions' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Task-state tally' })).toHaveCount(0)
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
    name: 'docs-only legacy structure link opens map',
    path: '/projects/docs-compass/structure',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: 'Project map' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Project map summary' })).toBeVisible()
      await expect(page.getByTitle('Docs Compass')).toBeVisible()
    },
  },
  {
    name: 'infra release criteria',
    path: '/projects/pipeline-ops/release/criteria',
    assertions: async (page) => {
      await expect(page.getByRole('heading', { name: /^(Release|Scope) checks$/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Release exceptions' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Task-state tally' })).toHaveCount(0)
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
    name: 'legacy activity link opens overview',
    path: '/projects/api-broker/timeline',
    assertions: async (page) => {
      await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
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
    .getByRole('button', { name: 'Review project update' })
    .click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/overview\?repair=migration/)
  await expect(page.getByRole('dialog', { name: 'Migrate project' })).toBeVisible()
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

  const activityHeights = await cards.locator('.activity').evaluateAll((nodes) =>
    nodes.map(node => node.getBoundingClientRect().height),
  )
  expect(Math.max(...activityHeights)).toBeLessThan(28)

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

test('a required project update preempts the work dashboard with one clear action', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/projects/looma-knit/work?view=columns')

  const updateGate = page.getByRole('region', { name: 'Project update required' })
  await expect(updateGate).toBeVisible()
  await expect(updateGate.getByRole('button', { name: 'Review project update' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Work view controls' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Work list' })).toHaveCount(0)
  await expectNoClippedContent(page, {
    containerSelector: '[aria-label="Project update required"]',
    itemSelector: '[aria-label="Project update required"] button',
  })
})

test('browsing work is deliberate and remains readable at split-screen widths', async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 692 })
  await page.goto('/projects/narrative-harness/work')
  await applyRequiredProjectUpdates(page)

  await page.getByRole('button', { name: 'Browse work' }).click()
  await expect(page).toHaveURL(/\/projects\/narrative-harness\/work\?view=queue$/)
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible()
  await expect(page.locator('.work-list-row').first()).toBeVisible()
  expect(await page.locator('html').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(1115)

  await page.setViewportSize({ width: 900, height: 692 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible()
  await expect(page.locator('.work-list-row').first()).toBeVisible()
  expect(await page.locator('html').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(901)
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

test('project map gives a compact orientation and keeps detail behind inspection', async ({ page }) => {
  for (const projectId of ['narrative-harness', 'looma-knit']) {
    const response = await page.request.get(`/api/project?projectId=${projectId}&surface=map`)
    expect(response.ok()).toBe(true)
    const detail = await response.json()
    const scopeLabel = detail.orientationSpine?.summary?.selectedScopeLabel
      ?? detail.orientationSpine?.scope?.label
    expect(scopeLabel).toBeTruthy()

    await page.goto(`/projects/${projectId}/map`)
    const summary = page.getByRole('region', { name: 'Project map summary' })
    await expect(summary).toBeVisible()
    await expect(summary.getByText(scopeLabel, { exact: true })).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Open Work' })).toBeVisible()
    await expect(page.locator('details').first()).toBeVisible()
  }
})

test('a shipped release ends calmly and offers only the next-release entry point', async ({ page }) => {
  await page.goto('/projects/release-consumed/overview')
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  await expect(page.getByText('Headless MVP').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shipped' })).toBeVisible()
  await expect(page.getByText('There is nothing you need to do here.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start next release' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open item' })).toHaveCount(0)

})

test('project shell keeps a required update as the sole visible work interruption', async ({ page }) => {
  for (const [width, height] of [[1114, 692], [900, 692], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto('/projects/looma-knit')

    const overview = page.getByRole('region', { name: 'Project overview' })
    await expect(overview).toBeVisible()
    await expect(overview.getByRole('button', { name: 'Review project update' })).toBeVisible()
    await expectNoClippedContent(page, {
      containerSelector: '.overview-decision-card',
      itemSelector: '.overview-decision-card button',
    })
    expect(await page.locator('html').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(width + 1)
  }

  await page.goto('/projects/looma-knit/work')
  await expect(page.getByRole('region', { name: 'Project update required' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review project update' })).toBeVisible()
  expect(await page.locator('html').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(1115)
})

test('selecting a work row does not make the passive Work list card look selected', async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 692 })
  await page.goto('/projects/narrative-harness/work')
  await applyRequiredProjectUpdates(page)
  await page.getByRole('button', { name: 'Browse work' }).click()

  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible()
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

test('default settings is a chooser, not a readiness report', async ({ page }) => {
  await page.goto('/projects/looma-knit/settings')

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ready to start?' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Local runtime' })).toHaveCount(0)
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

test('the focused task drawer repeats the shared project action instead of a stale task-opening action', async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 692 })
  await page.goto('/projects/narrative-harness/work')
  await applyRequiredProjectUpdates(page)

  const projectResponse = await page.request.get('/api/project?projectId=narrative-harness&detail=true')
  expect(projectResponse.ok()).toBe(true)
  const projectSummary = await projectResponse.json() as {
    actionModel?: { primaryAction?: { taskId?: string; buttonLabel?: string; ownerHeading?: string; code?: string } | null }
  }
  const action = projectSummary.actionModel?.primaryAction
  expect(action?.taskId).toBeTruthy()
  expect(action?.buttonLabel).toBeTruthy()

  const taskRoute = `/projects/narrative-harness/task/${encodeURIComponent(action!.taskId!)}`
  for (const [width, height] of [[1114, 692], [900, 692], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto(taskRoute)
    const drawerAction = page.getByRole('region', { name: 'Current task action' })
    await expect(drawerAction).toBeVisible()
    await expect(drawerAction.getByRole('button', { name: action!.buttonLabel!, exact: true })).toBeVisible()
    if (action?.ownerHeading) await expect(drawerAction).toContainText(action.ownerHeading)
    await expect(drawerAction.getByRole('button', { name: 'Open task', exact: true })).toHaveCount(0)
    await expectNoClippedContent(page, {
      containerSelector: '[aria-label="Current task action"]',
      itemSelector: '[aria-label="Current task action"] button',
    })
    expect(await page.locator('html').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(width + 1)
  }
})
