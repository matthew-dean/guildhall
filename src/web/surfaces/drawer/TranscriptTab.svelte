<!--
  Transcript tab: agent notes in chronological order.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import type { Task } from '../../lib/types.js'
  import { escapeAngleBracketPlaceholders } from '../../lib/spec-render.js'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  const notes = $derived(task.notes ?? [])
</script>

{#if notes.length === 0}
  <p class="muted">No agent notes yet.</p>
{:else}
  <Stack gap="3">
    {#each notes as n, i (i)}
      <article class="note">
        <header class="note-head">
          <span class="role">{n.role ?? n.agentId ?? 'agent'}</span>
          <time>{n.timestamp ?? ''}</time>
        </header>
        <Markdown source={escapeAngleBracketPlaceholders(n.content ?? '')} />
      </article>
    {/each}
  </Stack>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .note {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .note-head {
    display: flex;
    justify-content: space-between;
    gap: var(--s-3);
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .role {
    color: var(--accent);
  }
  p {
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    white-space: pre-wrap;
  }
</style>
