import type { Task, GateResult } from '@guildhall/core'
import {
  runGuildDeterministicChecks,
  selectApplicableGuilds,
  type CheckResult,
  type GuildSignals,
} from '@guildhall/guilds'

/**
 * At `gate_check`, each applicable guild's deterministic checks get a pre-
 * pass before the shell hard gates fire. Results are translated into the
 * canonical `GateResult` shape (`type: 'soft'`) so they land on
 * `task.gateResults` alongside typecheck/build/test/lint output. That way
 * the reviewer audit trail and the dashboard see guild checks exactly the
 * way they see shell gates — one unified list.
 *
 * This file is pure + composable. The orchestrator owns the I/O (read the
 * design system, apply results to the queue); this just takes signals in
 * and returns typed `GateResult[]`s.
 */

export interface RunGuildGatesInput {
  task: Task
  signals: GuildSignals
  now: string
}

export interface RunGuildGatesOutput {
  /** One `GateResult` per check that actually ran. Skipped checks are omitted. */
  gateResults: GateResult[]
  /** Raw `CheckResult`s for structured consumers (dashboard, verdicts). */
  rawResults: CheckResult[]
  /** True iff every non-skipped check passed. */
  allPassed: boolean
}

/**
 * Translate a guild `CheckResult` into the task-level `GateResult` shape.
 * The gate id is namespaced by guild slug (already done by each check's
 * `id` field, e.g. `a11y.contrast-matrix`) so the audit trail clearly
 * attributes the finding.
 */
function checkResultToGateResult(check: CheckResult, now: string): GateResult {
  const output = [check.summary, check.detail ?? '']
    .filter(Boolean)
    .join('\n\n')
    .trim()
  return {
    gateId: check.checkId,
    type: 'soft',
    passed: check.pass,
    ...(output ? { output } : {}),
    checkedAt: now,
  }
}

/**
 * Determine whether a `CheckResult` actually executed vs. was skipped. The
 * guild conventions: a skipped check passes with a summary starting with
 * "skipped" (no real signal). We drop skipped checks from `gateResults`
 * because they're not informative in the audit trail.
 */
function isSkipped(check: CheckResult): boolean {
  return check.pass && /^skipped\b/i.test(check.summary)
}

export async function runGuildGates(
  input: RunGuildGatesInput,
): Promise<RunGuildGatesOutput> {
  const guilds = selectApplicableGuilds(input.signals)
  const rawResults = await runGuildDeterministicChecks(guilds, input.signals)
  const gateResults = rawResults
    .filter((r) => !isSkipped(r))
    .map((r) => checkResultToGateResult(r, input.now))
  const allPassed = gateResults.every((g) => g.passed)
  return { gateResults, rawResults, allPassed }
}
