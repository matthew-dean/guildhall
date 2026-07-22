import type { GuildDefinition } from '@guildhall/guilds'
import type { ReviewVerdict, AdjudicationRecord, Task } from '@guildhall/core'
import type { ReviewPlanRecord, ReviewRiskLane } from './review-audit-store.js'
import { readStructuredReviewResult, reviewVerdictIsNonSubstantiveFailure } from './review-contract.js'

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
  /** Bullet points of recommended task-local changes, only populated when `verdict === 'revise'`. */
  revisionItems: string[]
  /** Concrete risks or trade-offs if the recommendation is not taken now. */
  riskItems?: string[]
  recommendationPriority?: 'low' | 'medium' | 'high'
  expectedValue?: 'low' | 'medium' | 'high'
  deferredRisk?: 'low' | 'medium' | 'high'
  /** Broader ideas that should not block this task. */
  followUpItems?: string[]
  /** Stable acceptance-criterion IDs from the machine result. */
  acceptedCriteriaIds?: string[]
  /** Stable proof evidence IDs from the machine result. */
  proofEvidenceIds?: string[]
  /** Machine-classified failure; never inferred from reviewer prose. */
  failureCode?: ReviewVerdict['failureCode']
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
  /**
   * Combined machine-derived feedback for the worker's next prompt, empty on
   * full approval. Reviewer reasoning is retained for audit but never copied
   * into the next mutation prompt.
   */
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

interface PersonaOutputHints {
  taskText?: string
}

type PersonaParseOptions = {
  failureCode?: ReviewVerdict['failureCode']
}

export type ReviewerFanoutPolicy =
  | 'strict'
  | 'coordinator_adjudicates_on_conflict'
  | 'advisory'
  | 'majority'

const REVIEW_LANE_GUILD_HINTS: Record<ReviewRiskLane, string[]> = {
  ux_comprehension: ['component-designer', 'visual-designer', 'frontend-engineer'],
  copy_clarity: ['copywriter'],
  visual_design: ['visual-designer', 'component-designer', 'color-theorist'],
  accessibility: ['accessibility-specialist'],
  security: ['security-engineer'],
  privacy: ['security-engineer', 'project-manager'],
  api_contract: ['api-designer', 'backend-engineer'],
  data_integrity: ['backend-engineer', 'typescript-engineer'],
  migration_safety: ['backend-engineer', 'test-engineer'],
  test_adequacy: ['test-engineer'],
  performance: ['performance-engineer'],
  docs_truth: ['copywriter', 'project-manager'],
  release_risk: ['project-manager', 'test-engineer'],
  plan_completeness: ['project-manager'],
  evidence_privacy: ['security-engineer', 'project-manager'],
  calibration_governance: ['project-manager', 'test-engineer'],
  cost_control: ['project-manager', 'performance-engineer'],
  rollout_safety: ['project-manager', 'backend-engineer'],
}

export function selectReviewersForPlan(
  personas: readonly GuildDefinition[],
  reviewPlan: ReviewPlanRecord | null | undefined,
): GuildDefinition[] {
  const cap = reviewPlan?.budget.maxReviewerAgents
  if (!cap || cap >= personas.length) return [...personas]

  const selectedLanes = reviewPlan.selectedLanes
  const selected: GuildDefinition[] = []
  const selectedSlugs = new Set<string>()
  for (const lane of selectedLanes) {
    const laneHints = REVIEW_LANE_GUILD_HINTS[lane] ?? []
    const persona = laneHints
      .map((slug) => personas.find((candidate) => candidate.slug === slug))
      .find((candidate): candidate is GuildDefinition => !!candidate && !selectedSlugs.has(candidate.slug))
    if (!persona) continue
    selected.push(persona)
    selectedSlugs.add(persona.slug)
    if (selected.length >= cap) return selected
  }

  const scores = new Map<string, number>()
  for (const lane of selectedLanes) {
    for (const slug of REVIEW_LANE_GUILD_HINTS[lane] ?? []) {
      scores.set(slug, (scores.get(slug) ?? 0) + 1)
    }
  }

  return personas
    .filter((persona) => !selectedSlugs.has(persona.slug))
    .map((persona, index) => ({
      persona,
      index,
      score: scores.get(persona.slug) ?? 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.index - b.index
    })
    .slice(0, Math.max(1, cap - selected.length))
    .map((entry) => entry.persona)
    .reduce((out, persona) => [...out, persona], selected)
}

/**
 * Parse a single persona's output into a structured verdict. The persona
 * prompt requires a structured JSON machine result. Prose is parsed only for
 * human-facing context and never controls the verdict. If the machine result
 * is missing or malformed, fail closed with `invalid_review_contract`.
 */
export function parsePersonaOutput(
  guild: GuildDefinition,
  rawOutput: string,
  _hints: PersonaOutputHints = {},
  options: PersonaParseOptions = {},
): PersonaVerdict {
  const structuredResult = readStructuredReviewResult(rawOutput)
  const verdict: PersonaVerdict['verdict'] = structuredResult?.verdict ?? 'revise'

  // Keep the complete audit trace. No heading or prose convention is needed
  // to interpret or retain a model's explanation.
  const reasoning = rawOutput.trim()

  const revisionItems = structuredResult?.revisionItems ?? []
  const followUpItems = structuredResult?.followUpItems ?? []
  const riskItems = structuredResult?.riskItems ?? []
  const advisoryScores = structuredResult?.advisoryScores ?? {}

  return {
    guildSlug: guild.slug,
    guildName: guild.name,
    verdict,
    reasoning,
    revisionItems,
    riskItems,
    recommendationPriority: advisoryScores.recommendationPriority,
    expectedValue: advisoryScores.expectedValue,
    deferredRisk: advisoryScores.deferredRisk,
    followUpItems,
    ...(structuredResult ? { acceptedCriteriaIds: structuredResult.acceptedCriteriaIds } : {}),
    ...(structuredResult ? { proofEvidenceIds: structuredResult.proofEvidenceIds } : {}),
    ...((options.failureCode ?? (structuredResult ? undefined : 'invalid_review_contract'))
      ? { failureCode: options.failureCode ?? 'invalid_review_contract' as const }
      : {}),
    rawOutput,
  }
}

export function buildPersonaOutputHints(task: Pick<Task, 'title' | 'description' | 'spec' | 'acceptanceCriteria' | 'outOfScope'>): PersonaOutputHints {
  const taskText = [
    task.title,
    task.description,
    task.spec ?? '',
    ...(task.acceptanceCriteria ?? []).map((criterion) => criterion.description),
    ...(task.outOfScope ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')

  return {
    taskText,
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
 *     persona, set `needsAdjudication: true`
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
  const availabilityOnly = verdicts.filter((v) => isNonSubstantiveFanoutFailure(v))
  const dissenting = verdicts.filter(
    (v) => v.verdict === 'revise' && !isNonSubstantiveFanoutFailure(v),
  )

  if (dissenting.length === 0) {
    return {
      verdict: 'approve',
      dissenting: [],
      approving,
      combinedFeedback: availabilityOnly.length > 0 ? renderCombinedFeedback(availabilityOnly) : '',
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
  // The renderer deliberately consumes only structured fields. Raw reviewer
  // prose is an audit trace, not an instruction channel: otherwise a model's
  // preferred vocabulary could change the next mutation.
  const combinedFeedback =
    taskVerdict === 'revise' || dissenting.length > 0
      ? renderCombinedFeedback([...dissenting, ...availabilityOnly])
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
  const actionable = dissenting.filter((verdict) => !isNonSubstantiveFanoutFailure(verdict))
  const availability = dissenting.filter((verdict) => isNonSubstantiveFanoutFailure(verdict))
  const followUps = actionable.flatMap((verdict) =>
    (verdict.followUpItems ?? []).map((item) => ({ guildName: verdict.guildName, item })),
  )
  const sections: string[] = [
    actionable.length > 0
      ? `**Aggregated revisions from ${actionable.length} persona${actionable.length > 1 ? 's' : ''}:**`
      : `**Reviewer availability issues from ${availability.length} persona${availability.length > 1 ? 's' : ''}:**`,
    '',
  ]
  for (const d of actionable) {
    sections.push(`### From ${d.guildName}`)
    sections.push('')
    if ((d.revisionItems ?? []).length > 0) {
      sections.push('')
      sections.push('Recommended task-local revisions:')
      for (const item of d.revisionItems ?? []) sections.push(`- ${item}`)
    }
    if ((d.acceptedCriteriaIds ?? []).length > 0) {
      sections.push('')
      sections.push(`Accepted criteria IDs: ${(d.acceptedCriteriaIds ?? []).join(', ')}`)
    }
    if ((d.proofEvidenceIds ?? []).length > 0) {
      sections.push('')
      sections.push(`Verified proof evidence IDs: ${(d.proofEvidenceIds ?? []).join(', ')}`)
    }
    const scoreLines = [
      d.recommendationPriority ? `- Recommendation priority: ${d.recommendationPriority}` : null,
      d.expectedValue ? `- Expected value if taken: ${d.expectedValue}` : null,
      d.deferredRisk ? `- Risk if deferred: ${d.deferredRisk}` : null,
    ].filter((line): line is string => Boolean(line))
    if (scoreLines.length > 0) {
      sections.push('')
      sections.push('Advisory scoring:')
      sections.push(...scoreLines)
    }
    if ((d.riskItems ?? []).length > 0) {
      sections.push('')
      sections.push('Risk if accepted as-is:')
      for (const item of d.riskItems ?? []) sections.push(`- ${item}`)
    }
    sections.push('')
  }
  if (followUps.length > 0) {
    sections.push('### Non-blocking follow-up ideas')
    sections.push('')
    sections.push('These ideas may be worthwhile later, but they are not required to accept this task.')
    sections.push('')
    for (const followUp of followUps) {
      sections.push(`- ${followUp.guildName}: ${followUp.item}`)
    }
    sections.push('')
  }
  if (availability.length > 0) {
    if (actionable.length > 0) {
      sections.push('### Reviewer availability notes')
      sections.push('')
      sections.push(
      'These reviewers did not return a usable structured verdict. Their contract or provider failures are preserved for audit, but they are not counted as substantive revision requests.',
      )
      sections.push('')
    }
    for (const d of availability) {
      sections.push(`- ${d.guildName}: ${d.failureCode ?? 'reviewer_unavailable'}`)
    }
    sections.push('')
  }
  return sections.join('\n').trim()
}

function isNonSubstantiveFanoutFailure(verdict: PersonaVerdict): boolean {
  return reviewVerdictIsNonSubstantiveFailure(verdict)
}

/**
 * Detect personas whose `revise` in the current round repeats in the
 * most-recent prior round. Attribution is identity-based; reviewer prose is
 * deliberately not compared because a different wording must not change
 * orchestration state.
 *
 * Pure and deterministic. Returns the guild slugs whose dissent is recurrent
 * — these are the ones the coordinator will adjudicate.
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
    recurrent.push(cur.guildSlug)
  }
  return recurrent
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
    reviewerId: v.guildSlug,
    reviewerName: v.guildName,
    reason:
      v.verdict === 'approve'
        ? `${v.guildName} approved`
        : v.failureCode
          ? `${v.guildName} returned ${v.failureCode}; no product finding was inferred`
          : `${v.guildName} requested revision`,
    reasoning:
      (v.followUpItems ?? []).length > 0
        ? [
            v.reasoning,
            '',
            '**Non-blocking follow-up ideas:**',
            ...(v.followUpItems ?? []).map((item) => `- ${item}`),
          ].join('\n')
        : v.reasoning,
    failingSignals: v.verdict === 'revise' && !v.failureCode ? [v.guildSlug] : [],
    ...(v.acceptedCriteriaIds ? { acceptedCriteriaIds: v.acceptedCriteriaIds } : {}),
    ...(v.proofEvidenceIds ? { proofEvidenceIds: v.proofEvidenceIds } : {}),
    ...((v.recommendationPriority || v.expectedValue || v.deferredRisk) ? {
      advisoryScores: {
        ...(v.recommendationPriority ? { recommendationPriority: v.recommendationPriority } : {}),
        ...(v.expectedValue ? { expectedValue: v.expectedValue } : {}),
        ...(v.deferredRisk ? { deferredRisk: v.deferredRisk } : {}),
      },
    } : {}),
    ...(v.failureCode ? { failureCode: v.failureCode } : {}),
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
