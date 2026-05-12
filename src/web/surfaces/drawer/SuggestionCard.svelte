<!--
  Agent-suggested-task surface. Renders ONE question with three buttons:
  Yes (approve & proceed), No (drop it), Different (open a textbox to
  redirect the agent). No "brief", no "spec", no "approve" ceremony.

  Shown in place of every other Spec-tab card when:
    task.origination === 'agent' && task.productBrief is unapproved
  i.e. the user hasn't yet said "yes do this." Until then, this is the
  whole drawer for that task.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
    busy?: boolean
    onYes: () => void
    onNo: () => void
    onDifferent: (message: string) => Promise<void>
  }

  let { task, busy = false, onYes, onNo, onDifferent }: Props = $props()

  let mode = $state<'idle' | 'different'>('idle')
  let correction = $state('')

  const proposedBy = $derived(task.proposedBy ?? task.authoredBy ?? 'an agent')
  const rationale = $derived(task.proposalRationale?.trim() ?? '')

  async function submitDifferent(): Promise<void> {
    const msg = correction.trim()
    if (!msg) return
    await onDifferent(msg)
    correction = ''
    mode = 'idle'
  }
</script>

<div class="suggestion">
  <div class="meta">Suggested by {proposedBy}{rationale ? ' — ' + rationale : ''}.</div>

  <h2 class="title">{task.title}</h2>

  {#if task.description}
    <div class="body">
      <Markdown source={task.description} />
    </div>
  {/if}

  {#if mode === 'idle'}
    <Stack gap="2">
      <div class="actions">
        <Button variant="primary" disabled={busy} onclick={onYes}>
          Yes, do this
        </Button>
        <Button variant="secondary" disabled={busy} onclick={() => (mode = 'different')}>
          Tell me different
        </Button>
        <Button variant="ghost" disabled={busy} onclick={onNo}>
          No, drop it
        </Button>
      </div>
    </Stack>
  {:else}
    <Stack gap="2">
      <Textarea
        bind:value={correction}
        rows={3}
        placeholder="What should I do instead? (one sentence is fine)"
      />
      <div class="actions">
        <Button
          variant="primary"
          disabled={busy || correction.trim().length === 0}
          onclick={submitDifferent}
        >
          Send
        </Button>
        <Button variant="ghost" disabled={busy} onclick={() => { mode = 'idle'; correction = '' }}>
          Cancel
        </Button>
      </div>
    </Stack>
  {/if}
</div>

<style>
  .suggestion {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-4);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--r-1);
    background: var(--bg-raised);
  }
  .meta {
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .title {
    margin: 0;
    font-size: var(--fs-4);
    font-weight: 700;
    color: var(--text);
    line-height: var(--lh-tight);
  }
  .body {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .actions {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
</style>
