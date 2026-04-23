<!--
  Prominent banner shown at the top of the Spec tab when a task is blocked,
  shelved, or has an open escalation. Replaces the legacy red "Why is this
  stuck?" banner.

  Kept ADHD-minimal: a clear heading, one reason sentence, a tight definition
  list for the first open escalation, and single-verb action buttons.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Button from '../../lib/Button.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import type { Task, Escalation } from '../../lib/types.js'

  interface Props {
    task: Task
    busy?: boolean
    onUnshelve: () => void
    onResolve: (escalation: Escalation) => void
  }

  let { task, busy = false, onUnshelve, onResolve }: Props = $props()

  const openEscalations = $derived(
    (task.escalations ?? []).filter((e) => !e.resolvedAt),
  )
  const firstOpen = $derived<Escalation | undefined>(openEscalations[0])

  const reasonLine = $derived(() => {
    if (task.status === 'blocked') {
      return task.blockReason ?? 'Blocked — waiting on human action.'
    }
    if (task.status === 'shelved') {
      return task.shelveReason?.detail ?? 'Shelved by policy or pre-rejection.'
    }
    if (openEscalations.length > 0) {
      return openEscalations[0].summary ?? 'An escalation is open.'
    }
    return 'An escalation is open.'
  })
</script>

<Card tone="danger" title="Why is this stuck?">
  <Stack gap="3">
    <p class="reason">{reasonLine()}</p>

    {#if firstOpen}
      <DefinitionList
        size="sm"
        items={[
          ['Reason', firstOpen.reason ?? '—'],
          ['Details', firstOpen.details ? { md: firstOpen.details } : null],
          ['Raised by', firstOpen.agentId ?? '—'],
        ]}
      />
    {/if}

    <Row justify="end" gap="2">
      {#if task.status === 'shelved'}
        <Button variant="secondary" disabled={busy} onclick={onUnshelve}>
          Unshelve
        </Button>
      {/if}
      {#if firstOpen}
        <Button variant="primary" disabled={busy} onclick={() => onResolve(firstOpen)}>
          Resolve escalation
        </Button>
      {/if}
    </Row>
  </Stack>
</Card>

<style>
  .reason {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
</style>
