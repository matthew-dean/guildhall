<script lang="ts">
  import Markdown from './Markdown.svelte'
  import IdentifierChip from './IdentifierChip.svelte'
  import { currentTaskHref } from './project-routes.js'
  import { nav } from './nav.svelte.js'
  import {
    friendlyTaskLabel,
    humanizeRuntimeText,
    taskTitleMap,
  } from './identifier-labels.js'
  import type { Task } from './types.js'

  interface Props {
    progress: string
    tasks?: Task[]
  }

  interface ProgressEntry {
    id: string
    type: string
    timestamp: string
    agentId: string
    domain: string
    taskId: string
    taskLabel: string
    summary: string
    timeLabel: string
  }

  let { progress, tasks = [] }: Props = $props()

  const taskTitles = $derived(taskTitleMap(tasks))
  const entries = $derived(parseProgressEntries(progress, taskTitles))

  function parseProgressEntries(markdown: string, titles: Record<string, string>): ProgressEntry[] {
    const parsed: ProgressEntry[] = []
    const blocks = markdown.split(/\n---\s*(?:\n|$)/g)
    for (const block of blocks) {
      const heading = block.match(/^###\s*(?:\S+\s+)?([A-Z_ -]+?)\s+—\s+([^\n]+)$/m)
      const meta = block.match(/\*\*Agent:\*\*\s*([^|\n]+?)\s*\|\s*\*\*Domain:\*\*\s*([^\n]+)\n\*\*Task:\*\*\s*([^\n]+)/m)
      if (!heading || !meta) continue
      const type = (heading[1] ?? 'update').trim().toLowerCase()
      const timestamp = (heading[2] ?? '').trim()
      const agentId = (meta[1] ?? '').trim()
      const domain = (meta[2] ?? '').trim()
      const taskId = (meta[3] ?? '').trim()
      const bodyStart = meta.index + meta[0].length
      const summary = humanizeRuntimeText(block.slice(bodyStart).trim(), titles)
      parsed.push({
        id: `${timestamp}:${taskId}:${parsed.length}`,
        type,
        timestamp,
        agentId,
        domain,
        taskId,
        taskLabel: friendlyTaskLabel(taskId, titles),
        summary,
        timeLabel: formatTimestamp(timestamp),
      })
    }
    return parsed
  }

  function formatTimestamp(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
</script>

{#if entries.length > 0}
  <div class="progress-feed">
    {#each entries as entry (entry.id)}
      <article class="progress-entry">
        <div class="progress-entry-head">
          <IdentifierChip kind="agent" value={entry.agentId} />
          <IdentifierChip kind="progress" value={entry.type} />
          <IdentifierChip kind="domain" value={entry.domain} />
          {#if entry.taskId}
            <button type="button" class="progress-task-link" onclick={() => nav(currentTaskHref(entry.taskId))}>
              {entry.taskLabel}
            </button>
          {/if}
          {#if entry.timeLabel}
            <time datetime={entry.timestamp}>{entry.timeLabel}</time>
          {/if}
        </div>
        <p>{entry.summary}</p>
      </article>
    {/each}
  </div>
{:else}
  <div class="progress">
    <Markdown source={progress} />
  </div>
{/if}

<style>
  .progress-feed {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-height: 320px;
    overflow: auto;
    margin-top: var(--s-2);
  }
  .progress-entry {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
  }
  .progress-entry-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-2);
    min-width: 0;
  }
  .progress-task-link {
    min-width: 0;
    max-width: min(44ch, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 700;
    padding: 2px var(--s-2);
    cursor: pointer;
  }
  .progress-task-link:hover {
    border-color: var(--accent);
  }
  .progress-entry time {
    margin-left: auto;
    color: var(--text-muted);
    font-size: var(--fs-0);
    white-space: nowrap;
  }
  .progress-entry p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .progress {
    max-height: 260px;
    overflow: auto;
    margin-top: var(--s-2);
  }
</style>
