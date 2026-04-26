<!--
  Spec tab: Why-stuck (when applicable) + About + Brief + Spec + Acceptance
  criteria + Actions + Exploring follow-up. Each section is its own Card; copy
  is terse; buttons are single-verb.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import { friendlyDomain } from '../../lib/display.js'
  import Button from '../../lib/Button.svelte'
  import Field from '../../lib/Field.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Byline from '../../lib/Byline.svelte'
  import WhyStuck from './WhyStuck.svelte'
  import SpecFillChecklist from './SpecFillChecklist.svelte'
  import SuggestionCard from './SuggestionCard.svelte'
  import type { Task, Escalation } from '../../lib/types.js'

  interface Props {
    task: Task
    busy?: boolean
    onApproveBrief: () => void
    onApproveSpec: () => void
    onPause: () => void
    onShelve: () => void
    onUnshelve: () => void
    onResolveEscalation: (escalation: Escalation, mode: 'retry' | 'resolve') => void
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
    onSendFollowUp,
    onAddAcceptance,
  }: Props = $props()

  let followup = $state('')
  let acceptanceDraft = $state('')
  // NOTE: the drawer is now a READ-ONLY artifact view. The interactive
  // approve / reply / answer-question affordances live in the Thread
  // surface. Past-context here is for inspection only.

  const openEscalations = $derived(
    (task.escalations ?? []).filter((e) => !e.resolvedAt),
  )
  const stuck = $derived(
    task.status === 'blocked' ||
      task.status === 'shelved' ||
      openEscalations.length > 0,
  )
  const brief = $derived(task.productBrief)
  const briefApproved = $derived(!!brief?.approvedAt)
  const specText = $derived((task.spec ?? '').trim())
  const acceptance = $derived(task.acceptanceCriteria ?? [])
  const exploring = $derived(task.status === 'exploring')
  const specApprovalPending = $derived(task.status === 'spec_review' && specText.length > 0)
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
    />
  {/if}

  <SpecFillChecklist taskId={task.id} refreshKey={task} />

  <div data-spec-section="section-about">
  <Card title="About">
    <Stack gap="2">
      <Markdown source={task.description ?? '(no description)'} />
      <Row wrap gap="2">
        <Chip label={task.status ?? 'unknown'} tone="neutral" />
        {#if task.domain}<Chip label={friendlyDomain(task.domain)} tone="neutral" />{/if}
        {#if task.priority}<Chip label="priority: {task.priority}" tone="neutral" />{/if}
        {#if (task.revisionCount ?? 0) > 0}
          <Chip label="revisions: {task.revisionCount}" tone="neutral" />
        {/if}
        {#if task.assignedTo}<Chip label="assigned: {task.assignedTo}" tone="neutral" />{/if}
      </Row>
    </Stack>
  </Card>
  </div>

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
        <h3>Did the agent understand you?</h3>
        <p class="explainer">
          You wrote a task. Before any code gets written, the spec agent wrote
          down what it <em>thinks</em> you want and how it'll know it's done.
          If that matches your intent, approve and the worker starts. If it
          misread you, correct it below.
        </p>
        {#if brief.userJob}
          <Field label="What it thinks you want"><Markdown source={brief.userJob} /></Field>
        {/if}
        {#if brief.successMetric || brief.successCriteria}
          <Field label="How it'll know it's done"><Markdown source={brief.successMetric ?? brief.successCriteria} /></Field>
        {/if}
        {#if brief.antiPatterns && brief.antiPatterns.length > 0}
          <Field label="Explicitly NOT">
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
          <li><Markdown source={a.description ?? a.text ?? JSON.stringify(a)} inline /></li>
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
        <Chip label="Awaiting your approval" tone="warn" />
      {/snippet}
      <Stack gap="2">
        <h3>Spec ready for review</h3>
        <p class="lede">Open in <strong>Thread</strong> to approve.</p>
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
          placeholder="Answer a question, add a requirement, correct a misunderstanding…"
        />
        <Row justify="end" gap="2" align="center">
          <span class="hint">Appends to memory/exploring/{task.id}.md</span>
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
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .muted {
    color: var(--text-muted);
  }
  .hint {
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .bullet {
    padding-left: var(--s-4);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .bullet li {
    margin: var(--s-1) 0;
  }
  .lede {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    margin: 0;
  }
  .explainer {
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    margin: 0 0 var(--s-1) 0;
    padding: var(--s-2) var(--s-3);
    background: var(--bg-raised-2);
    border-left: 2px solid var(--warn, #d0a146);
    border-radius: var(--r-1);
  }
  .explainer em {
    font-style: italic;
    color: var(--text);
  }
</style>
