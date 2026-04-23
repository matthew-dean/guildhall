<!--
  Top-level app header: brand, project-name badge, activity chip, Providers
  link, SSE status dot. Clicking the activity chip jumps to the Work view.
-->
<script lang="ts">
  import { path, nav } from '../lib/nav.svelte.js'
  import { project } from '../lib/project.svelte.js'
  import { onStatus, type SseStatus } from '../lib/events.js'
  import StatusDot from '../lib/StatusDot.svelte'

  let running = $state(false)
  let inFlightCount = $state(0)
  let summary = $state('Agents idle')
  let sseStatus = $state<SseStatus>('connecting')

  async function refreshActivityChip() {
    try {
      const r = await fetch('/api/project/activity')
      const j = await r.json()
      if (j.error) return
      running = Boolean(j.running)
      const inflight: Array<{ id: string; status: string }> =
        Array.isArray(j.inFlight) ? j.inFlight : []
      inFlightCount = inflight.length
      if (!running && inflight.length === 0) {
        summary = 'Agents idle'
      } else if (inflight.length === 0) {
        summary = 'Orchestrator running · no tasks in flight'
      } else {
        const heads = inflight.slice(0, 2).map(t => `${t.id} ${t.status.replace('_', ' ')}`)
        const more = inflight.length > heads.length ? ` +${inflight.length - heads.length}` : ''
        summary = `${inflight.length} in flight · ${heads.join(' · ')}${more}`
      }
    } catch {
      /* chip stays on its previous value; SSE will correct it */
    }
  }

  $effect(() => {
    refreshActivityChip()
    const iv = setInterval(refreshActivityChip, 3000)
    const off = onStatus(s => (sseStatus = s))
    return () => {
      clearInterval(iv)
      off()
    }
  })

  function onChipClick() {
    if (path.value !== '/') nav('/')
  }

  const projectName = $derived(project.detail?.name ?? '')
  const sseTone = $derived<'active' | 'warn' | 'idle'>(
    sseStatus === 'live' ? 'active' : sseStatus === 'error' ? 'warn' : 'idle',
  )
  const sseLabel = $derived(
    sseStatus === 'live' ? 'live' : sseStatus === 'error' ? 'reconnecting…' : 'connecting…',
  )
</script>

<header class="app-header">
  <h1 class="brand"><a href="/">⚔ Guildhall</a></h1>
  {#if projectName}
    <span class="project-badge">{projectName}</span>
  {/if}
  <span class="grow"></span>
  <button
    type="button"
    class="chip"
    class:running
    onclick={onChipClick}
    aria-label="Jump to Work view"
    title="Jump to Work view"
  >
    <StatusDot tone={running ? 'active' : 'idle'} pulse={running} />
    <span class="chip-summary">{summary}</span>
  </button>
  <a href="/providers" class="nav-link" class:active={path.value === '/providers'}>
    Providers
  </a>
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
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
  }
  .brand {
    font-size: var(--fs-3);
    font-weight: 700;
    line-height: var(--lh-tight);
  }
  .brand :global(a) {
    color: var(--text);
    text-decoration: none;
  }
  .project-badge {
    font-size: var(--fs-1);
    color: var(--text-muted);
    padding: 2px var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .grow {
    flex: 1;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--fs-1);
    font-family: inherit;
    padding: 2px var(--control-pad-x);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-muted);
    border-radius: 999px;
    cursor: pointer;
    min-height: var(--control-h);
    line-height: var(--lh-tight);
  }
  .chip.running {
    color: var(--accent-2);
    border-color: var(--accent-2);
  }
  .nav-link {
    color: var(--text-muted);
    font-size: var(--fs-2);
    text-decoration: none;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-1);
  }
  .nav-link:hover,
  .nav-link.active {
    color: var(--text);
    background: var(--bg-raised-2);
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
