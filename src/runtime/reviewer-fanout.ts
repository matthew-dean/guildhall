import type { GuildDefinition } from '@guildhall/guilds'
import type { ReviewVerdict } from '@guildhall/core'

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
  /** `approve` iff every persona approved. */
  verdict: 'approve' | 'revise'
  /** Personas that returned `revise`. */
  dissenting: PersonaVerdict[]
  /** Combined feedback for the worker's next prompt, empty on full approval. */
  combinedFeedback: string
}

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
 * Aggregate N persona verdicts into a task-level decision. Strict policy:
 * every persona must approve. The combined feedback is structured per-
 * dissenter so the worker can see which expert asked for which change.
 */
export function aggregateFanout(verdicts: readonly PersonaVerdict[]): FanoutAggregate {
  const dissenting = verdicts.filter((v) => v.verdict === 'revise')
  if (dissenting.length === 0) {
    return { verdict: 'approve', dissenting: [], combinedFeedback: '' }
  }
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
  return {
    verdict: 'revise',
    dissenting,
    combinedFeedback: sections.join('\n').trim(),
  }
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
