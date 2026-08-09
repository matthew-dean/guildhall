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
  runControlDisabledReason: string | null
  startReadinessMessage: string | null
  startReadinessCode: string | null
  visibleTotal: number
  visibleActive: number
  visibleBlocked: number
  selectedScopeTotal: number | null
  runnableCount: number
  waitingOnDependenciesCount: number
  firstRunnableId: string | null
  focusTaskId: string | null
  focusTaskTitle: string | null
  hasDeliveryQueue: boolean
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

export async function expectProgressiveScopeWorkCount(
  page: Page,
  expected: { current: number; deferred: number },
): Promise<{ current: number; deferred: number; total: number }> {
  const workListCount = page.locator('.work-list-count')
  await expect(workListCount).toHaveText(/^\d+ current items? · \d+ deferred items? · \d+ total$/)
  const match = (await workListCount.textContent())?.match(/^(\d+) current items? · (\d+) deferred items? · (\d+) total$/)
  expect(match).not.toBeNull()
  const current = Number(match?.[1])
  const deferred = Number(match?.[2])
  const total = Number(match?.[3])
  expect(current).toBe(expected.current)
  expect(deferred).toBe(expected.deferred)
  expect(current + deferred).toBe(total)
  return { current, deferred, total }
}

export async function readProjectFlowState(page: Page, projectId: string): Promise<ProjectFlowState> {
  const response = await page.request.get(`/api/project?projectId=${encodeURIComponent(projectId)}`)
  expect(response.ok()).toBe(true)
  const detail = await response.json()
  const queue = detail.deliverySpine?.queue ?? {}
  const hasDeliveryQueue = Boolean(detail.deliverySpine?.queue)
  const counts = detail.workProgress?.counts ?? {}
  const focusTaskId = typeof detail.decision?.execution?.focusTaskId === 'string'
    ? detail.decision.execution.focusTaskId
    : typeof detail.startReadiness?.focusTaskId === 'string'
      ? detail.startReadiness.focusTaskId
      : typeof queue.firstRunnable?.task?.id === 'string'
        ? queue.firstRunnable.task.id
        : null
  const focusTask = Array.isArray(detail.tasks)
    ? detail.tasks.find((task: { id?: string }) => task.id === focusTaskId)
    : null
  const scopeSummary = detail.orientationSpine?.summary ?? {}
  const scopeCurrent = scopeSummary.includedWorkCount ?? scopeSummary.includedCount
  const scopeDeferred = scopeSummary.deferredWorkCount ?? scopeSummary.deferredCount
  const selectedScopeTotal = typeof scopeCurrent === 'number' && typeof scopeDeferred === 'number'
    ? scopeCurrent + scopeDeferred
    : null

  return {
    startCanStart: detail.actionModel?.runControl?.startEnabled === true,
    runControlLabel: typeof detail.actionModel?.runControl?.label === 'string'
      ? detail.actionModel.runControl.label
      : null,
    runControlDisabledReason: typeof detail.actionModel?.runControl?.disabledReason === 'string'
      ? detail.actionModel.runControl.disabledReason
      : null,
    startReadinessMessage: typeof detail.actionModel?.runControl?.disabledReason === 'string'
      ? detail.actionModel.runControl.disabledReason
      : typeof detail.startReadiness?.message === 'string'
        ? detail.startReadiness.message
      : null,
    startReadinessCode: typeof detail.startReadiness?.code === 'string'
      ? detail.startReadiness.code
      : null,
    visibleTotal: counts.visibleTotal ?? 0,
    visibleActive: counts.visibleActive ?? 0,
    visibleBlocked: counts.visibleBlocked ?? 0,
    selectedScopeTotal,
    runnableCount: queue.runnable?.length ?? 0,
    waitingOnDependenciesCount: queue.blocked?.length ?? 0,
    firstRunnableId: queue.firstRunnable?.task?.id ?? null,
    focusTaskId,
    focusTaskTitle: typeof detail.decision?.execution?.focusTaskTitle === 'string'
      ? detail.decision.execution.focusTaskTitle
      : typeof detail.startReadiness?.focusTaskTitle === 'string'
        ? detail.startReadiness.focusTaskTitle
        : typeof focusTask?.title === 'string'
          ? focusTask.title
          : null,
    hasDeliveryQueue,
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
  await expect(page.getByText(`${state.selectedScopeTotal ?? state.visibleTotal} total`)).toBeVisible()

  if (state.startReadinessCode !== 'all_terminal') {
    const accessibleRunControlName = state.runControlLabel ?? state.runControlDisabledReason
    expect(accessibleRunControlName).toBeTruthy()
    const runControl = page.getByRole('button', { name: accessibleRunControlName!, exact: true })
    await expect(runControl).toBeVisible()
    if (!state.startCanStart) {
      await expect(runControl).toBeDisabled()
      if (state.runControlDisabledReason) {
        await expect(runControl).toHaveAttribute('title', state.runControlDisabledReason)
      }
    }
  }

  if (state.startCanStart) {
    if (state.hasDeliveryQueue) {
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
    }
  } else {
    if (state.startReadinessCode === 'all_terminal') {
      const readinessMessage = state.startReadinessMessage ?? state.runControlLabel
      expect(readinessMessage).toBeTruthy()
      await expect(page.getByText(readinessMessage!, { exact: true }).first()).toBeVisible()
    }
  }

  await page.goto(`/projects/${projectId}/thread`)
  await expect(page.getByRole('complementary', { name: 'Thread list' })).toBeVisible()

  if (state.startCanStart) {
    expect(state.focusTaskId).not.toBeNull()
    expect(state.focusTaskTitle).toBeTruthy()
    const selectedThread = page.locator('.thread-index-row[aria-current="true"]')
    await expect(selectedThread).toBeVisible()
    await expect(selectedThread).toContainText(state.focusTaskTitle!)
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
  await expect(page.getByRole('heading', { name: /^(Do this next|Scope status)$/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project orientation' })).toBeVisible()
  await expect(page.getByText(new RegExp(escapeRegExp(scopeLabel))).first()).toBeVisible()
  await expect(page.getByRole('button', { name: `${included} Current scope`, exact: true })).toBeVisible()
  if (deferred > 0) {
    await expect(page.getByRole('button', { name: `${deferred} Deferred`, exact: true })).toBeVisible()
  }
  await expect(page.getByText(new RegExp(`${included} work items in view`))).toHaveCount(0)
  if (topBlocker) {
    await expect(page.getByText(topBlocker).first()).toBeVisible()
  }
  const readinessMessage = typeof detail.startReadiness?.message === 'string'
    ? detail.startReadiness.message
    : null
  const runControlLabel = detail.actionModel?.runControl?.label
  const currentStateMessage = detail.startReadiness?.code === 'paused_live_work'
    ? runControlLabel
    : readinessMessage ?? runControlLabel
  if (typeof currentStateMessage === 'string' && currentStateMessage.trim()) {
    await expect(page.getByText(currentStateMessage, { exact: true }).first()).toBeVisible()
  }

  await page.goto(`/projects/${expected.projectId}/work`)
  await expect(page.getByRole('heading', { name: 'Work list' })).toBeVisible()
  const showFilter = page.getByLabel('Show', { exact: true })
  await showFilter.selectOption({ label: 'Current scope' })
  await expectProgressiveScopeWorkCount(page, { current: included, deferred })
  if (workAnchor) {
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
  const releaseReadinessResponse = await page.request.get(
    `/api/project/release-readiness/summary?projectId=${encodeURIComponent(expected.projectId)}`,
  )
  expect(releaseReadinessResponse.ok()).toBe(true)
  const releaseReadiness = await releaseReadinessResponse.json()
  const releaseVerdictTitle = releaseReadiness.verdict?.title ?? releaseReadiness.verdict?.label
  expect(releaseVerdictTitle).toBeTruthy()
  await expect(page.getByText(releaseVerdictTitle).first()).toBeVisible()
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
