import type { GuildDefinition } from '@guildhall/guilds'
import type { ReviewVerdict, AdjudicationRecord } from '@guildhall/core'

/**
 * Reviewer fan-out: at `review`, each applicable persona produces an
 * independent verdict through its own lens. This file holds the pure,
 * testable pieces — parser, aggregator, and a generic bounded-concurrency
 * pool used by the default LLM runner. The orchestrator wires them to
 * actual LLM calls via `createPersonaReviewerAgent`.
 *
 * Aggregation rule (strict by default): every persona must approve for the
 * task to advance to `gate_check`. Any single "revise" returns the task to
 * `in_progress` with combined feedback from the dissenting personas. A
 * future lever (`reviewer_fanout_policy`) could relax this to majority or
 * advisory.
 */

export interface PersonaVerdict {
  guildSlug: string
  guildName: string
  verdict: 'approve' | 'revise'
  reasoning: string
  /** Bullet points of what must change, only populated when `verdict === 'revise'`. */
  revisionItems: string[]
  /** Raw model output, preserved for audit. */
  rawOutput: string
}

export interface FanoutAggregate {
  /** `approve` iff policy says the task advances. */
  verdict: 'approve' | 'revise'
  /** Personas that returned `revise`. */
  dissenting: PersonaVerdict[]
  /** Personas that returned `approve`. */
  approving: PersonaVerdict[]
  /** Combined feedback for the worker's next prompt, empty on full approval. */
  combinedFeedback: string
  /**
   * When true, the caller should route to the coordinator for
   * adjudication rather than bouncing to the worker. Only set under
   * `coordinator_adjudicates_on_conflict` when dissent is recurrent.
   */
  needsAdjudication?: boolean
  /** Human-facing explanation when `needsAdjudication` is set. */
  adjudicationTrigger?: AdjudicationRecord['trigger']
}

export type ReviewerFanoutPolicy =
  | 'strict'
  | 'coordinator_adjudicates_on_conflict'
  | 'advisory'
  | 'majority'

/**
 * Parse a single persona's output into a structured verdict. The persona
 * prompt requires a specific format (`**Verdict:** approve|revise` +
 * reasoning + revision items) — we're liberal in what we accept but strict
 * on the verdict keyword. If no clear verdict is present, default to
 * `revise` with the raw output as reasoning — a missing verdict is itself
 * a failed review pass.
 */
export function parsePersonaOutput(
  guild: GuildDefinition,
  rawOutput: string,
): PersonaVerdict {
  const verdictMatch = rawOutput.match(/\*\*Verdict:\*\*\s*(approve|revise|approved|needs revision)/i)
  const verdict: PersonaVerdict['verdict'] = verdictMatch
    ? /^approv/i.test(verdictMatch[1]!)
      ? 'approve'
      : 'revise'
    : 'revise'

  const reasoningMatch = rawOutput.match(
    /\*\*Reasoning:\*\*\s*([\s\S]*?)(?:\n\s*\*\*|$)/i,
  )
  const reasoning = reasoningMatch
    ? reasoningMatch[1]!.trim()
    : `(no **Reasoning:** block found — raw output retained)\n${rawOutput.trim().slice(0, 800)}`

  const revisionItems: string[] = []
  if (verdict === 'revise') {
    const revBlockMatch = rawOutput.match(
      /\*\*If revise[^:]*:\*\*\s*([\s\S]*?)(?:\n\s*\*\*|$)/i,
    )
    if (revBlockMatch) {
      const lines = revBlockMatch[1]!
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-') || l.startsWith('*'))
      for (const l of lines) {
        const cleaned = l.replace(/^[-*]\s*/, '').trim()
        if (cleaned.length > 0) revisionItems.push(cleaned)
      }
    }
  }

  return {
    guildSlug: guild.slug,
    guildName: guild.name,
    verdict,
    reasoning,
    revisionItems,
    rawOutput,
  }
}

/**
 * Aggregate N persona verdicts into a task-level decision. Policy selects
 * the rule:
 *
 *   - `strict` — any revise → task revise. The worker synthesizes across
 *     all dissenters' revision items. Default.
 *   - `advisory` — any approve → task approve; dissents become notes for
 *     the worker but do not block the transition.
 *   - `majority` — ≥50% approving → task approve (ties break as revise so
 *     the system stays conservative).
 *   - `coordinator_adjudicates_on_conflict` — same as `strict` for a single
 *     round; when `priorRounds` shows a *recurring* dissent from the same
 *     persona on overlapping revision items, set `needsAdjudication: true`
 *     so the orchestrator routes to the coordinator instead of the worker.
 *
 * `priorRounds` — a list of prior fan-out rounds' verdicts (most-recent
 * last) used only by the conflict-detecting policy.
 */
export function aggregateFanout(
  verdicts: readonly PersonaVerdict[],
  opts: {
    policy?: ReviewerFanoutPolicy
    priorRounds?: ReadonlyArray<ReadonlyArray<PersonaVerdict>>
  } = {},
): FanoutAggregate {
  const policy = opts.policy ?? 'strict'
  const approving = verdicts.filter((v) => v.verdict === 'approve')
  const dissenting = verdicts.filter((v) => v.verdict === 'revise')

  if (dissenting.length === 0) {
    return {
      verdict: 'approve',
      dissenting: [],
      approving,
      combinedFeedback: '',
    }
  }

  // Policy-specific verdict selection.
  let taskVerdict: 'approve' | 'revise' = 'revise'
  if (policy === 'advisory') {
    taskVerdict = approving.length > 0 ? 'approve' : 'revise'
  } else if (policy === 'majority') {
    taskVerdict = approving.length > dissenting.length ? 'approve' : 'revise'
  } else {
    // strict OR coordinator_adjudicates_on_conflict: any dissent is revise
    // at the per-round level. The adjudication policy *also* flags
    // recurrent dissent so the caller can route to the coordinator.
    taskVerdict = 'revise'
  }

  // Combined feedback rendering — same across policies (approving dissents
  // ride along as notes even under advisory, so the worker sees everything).
  const combinedFeedback =
    taskVerdict === 'revise' || dissenting.length > 0
      ? renderCombinedFeedback(dissenting)
      : ''

  const result: FanoutAggregate = {
    verdict: taskVerdict,
    dissenting,
    approving,
    combinedFeedback,
  }

  if (
    policy === 'coordinator_adjudicates_on_conflict' &&
    taskVerdict === 'revise'
  ) {
    const recurrent = findRecurrentDissent(dissenting, opts.priorRounds ?? [])
    if (recurrent.length > 0) {
      result.needsAdjudication = true
      result.adjudicationTrigger = 'same_persona_repeat_dissent'
    }
  }

  return result
}

function renderCombinedFeedback(
  dissenting: readonly PersonaVerdict[],
): string {
  if (dissenting.length === 0) return ''
  const sections: string[] = [
    `**Aggregated revisions from ${dissenting.length} persona${dissenting.length > 1 ? 's' : ''}:**`,
    '',
  ]
  for (const d of dissenting) {
    sections.push(`### From ${d.guildName}`)
    sections.push('')
    sections.push(d.reasoning)
    if (d.revisionItems.length > 0) {
      sections.push('')
      sections.push('What must change:')
      for (const item of d.revisionItems) sections.push(`- ${item}`)
    }
    sections.push('')
  }
  return sections.join('\n').trim()
}

/**
 * Detect personas whose `revise` in the current round overlaps significantly
 * with their `revise` in the most-recent prior round. Overlap is measured
 * as ≥50% token-set intersection across the concatenated revision items.
 *
 * Pure, deterministic, no embeddings. Returns the guild slugs whose dissent
 * is recurrent — these are the ones the coordinator will adjudicate.
 *
 * Exported so tests can exercise the heuristic without going through the
 * full aggregation path.
 */
export function findRecurrentDissent(
  currentDissenting: readonly PersonaVerdict[],
  priorRounds: ReadonlyArray<ReadonlyArray<PersonaVerdict>>,
): string[] {
  if (priorRounds.length === 0) return []
  // Compare only against the *most recent* prior round — a one-round break
  // in dissent breaks the chain.
  const prior = priorRounds[priorRounds.length - 1]!
  const priorBySlug = new Map<string, PersonaVerdict>()
  for (const p of prior) {
    if (p.verdict === 'revise') priorBySlug.set(p.guildSlug, p)
  }
  const recurrent: string[] = []
  for (const cur of currentDissenting) {
    const pv = priorBySlug.get(cur.guildSlug)
    if (!pv) continue
    const overlap = tokenOverlapRatio(
      cur.revisionItems.join(' '),
      pv.revisionItems.join(' '),
    )
    if (overlap >= 0.5) recurrent.push(cur.guildSlug)
  }
  return recurrent
}

function tokenOverlapRatio(a: string, b: string): number {
  const ta = tokenSet(a)
  const tb = tokenSet(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  // Jaccard-ish; we use min(|A|,|B|) as the denominator so a shorter round's
  // full-coverage in the longer round still registers as overlap.
  return inter / Math.min(ta.size, tb.size)
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these',
  'those', 'it', 'its', 'as', 'at', 'by', 'with', 'from', 'not', 'no',
  'must', 'should', 'change', 'fix', 'add', 'remove', 'update',
])

function tokenSet(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of s.toLowerCase().split(/[^a-z0-9_\-.]+/)) {
    if (raw.length < 3) continue
    if (STOP_WORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}

/**
 * Convert a PersonaVerdict into the canonical ReviewVerdict shape persisted
 * on `task.reviewVerdicts`. Each fan-out pass produces one record per
 * persona — the full audit trail shows which expert agreed and which
 * objected.
 */
export function personaVerdictToReviewRecord(
  v: PersonaVerdict,
  opts: {
    now: string
    reviewerPath?: ReviewVerdict['reviewerPath']
    policyVersion?: string
    llmError?: string
  },
): ReviewVerdict {
  return {
    verdict: v.verdict,
    reviewerPath: opts.reviewerPath ?? 'llm',
    reason:
      v.verdict === 'approve'
        ? `${v.guildName} approved`
        : `${v.guildName} requested revision`,
    reasoning: v.reasoning,
    failingSignals: v.verdict === 'revise' ? [v.guildSlug] : [],
    recordedAt: opts.now,
    ...(opts.policyVersion !== undefined ? { policyVersion: opts.policyVersion } : {}),
    ...(opts.llmError !== undefined ? { llmError: opts.llmError } : {}),
  }
}

/**
 * Bounded-concurrency pool: apply `work` to every item in `items` with up
 * to `concurrency` calls in flight at once. Results are returned in the
 * same order as `items`. `concurrency <= 1` falls back to a strictly
 * sequential for-loop. An error thrown by `work` for any single item
 * propagates out; callers that need per-item error isolation should
 * catch inside `work` themselves.
 */
export async function boundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.floor(concurrency))
  if (n <= 1) {
    const out: R[] = []
    for (let i = 0; i < items.length; i++) {
      out.push(await work(items[i]!, i))
    }
    return out
  }
  const out: R[] = new Array(items.length)
  let nextIdx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIdx++
      if (i >= items.length) return
      out[i] = await work(items[i]!, i)
    }
  }
  const workers = Array.from(
    { length: Math.min(n, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return out
}
