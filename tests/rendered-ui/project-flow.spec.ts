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
