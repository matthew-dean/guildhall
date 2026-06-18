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
  visibleTotal: number
  visibleActive: number
  visibleBlocked: number
  runnableCount: number
  blockedQueueCount: number
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
    visibleTotal: counts.visibleTotal ?? 0,
    visibleActive: counts.visibleActive ?? 0,
    visibleBlocked: counts.visibleBlocked ?? 0,
    runnableCount: queue.runnable?.length ?? 0,
    blockedQueueCount: queue.blocked?.length ?? 0,
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
    if (state.blockedQueueCount > 0) {
      await expect(page.getByText(`${state.blockedQueueCount} BLOCKED`)).toBeVisible()
    } else {
      await expect(page.getByText(/\d+ BLOCKED/)).toHaveCount(0)
    }
    if (state.visibleBlocked > 0) {
      await expect(page.getByText(`${state.visibleBlocked} blocked tasks`)).toBeVisible()
    } else {
      await expect(page.getByText(/\d+ blocked tasks/)).toHaveCount(0)
    }
  } else {
    await expect(page.getByRole('button', { name: 'Migrate project' })).toBeVisible()
  }

  await page.goto(`/projects/${projectId}/thread`)
  await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()

  if (state.startCanStart) {
    expect(state.runnableCount).toBe(state.visibleActive)
    expect(state.blockedQueueCount).toBe(state.visibleBlocked)
    expect(state.firstRunnableId).not.toBeNull()
  }
  return state
}

export async function expectProjectOrientationSpineAgreement(
  page: Page,
  expected: ProjectOrientationExpectation,
): Promise<void> {
  const response = await page.request.get(`/api/project/spine?projectId=${encodeURIComponent(expected.projectId)}`)
  expect(response.ok()).toBe(true)
  const body = await response.json()
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
    ?? spine.roots?.[0]?.title

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
  await expect(page.getByRole('region', { name: 'Project knowledge summary' })).toBeVisible()
  await expect(page.getByText(new RegExp(escapeRegExp(scopeLabel)))).toBeVisible()
  await expect(page.getByText(new RegExp(`${included} work items in view`))).toBeVisible()
  await expect(page.getByText(new RegExp(`${deferred} deferred`))).toBeVisible()
  if (pinCount > 0) {
    await expect(page.getByText(/Current focus:/)).toBeVisible()
  }
  if (topBlocker) {
    await expect(page.getByText(topBlocker).first()).toBeVisible()
  }
  const primaryActions = await page.locator('.overview-priority button').count()
  expect(primaryActions).toBe(1)

  await page.goto(`/projects/${expected.projectId}/work`)
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  if (workAnchor) {
    await expect(page.getByText(workAnchor).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/thread`)
  await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()
  if (threadAnchor) {
    await expect(page.getByText(threadAnchor).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/release`)
  await expect(page.getByRole('heading', { name: 'Current work closure' })).toBeVisible()
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
