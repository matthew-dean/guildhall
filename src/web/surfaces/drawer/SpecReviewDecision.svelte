<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Row from '../../lib/Row.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import { briefScopeForReaders } from '../../lib/brief-display.js'
  import { readableTaskDescription } from '../../lib/task-display.js'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
    busy?: boolean
    onApprove: () => void
    onRequestChanges: (message: string) => Promise<void>
    onOpenFullRecord: () => void
  }

  let {
    task,
    busy = false,
    onApprove,
    onRequestChanges,
    onOpenFullRecord,
  }: Props = $props()

  let requestingChanges = $state(false)
  let changeRequest = $state('')

  const summary = $derived.by(() => {
    const scope = task.productBrief
      ? briefScopeForReaders(task.productBrief, task.title)
      : readableTaskDescription(task.description, task.title)
    return conciseExcerpt(scope || task.spec || '')
  })
  const finishConditionCount = $derived(task.acceptanceCriteria?.length ?? 0)

  function conciseExcerpt(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return 'Guildhall has a draft ready for your review.'
    const sentence = normalized.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? normalized
    return sentence.length > 280 ? `${sentence.slice(0, 277).trimEnd()}...` : sentence
  }

  async function submitChanges(): Promise<void> {
    const message = changeRequest.trim()
    if (!message) return
    await onRequestChanges(message)
    changeRequest = ''
    requestingChanges = false
  }
</script>

<div class="spec-review-decision">
  <Stack gap="4">
    <Card title="Your decision" tone="warn" variant="callout" railStrength="strong">
      <Stack gap="3">
        <div>
          <h3>Approve this spec?</h3>
          <p>Approving lets Guildhall continue this work item.</p>
        </div>
        <Row justify="end" gap="2" wrap>
          <Button variant="secondary" disabled={busy} onclick={() => (requestingChanges = !requestingChanges)}>
            Request changes
          </Button>
          <Button variant="primary" disabled={busy} onclick={onApprove}>Approve spec</Button>
        </Row>
      </Stack>
    </Card>

    {#if requestingChanges}
      <Card title="What should change?" tone="neutral">
        <Stack gap="2">
          <Textarea
            bind:value={changeRequest}
            rows={4}
            placeholder="Describe the correction Guildhall should make."
          />
          <Row justify="end" gap="2" wrap>
            <Button variant="ghost" disabled={busy} onclick={() => (requestingChanges = false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || changeRequest.trim().length === 0} onclick={() => void submitChanges()}>
              Send changes
            </Button>
          </Row>
        </Stack>
      </Card>
    {/if}

    <section class="spec-review-summary" aria-label="Spec at a glance">
      <h3>What will change</h3>
      <p>{summary}</p>
      {#if finishConditionCount > 0}
        <p class="spec-review-conditions">{finishConditionCount} finish {finishConditionCount === 1 ? 'condition is' : 'conditions are'} recorded.</p>
      {/if}
      <Button variant="ghost" size="sm" onclick={onOpenFullRecord}>Read full task record</Button>
    </section>
  </Stack>
</div>

<style>
  .spec-review-decision :global(h3),
  .spec-review-summary h3 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .spec-review-decision :global(p),
  .spec-review-summary p {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .spec-review-summary {
    display: grid;
    gap: var(--s-2);
    max-inline-size: 62ch;
  }
  .spec-review-summary p {
    margin: 0;
  }
  .spec-review-conditions {
    font-size: var(--gh-type-size-meta) !important;
  }
</style>
