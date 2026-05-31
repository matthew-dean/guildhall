import { expect, test } from '@playwright/test'

test('projects home scrolls at mobile size and opens explicit project routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 })
  await page.goto('/projects')

  await expect(page.getByRole('heading', { name: 'Projects & Workspaces' })).toBeVisible()
  await expect(page.getByText('Tiny demo')).toBeVisible()

  await page
    .locator('section.project-card')
    .filter({ has: page.getByRole('heading', { name: 'Looma + Knit' }) })
    .getByRole('button', { name: 'Open project' })
    .click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/overview$/)
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Looma + Knit' })).toBeVisible()
})

test('projects home keeps project cards compact for scanability', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects')

  await expect(page.getByRole('heading', { name: 'Projects & Workspaces' })).toBeVisible()
  const dashboard = page.getByRole('region', { name: 'Projects dashboard' })
  await expect(dashboard).toBeVisible()
  const panelBoxes = await dashboard.locator(':scope > div').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { height: box.height, top: box.top, right: box.right }
    }),
  )
  expect(panelBoxes).toHaveLength(3)
  expect(new Set(panelBoxes.map(box => Math.round(box.height))).size).toBe(1)
  expect(Math.max(...panelBoxes.map(box => box.right))).toBeGreaterThan(1380)

  const cards = page.locator('section.project-card')
  await expect(cards).toHaveCount(6)

  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { height: box.height, width: box.width, top: box.top, left: box.left, right: box.right }
    }),
  )
  expect(Math.max(...boxes.map(box => box.height))).toBeLessThan(260)
  expect(new Set(boxes.map(box => Math.round(box.top))).size).toBeGreaterThan(1)
  expect(Math.max(...boxes.map(box => box.top)) - Math.min(...boxes.map(box => box.top))).toBeLessThan(260)

  const rows = new Map<number, typeof boxes>()
  for (const box of boxes) {
    const top = Math.round(box.top)
    rows.set(top, [...(rows.get(top) ?? []), box])
  }
  for (const row of rows.values()) {
    expect(row.length).toBeGreaterThan(1)
    expect(Math.min(...row.map(box => box.width))).toBeGreaterThan(420)
    expect(Math.max(...row.map(box => box.right))).toBeGreaterThan(1380)
  }
})

test('legacy project routes fall back to project selection', async ({ page }) => {
  await page.goto('/project/thread')
  await expect(page.getByRole('heading', { name: 'Projects & Workspaces' })).toBeVisible()
})

test('required migration blocks thread work until it is applied', async ({ page }) => {
  await page.goto('/projects/looma-knit/thread')

  await expect(page.getByRole('heading', { name: 'Thread' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Required migration:/ }).first()).toBeVisible()
  await expect(page.getByText('Which controls belong in the link editor?')).toHaveCount(0)

  await page.getByRole('button', { name: 'Migrate project' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Migrate project' })).toBeVisible()
  await expect(page.getByText('Review the file changes first')).toBeVisible()
  await page.getByRole('button', { name: 'Apply required migration' }).click()
  await expect(page.getByText('Migration applied.')).toBeVisible()
  await page.getByRole('dialog', { name: 'Migrate project' }).getByRole('button', { name: 'Close' }).last().click()

  const card = page.locator('section').filter({ hasText: 'Block menu / block side menu' }).first()
  await expect(card).toBeVisible()
  await expect(card.getByText('Which controls belong in the link editor?')).toBeVisible()
  await expect(page.getByText('Which controls belong in the link editor?')).toHaveCount(1)

  const choice = card.getByRole('button', { name: 'URL input + Display text input' })
  await expect(choice).toBeVisible()

  const choiceBox = await choice.boundingBox()
  const markBox = await choice.locator('.choice-mark').boundingBox()
  expect(choiceBox).not.toBeNull()
  expect(markBox).not.toBeNull()
  const choiceCenter = choiceBox!.y + choiceBox!.height / 2
  const markCenter = markBox!.y + markBox!.height / 2
  expect(Math.abs(choiceCenter - markCenter)).toBeLessThanOrEqual(3)
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

test('work view switcher swaps between columns list and board surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/projects/looma-knit/work?view=columns')

  await expect(page.getByRole('toolbar', { name: 'Work view controls' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Columns' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Work hierarchy columns')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Work list' })).toHaveCount(0)

  await page.getByRole('button', { name: 'List' }).click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/work\?view=list$/)
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Columns' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeVisible()
  await expect(page.getByLabel('Work hierarchy columns')).toHaveCount(0)

  await page.getByRole('button', { name: 'Columns' }).click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/work\?view=columns$/)
  await expect(page.getByLabel('Work hierarchy columns')).toBeVisible()

  await page.getByRole('button', { name: 'Board' }).click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/work\?view=board$/)
  await expect(page.getByText('Next focus')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Columns' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeVisible()
})

test('advanced settings exposes design taste and interactable catalog state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/projects/looma-knit/settings/advanced')

  await expect(page.getByRole('heading', { name: 'Advanced settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible()
  await expect(page.getByText('Taste memory')).toBeVisible()
  await expect(page.getByText('warm-functional-polish', { exact: true })).toBeVisible()
  await expect(page.getByText('segmented-control-or-tabs', { exact: true })).toBeVisible()
  await expect(page.getByText('Catalog', { exact: true })).toBeVisible()
  await expect(page.getByText(/guildhall-portable · 1 item/)).toBeVisible()
  await expect(page.getByText('Guildhall portable stories are available as the interactable catalog')).toBeVisible()
  await expect(page.getByText('Intent preview', { exact: true })).toBeVisible()
  await expect(page.getByText('web · real-web-preview', { exact: true })).toBeVisible()
  await expect(page.getByText('Native proof', { exact: true })).toBeVisible()
  await expect(page.getByText('not required', { exact: true })).toBeVisible()
  await expect(page.getByText('Owner feedback', { exact: true })).toBeVisible()
  await expect(page.getByText('Decision packets', { exact: true })).toBeVisible()
})
