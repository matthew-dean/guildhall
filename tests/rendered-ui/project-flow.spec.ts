import { expect, test } from '@playwright/test'

test('projects home scrolls at mobile size and opens explicit project routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 })
  await page.goto('/projects')

  await expect(page.getByRole('heading', { name: 'Your local Guildhall service' })).toBeVisible()
  await expect(page.getByText('Tiny demo')).toBeVisible()

  await page
    .locator('section.project-card')
    .filter({ has: page.getByRole('heading', { name: 'Looma + Knit' }) })
    .getByRole('button', { name: 'Open project' })
    .click()
  await expect(page).toHaveURL(/\/projects\/looma-knit\/thread$/)
  await expect(page.getByRole('heading', { name: 'Thread' })).toBeVisible()
})

test('legacy project routes canonicalize to the loaded project slug', async ({ page }) => {
  await page.goto('/project/thread')
  await expect(page).toHaveURL(/\/projects\/looma-knit\/thread$/)
})

test('thread keeps task questions inside the task card and centers answer controls', async ({ page }) => {
  await page.goto('/projects/looma-knit/thread')

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
