<!--
  Global app header. Trimmed to the workspace-level brand + the SSE live
  indicator. Project-level controls (name chip, run status, Start/Stop,
  New request) live inside ProjectView's top bar now. Providers navigation
  moved to the bottom of the left rail.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Icon from '../lib/Icon.svelte'
  import { nav, path } from '../lib/nav.svelte.js'
  import { onStatus, type SseStatus } from '../lib/events.js'
  import StatusDot from '../lib/StatusDot.svelte'
  import { parseProjectRoute } from '../lib/project-routes.js'
  import { humanizeProjectName } from '../lib/project-name.js'
  import { project } from '../lib/project.svelte.js'

  let sseStatus = $state<SseStatus>('connecting')
  let version = $state<string | null>(null)
  let projectTitle = $state<string | null>(null)
  let compactProjectNav = $state(false)
  let navContextMode = $state<'project' | 'list' | 'detail' | 'split'>('project')

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
    sseStatus === 'live' ? 'active' : sseStatus === 'reconnecting' ? 'warn' : 'idle',
  )
  const sseLabel = $derived(
    sseStatus === 'live' ? 'connected' : sseStatus === 'reconnecting' ? 'reconnecting' : 'connecting',
  )
  const headerPath = $derived(path.value)
  const browserPath = $derived(typeof window === 'undefined' ? headerPath : window.location.pathname)
  const parsedRoute = $derived(parseProjectRoute(headerPath))
  const browserRoute = $derived(parseProjectRoute(browserPath))
  const showProjectMenu = $derived(
    (path.value.startsWith('/project') || parsedRoute.projectScoped) &&
    compactProjectNav &&
    navContextMode !== 'detail',
  )
  const showSseStatus = $derived(browserRoute.projectScoped || browserPath.startsWith('/project'))
  const savedProjectTitle = $derived(
    parsedRoute.projectScoped && project.detail?.id === parsedRoute.projectId
      ? (project.detail.name?.trim() || null)
      : null,
  )
  const fallbackProjectTitle = $derived(
    parsedRoute.projectScoped
      ? humanizeProjectName(parsedRoute.projectId)
      : null,
  )

  $effect(() => {
    projectTitle = savedProjectTitle ?? fallbackProjectTitle
  })

  $effect(() => {
    const handle = (event: Event) => {
      const custom = event as CustomEvent<{ title?: string | null }>
      projectTitle = typeof custom.detail?.title === 'string' && custom.detail.title.trim().length > 0
        ? custom.detail.title.trim()
        : (savedProjectTitle ?? fallbackProjectTitle)
    }
    window.addEventListener('guildhall:set-project-title', handle as EventListener)
    return () => window.removeEventListener('guildhall:set-project-title', handle as EventListener)
  })

  $effect(() => {
    const media = window.matchMedia('(max-width: 920px)')
    const sync = () => {
      compactProjectNav = media.matches
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  })

  $effect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: 'project' | 'list' | 'detail' | 'split' }>).detail
      navContextMode = detail?.mode ?? 'project'
    }
    window.addEventListener('guildhall:set-nav-context', handle as EventListener)
    return () => window.removeEventListener('guildhall:set-nav-context', handle as EventListener)
  })

  function goHome() {
    nav('/')
  }

  function toggleProjectNav() {
    window.dispatchEvent(new CustomEvent('guildhall:toggle-project-nav'))
  }

  function browserIsGlobalPage(): boolean {
    if (typeof window === 'undefined') return false
    return ['/', '/projects', '/overview', '/providers', '/needs-you', '/notifications', '/inbox'].includes(window.location.pathname)
  }
</script>

<header class="app-header">
  <div class="header-left">
    {#if showProjectMenu}
      <Button
        variant="secondary"
        size="sm"
        iconOnly
        onclick={toggleProjectNav}
        ariaLabel="Open project navigation"
        title="Open project navigation"
        className="project-menu"
      >
        <Icon name="menu" size={18} />
      </Button>
    {/if}
    <button type="button" class="brand" onclick={goHome} aria-label="Projects home">
      <span class="brand-mark" aria-hidden="true">
        <img src="/icons/genfavicon-64.png" alt="" />
      </span>
      <span class="brand-word">Guildhall</span>
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
    {#if showSseStatus && !browserIsGlobalPage()}
      <span class="sse-status">
        <StatusDot tone={sseTone} pulse={sseStatus === 'live'} />
        {sseLabel}
      </span>
    {/if}
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
    border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 82%, var(--border));
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 32%),
      color-mix(in srgb, var(--glass-bg-strong) 92%, var(--bg-raised));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 7%, transparent),
      0 8px 24px color-mix(in srgb, black 18%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
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
    display: inline-flex;
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
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--fs-3);
    font-weight: 700;
    letter-spacing: 0;
    line-height: var(--lh-tight);
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 0;
    font-family: inherit;
  }
  .brand-mark {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 8px;
    isolation: isolate;
  }
  .brand-mark::before {
    content: "";
    position: absolute;
    inset: -8px;
    border-radius: 999px;
    background:
      radial-gradient(circle, color-mix(in srgb, var(--accent) 38%, transparent) 0%, transparent 66%);
    filter: blur(7px);
    opacity: 0.78;
    z-index: -1;
  }
  .brand-mark::after {
    content: "";
    position: absolute;
    inset: 2px;
    border-radius: 7px;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 26%, transparent),
      0 0 18px color-mix(in srgb, var(--accent) 34%, transparent);
    pointer-events: none;
  }
  .brand-mark img {
    display: block;
    width: 22px;
    height: 22px;
    border-radius: 7px;
  }
  .brand-word {
    display: inline-flex;
  }
  .brand:hover {
    color: var(--light-violet-warm);
    text-shadow: 0 0 16px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .brand:hover .brand-mark::before {
    opacity: 1;
  }
  :global(.project-menu) {
    display: none;
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
    :global(.project-menu) {
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
  @media (max-width: 640px) {
    .app-header {
      padding-inline: var(--s-2);
    }
    .brand-word,
    .version {
      display: none;
    }
    .header-center {
      justify-self: start;
      padding-inline: 0;
    }
    .project-title {
      max-width: 100%;
    }
    .sse-status {
      font-size: 0;
      letter-spacing: 0;
      gap: 0;
    }
  }
</style>
