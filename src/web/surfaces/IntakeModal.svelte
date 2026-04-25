<!--
  New-task modal. Switches between the feature/question form and the
  bug-report form based on the Type select. Legacy `showIntakeModal` +
  `bug-report` flows merged into one component.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import Input from '../lib/Input.svelte'
  import Select from '../lib/Select.svelte'
  import Textarea from '../lib/Textarea.svelte'
  import { project } from '../lib/project.svelte.js'
  import { friendlyDomain } from '../lib/display.js'
  import type { CoordinatorConfig } from '../lib/types.js'

  interface Props {
    coordinators: CoordinatorConfig[]
    onClose: () => void
  }

  let { coordinators, onClose }: Props = $props()

  type IntakeType = 'feature' | 'bug' | 'question'
  let type = $state<IntakeType>('feature')
  let ask = $state('')
  let title = $state('')
  let domain = $state('')

  let bugTitle = $state('')
  let bugBody = $state('')
  let bugStack = $state('')
  let bugDomain = $state('')
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
      if (type === 'bug') {
        if (!bugTitle.trim()) return (error = 'Please add a summary.')
        if (!bugBody.trim()) return (error = 'Please describe what happened.')
        const payload: Record<string, unknown> = {
          title: bugTitle.trim(),
          body: bugBody.trim(),
          priority: bugPriority,
        }
        if (bugStack.trim()) payload.stackTrace = bugStack.trim()
        if (bugDomain) payload.domain = bugDomain
        const res = await fetch('/api/project/bug-report', {
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

      if (!ask.trim()) return (error = 'Please describe the task.')
      const body: Record<string, unknown> = { ask: ask.trim(), domain }
      if (title.trim()) body.title = title.trim()
      const res = await fetch('/api/project/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (j.error) return (error = 'Intake failed: ' + j.error)
      onClose()
      const detail = await fetch('/api/project').then(r => r.json())
      if (!detail.run || detail.run.status !== 'running') {
        await fetch('/api/project/start', { method: 'POST' })
      }
      setTimeout(() => void project.refresh(), 400)
    } finally {
      busy = false
    }
  }

  $effect(() => {
    if (domain === '' && coordinators.length > 0 && coordinators[0].domain) {
      domain = coordinators[0].domain
    }
  })

  const typeOptions = [
    { value: 'feature', label: 'Feature / change' },
    { value: 'bug', label: 'Bug — file a stack trace for agents to triage' },
    { value: 'question', label: 'Question / research' },
  ] as const

  const priorityOptions = [
    { value: 'high', label: 'High (default)' },
    { value: 'critical', label: 'Critical (outage)' },
    { value: 'normal', label: 'Normal' },
    { value: 'low', label: 'Low' },
  ] as const

  const coordOptions = $derived(
    coordinators.map((c) => ({
      value: c.domain ?? '',
      label: c.name || friendlyDomain(c.domain) || 'Coordinator',
    })),
  )
  const bugDomainOptions = $derived([
    { value: '', label: '(auto — from stack trace, or first coordinator)' },
    ...coordOptions,
  ])
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  role="presentation"
  onclick={onBackdrop}
>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="intake-title">
    <h2 id="intake-title">New Task</h2>
    <Stack gap="3">
      <label class="field">
        <span>Type</span>
        <Select bind:value={type} options={typeOptions} />
      </label>

      {#if type === 'bug'}
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
          <span>Domain</span>
          <Select bind:value={bugDomain} options={bugDomainOptions} />
        </label>
        <label class="field">
          <span>Priority</span>
          <Select bind:value={bugPriority} options={priorityOptions} />
        </label>
      {:else}
        <label class="field">
          <span>What should the agents work on?</span>
          <Textarea
            bind:value={ask}
            rows={5}
            placeholder="Describe the task in plain language. The spec agent will ask follow-ups before a coordinator assigns work."
          />
        </label>
        <label class="field">
          <span>Domain (routes to a coordinator)</span>
          <Select bind:value={domain} options={coordOptions} />
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
        <Button variant="secondary" disabled={busy} onclick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onclick={submit}>
          {type === 'bug' ? (busy ? 'Filing…' : 'File bug') : busy ? 'Creating…' : 'Create task'}
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
    z-index: 200;
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
