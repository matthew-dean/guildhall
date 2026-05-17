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
  import { humanizeProjectName } from '../lib/project-name.js'

  let sseStatus = $state<SseStatus>('connecting')
  let version = $state<string | null>(null)
  let projectTitle = $state<string | null>(null)

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
  const parsedRoute = $derived(parseProjectRoute(path.value))
  const showProjectMenu = $derived(path.value.startsWith('/project') || parsedRoute.projectScoped)

  $effect(() => {
    projectTitle = parsedRoute.projectScoped
      ? humanizeProjectName(parsedRoute.projectId)
      : null
  })

  $effect(() => {
    const handle = (event: Event) => {
      const custom = event as CustomEvent<{ title?: string | null }>
      projectTitle = typeof custom.detail?.title === 'string' && custom.detail.title.trim().length > 0
        ? custom.detail.title.trim()
        : (parsedRoute.projectScoped ? humanizeProjectName(parsedRoute.projectId) : null)
    }
    window.addEventListener('guildhall:set-project-title', handle as EventListener)
    return () => window.removeEventListener('guildhall:set-project-title', handle as EventListener)
  })

  function goHome() {
    nav('/')
  }

  function toggleProjectNav() {
    window.dispatchEvent(new CustomEvent('guildhall:toggle-project-nav'))
  }
</script>

<header class="app-header">
  <div class="header-left">
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
  </div>
  <div class="header-center" title={projectTitle ?? undefined}>
    {#if projectTitle}
      <span class="project-title">{projectTitle}</span>
    {/if}
  </div>
  <div class="header-right">
    <span class="sse-status">
      <StatusDot tone={sseTone} pulse={sseStatus === 'live'} />
      {sseLabel}
    </span>
  </div>
</header>

<style>
  .app-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-4);
    min-height: var(--app-header-h);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
    z-index: var(--z-app-header);
  }
  .header-left,
  .header-right {
    display: inline-flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  .header-right {
    justify-self: end;
  }
  .header-center {
    min-width: 0;
    justify-self: center;
    padding-inline: var(--s-3);
  }
  .project-title {
    display: inline-block;
    max-width: min(52vw, 40ch);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-size: var(--fs-2);
    font-weight: 600;
    line-height: var(--lh-tight);
    text-transform: none;
    letter-spacing: 0;
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
  @media (max-width: 900px) {
    .app-header {
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--s-2);
    }
    .header-left,
    .header-right {
      gap: var(--s-2);
    }
    .project-title {
      max-width: min(42vw, 24ch);
      font-size: var(--fs-1);
    }
  }
</style>
