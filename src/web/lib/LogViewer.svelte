<!--
  LogViewer primitive. A scrollable monospace box for streaming log lines,
  event summaries, or command output. Caller owns the lines array; the
  component scrolls to bottom when new items arrive (if followTail).

  Usage:
    <LogViewer lines={bootstrapLog} followTail />
-->
<script lang="ts">
  interface Props {
    lines: readonly string[]
    maxHeight?: string
    followTail?: boolean
    empty?: string
  }

  let { lines, maxHeight = '260px', followTail = false, empty = '' }: Props = $props()

  let el: HTMLDivElement | undefined = $state()

  $effect(() => {
    void lines.length
    if (!followTail || !el) return
    queueMicrotask(() => {
      if (el) el.scrollTop = el.scrollHeight
    })
  })
</script>

<div class="log" bind:this={el} style="max-height: {maxHeight}">
  {#if lines.length === 0 && empty}
    <div class="log-empty">{empty}</div>
  {:else}
    {#each lines as line, i (i)}
      <div class="log-line">{line}</div>
    {/each}
  {/if}
</div>

<style>
  .log {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-2);
    overflow-y: auto;
    font-family: 'SF Mono', monospace;
    font-size: var(--fs-1);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .log-line {
    color: var(--text);
    line-height: var(--lh-body);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .log-empty {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
