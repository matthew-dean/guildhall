<!--
  Global app header. Trimmed to the workspace-level brand + the SSE live
  indicator. Project-level controls (name chip, run status, Start/Stop,
  New Task) live inside ProjectView's top bar now. Providers navigation
  moved to the bottom of the left rail.
-->
<script lang="ts">
  import Icon from '../lib/Icon.svelte'
  import { nav, path } from '../lib/nav.svelte.js'
  import { onStatus, type SseStatus } from '../lib/events.js'
  import StatusDot from '../lib/StatusDot.svelte'
  import { parseProjectRoute } from '../lib/project-routes.js'

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
    sseStatus === 'live' ? 'live' : sseStatus === 'error' ? 'reconnecting...' : 'connecting...',
  )
  const showProjectMenu = $derived(path.value.startsWith('/project') || parseProjectRoute(path.value).projectScoped)

  function goHome() {
    nav('/')
  }

  function toggleProjectNav() {
    window.dispatchEvent(new CustomEvent('guildhall:toggle-project-nav'))
  }
</script>

<header class="app-header">
  {#if showProjectMenu}
    <button type="button" class="project-menu" onclick={toggleProjectNav} aria-label="Open project navigation">
      <Icon name="menu" size={18} />
    </button>
  {/if}
  <button type="button" class="brand" onclick={goHome} aria-label="Projects home">
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
    min-height: var(--app-header-h);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
    z-index: var(--z-app-header);
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
  .project-menu {
    display: none;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-1);
    background: var(--bg-elevated);
    color: var(--text);
    cursor: pointer;
    padding: 0;
  }
  .project-menu:hover {
    background: var(--bg-raised-2);
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
  @media (max-width: 1100px) {
    .project-menu {
      display: inline-flex;
    }
  }
</style>
