<!--
  Transcript tab: actual exploring conversation first, then durable task notes.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import type { Task } from '../../lib/types.js'
  import { escapeAngleBracketPlaceholders } from '../../lib/spec-render.js'

  interface ExploringTranscriptPayload {
    content: string | null
    path: string
    error?: string
  }

  interface TranscriptEntry {
    role: string
    timestamp: string
    content: string
  }

  interface Props {
    task: Task
    exploringTranscript?: ExploringTranscriptPayload | null
  }

  let { task, exploringTranscript = null }: Props = $props()

  const notes = $derived(task.notes ?? [])
  const entries = $derived(parseExploringTranscript(exploringTranscript?.content ?? ''))
  const hasNotes = $derived(notes.length > 0)
  const taskIsDone = $derived(task.status === 'done')
  const doneSummary = $derived(task.doneSummaryBundle ?? null)

  function parseExploringTranscript(content: string): TranscriptEntry[] {
    const entries: TranscriptEntry[] = []
    const body = content.replace(/^# .*?\n+/, '')
    const re = /^## \[([^\]]+)\]\s+([^\n]+)\n\n([\s\S]*?)(?=\n---\n|$)/gm
    for (const match of body.matchAll(re)) {
      const timestamp = (match[1] ?? '').trim()
      const role = (match[2] ?? '').trim()
      const entryContent = (match[3] ?? '').replace(/\n---\s*$/, '').trim()
      if (!role && !entryContent) continue
      entries.push({ role: role || 'agent', timestamp, content: entryContent })
    }
    return entries
  }
</script>

{#if taskIsDone}
  <section class="source-note" aria-label="Source conversation">
    <h4>Source conversation</h4>
    <p>
      This task is done, so Journey is the friendly summary. Transcript stays here as the source conversation
      {#if doneSummary?.retention?.compactedFullTranscript}
        , and Guildhall has already reduced it into a done-task summary.
      {:else}
        when you need the original thread.
      {/if}
    </p>
  </section>
{/if}

{#if entries.length === 0 && !hasNotes}
  <p class="muted">No transcript entries or task notes yet.</p>
{:else}
  <Stack gap="3">
    {#if entries.length > 0}
      <section class="transcript-section" aria-label="Exploring transcript">
        <h4>Exploring transcript</h4>
        <Stack gap="3">
          {#each entries as entry, i (`${entry.timestamp}-${entry.role}-${i}`)}
            <article class="note">
              <header class="note-head">
                <span class="role">{entry.role}</span>
                <time>{entry.timestamp}</time>
              </header>
              <Markdown source={escapeAngleBracketPlaceholders(entry.content)} />
            </article>
          {/each}
        </Stack>
      </section>
    {:else if exploringTranscript?.error}
      <p class="muted">Transcript could not be loaded: {exploringTranscript.error}</p>
    {/if}

    {#if hasNotes}
      <section class="transcript-section" aria-label="Task notes">
        {#if entries.length > 0}
          <h4>Task notes</h4>
        {/if}
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
      </section>
    {/if}
  </Stack>
{/if}

<style>
  .transcript-section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .source-note {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    margin-bottom: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h4 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
  }
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
