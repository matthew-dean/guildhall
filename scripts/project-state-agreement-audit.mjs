#!/usr/bin/env node

import process from 'node:process'
import { fileURLToPath } from 'node:url'

const baseUrl = (process.env.GUILDHALL_URL ?? 'http://localhost:7777').replace(/\/$/, '')
const requiredProjects = (process.env.GUILDHALL_AGREEMENT_PROJECTS ??
  'narrative-harness,looma-knit,jess,fair-labor-license')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
const timeoutMs = Number(process.env.GUILDHALL_READ_TIMEOUT_MS ?? 5000)

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${body.slice(0, 240)}`)
  return JSON.parse(body)
}

function projectBody(body) {
  return body?.summary && typeof body.summary === 'object' ? body.summary : body ?? {}
}

export function releaseFingerprint(value) {
  const release = value?.release ?? null
  const counts = value?.counts ?? {}
  return {
    scopeMode: value?.scopeMode ?? null,
    release: release
      ? { id: release.id ?? null, label: release.label ?? null, kind: release.kind ?? null, source: release.source ?? null }
      : null,
    state: value?.state ?? null,
    counts: {
      total: counts.total ?? 0,
      done: counts.done ?? 0,
      unfinished: counts.unfinished ?? 0,
      ready: counts.ready ?? 0,
      active: counts.active ?? 0,
      blocked: counts.blocked ?? 0,
      deferred: counts.deferred ?? 0,
      ownerBlocked: counts.ownerBlocked ?? 0,
      proofBlocked: counts.proofBlocked ?? 0,
    },
  }
}

export function startFingerprint(value) {
  return {
    canStart: value?.canStart ?? null,
    code: value?.code ?? null,
    focusTaskId: value?.focusTaskId ?? null,
    focusKind: value?.focusKind ?? null,
  }
}

export function actionFingerprint(value) {
  const primary = value?.primaryAction ?? null
  return {
    primary: primary
      ? {
          source: primary.source ?? null,
          taskId: primary.taskId ?? null,
          code: primary.code ?? null,
          label: primary.label ?? null,
          href: primary.href ?? null,
        }
      : null,
    runControl: value?.runControl
      ? { label: value.runControl.label ?? null, startEnabled: value.runControl.startEnabled ?? null }
      : null,
  }
}

export function selectedCounts(value) {
  const counts = value?.workProgress?.selectedCounts ?? {}
  return {
    visibleTotal: counts.visibleTotal ?? 0,
    visibleActive: counts.visibleActive ?? 0,
    visibleBlocked: counts.visibleBlocked ?? 0,
    visibleDone: counts.visibleDone ?? 0,
    visibleShelved: counts.visibleShelved ?? 0,
  }
}

function sortedMembers(value, field) {
  return Array.isArray(value?.[field])
    ? value[field].map(String).sort()
    : []
}

function releaseIdentity(value) {
  if (!value || typeof value !== 'object') return null
  return {
    id: value.id ?? null,
    label: value.label ?? null,
    kind: value.kind ?? null,
    source: value.source ?? null,
  }
}

function scopeMembership(value) {
  if (!value || typeof value !== 'object') return null
  return {
    id: value.id ?? null,
    nodeIds: sortedMembers(value, 'nodeIds'),
    deferredNodeIds: sortedMembers(value, 'deferredNodeIds'),
  }
}

function blockerIds(value) {
  if (!Array.isArray(value)) return null
  return value
    .map(blocker => typeof blocker === 'string' ? blocker : blocker?.id ?? blocker?.owningTaskId ?? blocker?.label ?? null)
    .map(value => value === null ? null : String(value))
    .sort()
}

function diagnosticTaskBlockerIds(value) {
  return (blockerIds(value) ?? [])
    .map(id => id.startsWith('task:') ? id.slice('task:'.length) : id)
    .filter(id => !id.startsWith('repo:') && !id.startsWith('repository-followup:'))
}

function revision(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function freshness(value, field = 'summaryFreshness') {
  return value?.[field] ?? value?.detailPayload?.freshness ?? null
}

export function selectedReleaseMismatches({
  projectId,
  surfaces,
  fleetProject,
  activity,
  releaseSummary,
  releaseDetail,
}) {
  const mismatches = []
  const overviewSpine = projectBody(surfaces?.overview).orientationSpine ?? {}
  const expectedRelease = releaseIdentity(overviewSpine.selectedRelease)
  const expectedScope = scopeMembership(overviewSpine.selectedTaskScope ?? overviewSpine.scope)
  const compareIdentity = (surface, field, value) => {
    if (value === undefined) return
    addMismatch(mismatches, projectId, surface, field, expectedRelease, releaseIdentity(value))
  }
  const compareScope = (surface, field, value) =>
    addMismatch(mismatches, projectId, surface, field, expectedScope, scopeMembership(value))

  for (const [surface, body] of Object.entries(surfaces ?? {})) {
    const spine = projectBody(body).orientationSpine ?? {}
    compareIdentity(surface, 'selected-release-identity', spine.selectedRelease)
    compareScope(surface, 'selected-release-membership', spine.selectedTaskScope ?? spine.scope)
  }

  compareIdentity('fleet', 'selected-release-identity', fleetProject?.releaseSummary?.release)
  compareIdentity('activity', 'selected-release-identity', activity?.releaseSummary?.release)
  compareIdentity('release-summary', 'selected-release-identity', releaseSummary?.release)
  compareIdentity('release-detail', 'selected-release-identity', releaseDetail?.release)

  if (expectedRelease) {
    compareScope('release-detail', 'selected-release-membership', releaseDetail?.scope)
  }

  return mismatches
}

export function blockerAgreementMismatches({
  projectId,
  surfaces,
  fleetProject,
  activity,
  releaseDetail,
}) {
  const mismatches = []
  const overview = projectBody(surfaces?.overview)
  const expected = blockerIds(overview.releaseSummary?.blockers)
  const compare = (surface, field, value) => {
    if (value === undefined) return
    addMismatch(mismatches, projectId, surface, field, expected, blockerIds(value))
  }
  const compareDiagnostic = (surface, value) => {
    if (value === undefined) return
    const actual = diagnosticTaskBlockerIds(value)
    const missing = (expected ?? []).filter(id => !actual.includes(id))
    if (missing.length > 0) {
      addMismatch(mismatches, projectId, surface, 'nested-diagnostic-blocker-ids', expected, actual)
    }
  }

  for (const [surface, body] of Object.entries(surfaces ?? {})) {
    const current = projectBody(body)
    compare(surface, 'release-blocker-ids', current.releaseSummary?.blockers)
    compare(surface, 'nested-release-blocker-ids', current.releaseReadiness?.releaseBlockers)
    compareDiagnostic(surface, current.releaseReadiness?.diagnostics?.releaseBlockers)
  }
  compare('fleet', 'release-blocker-ids', fleetProject?.releaseSummary?.blockers)
  compare('activity', 'release-blocker-ids', activity?.releaseSummary?.blockers)
  compare('release-detail', 'release-blocker-ids', releaseDetail?.releaseBlockers)
  compareDiagnostic('release-detail', releaseDetail?.diagnostics?.releaseBlockers)

  return mismatches
}

export function projectionStateMismatches({
  projectId,
  surfaces,
  activity,
  spine,
  releaseDetail,
  thread,
}) {
  const mismatches = []
  const states = [
    ...Object.entries(surfaces ?? {}).map(([surface, body]) => [surface, freshness(projectBody(body)), body]),
    ['activity', freshness(activity), activity],
    ['spine', freshness(spine), spine],
    ['release-detail-summary', freshness(releaseDetail), releaseDetail],
    ['release-detail-diagnostic', freshness(releaseDetail, 'diagnosticFreshness'), releaseDetail],
    ['thread', freshness(thread, 'currentThreadFreshness'), thread],
  ]

  for (const [surface, actual, body] of states) {
    addMismatch(mismatches, projectId, surface, 'projection-freshness', 'current', actual)
    if (actual !== 'current' && body?.requiresRefresh !== undefined) {
      addMismatch(mismatches, projectId, surface, 'projection-requires-refresh', true, body.requiresRefresh)
    }
  }

  return mismatches
}

export function revisionMismatches({
  projectId,
  spine,
  releaseDetail,
  thread,
}) {
  const mismatches = []
  const revisions = {
    source: revision(spine?.queueRevision),
    project: revision(spine?.projectRevision),
    diagnostic: revision(releaseDetail?.diagnosticSourceRevision ?? releaseDetail?.diagnostics?.sourceRevision),
    thread: revision(thread?.sourceRevision),
  }
  const present = (surface, field, value) =>
    addMismatch(mismatches, projectId, surface, field, true, value !== null)
  present('spine', 'saved-source-revision-present', revisions.source)
  present('spine', 'saved-project-revision-present', revisions.project)
  present('release-detail', 'saved-diagnostic-revision-present', revisions.diagnostic)
  present('thread', 'saved-thread-revision-present', revisions.thread)
  addMismatch(mismatches, projectId, 'release-detail', 'diagnostic-project-revision', revisions.project, revisions.diagnostic)
  addMismatch(mismatches, projectId, 'thread', 'thread-project-revision', revisions.project, revisions.thread)
  addMismatch(mismatches, projectId, 'release-detail', 'state-consistency', 'aligned', releaseDetail?.stateConsistency ?? null)
  return { revisions, mismatches }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function addMismatch(mismatches, projectId, surface, field, expected, actual) {
  if (same(expected, actual)) return
  mismatches.push({ projectId, surface, field, expected, actual })
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function sumCounts(counts) {
  return Object.values(counts ?? {}).reduce((total, value) => total + numeric(value), 0)
}

/**
 * Check the compact selected scope against the richer release read model.
 *
 * The compact projection is the fast, durable read model; the release detail
 * is allowed to explain more blockers, but it must not disagree about which
 * scoped tasks are done or unfinished. This is deliberately pure so the
 * contract has a cheap fixture test and the live audit uses the same check.
 */
export function releaseProjectionMismatches({
  projectId,
  compactRelease,
  selected,
  releaseDetail,
}) {
  const mismatches = []
  const detailScope = releaseDetail?.scope ?? null
  const detailTotals = releaseDetail?.totals ?? null
  const detailStatusCounts = releaseDetail?.statusCounts ?? null
  const hasDetailScope = Boolean(detailScope || detailTotals || detailStatusCounts)

  if (compactRelease?.scopeMode === 'named_release' && selected) {
    const compactCounts = compactRelease.counts ?? {}
    const selectedUnfinished = Math.max(
      0,
      numeric(selected.visibleTotal) - numeric(selected.visibleDone) - numeric(selected.visibleShelved),
    )
    addMismatch(mismatches, projectId, 'release-detail', 'compact-selected-total', numeric(compactCounts.total), numeric(selected.visibleTotal))
    addMismatch(mismatches, projectId, 'release-detail', 'compact-selected-done', numeric(compactCounts.done), numeric(selected.visibleDone))
    addMismatch(mismatches, projectId, 'release-detail', 'compact-selected-unfinished', numeric(compactCounts.unfinished), selectedUnfinished)
  }

  if (!hasDetailScope || !detailTotals) return mismatches

  const total = numeric(detailTotals.tasks)
  const done = numeric(detailTotals.done)
  const unfinished = numeric(detailTotals.unfinishedCount)
  const statusDone = numeric(detailStatusCounts?.done)
  addMismatch(mismatches, projectId, 'release-detail', 'status-counts-done-invariant', done, statusDone)
  addMismatch(mismatches, projectId, 'release-detail', 'status-counts-total-invariant', total, sumCounts(detailStatusCounts))
  addMismatch(mismatches, projectId, 'release-detail', 'completion-partition-invariant', total, done + unfinished)

  if (compactRelease?.scopeMode === 'named_release' && selected) {
    const selectedUnfinished = Math.max(
      0,
      numeric(selected.visibleTotal) - numeric(selected.visibleDone) - numeric(selected.visibleShelved),
    )
    addMismatch(mismatches, projectId, 'release-detail', 'compact-rich-total', numeric(selected.visibleTotal), total)
    addMismatch(mismatches, projectId, 'release-detail', 'compact-rich-done', numeric(selected.visibleDone), done)
    addMismatch(mismatches, projectId, 'release-detail', 'compact-rich-unfinished', selectedUnfinished, unfinished)
  }

  return mismatches
}

async function auditProject(projectId, fleetProject) {
  const mismatches = []
  const surfaces = await Promise.all(['overview', 'work', 'map'].map(async surface => [
    surface,
    await readJson(`/api/project?projectId=${encodeURIComponent(projectId)}&compact=true&surface=${surface}`),
  ]))
  const bySurface = Object.fromEntries(surfaces)
  const overview = projectBody(bySurface.overview)
  const [activity, releaseSummary, releaseDetail, spine, thread] = await Promise.all([
    readJson(`/api/project/activity?projectId=${encodeURIComponent(projectId)}`),
    readJson(`/api/project/release-readiness/summary?projectId=${encodeURIComponent(projectId)}`),
    readJson(`/api/project/release-readiness?projectId=${encodeURIComponent(projectId)}`),
    readJson(`/api/project/spine?projectId=${encodeURIComponent(projectId)}`),
    readJson(`/api/project/thread?projectId=${encodeURIComponent(projectId)}`),
  ])

  for (const [surface, body] of Object.entries(bySurface)) {
    const current = projectBody(body)
    addMismatch(mismatches, projectId, surface, 'summaryFreshness', overview.summaryFreshness ?? null, current.summaryFreshness ?? null)
    addMismatch(mismatches, projectId, surface, 'releaseSummary', releaseFingerprint(overview.releaseSummary), releaseFingerprint(current.releaseSummary))
    addMismatch(mismatches, projectId, surface, 'startReadiness', startFingerprint(overview.startReadiness), startFingerprint(current.startReadiness))
    addMismatch(mismatches, projectId, surface, 'actionModel', actionFingerprint(overview.actionModel), actionFingerprint(current.actionModel))
    addMismatch(mismatches, projectId, surface, 'selectedCounts', selectedCounts(overview), selectedCounts(current))
  }

  addMismatch(mismatches, projectId, 'fleet', 'releaseSummary', releaseFingerprint(overview.releaseSummary), releaseFingerprint(fleetProject?.releaseSummary))
  addMismatch(mismatches, projectId, 'fleet', 'startReadiness', startFingerprint(overview.startReadiness), startFingerprint(fleetProject?.startReadiness))
  addMismatch(mismatches, projectId, 'fleet', 'actionModel', actionFingerprint(overview.actionModel), actionFingerprint(fleetProject?.actionModel))
  addMismatch(mismatches, projectId, 'fleet', 'selectedCounts', selectedCounts(overview), selectedCounts(fleetProject))
  addMismatch(mismatches, projectId, 'activity', 'releaseSummary', releaseFingerprint(overview.releaseSummary), releaseFingerprint(activity.releaseSummary))
  addMismatch(mismatches, projectId, 'activity', 'actionModel', actionFingerprint(overview.actionModel), actionFingerprint(activity.actionModel))
  mismatches.push(...selectedReleaseMismatches({
    projectId,
    surfaces: bySurface,
    fleetProject,
    activity,
    releaseSummary,
    releaseDetail,
  }))
  mismatches.push(...blockerAgreementMismatches({
    projectId,
    surfaces: bySurface,
    fleetProject,
    activity,
    releaseDetail,
  }))
  mismatches.push(...projectionStateMismatches({
    projectId,
    surfaces: bySurface,
    activity,
    spine,
    releaseDetail,
    thread,
  }))
  const revisionResult = revisionMismatches({ projectId, spine, releaseDetail, thread })
  mismatches.push(...revisionResult.mismatches)

  const compactRelease = releaseFingerprint(overview.releaseSummary)
  const summaryRelease = releaseFingerprint({
    scopeMode: releaseSummary.release ? 'named_release' : 'unreleased',
    release: releaseSummary.release,
    state: releaseSummary.release?.state === 'ready' ? 'ready' : compactRelease.state,
    counts: {
      total: releaseSummary.totals?.tasks,
      done: releaseSummary.totals?.done,
      unfinished: releaseSummary.totals?.unfinishedCount,
      blocked: releaseSummary.totals?.blockingCount,
      ownerBlocked: releaseSummary.totals?.humanBlockingCount,
      proofBlocked: releaseSummary.totals?.proofEvidenceBlockingCount,
      ready: releaseSummary.statusCounts?.ready,
      active: releaseSummary.statusCounts?.active,
      deferred: releaseSummary.statusCounts?.deferred,
    },
  })
  // Compare normalized task state directly. Rich detail may add repository
  // blockers that are intentionally outside the compact task projection.
  addMismatch(mismatches, projectId, 'release-summary', 'release', compactRelease.release, summaryRelease.release)
  addMismatch(mismatches, projectId, 'release-summary', 'task-counts', compactRelease.counts, summaryRelease.counts)

  const detailRelease = releaseDetail.release ?? null
  const detailScope = releaseDetail.scope ?? null
  if (compactRelease.release || detailRelease || detailScope) {
    addMismatch(mismatches, projectId, 'release-detail', 'release-id', compactRelease.release?.id ?? null, detailRelease?.id ?? null)
    addMismatch(mismatches, projectId, 'release-detail', 'scope-id', compactRelease.release?.id ?? null, detailScope?.id ?? null)
    addMismatch(mismatches, projectId, 'release-detail', 'task-count', compactRelease.counts.total, releaseDetail.totals?.tasks ?? 0)
    addMismatch(mismatches, projectId, 'release-detail', 'done-count', compactRelease.counts.done, releaseDetail.totals?.done ?? 0)
    addMismatch(mismatches, projectId, 'release-detail', 'unfinished-count', compactRelease.counts.unfinished, releaseDetail.totals?.unfinishedCount ?? 0)
    addMismatch(mismatches, projectId, 'release-detail', 'scope-node-count', compactRelease.counts.total, detailScope?.nodeIds?.length ?? 0)
    addMismatch(mismatches, projectId, 'release-detail', 'deferred-node-count', compactRelease.counts.deferred, detailScope?.deferredNodeIds?.length ?? 0)
  }
  mismatches.push(...releaseProjectionMismatches({
    projectId,
    compactRelease,
    selected: selectedCounts(overview),
    releaseDetail,
  }))

  const focusTaskId = overview.startReadiness?.focusTaskId ?? overview.actionModel?.primaryAction?.taskId ?? null
  if (focusTaskId) {
    const detail = await readJson(`/api/project/task/${encodeURIComponent(focusTaskId)}?projectId=${encodeURIComponent(projectId)}`)
    addMismatch(mismatches, projectId, 'task-detail', 'selectedCounts', selectedCounts(overview), selectedCounts(detail))
  }

  return {
    projectId,
    release: compactRelease,
    revisions: revisionResult.revisions,
    focusTaskId,
    mismatchCount: mismatches.length,
    mismatches,
  }
}

export async function runAgreementAudit() {
  const fleet = await readJson('/api/service/projects')
  const projects = Array.isArray(fleet.projects) ? fleet.projects : []
  const fleetById = new Map(projects.map(project => [project.id, project]))
  const missing = requiredProjects.filter(id => !fleetById.has(id))
  const results = []
  for (const project of projects) {
    try {
      results.push(await auditProject(project.id, project))
    } catch (error) {
      results.push({ projectId: project.id, mismatchCount: 1, mismatches: [{ surface: 'audit', field: 'request', actual: error instanceof Error ? error.message : String(error) }] })
    }
  }
  const mismatches = [
    ...missing.map(projectId => ({ projectId, surface: 'fleet', field: 'required-project-missing' })),
    ...results.flatMap(result => result.mismatches ?? []),
  ]
  const output = {
    baseUrl,
    projectCount: projects.length,
    requiredProjects,
    missingProjects: missing,
    projects: results,
    mismatchCount: mismatches.length,
    pass: projects.length > 0 && missing.length === 0 && mismatches.length === 0,
  }
  console.log(JSON.stringify(output, null, 2))
  return output
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAgreementAudit().then(output => {
    if (!output.pass) process.exitCode = 1
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
