<!--
  Spec tab: Why-stuck (when applicable) + About + Brief + Spec + Acceptance
  criteria + Actions + Exploring follow-up. Each section is its own Card; copy
  is terse; buttons are single-verb.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import { friendlyDomain, friendlyPriority, friendlyStatus } from '../../lib/display.js'
  import { activeEscalations } from '../../lib/escalation.js'
  import { roleLabel } from '../../lib/escalation-labels.js'
  import Button from '../../lib/Button.svelte'
  import Field from '../../lib/Field.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Byline from '../../lib/Byline.svelte'
  import { briefDoneWhenForReaders, briefScopeForReaders } from '../../lib/brief-display.js'
  import { parseReviewerSummarySections, type ReviewerAdvisoryScores } from '../../lib/reviewer-summary.js'
  import { readableTaskDescription } from '../../lib/task-display.js'
  import { specApprovalNeedsStructuredBrief } from '../../lib/task-drawer-integrity.js'
  import WhyStuck from './WhyStuck.svelte'
  import SpecFillChecklist from './SpecFillChecklist.svelte'
  import SuggestionCard from './SuggestionCard.svelte'
  import type { Task, Escalation } from '../../lib/types.js'
  import {
    escapeAngleBracketPlaceholders,
    stripAcceptanceCriteriaSection,
  } from '../../lib/spec-render.js'

  interface Props {
    task: Task
    busy?: boolean
    onApproveBrief: () => void
    onApproveSpec: () => void
    onPause: () => void
    onShelve: () => void
    onUnshelve: () => void
    onResolveEscalation: (escalation: Escalation, mode: 'retry' | 'resolve') => void
    onRunEscalationAction: (escalation: Escalation) => void
    onSendFollowUp: (message: string) => Promise<void>
    onAddAcceptance: (description: string) => Promise<void>
  }

  let {
    task,
    busy = false,
    onApproveBrief,
    onApproveSpec,
    onPause,
    onShelve,
    onUnshelve,
    onResolveEscalation,
    onRunEscalationAction,
    onSendFollowUp,
    onAddAcceptance,
  }: Props = $props()

  let followup = $state('')
  let acceptanceDraft = $state('')
  const openEscalations = $derived(
    activeEscalations(task),
  )
  const stuck = $derived(
    task.status === 'blocked' ||
      task.status === 'shelved' ||
      openEscalations.length > 0,
  )
  const brief = $derived(task.productBrief)
  const briefApproved = $derived(!!brief?.approvedAt)
  const rawSpecText = $derived((task.spec ?? '').trim())
  const acceptance = $derived(task.acceptanceCriteria ?? [])
  const specText = $derived(
    acceptance.length > 0
      ? stripAcceptanceCriteriaSection(rawSpecText)
      : rawSpecText,
  )
  const latestReviewerSummary = $derived((task.latestReviewerSummary ?? '').trim())
  const reviewerSections = $derived(parseReviewerSummarySections(latestReviewerSummary))
  const latestSelfCritique = $derived((task.latestSelfCritique ?? '').trim())
  const latestCheckpoint = $derived(task.latestCheckpoint ?? null)
  const reviewPlan = $derived(task.reviewPlan ?? null)
  const reviewAuditSummary = $derived(task.reviewAuditSummary ?? null)
  const taskDescription = $derived(readableTaskDescription(task.description, task.title) || '(no description)')
  const hasRecoverySpecSeed = $derived(
    task.status === 'spec_review' &&
      (task.notes ?? []).some((note) =>
        /deterministic recovery spec seed/i.test(note.content ?? ''),
      ),
  )
  const hasTaskLocalSpecification = $derived(
    Boolean(brief) ||
      specText.length > 0 ||
      acceptance.length > 0,
  )
  const reviewPacketStatus = $derived(
    ['review', 'gate_check', 'done', 'pending_pr', 'merged'].includes(task.status),
  )
  const reviewPlanLanes = $derived(reviewPlan?.selectedLanes ?? [])
  const reviewPlanHiddenLaneCount = $derived(Math.max(0, reviewPlanLanes.length - 4))
  const reviewPlanRecipeCount = $derived(reviewPlan?.requiredRecipes?.length ?? 0)
  const hasReviewPacket = $derived(
    !hasRecoverySpecSeed &&
      (hasTaskLocalSpecification || reviewPacketStatus) &&
      (
        latestReviewerSummary.length > 0 ||
        latestSelfCritique.length > 0 ||
        Boolean(latestCheckpoint)
      ),
  )
  const exploring = $derived(task.status === 'exploring')
  const specApprovalPending = $derived(task.status === 'spec_review' && specText.length > 0)
  const specApprovalNeedsBrief = $derived(specApprovalPending && specApprovalNeedsStructuredBrief(task))
  const needsAcceptance = $derived(exploring && briefApproved && acceptance.length === 0)

  // Agent-suggested tasks the user hasn't said "yes" to yet get the
  // simple-question surface. Everything else (brief, spec, acceptance,
  // approval cards) is hidden until they accept.
  const isUnacceptedSuggestion = $derived(
    task.origination === 'agent' && !briefApproved,
  )

  async function send() {
    const msg = followup.trim()
    if (!msg) return
    await onSendFollowUp(msg)
    followup = ''
  }

  async function addAcceptance() {
    const description = acceptanceDraft.trim()
    if (!description) return
    await onAddAcceptance(description)
    acceptanceDraft = ''
  }

  type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'

  function scoreTone(
    kind: 'recommendationPriority' | 'expectedValue' | 'deferredRisk',
    level: ReviewerAdvisoryScores[keyof ReviewerAdvisoryScores],
  ): ChipTone {
    if (!level) return 'neutral'
    if (kind === 'expectedValue') {
      if (level === 'high') return 'ok'
      if (level === 'medium') return 'accent'
      return 'neutral'
    }
    if (level === 'high') return 'danger'
    if (level === 'medium') return 'warn'
    return 'neutral'
  }

  function scoreLabel(
    kind: 'recommendationPriority' | 'expectedValue' | 'deferredRisk',
    level: ReviewerAdvisoryScores[keyof ReviewerAdvisoryScores],
  ): string {
    const prefix =
      kind === 'recommendationPriority'
        ? 'Priority'
        : kind === 'expectedValue'
          ? 'Value'
          : 'Deferred risk'
    return `${prefix}: ${level}`
  }

  function friendlyReviewToken(value: string | undefined): string {
    if (!value) return 'Unknown'
    return value
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace(/\bUx\b/g, 'UX')
      .replace(/\bApi\b/g, 'API')
  }

  function budgetSummary(): string {
    const budget = reviewPlan?.budget
    if (!budget) return 'No budget recorded.'
    const parts = [
      budget.maxReviewerAgents ? `${budget.maxReviewerAgents} reviewer${budget.maxReviewerAgents === 1 ? '' : 's'}` : null,
      budget.maxWallClockMinutes ? `${budget.maxWallClockMinutes} min` : null,
      budget.maxEstimatedTokens ? `${budget.maxEstimatedTokens.toLocaleString()} tokens` : null,
    ].filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join(' · ') : 'No budget recorded.'
  }

  function reviewAuditSummaryText(): string {
    if (!reviewAuditSummary) return ''
    const reviewerRunCount = reviewAuditSummary.reviewerRunCount ?? 0
    const reviseCount = reviewAuditSummary.reviseCount ?? 0
    const escapedMissCount = reviewAuditSummary.escapedMissCount ?? 0
    const parts = [
      `${reviewerRunCount} reviewer run${reviewerRunCount === 1 ? '' : 's'}`,
      `${reviseCount} revision request${reviseCount === 1 ? '' : 's'}`,
      escapedMissCount > 0 ? `${escapedMissCount} escaped miss${escapedMissCount === 1 ? '' : 'es'}` : null,
    ].filter((part): part is string => Boolean(part))
    return parts.join(' · ')
  }
</script>

<Stack gap="4">
  {#if isUnacceptedSuggestion}
    <SuggestionCard
      {task}
      {busy}
      onYes={onApproveBrief}
      onNo={onShelve}
      onDifferent={onSendFollowUp}
    />
  {:else}
  {#if stuck}
    <WhyStuck
      {task}
      {busy}
      onUnshelve={onUnshelve}
      onResolve={onResolveEscalation}
      onRun={onRunEscalationAction}
    />
  {/if}

  <SpecFillChecklist taskId={task.id} refreshKey={task} />

  <div data-spec-section="section-about">
  <Card title="About">
    <Stack gap="2">
      <Markdown source={taskDescription} />
      <Row wrap gap="2">
        <Chip label={friendlyStatus(task.status)} tone="neutral" />
        {#if task.domain}<Chip label={friendlyDomain(task.domain)} tone="neutral" />{/if}
        {#if task.priority}<Chip label="Priority: {friendlyPriority(task.priority)}" tone="neutral" />{/if}
        {#if (task.revisionCount ?? 0) > 0}
          <Chip label="Revisions: {task.revisionCount}" tone="neutral" />
        {/if}
        {#if task.assignedTo}<Chip label="Assigned: {roleLabel(task.assignedTo)}" tone="neutral" />{/if}
      </Row>
    </Stack>
  </Card>
  </div>

  {#if reviewPlan}
    <Card title="Review plan">
      <Stack gap="3">
        <div class="review-plan-summary">
          <div>
            <strong>{friendlyReviewToken(reviewPlan.effort)} review</strong>
            <span>{friendlyReviewToken(reviewPlan.depth)} depth · {budgetSummary()}</span>
          </div>
          <Chip
            label={reviewPlanRecipeCount === 1 ? '1 reviewer group' : `${reviewPlanRecipeCount} reviewer groups`}
            tone="ok"
          />
        </div>
        {#if reviewPlanLanes.length > 0}
          <div class="review-plan-lanes" aria-label="Review risk lanes">
            {#each reviewPlanLanes.slice(0, 4) as lane (lane)}
              <Chip label={friendlyReviewToken(lane)} tone="neutral" />
            {/each}
            {#if reviewPlanHiddenLaneCount > 0}
              <Chip label={`+${reviewPlanHiddenLaneCount} more`} tone="neutral" />
            {/if}
          </div>
        {/if}
        <p class="explainer">
          Guildhall planned these review lenses before handing the task to reviewers, so the review budget and skipped areas are auditable.
        </p>
        {#if reviewAuditSummary}
          <p class="checkpoint-line">{reviewAuditSummaryText()}</p>
        {/if}
        <details class="review-plan-more">
          <summary>Show review details</summary>
          <Stack gap="2">
            {#if reviewPlan.requiredRecipes?.length}
              <Field label="Reviewer groups">
                <ul class="review-plan-list">
                  {#each reviewPlan.requiredRecipes as recipe (`${recipe.recipeId ?? 'recipe'}:${recipe.version ?? 'v'}`)}
                    <li>
                      {friendlyReviewToken(recipe.recipeId)}
                      {#if recipe.blocking}
                        <span>{friendlyReviewToken(recipe.blocking)}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </Field>
            {/if}
            {#if reviewPlan.deterministicChecks?.length}
              <Field label="Required checks">
                <p class="checkpoint-line">{reviewPlan.deterministicChecks.join(', ')}</p>
              </Field>
            {/if}
            {#if reviewPlan.requiredArtifacts?.length}
              <Field label="Evidence expected">
                <p class="checkpoint-line">{reviewPlan.requiredArtifacts.join(', ')}</p>
              </Field>
            {/if}
            {#if reviewPlan.skippedLanes?.length}
              <Field label="Skipped lenses">
                <p class="checkpoint-line">
                  {reviewPlan.skippedLanes.slice(0, 4).map((item) => friendlyReviewToken(item.lane)).join(', ')}
                  {#if reviewPlan.skippedLanes.length > 4}
                    , +{reviewPlan.skippedLanes.length - 4} more
                  {/if}
                </p>
              </Field>
            {/if}
          </Stack>
        </details>
      </Stack>
    </Card>
  {/if}

  {#if hasReviewPacket}
    <Card title="Latest handoff packet">
      <Stack gap="3">
        {#if latestReviewerSummary}
          <Field label="Latest reviewer feedback">
            <Stack gap="2">
              {#if reviewerSections.length > 0}
                <div class="review-score-list">
                  {#each reviewerSections as section}
                    <div class="review-score-row">
                      <strong class="review-score-name">{section.guildName}</strong>
                      <div class="review-score-chips">
                        {#if section.scores.recommendationPriority}
                          <Chip
                            label={scoreLabel('recommendationPriority', section.scores.recommendationPriority)}
                            tone={scoreTone('recommendationPriority', section.scores.recommendationPriority)}
                          />
                        {/if}
                        {#if section.scores.expectedValue}
                          <Chip
                            label={scoreLabel('expectedValue', section.scores.expectedValue)}
                            tone={scoreTone('expectedValue', section.scores.expectedValue)}
                          />
                        {/if}
                        {#if section.scores.deferredRisk}
                          <Chip
                            label={scoreLabel('deferredRisk', section.scores.deferredRisk)}
                            tone={scoreTone('deferredRisk', section.scores.deferredRisk)}
                          />
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
              <Markdown source={latestReviewerSummary} />
            </Stack>
          </Field>
        {/if}
        {#if latestSelfCritique}
          <Field label="Latest self-critique">
            <Markdown source={latestSelfCritique} />
          </Field>
        {/if}
        {#if latestCheckpoint}
          <Field label="Latest checkpoint">
            <Stack gap="1">
              <p class="checkpoint-line">
                Step {latestCheckpoint.step ?? '?'} by {latestCheckpoint.agentId ?? 'unknown'}
                {#if latestCheckpoint.writtenAt}
                  · {latestCheckpoint.writtenAt}
                {/if}
              </p>
              {#if latestCheckpoint.intent}
                <p class="checkpoint-line"><strong>Intent:</strong> {latestCheckpoint.intent}</p>
              {/if}
              {#if latestCheckpoint.nextPlannedAction}
                <p class="checkpoint-line"><strong>Next:</strong> {latestCheckpoint.nextPlannedAction}</p>
              {/if}
              {#if latestCheckpoint.filesTouched?.length}
                <p class="checkpoint-line"><strong>Files:</strong> {latestCheckpoint.filesTouched.join(', ')}</p>
              {/if}
            </Stack>
          </Field>
        {/if}
      </Stack>
    </Card>
  {/if}

  <div data-spec-section="section-brief">
  {#if brief}
    <Card tone={briefApproved ? 'ok' : 'warn'}>
      {#snippet actions()}
        <Chip
          label={briefApproved ? 'Approved' : 'Draft'}
          tone={briefApproved ? 'ok' : 'warn'}
        />
      {/snippet}
      <Stack gap="3">
        {@const briefScope = briefScopeForReaders(brief, task.title)}
        {@const briefDoneWhen = briefDoneWhenForReaders(brief)}
        <h3>Task brief</h3>
        <p class="explainer">
          Guildhall writes a short brief before workers start. Review it in
          Thread if the scope or finish line is wrong.
        </p>
        <Field label="Scope"><Markdown source={briefScope} /></Field>
        {#if briefDoneWhen}
          <Field label="Done when"><Markdown source={briefDoneWhen} /></Field>
        {/if}
        {#if brief.antiPatterns && brief.antiPatterns.length > 0}
          <Field label="Out of scope">
            <ul class="bullet">
              {#each brief.antiPatterns as p}<li><Markdown source={p} inline /></li>{/each}
            </ul>
          </Field>
        {/if}
        {#if brief.rolloutPlan}
          <Field label="Rollout"><Markdown source={brief.rolloutPlan} /></Field>
        {/if}
        {#if !briefApproved}
          <p class="lede">
            Open in <strong>Thread</strong> to approve or reply.
          </p>
          <Row justify="end" gap="2" align="center">
            <Byline by={brief.authoredBy ?? '?'} />
          </Row>
        {/if}
      </Stack>
    </Card>
  {:else if exploring}
    <Card title="Brief">
      <p class="muted">Spec agent will draft a brief if this task touches product surface area.</p>
    </Card>
  {/if}
  </div>

  <Card title="Spec">
    {#if specText}
      <Markdown source={specText} />
    {:else}
      <p class="muted">(no spec drafted yet)</p>
    {/if}
  </Card>

  <div data-spec-section="section-acceptance">
  {#if acceptance.length > 0}
    <Card title="Acceptance criteria">
      <ul class="bullet">
        {#each acceptance as a}
          <li><Markdown source={escapeAngleBracketPlaceholders(a.description ?? a.text ?? JSON.stringify(a))} inline /></li>
        {/each}
      </ul>
    </Card>
  {:else if needsAcceptance}
    <Card title="Acceptance criterion" tone="warn">
      <Stack gap="2">
        <p class="lede">Add one concrete finish line the reviewer can verify.</p>
        <Textarea
          bind:value={acceptanceDraft}
          rows={3}
          placeholder="Example: Round-trip tests cover variable declarations and function declarations without changing comments or formatting."
        />
        <Row justify="end">
          <Button
            variant="primary"
            disabled={busy || acceptanceDraft.trim().length === 0}
            onclick={addAcceptance}
          >
            Add
          </Button>
        </Row>
      </Stack>
    </Card>
  {/if}
  </div>

  {#if specApprovalPending}
    <Card tone="warn">
      {#snippet actions()}
        <Chip label={specApprovalNeedsBrief ? 'Brief incomplete' : 'Awaiting your approval'} tone="warn" />
      {/snippet}
      <Stack gap="2">
        {#if specApprovalNeedsBrief}
          <h3>Spec needs brief details first</h3>
          <p class="lede">Add the missing success target and structured acceptance criteria before approval can mean the task is ready.</p>
        {:else}
          <h3>Spec draft awaiting approval</h3>
          <p class="lede">Review the draft on this page, then approve it when it matches what you want.</p>
          <Row justify="end">
            <Button variant="primary" disabled={busy} onclick={onApproveSpec}>Approve spec</Button>
          </Row>
        {/if}
      </Stack>
    </Card>
  {/if}

  {#if exploring}
    <Card title={needsAcceptance ? 'Other note to spec author' : 'Follow-up to spec author'}>
      <Stack gap="2">
        <Textarea
          bind:value={followup}
          rows={4}
          mono
          placeholder="Answer a question, add a requirement, correct a misunderstanding..."
        />
        <Row justify="end" gap="2" align="center">
          <span class="hint">Appends to local Guildhall transcript history</span>
          <Button variant="primary" disabled={busy || followup.trim().length === 0} onclick={send}>
            Send
          </Button>
        </Row>
      </Stack>
    </Card>
  {/if}
  {/if}
</Stack>

<style>
  p {
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .muted {
    color: var(--text-muted);
  }
  .hint {
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
  }
  .bullet {
    padding-left: var(--s-4);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .bullet li {
    margin: var(--s-1) 0;
  }
  .lede {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    margin: 0;
  }
  .checkpoint-line {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    margin: 0;
  }
  .review-plan-summary {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .review-plan-summary > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .review-plan-summary strong {
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .review-plan-summary span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .review-plan-lanes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .review-plan-more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0.05em;
    list-style: none;
    text-transform: uppercase;
  }
  .review-plan-more > summary::-webkit-details-marker {
    display: none;
  }
  .review-plan-more > summary::before {
    content: '▸ ';
  }
  .review-plan-more[open] > summary::before {
    content: '▾ ';
  }
  .review-plan-list {
    display: grid;
    gap: var(--s-1);
    margin: 0;
    padding-left: var(--s-4);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .review-plan-list span {
    color: var(--text-soft);
  }
  .review-score-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .review-score-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .review-score-name {
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .review-score-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .explainer {
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    margin: 0 0 var(--s-1) 0;
    padding: var(--s-2) var(--s-3);
    background: var(--bg-raised-2);
    border-left: 2px solid var(--warn, #d0a146);
    border-radius: var(--r-1);
  }
</style>
