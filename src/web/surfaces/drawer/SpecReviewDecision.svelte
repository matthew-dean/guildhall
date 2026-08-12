<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Row from '../../lib/Row.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  interface Props {
    busy?: boolean
    onApprove: () => void
    onRequestChanges: (message: string) => Promise<void>
    onOpenFullRecord: () => void
  }

  let {
    busy = false,
    onApprove,
    onRequestChanges,
    onOpenFullRecord,
  }: Props = $props()

  let requestingChanges = $state(false)
  let changeRequest = $state('')

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

    <section class="spec-review-record-link" aria-label="Task record">
      <Button variant="ghost" size="sm" onclick={onOpenFullRecord}>Read full task record</Button>
    </section>
  </Stack>
</div>

<style>
  .spec-review-decision :global(h3) {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .spec-review-decision :global(p) {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .spec-review-record-link {
    display: flex;
    justify-content: flex-start;
  }
</style>
