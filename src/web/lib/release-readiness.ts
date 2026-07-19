import type { ProjectReleaseReadiness } from './types.js'
import {
  buildReleaseCompletionSummary,
  buildReleaseVerdictSummary,
  type ReleaseStatusSummary,
  type ReleaseStatusTone,
} from '@guildhall/shared'

type ReleaseReadinessLike = ProjectReleaseReadiness & {
  designSystem?: {
    drafted?: boolean
    approved?: boolean
    reason?: string
  }
  dirtyCheckout?: {
    ownedCount?: number
    error?: string
  }
}

function unfinishedCountFromStatusCounts(statusCounts: ProjectReleaseReadiness['statusCounts'] | undefined): number {
  if (!statusCounts) return 0
  const terminal = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
  return Object.entries(statusCounts).reduce((total, [status, count]) => {
    return terminal.has(status) ? total : total + count
  }, 0)
}

export function releaseCompletionSummary(
  releaseReadiness: ReleaseReadinessLike | null | undefined,
): ReleaseStatusSummary | null {
  if (!releaseReadiness) return null
  const shared = releaseReadiness.completion
  if (shared?.label && shared?.detail) {
    return {
      state: shared.state ?? 'incomplete',
      label: shared.label,
      tone: shared.tone === 'ok' || shared.tone === 'warn' ? shared.tone : 'neutral',
      detail: shared.detail,
    }
  }
  const totals = releaseReadiness.totals
  const taskCount = totals?.tasks ?? 0
  const unfinished = totals?.unfinishedCount ?? unfinishedCountFromStatusCounts(releaseReadiness.statusCounts)
  const humanBlocking = totals?.humanBlockingCount ?? 0
  const effectiveReady = releaseReadiness.ready ?? (
    taskCount > 0 &&
    (totals?.blockingCount ?? 0) === 0 &&
    unfinished === 0 &&
    humanBlocking === 0 &&
    (totals?.dirtyCheckoutBlockingCount ?? 0) === 0 &&
    (totals?.designSystemBlockingCount ?? 0) === 0
  )
  const summary = buildReleaseCompletionSummary({
    ready: effectiveReady,
    totals: {
      tasks: taskCount,
      done: totals?.done ?? 0,
      unfinishedCount: unfinished,
      humanBlockingCount: humanBlocking,
    },
    releaseBlockers: releaseReadiness.releaseBlockers ?? [],
  })
  if (summary.state === 'empty' && releaseReadiness.notReadyReason) {
    return { ...summary, detail: releaseReadiness.notReadyReason }
  }
  return summary
}

export function releaseVerdictSummary(
  releaseReadiness: ReleaseReadinessLike | null | undefined,
): ReleaseStatusSummary | null {
  if (!releaseReadiness) return null
  const shared = releaseReadiness.verdict
  if (shared?.label && shared?.detail) {
    return {
      state: shared.state ?? 'blocked',
      label: shared.label,
      tone: shared.tone === 'ok' || shared.tone === 'warn' ? shared.tone : 'neutral',
      detail: shared.detail,
    }
  }
  const totals = releaseReadiness.totals
  const hasNamedRelease = Boolean(releaseReadiness.release?.label)
  const readinessNoun = hasNamedRelease ? 'release' : 'scope'
  const blockerNoun = hasNamedRelease ? 'release blocker' : 'scope blocker'
  const taskCount = totals?.tasks ?? 0
  const doneCount = totals?.done ?? 0
  const unfinishedCount = totals?.unfinishedCount ?? unfinishedCountFromStatusCounts(releaseReadiness.statusCounts)
  const dirtyCheckoutCount = releaseReadiness.dirtyCheckout?.ownedCount ?? totals?.dirtyCheckoutBlockingCount ?? 0
  const designSystemBlockingCount = totals?.designSystemBlockingCount ?? (
    releaseReadiness.designSystem?.approved === false ? 1 : 0
  )
  const blockingCount = totals?.blockingCount ?? 0
  const humanBlockingCount = totals?.humanBlockingCount ?? 0
  const effectiveReady = releaseReadiness.ready ?? (
    taskCount > 0 &&
    blockingCount === 0 &&
    unfinishedCount === 0 &&
    dirtyCheckoutCount === 0 &&
    designSystemBlockingCount === 0
  )
  const summary = buildReleaseVerdictSummary({
    hasNamedRelease: Boolean(releaseReadiness.release?.label),
    ready: effectiveReady,
    ...(releaseReadiness.notReadyReason ? { notReadyReason: releaseReadiness.notReadyReason } : {}),
    totals: {
      tasks: taskCount,
      done: doneCount,
      blockingCount,
      humanBlockingCount,
      proofEvidenceBlockingCount: totals?.proofEvidenceBlockingCount ?? 0,
      unfinishedCount,
      designSystemBlockingCount,
      dirtyCheckoutBlockingCount: dirtyCheckoutCount,
    },
    designSystem: releaseReadiness.designSystem ?? {},
    dirtyCheckout: {
      ownedCount: dirtyCheckoutCount,
      ...(releaseReadiness.dirtyCheckout?.error ? { error: releaseReadiness.dirtyCheckout.error } : {}),
    },
  })
  if (releaseReadiness.notReadyReason && blockingCount === 0 && summary.state === 'blocked') {
    return { ...summary, detail: releaseReadiness.notReadyReason }
  }
  return summary
}
