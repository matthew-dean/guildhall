import { expect, type Page } from '@playwright/test'

export interface FlowUserJob {
  route: string
  projectId: string
  expectation: string
}

export interface GeometryTarget {
  containerSelector: string
  itemSelector: string
  horizontalScrollSelector?: string
}

export interface ProjectFlowState {
  startCanStart: boolean
  runControlLabel: string | null
  visibleTotal: number
  visibleActive: number
  visibleBlocked: number
  runnableCount: number
  waitingOnDependenciesCount: number
  firstRunnableId: string | null
}

export interface ProjectOrientationExpectation {
  projectId: string
  workAnchorLabel?: string
  threadAnchorLabel?: string
  releaseNodeLabel?: string
  minIncludedWorkCount?: number
  minRootCount?: number
  minPinCount?: number
  minGapCount?: number
  requireInferredPurpose?: boolean
  requireMissingCharterGap?: boolean
}

export function defineFlowUserJob(input: FlowUserJob): FlowUserJob {
  expect(input.route).toMatch(/^\//)
  expect(input.projectId.length).toBeGreaterThan(0)
  expect(input.expectation).toContain('what is happening now')
  expect(input.expectation).toContain('what is queued')
  expect(input.expectation).toContain('what is blocked')
  expect(input.expectation).toContain('what they can do next')
  expect(input.expectation).toContain('whether the system is actually working')
  return input
}

export async function readProjectFlowState(page: Page, projectId: string): Promise<ProjectFlowState> {
  const response = await page.request.get(`/api/project?projectId=${encodeURIComponent(projectId)}`)
  expect(response.ok()).toBe(true)
  const detail = await response.json()
  const queue = detail.deliverySpine?.queue ?? {}
  const counts = detail.workProgress?.counts ?? {}

  return {
    startCanStart: detail.startReadiness?.canStart === true,
    runControlLabel: typeof detail.actionModel?.runControl?.label === 'string'
      ? detail.actionModel.runControl.label
      : null,
    visibleTotal: counts.visibleTotal ?? 0,
    visibleActive: counts.visibleActive ?? 0,
    visibleBlocked: counts.visibleBlocked ?? 0,
    runnableCount: queue.runnable?.length ?? 0,
    waitingOnDependenciesCount: queue.blocked?.length ?? 0,
    firstRunnableId: queue.firstRunnable?.task?.id ?? null,
  }
}

export async function expectNoClippedContent(page: Page, target: GeometryTarget): Promise<void> {
  const metrics = await page.locator(target.containerSelector).evaluate((container, targetArg) => {
    const itemNodes = Array.from(document.querySelectorAll(targetArg.itemSelector))
    const scrollNode = targetArg.horizontalScrollSelector
      ? document.querySelector(targetArg.horizontalScrollSelector)
      : container
    const containerBox = container.getBoundingClientRect()
    const scrollBox = scrollNode?.getBoundingClientRect() ?? containerBox
    const itemBoxes = itemNodes.map(node => node.getBoundingClientRect())
    const itemMaxRight = itemBoxes.length ? Math.max(...itemBoxes.map(box => box.right)) : containerBox.right
    const itemMinLeft = itemBoxes.length ? Math.min(...itemBoxes.map(box => box.left)) : containerBox.left
    const scrollStyle = scrollNode ? getComputedStyle(scrollNode) : null

    return {
      containerLeft: containerBox.left,
      containerRight: containerBox.right,
      itemMinLeft,
      itemMaxRight,
      overflowX: scrollStyle?.overflowX ?? null,
      scrollClientWidth: scrollNode?.clientWidth ?? null,
      scrollWidth: scrollNode?.scrollWidth ?? null,
      scrollLeft: scrollBox.left,
      scrollRight: scrollBox.right,
    }
  }, target)

  expect(metrics.scrollLeft).toBeGreaterThanOrEqual(metrics.containerLeft - 1)
  expect(metrics.scrollRight).toBeLessThanOrEqual(metrics.containerRight + 1)

  if (metrics.scrollWidth !== null && metrics.scrollClientWidth !== null && metrics.scrollWidth > metrics.scrollClientWidth + 1) {
    expect(['auto', 'scroll']).toContain(metrics.overflowX)
    return
  }

  expect(metrics.itemMinLeft).toBeGreaterThanOrEqual(metrics.containerLeft - 1)
  expect(metrics.itemMaxRight).toBeLessThanOrEqual(metrics.containerRight + 1)
}

export async function expectProjectFlowStateAgreement(page: Page, projectId: string): Promise<ProjectFlowState> {
  const state = await readProjectFlowState(page, projectId)

  await page.goto(`/projects/${projectId}/work`)
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  await expect(page.getByText(`${state.visibleTotal} total`)).toBeVisible()

  if (state.startCanStart) {
    await expect(page.getByText(`${state.runnableCount} RUNNABLE`)).toBeVisible()
    if (state.waitingOnDependenciesCount > 0) {
      await expect(page.getByText(`${state.waitingOnDependenciesCount} WAITING ON DEPENDENCIES`)).toBeVisible()
    } else {
      await expect(page.getByText(/\d+ WAITING ON DEPENDENCIES/)).toHaveCount(0)
    }
    if (state.visibleBlocked > 0) {
      await expect(page.getByText(`${state.visibleBlocked} blocked tasks`)).toBeVisible()
    } else {
      await expect(page.getByText(/\d+ blocked tasks/)).toHaveCount(0)
    }
  } else {
    expect(state.runControlLabel).toBeTruthy()
    await expect(page.getByText(state.runControlLabel!, { exact: true }).first()).toBeVisible()
  }

  await page.goto(`/projects/${projectId}/thread`)
  await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()

  if (state.startCanStart) {
    expect(state.runnableCount).toBe(state.visibleActive)
    expect(state.firstRunnableId).not.toBeNull()
  }
  return state
}

export async function expectProjectOrientationSpineAgreement(
  page: Page,
  expected: ProjectOrientationExpectation,
): Promise<void> {
  await ensureProjectMigrationsApplied(page, expected.projectId)
  const response = await page.request.get(`/api/project/spine?projectId=${encodeURIComponent(expected.projectId)}`)
  expect(response.ok()).toBe(true)
  const body = await response.json()
  const detailResponse = await page.request.get(`/api/project?projectId=${encodeURIComponent(expected.projectId)}`)
  expect(detailResponse.ok()).toBe(true)
  const detail = await detailResponse.json()
  const spine = body.spine ?? {}
  const summary = spine.summary ?? {}
  const scopeLabel = summary.selectedScopeLabel ?? spine.scope?.label
  const headline = summary.headline
  const purpose = summary.purpose ?? spine.charter?.goal
  const included = summary.includedWorkCount ?? summary.includedCount ?? 0
  const deferred = summary.deferredWorkCount ?? summary.deferredCount ?? 0
  const rootCount = Array.isArray(spine.roots) ? spine.roots.length : 0
  const gapCount = Array.isArray(spine.gaps) ? spine.gaps.length : 0
  const topBlocker = typeof summary.topBlocker === 'string'
    ? summary.topBlocker
    : summary.topBlocker?.label
  const pinCount = Array.isArray(spine.activePins)
    ? spine.activePins.length
    : Array.isArray(summary.pinnedNow)
      ? summary.pinnedNow.length
      : 0
  const releaseNodeId = spine.release?.blockers?.[0]?.owningNodeId
  const releaseNodeLabel = expected.releaseNodeLabel
    ?? (releaseNodeId ? spine.nodes?.[releaseNodeId]?.title : null)
  const workAnchor = expected.workAnchorLabel
    ?? spine.activePins?.[0]?.label
    ?? spine.roots?.[0]?.title
  const threadAnchor = expected.threadAnchorLabel
    ?? spine.activePins?.[0]?.label

  expect(headline).toBeTruthy()
  expect(scopeLabel).toBeTruthy()
  expect(purpose).toBeTruthy()
  if (expected.minIncludedWorkCount != null) {
    expect(included).toBeGreaterThanOrEqual(expected.minIncludedWorkCount)
  }
  if (expected.minRootCount != null) {
    expect(rootCount).toBeGreaterThanOrEqual(expected.minRootCount)
  }
  if (expected.minPinCount != null) {
    expect(pinCount).toBeGreaterThanOrEqual(expected.minPinCount)
  }
  if (expected.minGapCount != null) {
    expect(gapCount).toBeGreaterThanOrEqual(expected.minGapCount)
  }
  if (expected.requireInferredPurpose) {
    expect(spine.charter?.source).toBe('inferred')
    expect(purpose).not.toMatch(/needs a confirmed purpose/i)
  }
  if (expected.requireMissingCharterGap) {
    expect(spine.gaps?.some((gap: { kind?: string }) => gap.kind === 'missing_charter')).toBe(true)
  }

  await page.goto(`/projects/${expected.projectId}/overview`)
  await expect(page.getByRole('region', { name: 'Project overview' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project state' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Do this next' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Current scope map' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Project orientation' })).toBeVisible()
  await expect(page.getByText(new RegExp(escapeRegExp(scopeLabel))).first()).toBeVisible()
  await expect(page.getByText(new RegExp(`${included} work items in view`))).toBeVisible()
  await expect(page.getByText(new RegExp(`${deferred} deferred`))).toBeVisible()
  if (pinCount > 0) {
    await expect(page.getByText(/Current focus:/)).toBeVisible()
  }
  if (topBlocker) {
    await expect(page.getByText(topBlocker).first()).toBeVisible()
  }
  const runControlLabel = detail.actionModel?.runControl?.label
  if (typeof runControlLabel === 'string' && runControlLabel.trim()) {
    await expect(page.getByText(runControlLabel, { exact: true }).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/work`)
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  if (workAnchor) {
    const showFilter = page.getByLabel('Show', { exact: true })
    if (await showFilter.count() > 0) {
      await showFilter.selectOption({ label: 'All' })
    }
    await expect(page.getByText(workAnchor).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/thread`)
  await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()
  if (threadAnchor) {
    await expect(page.getByText(threadAnchor).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/release`)
  await expect(page.getByRole('heading', { name: /^(Release|Scope) readiness$/ })).toBeVisible()
  await expect(page.getByText(headline).first()).toBeVisible()
  if (topBlocker) {
    await expect(page.getByText(topBlocker).first()).toBeVisible()
  }
  if (releaseNodeLabel) {
    await expect(page.getByText(releaseNodeLabel).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/structure`)
  await expect(page.getByRole('heading', { name: 'Structure', exact: true })).toBeVisible()
  await expect(page.getByText(headline).first()).toBeVisible()
  await expect(page.getByText(`${included} included · ${deferred} later`).first()).toBeVisible()
}

async function ensureProjectMigrationsApplied(page: Page, projectId: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const statusResponse = await page.request.get(`/api/project/migrations?projectId=${encodeURIComponent(projectId)}`)
    expect(statusResponse.ok()).toBe(true)
    const status = await statusResponse.json()
    if (!Array.isArray(status.blocked) || status.blocked.length === 0) return
    const applyResponse = await page.request.post(`/api/project/migrations/apply?projectId=${encodeURIComponent(projectId)}`, {
      data: { includePrompt: true },
    })
    expect(applyResponse.ok()).toBe(true)
  }
  const finalStatusResponse = await page.request.get(`/api/project/migrations?projectId=${encodeURIComponent(projectId)}`)
  expect(finalStatusResponse.ok()).toBe(true)
  const finalStatus = await finalStatusResponse.json()
  expect(Array.isArray(finalStatus.blocked) ? finalStatus.blocked.length : 0).toBe(0)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
