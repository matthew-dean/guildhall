export type ReleaseStatusTone = 'ok' | 'warn' | 'neutral'
export type ReleaseCompletionState = 'empty' | 'incomplete' | 'work_complete' | 'complete'
export type ReleaseVerdictState = 'empty' | 'work_remaining' | 'blocked' | 'ready'

export interface ReleaseBlockerLike {
  id?: string
  title?: string
  label?: string
}

export interface ReleaseStatusSummary<State extends string = string> {
  state: State
  label: string
  tone: ReleaseStatusTone
  detail: string
}

export function releaseHumanBlockingPhrase(
  count: number,
  blockers: ReleaseBlockerLike[],
): string {
  const needsShaping = blockers.some(blocker => /brief|source-backed|shaping|clearer/i.test(`${blocker.label ?? ''} ${blocker.title ?? ''}`))
  if (needsShaping) return `${count} ${count === 1 ? 'needs shaping' : 'need shaping'}`
  return `${count} ${count === 1 ? 'needs you' : 'need you'}`
}

export function buildReleaseCompletionSummary(input: {
  ready: boolean
  totals: {
    tasks: number
    done: number
    unfinishedCount: number
    humanBlockingCount: number
  }
  releaseBlockers: ReleaseBlockerLike[]
}): ReleaseStatusSummary<ReleaseCompletionState> {
  const { ready, totals, releaseBlockers } = input
  if (totals.tasks === 0) {
    return {
      state: 'empty',
      label: 'No tracked work',
      tone: 'neutral',
      detail: 'No tasks in this scope yet.',
    }
  }
  const detail = [
    `${totals.done} / ${totals.tasks} done`,
    totals.unfinishedCount > 0 ? `${totals.unfinishedCount} unfinished` : null,
    totals.humanBlockingCount > 0 ? releaseHumanBlockingPhrase(totals.humanBlockingCount, releaseBlockers) : null,
  ].filter(Boolean).join(' · ')
  if (ready) {
    return {
      state: 'complete',
      label: 'Complete',
      tone: 'ok',
      detail,
    }
  }
  if (totals.done >= totals.tasks && totals.unfinishedCount === 0 && totals.humanBlockingCount === 0) {
    return {
      state: 'work_complete',
      label: 'Work complete',
      tone: 'ok',
      detail,
    }
  }
  return {
    state: 'incomplete',
    label: 'Not complete',
    tone: totals.unfinishedCount > 0 || totals.humanBlockingCount > 0 ? 'warn' : 'neutral',
    detail,
  }
}

export function buildReleaseVerdictSummary(input: {
  hasNamedRelease: boolean
  ready: boolean
  notReadyReason?: string
  totals: {
    tasks: number
    done: number
    blockingCount: number
    humanBlockingCount?: number
    proofEvidenceBlockingCount?: number
    unfinishedCount: number
    designSystemBlockingCount: number
    dirtyCheckoutBlockingCount: number
  }
  designSystem: { drafted?: boolean; approved?: boolean; reason?: string }
  dirtyCheckout: { ownedCount: number; error?: string }
}): ReleaseStatusSummary<ReleaseVerdictState> {
  const { hasNamedRelease, ready, notReadyReason, totals, designSystem, dirtyCheckout } = input
  const humanBlockingCount = totals.humanBlockingCount ?? 0
  const proofEvidenceBlockingCount = totals.proofEvidenceBlockingCount ?? 0
  const readinessNoun = hasNamedRelease ? 'release' : 'scope'
  const blockerNoun = hasNamedRelease ? 'release blocker' : 'scope blocker'
  if (totals.tasks === 0) {
    return {
      state: 'empty',
      label: 'Not yet',
      tone: 'warn',
      detail: `No tracked work yet. Shape the first task before judging ${readinessNoun} readiness.`,
    }
  }
  if (ready && totals.blockingCount === 0 && totals.unfinishedCount === 0 && totals.dirtyCheckoutBlockingCount === 0 && totals.designSystemBlockingCount === 0) {
    return {
      state: 'ready',
      label: 'Ready',
      tone: 'ok',
      detail: `${totals.done}/${totals.tasks} tasks done · no open ${blockerNoun}s.`,
    }
  }
  if (totals.unfinishedCount > 0) {
    return {
      state: 'work_remaining',
      label: 'Work remaining',
      tone: 'warn',
      detail: `${totals.unfinishedCount} task${totals.unfinishedCount === 1 ? '' : 's'} still need shaping, worker execution, review, or recovery.`,
    }
  }
  if (dirtyCheckout.ownedCount > 0) {
    return {
      state: 'blocked',
      label: 'Blocked',
      tone: 'warn',
      detail: `${dirtyCheckout.ownedCount} Guildhall-managed checkout ${dirtyCheckout.ownedCount === 1 ? 'file needs' : 'files need'} cleanup or landing.`,
    }
  }
  if (dirtyCheckout.error) {
    return {
      state: 'blocked',
      label: 'Blocked',
      tone: 'warn',
      detail: 'Could not inspect the project checkout.',
    }
  }
  if (totals.designSystemBlockingCount > 0) {
    return {
      state: 'blocked',
      label: 'Blocked',
      tone: 'warn',
      detail: designSystem.reason
        ?? (designSystem.drafted
          ? 'A design guardrail is drafted but still needs approval.'
          : 'No design-system guardrail is captured yet.'),
    }
  }
  return {
    state: 'blocked',
    label: 'Blocked',
    tone: 'warn',
    detail: notReadyReason
      ?? (proofEvidenceBlockingCount > 0
        ? `${proofEvidenceBlockingCount} ${proofEvidenceBlockingCount === 1 ? 'item needs' : 'items need'} proof evidence.`
        : humanBlockingCount > 0
          ? `${humanBlockingCount} ${humanBlockingCount === 1 ? 'item' : 'items'} waiting on you.`
          : `${totals.blockingCount} ${totals.blockingCount === 1 ? 'item blocks' : 'items block'} ${readinessNoun} readiness.`),
  }
}
