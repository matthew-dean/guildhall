<!--
  Modal for resolving an open escalation. Replaces the legacy window.prompt
  chain. Two paths:
    · Retry — resubmit the task to gate_check with a short "retrying" note
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
  import { escalationReasonLabel, roleLabel } from '../../lib/escalation-labels.js'
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

  $effect(() => {
    if (open) {
      if (mode === 'retry') {
        resolution = 'Retrying — infrastructure fixed.'
        nextStatus = 'gate_check'
      } else {
        resolution = ''
        nextStatus = 'ready'
      }
    }
  })

  async function handleRetry() {
    await onSubmit({
      resolution: resolution.trim() || 'Retrying — infrastructure fixed.',
      nextStatus: 'gate_check',
    })
  }

  async function handleResolve() {
    if (!resolution.trim()) return
    await onSubmit({ resolution: resolution.trim(), nextStatus })
  }

  const reasonText = $derived(escalationReasonLabel(escalation?.reason))
  const roleText = $derived(roleLabel(escalation?.agentId))
</script>

<Modal
  {open}
  title="Resolve escalation"
  {onClose}
  size="md"
>
  {#snippet children()}
    {#if escalation}
      <Stack gap="4">
        <Stack gap="2">
          <div class="chips">
            <Chip label={reasonText} tone="warn" />
            <Chip label={roleText} tone="accent" />
          </div>
          <p class="summary">{escalation.summary}</p>
        </Stack>

        <Field label="How should the agent proceed?" hint="Fed back to the coordinator as context on resume.">
          <Textarea
            bind:value={resolution}
            rows={4}
            placeholder="e.g. Installed oxlint; gates should now pass."
          />
        </Field>

        <Field label="Resume at" hint="Which step the task re-enters.">
          <Select
            bind:value={nextStatus}
            options={[
              { value: 'ready', label: 'Ready (coordinator picks next step)' },
              { value: 'gate_check', label: 'Gate check (re-run gates)' },
              { value: 'in_progress', label: 'In progress (keep working)' },
              { value: 'review', label: 'Review (send to reviewer)' },
              { value: 'exploring', label: 'Exploring (re-investigate)' },
              { value: 'spec_review', label: 'Spec review' },
            ]}
          />
        </Field>
      </Stack>
    {/if}
  {/snippet}

  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
    <Button variant="secondary" disabled={busy} onclick={handleRetry}>
      Retry gates
    </Button>
    <Button variant="primary" disabled={busy || !resolution.trim()} onclick={handleResolve}>
      Resolve
    </Button>
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
</style>
