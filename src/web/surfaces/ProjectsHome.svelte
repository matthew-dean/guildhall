<script lang="ts">
  import { onEvent } from '../lib/events.js'
  import { nav } from '../lib/nav.svelte.js'
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert'
  import Cpu from 'lucide-svelte/icons/cpu'
  import FolderPlus from 'lucide-svelte/icons/folder-plus'
  import Inbox from 'lucide-svelte/icons/inbox'
  import Button from '../lib/Button.svelte'
  import ProjectsShell from '../lib/layout/ProjectsShell.svelte'
  import ProjectCard from '../lib/ProjectCard.svelte'
  import { createProjectSummaryCache, mergeServiceProjectSummaries } from '../lib/project-summary.js'
  import { projectHref } from '../lib/project-routes.js'
  import { getCachedService, setCachedService } from '../lib/service-cache.js'
  import type { ServiceDetail } from '../lib/types.js'

  let service = $state<ServiceDetail | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let busyId = $state<string | null>(null)
  let refreshHandle: ReturnType<typeof setTimeout> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshInFlight = false
  let refreshQueued = false
  let lastRefreshAt = 0

  const SERVICE_REFRESH_MIN_INTERVAL_MS = 1500
  const SERVICE_REFRESH_POLL_MS = 30000
  const projectSummaryCache = createProjectSummaryCache()

  function isMeaningfulProjectListEvent(type: string): boolean {
    return (
      type === 'task_transition' ||
      type === 'escalation_raised' ||
      type === 'agent_issue' ||
      type === 'error' ||
      type === 'provider_health_changed' ||
      type.startsWith('supervisor_')
    )
  }

  function requestErrorMessage(err: unknown): string {
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      return 'The local service did not answer that request. It may have restarted; this will clear on the next successful refresh.'
    }
    return err instanceof Error ? err.message : String(err)
  }

  function pageIsHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  function updateService(incoming: ServiceDetail): void {
    const merged = mergeServiceProjectSummaries(service, incoming)
    if (merged !== service) {
      service = merged
      setCachedService(merged)
    }
  }

  async function refresh(background = false): Promise<void> {
    if (background && pageIsHidden()) return
    if (refreshInFlight) {
      refreshQueued = true
      return
    }
    refreshInFlight = true
    if (!background || service == null) loading = true
    try {
      const response = await fetch('/api/service/projects', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Project list request failed (${response.status})`)
      updateService(await response.json() as ServiceDetail)
      error = null
      lastRefreshAt = Date.now()
    } catch (err) {
      error = requestErrorMessage(err)
    } finally {
      refreshInFlight = false
      loading = false
      if (refreshQueued) {
        refreshQueued = false
        void refresh(true)
      }
    }
  }

  async function initialLoad(): Promise<void> {
    const cached = getCachedService()
    if (cached) {
      service = cached
      loading = false
      void refresh(true)
      return
    }
    await refresh()
  }

  function scheduleRefresh(): void {
    if (refreshTimer) return
    const delay = Math.max(0, SERVICE_REFRESH_MIN_INTERVAL_MS - (Date.now() - lastRefreshAt))
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh(true)
    }, delay)
  }

  function openProject(projectId: string, href?: string | null): void {
    nav(href ?? projectHref(projectId, '/overview'))
  }

  async function attachProject(): Promise<void> {
    busyId = '__attach__'
    try {
      const response = await fetch('/api/service/attach-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? `Unable to attach project (${response.status})`)
      }
      if (payload?.cancelled) return
      await refresh()
      if (typeof payload?.project?.id === 'string') nav(projectHref(payload.project.id, '/overview'))
    } catch (err) {
      error = requestErrorMessage(err)
    } finally {
      busyId = null
    }
  }

  $effect(() => {
    void initialLoad()
  })

  $effect(() => {
    function poll() {
      void refresh(true)
      refreshHandle = setTimeout(poll, SERVICE_REFRESH_POLL_MS)
    }
    if (refreshHandle) clearTimeout(refreshHandle)
    refreshHandle = setTimeout(poll, SERVICE_REFRESH_POLL_MS)
    return () => {
      if (refreshHandle) clearTimeout(refreshHandle)
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
    }
  })

  $effect(() => {
    const off = onEvent((ev) => {
      const type = ev.event?.type ?? ev.type ?? ''
      if (!isMeaningfulProjectListEvent(type)) return
      scheduleRefresh()
    })
    return off
  })

  $effect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      if (!pageIsHidden()) scheduleRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  const cards = $derived(projectSummaryCache.summarize(service))
  // The service returns this from the same bounded projection as /needs-you.
  // Card-local status remains presentation only; it must not re-count urgency.
  const needsYouCount = $derived(service?.fleetAttention?.projectCount ?? cards.filter(card => card.needsAttention).length)
  const defaultProviderStatus = $derived(service?.defaultProviderStatus ?? null)
  const defaultProviderWarning = $derived(defaultProviderStatus?.warnings?.[0] ?? null)
  const defaultProviderLabel = $derived(defaultProviderStatus?.preferredProviderLabel ?? defaultProviderStatus?.activeProviderLabel ?? 'Providers')
  const defaultWorkerModel = $derived(compactModelLabel(defaultProviderStatus?.activeModel ?? defaultProviderStatus?.models?.worker))
  const defaultProviderTitle = $derived(
    defaultProviderWarning?.message ??
      'Open model settings.',
  )
  const showingPartialProjectStatus = $derived(cards.some(card => card.statusLoading))

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function compactModelLabel(model: string | null | undefined): string {
    if (!model) return ''
    const trimmed = model.trim()
    if (!trimmed) return ''
    const slash = trimmed.lastIndexOf('/')
    return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  }

  function openNeedsYou(): void {
    nav('/needs-you')
  }

</script>

<ProjectsShell shellClass="projects-home">
  {#snippet hero()}
  <header class="hero">
    <div>
      <h1>Projects &amp; Workspaces</h1>
      <p class="lede">Choose a project to see its current work and next decision.</p>
    </div>
    <div class="hero-actions">
      {#if defaultProviderStatus}
        <Button
          variant="secondary"
          className={`default-model-button ${defaultProviderWarning ? 'default-model-button-warn' : ''}`}
          title={defaultProviderTitle}
          ariaLabel="Open model settings"
          onclick={() => nav('/providers')}
        >
          {#if defaultProviderWarning}
            <AlertTriangle size={15} />
          {:else}
            <Cpu size={15} />
          {/if}
          <span class="default-model-copy">
            <span class="default-model-prefix">Models</span>
          </span>
        </Button>
      {/if}
      <Button
        variant={needsYouCount > 0 ? 'human' : 'secondary'}
        disabled={needsYouCount === 0}
        title={needsYouCount > 0
          ? `${countLabel(needsYouCount, 'project')} need you. Opens the grouped fleet inbox.`
          : 'No project needs your attention right now'}
        onclick={openNeedsYou}
      >
        <Inbox size={15} />
        Needs you
        {#if needsYouCount > 0}
          <span class="action-count"><span class="count-glyph">{needsYouCount > 99 ? '99+' : `${needsYouCount} project${needsYouCount === 1 ? '' : 's'}`}</span></span>
        {/if}
      </Button>
      <Button variant="secondary" disabled={busyId === '__attach__'} title="Attach another local project" onclick={attachProject}>
        <FolderPlus size={15} />
        {busyId === '__attach__' ? 'Attaching...' : 'Attach project'}
      </Button>
    </div>
  </header>
  {/snippet}

  {#snippet notices()}
  {#if error}
    <div class="notice warn">{error}</div>
  {/if}
  {/snippet}

  {#if loading && cards.length === 0}
    <div class="empty">Loading projects...</div>
  {:else if cards.length === 0}
    <div class="empty">
      <h2>No projects yet</h2>
      <p>Register or attach a project to start using the local service over your work.</p>
    </div>
  {:else}
    {#if showingPartialProjectStatus}
      <p class="loading-inline" role="status">Loading project status...</p>
    {/if}
    <div class="projects-area">
      <div class="grid">
        {#each cards as card (card.id)}
          <ProjectCard
            summary={card}
            onOpen={openProject}
          />
        {/each}
      </div>
    </div>
  {/if}

</ProjectsShell>

<style>
  .hero {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
    align-items: center;
  }
  .hero-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .hero-actions :global(.btn) {
    box-sizing: border-box;
    height: 34px;
    min-height: 34px;
    align-items: center;
  }
  .hero-actions :global(.default-model-button) {
    gap: var(--s-1);
    min-width: 0;
    max-width: min(22rem, 100%);
    padding-inline: var(--s-2);
  }
  .hero-actions :global(.default-model-button-warn) {
    border-color: color-mix(in srgb, var(--warn) 52%, var(--button-secondary-border));
    color: color-mix(in srgb, var(--warn) 72%, var(--text));
    box-shadow:
      0 0 12px color-mix(in srgb, var(--warn) 14%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 9%, transparent);
  }
  .default-model-copy {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    overflow: hidden;
  }
  .default-model-prefix {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
    font-size: var(--gh-type-size-meta);
  }
  .action-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.15rem;
    min-height: 1.15rem;
    padding: 0.08rem 0.42rem;
    box-sizing: border-box;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-base) 24%, transparent);
    color: currentColor;
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    font-variant-numeric: tabular-nums;
    line-height: var(--gh-type-line-height-control);
  }
  .count-glyph {
    display: block;
    line-height: var(--gh-type-line-height-control);
    transform: translateY(0.06em);
  }
  h1 {
    margin: 0;
    font-size: var(--gh-type-size-page-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .lede {
    margin: var(--s-1) 0 0;
    max-width: 44rem;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .notice {
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3) var(--s-4);
    background: var(--bg-elevated);
  }
  .notice.warn {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
  }
  :global(.projects-shell.projects-home .projects-shell-body) {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    background:
      linear-gradient(90deg, transparent 0 9%, color-mix(in srgb, var(--accent) 10%, transparent) 9% 9.12%, transparent 9.12% 58%, color-mix(in srgb, var(--accent-2) 7%, transparent) 58% 58.1%, transparent 58.1%),
      repeating-linear-gradient(0deg, color-mix(in srgb, white 3%, transparent) 0 1px, transparent 1px 38px);
  }
  .empty {
    border: 1px dashed var(--border);
    border-radius: var(--r-3);
    padding: var(--s-6);
    color: var(--text-muted);
    background: var(--bg-elevated);
  }
  .empty h2 {
    margin-top: 0;
    color: var(--text);
  }
  .loading-inline {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .projects-area {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-2);
    align-items: start;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
    gap: var(--s-2);
    align-items: stretch;
  }
  .grid :global(section.project-card) {
    width: 100%;
  }
  @media (max-width: 720px) {
    .hero {
      align-items: start;
      flex-direction: column;
    }
    .hero-actions,
    .hero-actions :global(button) {
      width: 100%;
      justify-content: center;
    }
    .projects-area {
      grid-template-columns: 1fr;
    }
  }
</style>
