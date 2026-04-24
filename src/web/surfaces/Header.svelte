<!--
  Global app header. Trimmed to the workspace-level brand + the SSE live
  indicator. Project-level controls (name chip, run status, Start/Stop,
  New Task) live inside ProjectView's top bar now. Providers navigation
  moved to the bottom of the left rail.
-->
<script lang="ts">
  import { nav } from '../lib/nav.svelte.js'
  import { onStatus, type SseStatus } from '../lib/events.js'
  import StatusDot from '../lib/StatusDot.svelte'

  let sseStatus = $state<SseStatus>('connecting')
  let version = $state<string | null>(null)

  $effect(() => {
    const off = onStatus(s => (sseStatus = s))
    return off
  })

  $effect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then((j: { version?: string }) => {
        if (j?.version) version = j.version
      })
      .catch(() => {})
  })

  const sseTone = $derived<'active' | 'warn' | 'idle'>(
    sseStatus === 'live' ? 'active' : sseStatus === 'error' ? 'warn' : 'idle',
  )
  const sseLabel = $derived(
    sseStatus === 'live' ? 'live' : sseStatus === 'error' ? 'reconnecting…' : 'connecting…',
  )

  function goHome() {
    nav('/')
  }
</script>

<header class="app-header">
  <button type="button" class="brand" onclick={goHome} aria-label="Workspace home">
    Guildhall
  </button>
  {#if version}
    <span class="version" title="Guildhall runtime version">v{version}</span>
  {/if}
  <span class="grow"></span>
  <span class="sse-status">
    <StatusDot tone={sseTone} pulse={sseStatus === 'live'} />
    {sseLabel}
  </span>
</header>

<style>
  .app-header {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
  }
  .brand {
    font-size: var(--fs-3);
    font-weight: 700;
    letter-spacing: -0.3px;
    line-height: var(--lh-tight);
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0;
    font-family: inherit;
  }
  .brand:hover {
    color: var(--accent);
  }
  .version {
    font-size: var(--fs-0);
    color: var(--text-muted);
    font-weight: 600;
    letter-spacing: 0.02em;
    margin-left: -2px;
  }
  .grow {
    flex: 1;
  }
  .sse-status {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--fs-0);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
</style>
