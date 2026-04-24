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
  import Button from '../../lib/Button.svelte'
  import Field from '../../lib/Field.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Byline from '../../lib/Byline.svelte'
  import WhyStuck from './WhyStuck.svelte'
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
  }: Props = $props()

  let followup = $state('')

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
  const specApprovalPending = $derived(exploring && specText.length > 0)

  async function send() {
    const msg = followup.trim()
    if (!msg) return
    await onSendFollowUp(msg)
    followup = ''
  }
</script>

<Stack gap="4">
  {#if stuck}
    <WhyStuck
      {task}
      {busy}
      onUnshelve={onUnshelve}
      onResolve={onResolveEscalation}
    />
  {/if}

  <Card title="About">
    <Stack gap="2">
      <Markdown source={task.description ?? '(no description)'} />
      <Row wrap gap="2">
        <Chip label={task.status ?? 'unknown'} tone="neutral" />
        {#if task.domain}<Chip label={task.domain} tone="neutral" />{/if}
        {#if task.priority}<Chip label="priority: {task.priority}" tone="neutral" />{/if}
        {#if (task.revisionCount ?? 0) > 0}
          <Chip label="revisions: {task.revisionCount}" tone="neutral" />
        {/if}
        {#if task.assignedTo}<Chip label="assigned: {task.assignedTo}" tone="neutral" />{/if}
      </Row>
    </Stack>
  </Card>

  {#if brief}
    <Card>
      {#snippet actions()}
        <Chip
          label={briefApproved ? 'Approved' : 'Approve?'}
          tone={briefApproved ? 'ok' : 'warn'}
        />
      {/snippet}
      <Stack gap="3">
        <h3>Brief</h3>
        {#if brief.userJob}
          <Field label="User need"><Markdown source={brief.userJob} /></Field>
        {/if}
        {#if brief.successMetric || brief.successCriteria}
          <Field label="Done when"><Markdown source={brief.successMetric ?? brief.successCriteria} /></Field>
        {/if}
        {#if brief.antiPatterns && brief.antiPatterns.length > 0}
          <Field label="Not">
            <ul class="bullet">
              {#each brief.antiPatterns as p}<li><Markdown source={p} inline /></li>{/each}
            </ul>
          </Field>
        {/if}
        {#if brief.rolloutPlan}
          <Field label="Rollout"><Markdown source={brief.rolloutPlan} /></Field>
        {/if}
        {#if !briefApproved}
          <Row justify="end" gap="2" align="center">
            <Byline by={brief.authoredBy ?? '?'} />
            <Button variant="primary" disabled={busy} onclick={onApproveBrief}>
              Approve
            </Button>
          </Row>
        {/if}
      </Stack>
    </Card>
  {:else if exploring}
    <Card title="Brief">
      <p class="muted">Spec agent will draft a brief if this task touches product surface area.</p>
    </Card>
  {/if}

  <Card title="Spec">
    {#if specText}
      <Markdown source={specText} />
    {:else}
      <p class="muted">(no spec drafted yet)</p>
    {/if}
  </Card>

  {#if acceptance.length > 0}
    <Card title="Acceptance criteria">
      <ul class="bullet">
        {#each acceptance as a}
          <li><Markdown source={a.description ?? a.text ?? JSON.stringify(a)} inline /></li>
        {/each}
      </ul>
    </Card>
  {/if}

  {#if specApprovalPending}
    <Card>
      {#snippet actions()}
        <Chip label="Approve?" tone="warn" />
      {/snippet}
      <Stack gap="3">
        <h3>Spec</h3>
        <Row justify="end">
          <Button variant="primary" disabled={busy} onclick={onApproveSpec}>
            Approve spec
          </Button>
        </Row>
      </Stack>
    </Card>
  {/if}

  {#if exploring}
    <Card title="Follow-up to spec agent">
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
</style>
