/**
 * Ported from openharness/src/openharness/hooks/types.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python frozen dataclasses → TS interfaces (treated as read-only by
 *     convention; the codebase never mutates HookResult after construction)
 *   - `AggregatedHookResult.blocked` and `reason` properties → plain helpers
 *     on the interface (`aggregatedBlocked`, `aggregatedReason`); callers get
 *     the same ergonomic read-as-property shape via the helper functions
 */

export interface HookResult {
  hook_type: string
  success: boolean
  output: string
  blocked: boolean
  reason: string
  metadata: Record<string, unknown>
}

export interface AggregatedHookResult {
  results: HookResult[]
}

export function aggregatedBlocked(agg: AggregatedHookResult): boolean {
  return agg.results.some((r) => r.blocked)
}

export function aggregatedReason(agg: AggregatedHookResult): string {
  for (const r of agg.results) {
    if (r.blocked) return r.reason || r.output
  }
  return ''
}

export function makeHookResult(partial: Partial<HookResult> & { hook_type: string; success: boolean }): HookResult {
  return {
    output: '',
    blocked: false,
    reason: '',
    metadata: {},
    ...partial,
  }
}
