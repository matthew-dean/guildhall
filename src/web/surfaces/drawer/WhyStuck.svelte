<!--
  Banner at the top of the Spec tab when a task is blocked, shelved, or has
  an open escalation. Primary/secondary/overflow IA:
    · Primary: one-line reason headline + chip row (reason code + role).
    · Secondary: single action row (Retry gates / Mark blocker resolved...).
    · Overflow: details collapsed behind a <details> toggle.
-->
<script lang="ts">
  import Card from '../../lib/ui-compat/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import { activeEscalations } from '../../lib/escalation.js'
  import {
    escalationReasonLabel,
    escalationPrimaryAction,
    escalationRecoveryCopy,
    escalationUserGuidance,
    roleLabel,
    roleBlurb,
  } from '../../lib/escalation-labels.js'
  import type { Task, Escalation } from '../../lib/types.js'

  interface Props {
    task: Task
    busy?: boolean
    onUnshelve: () => void
    onResolve: (escalation: Escalation, mode: 'retry' | 'resolve') => void
    onRun: (escalation: Escalation) => void
  }

  let { task, busy = false, onUnshelve, onResolve, onRun }: Props = $props()

  const openEscalations = $derived(
    activeEscalations(task),
  )
  const firstOpen = $derived<Escalation | undefined>(openEscalations[0])

  // blockReason is persisted as "<enum_code>: <summary>" by the escalation
  // tool. Strip the enum prefix for display — the reason chip below carries
  // the human-readable code label already.
  function stripEnumPrefix(s: string): string {
    return s.replace(/^[a-z_]+:\s*/, '')
  }

  const headline = $derived.by(() => {
    if (firstOpen) {
      return escalationRecoveryCopy(firstOpen).headline
    }
    if (task.status === 'blocked') {
      return stripEnumPrefix(task.blockReason ?? 'Blocked — waiting on human action.')
    }
    if (task.status === 'shelved') {
      return task.shelveReason?.detail ?? 'Shelved by policy or pre-rejection.'
    }
    if (openEscalations.length > 0) {
      return openEscalations[0].summary ?? 'An escalation is open.'
    }
    return 'An escalation is open.'
  })

  const reasonChip = $derived(
    firstOpen ? escalationReasonLabel(firstOpen.reason) : null,
  )
  const roleChip = $derived(
    firstOpen ? roleLabel(firstOpen.agentId) : null,
  )
  const roleTitle = $derived(
    firstOpen ? roleBlurb(firstOpen.agentId) : '',
  )
  const primaryAction = $derived(escalationPrimaryAction(firstOpen))
  const guidance = $derived(escalationUserGuidance(firstOpen))
  const recoveryDetail = $derived(firstOpen ? escalationRecoveryCopy(firstOpen).detail : null)
</script>

<Card tone="danger" title="Why is this stuck?">
  <Stack gap="3">
    <p class="headline">{headline}</p>
    {#if recoveryDetail}
      <p class="copy">{recoveryDetail}</p>
    {/if}

    {#if reasonChip || roleChip}
      <div class="chips">
        {#if reasonChip}
          <Chip label={reasonChip} tone="warn" />
        {/if}
        {#if roleChip}
          <span title={roleTitle}>
            <Chip label={roleChip} tone="accent" />
          </span>
        {/if}
      </div>
    {/if}

    {#if firstOpen && firstOpen.details}
      <details class="more">
        <summary>Show details</summary>
        <div class="details-body">
          <Markdown source={firstOpen.details} />
        </div>
      </details>
    {/if}

    <Row justify="end" gap="2">
      {#if task.status === 'shelved'}
        <Button variant="secondary" disabled={busy} onclick={onUnshelve}>
          Unshelve
        </Button>
      {/if}
      {#if firstOpen}
        {#if guidance.actionOwner === 'guildhall'}
          <Button
            variant="agent"
            disabled={busy}
            onclick={() => onRun(firstOpen)}
          >
            <Icon name="sparkles" size={14} />
            {primaryAction.label}
          </Button>
        {:else}
          <Button
            variant="primary"
            disabled={busy}
            onclick={() => onResolve(firstOpen, 'resolve')}
          >
            Mark blocker resolved...
          </Button>
        {/if}
      {/if}
    </Row>
  </Stack>
</Card>

<style>
  .headline {
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }
  .copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .chips {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--gh-type-weight-strong);
    list-style: none;
  }
  .more > summary::-webkit-details-marker {
    display: none;
  }
  .more > summary::before {
    content: '▸ ';
  }
  .more[open] > summary::before {
    content: '▾ ';
  }
  .details-body {
    margin-top: var(--s-2);
    color: var(--text);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
</style>
