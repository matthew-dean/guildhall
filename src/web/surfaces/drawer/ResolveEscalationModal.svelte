<!--
  Modal for resolving an open escalation. Replaces the legacy window.prompt
  chain. Two paths:
    · Retry — resolve with the reason-aware primary action
    · Resolve with note — free-form resolution + next status picker
-->
<script lang="ts">
  import Modal from '../../lib/Modal.svelte'
  import Button from '../../lib/Button.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Select from '../../lib/Select.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Field from '../../lib/Field.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import { escalationPrimaryAction, escalationReasonLabel, roleLabel } from '../../lib/escalation-labels.js'
  import type { Escalation } from '../../lib/types.js'

  interface Props {
    open: boolean
    escalation: Escalation | null
    mode?: 'retry' | 'resolve'
    busy?: boolean
    onClose: () => void
    onSubmit: (args: { resolution: string; nextStatus: string }) => Promise<void> | void
  }

  let { open, escalation, mode = 'resolve', busy = false, onClose, onSubmit }: Props = $props()

  let resolution = $state('')
  let nextStatus = $state<'ready' | 'gate_check' | 'in_progress' | 'exploring' | 'spec_review' | 'review'>('ready')
  const primaryAction = $derived(escalationPrimaryAction(escalation))

  $effect(() => {
    if (open) {
      if (mode === 'retry') {
        resolution = primaryAction.resolution
        nextStatus = primaryAction.nextStatus
      } else {
        resolution = ''
        nextStatus = 'ready'
      }
    }
  })

  async function handleRetry() {
    await onSubmit({
      resolution: resolution.trim() || primaryAction.resolution,
      nextStatus: primaryAction.nextStatus,
    })
  }

  async function handleResolve() {
    if (!resolution.trim()) return
    await onSubmit({ resolution: resolution.trim(), nextStatus })
  }

  const reasonText = $derived(escalationReasonLabel(escalation?.reason))
  const displayedReasonText = $derived(
    mode === 'retry' && primaryAction.label === 'Retry worker'
      ? 'Worker stalled'
      : reasonText,
  )
  const roleText = $derived(roleLabel(escalation?.agentId))
</script>

<Modal
  {open}
  title={mode === 'retry' ? primaryAction.label : 'Mark blocker resolved'}
  {onClose}
  size="md"
>
  {#snippet children()}
    {#if escalation}
      <Stack gap="4">
        <Stack gap="2">
          <div class="chips">
            <Chip label={displayedReasonText} tone="warn" />
            <Chip label={roleText} tone="accent" />
          </div>
          <p class="summary">{escalation.summary}</p>
          <p class="mode-help">
            {mode === 'retry'
              ? 'Guildhall will close this blocker and continue from the step this recovery action is built for.'
              : 'Use this when you handled the blocker yourself or want to tell Guildhall exactly where to continue.'}
          </p>
        </Stack>

        <Field
          label={mode === 'retry' ? 'Resume note' : 'Resolution note'}
          hint={mode === 'retry'
            ? 'This note is sent back to the coordinator when the task resumes.'
            : 'Tell the coordinator what changed, then choose where the task re-enters.'}
        >
          <Textarea
            bind:value={resolution}
            rows={4}
            placeholder="e.g. Installed oxlint; gates should now pass."
          />
        </Field>

        {#if mode === 'resolve'}
          <Field label="Resume at" hint="Which step the task re-enters.">
            <Select
              bind:value={nextStatus}
              options={[
                { value: 'ready', label: 'Ready (coordinator picks next step)' },
                { value: 'gate_check', label: 'Gate check (re-run gates)' },
                { value: 'in_progress', label: 'In progress (keep working)' },
                { value: 'review', label: 'Review (send to reviewer)' },
                { value: 'exploring', label: 'Exploring (re-investigate)' },
                { value: 'spec_review', label: 'Awaiting approval' },
              ]}
            />
          </Field>
        {/if}
      </Stack>
    {/if}
  {/snippet}

  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
    {#if mode === 'retry'}
      <Button variant="agent" disabled={busy} onclick={handleRetry}>
        <Icon name="sparkles" size={14} />
        {primaryAction.label}
      </Button>
    {:else}
      <Button variant="primary" disabled={busy || !resolution.trim()} onclick={handleResolve}>
        Mark resolved
      </Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .chips {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .summary {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    margin: 0;
  }
  .mode-help {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    margin: 0;
  }
</style>
