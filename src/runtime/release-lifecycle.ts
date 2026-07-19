import type { ProjectRelease } from '@guildhall/core'

export interface ReleaseClosureReadiness {
  state?: string | null
  counts?: {
    total?: number
    done?: number
    unfinished?: number
    blocked?: number
    proofBlocked?: number
  } | null
}

export interface ReleaseCloseResult {
  ok: boolean
  code?: 'already_shipped' | 'not_ready' | 'no_work' | 'deferred'
  message?: string
  release: ProjectRelease
}

/**
 * Release lifecycle is deliberately small: readiness is derived from the
 * shared summary, while shipping is an explicit owner/delegate action.
 * There is no parallel "closure" record to keep in sync.
 */
export function closeReleaseIfReady(
  release: ProjectRelease,
  readiness: ReleaseClosureReadiness | null | undefined,
  now: string,
): ReleaseCloseResult {
  if (release.state === 'shipped') {
    return { ok: true, code: 'already_shipped', release }
  }
  if (release.state === 'deferred') {
    return {
      ok: false,
      code: 'deferred',
      message: 'Deferred release work is not the active release. Select it before shipping it.',
      release,
    }
  }
  const counts = readiness?.counts ?? {}
  const total = counts.total ?? 0
  if (total <= 0) {
    return {
      ok: false,
      code: 'no_work',
      message: 'This release has no tracked work to ship.',
      release,
    }
  }
  if (
    readiness?.state !== 'ready' ||
    (counts.done ?? 0) !== total ||
    (counts.unfinished ?? 0) > 0 ||
    (counts.blocked ?? 0) > 0 ||
    (counts.proofBlocked ?? 0) > 0
  ) {
    return {
      ok: false,
      code: 'not_ready',
      message: 'Finish the selected release work and its proof before shipping this release.',
      release,
    }
  }
  return {
    ok: true,
    release: {
      ...release,
      state: 'shipped',
      updatedAt: now,
    },
  }
}
