<!--
  New request modal. Starts with a freeform request and lets users switch
  into the dedicated bug-report form only when they need stack-trace capture.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import Input from '../lib/Input.svelte'
  import Select from '../lib/Select.svelte'
  import Textarea from '../lib/Textarea.svelte'
  import { project } from '../lib/project.svelte.js'
  import { projectFetch } from '../lib/project-routes.js'
  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  type IntakeMode = 'request' | 'bug'
  let mode = $state<IntakeMode>('request')
  let ask = $state('')
  let title = $state('')

  let bugTitle = $state('')
  let bugBody = $state('')
  let bugStack = $state('')
  let bugPriority = $state<'high' | 'critical' | 'normal' | 'low'>('high')

  let busy = $state(false)
  let error = $state<string | null>(null)

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  async function submit() {
    error = null
    busy = true
    try {
      if (mode === 'bug') {
        if (!bugTitle.trim()) return (error = 'Please add a summary.')
        if (!bugBody.trim()) return (error = 'Please describe what happened.')
        const payload: Record<string, unknown> = {
          title: bugTitle.trim(),
          body: bugBody.trim(),
          priority: bugPriority,
        }
        if (bugStack.trim()) payload.stackTrace = bugStack.trim()
        const res = await projectFetch('/api/project/bug-report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const j = await res.json()
        if (j.error) return (error = 'Bug filing failed: ' + j.error)
        onClose()
        setTimeout(() => void project.refresh(), 400)
        return
      }

      if (!ask.trim()) return (error = 'Please describe the request.')
      const body: Record<string, unknown> = { ask: ask.trim() }
      if (title.trim()) body.title = title.trim()
      const res = await projectFetch('/api/project/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (j.error) return (error = 'Request failed: ' + j.error)
      onClose()
      setTimeout(() => void project.refresh(), 400)
    } finally {
      busy = false
    }
  }

  const priorityOptions = [
    { value: 'high', label: 'High (default)' },
    { value: 'critical', label: 'Critical (outage)' },
    { value: 'normal', label: 'Normal' },
    { value: 'low', label: 'Low' },
  ] as const

</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  role="presentation"
  onclick={onBackdrop}
>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="intake-title">
    <h2 id="intake-title">New request</h2>
    <Stack gap="3">
      {#if mode === 'bug'}
        <label class="field">
          <span>Summary</span>
          <Input bind:value={bugTitle} placeholder="What went wrong? (one line)" />
        </label>
        <label class="field">
          <span>Details</span>
          <Textarea
            bind:value={bugBody}
            rows={4}
            placeholder="What were you doing, what happened, and what did you expect?"
          />
        </label>
        <label class="field">
          <span>Stack trace (optional — used for domain routing)</span>
          <Textarea
            bind:value={bugStack}
            rows={4}
            mono
            placeholder="Paste the error's stack trace here if you have one"
          />
        </label>
        <label class="field">
          <span>Priority</span>
          <Select bind:value={bugPriority} options={priorityOptions} />
        </label>
      {:else}
        <label class="field">
          <span>What should Guildhall work through?</span>
          <Textarea
            bind:value={ask}
            rows={5}
            placeholder="Describe the request in plain language. Guildhall will ask follow-up questions before work starts."
          />
        </label>
        <label class="field">
          <span>Title (optional — auto-generated from the ask)</span>
          <Input bind:value={title} placeholder="Short descriptive title" />
        </label>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <Row justify="end" gap="2">
        {#if mode === 'bug'}
          <Button variant="ghost" disabled={busy} onclick={() => (mode = 'request')}>Create request instead</Button>
        {:else}
          <Button variant="ghost" disabled={busy} onclick={() => (mode = 'bug')}>File a bug instead</Button>
        {/if}
        <Button variant="secondary" disabled={busy} onclick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onclick={submit}>
          {mode === 'bug' ? (busy ? 'Filing...' : 'File bug') : busy ? 'Creating...' : 'Create request'}
        </Button>
      </Row>
    </Stack>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: var(--z-modal-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-4);
  }
  .modal {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-3);
    padding: var(--s-4);
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    position: relative;
    z-index: var(--z-modal);
  }
  h2 {
    font-size: var(--fs-4);
    font-weight: 700;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .field > span:first-child {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-2);
  }
</style>
