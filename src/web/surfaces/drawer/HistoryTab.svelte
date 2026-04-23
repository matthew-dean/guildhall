<!--
  History tab: revision counts, gate results, and all escalations (open + resolved).
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  const gateResults = $derived(task.gateResults ?? [])
  const escalations = $derived(task.escalations ?? [])
</script>

<Stack gap="4">
  <Card title="Revisions">
    <p>
      Revision count: <strong>{task.revisionCount ?? 0}</strong>
      {#if (task.remediationAttempts ?? 0) > 0}
        · Remediation attempts: <strong>{task.remediationAttempts}</strong>
      {/if}
    </p>
  </Card>

  <Card title="Gate results ({gateResults.length})">
    {#if gateResults.length === 0}
      <p class="muted">No gate runs yet.</p>
    {:else}
      <Stack gap="2">
        {#each gateResults as g, i (i)}
          <article class="entry">
            <header>
              <span class="id">{g.gateId ?? '—'}</span>
              <span class="kind">{g.type ?? ''}</span>
              <Chip
                label={g.passed ? 'pass' : 'fail'}
                tone={g.passed ? 'ok' : 'danger'}
              />
              <time>{g.checkedAt ?? ''}</time>
            </header>
            {#if g.output}
              <pre>{g.output}</pre>
            {/if}
          </article>
        {/each}
      </Stack>
    {/if}
  </Card>

  <Card title="Escalations ({escalations.length})">
    {#if escalations.length === 0}
      <p class="muted">No escalations.</p>
    {:else}
      <Stack gap="2">
        {#each escalations as e, i (i)}
          <article class="entry">
            <header>
              <span class="id">{e.reason ?? '—'}</span>
              <Chip
                label={e.resolvedAt ? 'resolved' : 'open'}
                tone={e.resolvedAt ? 'ok' : 'warn'}
              />
            </header>
            {#if e.summary}<Markdown source={e.summary} />{/if}
            {#if e.details}<Markdown source={e.details} />{/if}
          </article>
        {/each}
      </Stack>
    {/if}
  </Card>
</Stack>

<style>
  p {
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .muted {
    color: var(--text-muted);
  }
  .entry {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  header .id {
    color: var(--text);
  }
  header time {
    margin-left: auto;
  }
  pre {
    background: var(--bg-raised-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: var(--s-2);
    font-size: var(--fs-0);
    font-family: 'SF Mono', monospace;
    white-space: pre-wrap;
    color: var(--text);
    line-height: var(--lh-body);
  }
</style>
