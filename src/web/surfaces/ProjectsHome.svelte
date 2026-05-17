<script lang="ts">
  import { onEvent } from '../lib/events.js'
  import { nav } from '../lib/nav.svelte.js'
  import { FolderPlus } from 'lucide-svelte'
  import Button from '../lib/Button.svelte'
  import ProjectsShell from '../lib/layout/ProjectsShell.svelte'
  import ProjectCard from '../lib/ProjectCard.svelte'
  import { summarizeProjects } from '../lib/project-summary.js'
  import { projectHref } from '../lib/project-routes.js'
  import type { ServiceDetail } from '../lib/types.js'

  let service = $state<ServiceDetail | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let busyId = $state<string | null>(null)
  let refreshHandle: ReturnType<typeof setInterval> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshInFlight = false
  let refreshQueued = false
  let lastRefreshAt = 0

  const SERVICE_REFRESH_MIN_INTERVAL_MS = 1500
  const SERVICE_REFRESH_POLL_MS = 15000

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

  async function refresh(background = false): Promise<void> {
    if (refreshInFlight) {
      refreshQueued = true
      return
    }
    refreshInFlight = true
    if (!background || service == null) loading = true
    try {
      const response = await fetch('/api/service', { cache: 'no-store' })
      const payload = (await response.json()) as ServiceDetail
      service = payload
      error = null
      lastRefreshAt = Date.now()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      refreshInFlight = false
      loading = false
      if (refreshQueued) {
        refreshQueued = false
        void refresh(true)
      }
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) return
    const delay = Math.max(0, SERVICE_REFRESH_MIN_INTERVAL_MS - (Date.now() - lastRefreshAt))
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh(true)
    }, delay)
  }

  async function openProject(projectId: string): Promise<void> {
    busyId = projectId
    try {
      nav(projectHref(projectId, '/thread'))
    } finally {
      busyId = null
    }
  }

  async function startProject(projectId: string): Promise<void> {
    busyId = projectId
    try {
      const response = await fetch(`/api/project/start?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? `Unable to start project (${response.status})`)
      }
      await refresh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busyId = null
    }
  }

  async function stopProject(projectId: string): Promise<void> {
    busyId = projectId
    try {
      const response = await fetch(`/api/project/stop?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? `Unable to stop project (${response.status})`)
      }
      await refresh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busyId = null
    }
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
      if (typeof payload?.selectedProject?.id === 'string') nav(projectHref(payload.selectedProject.id, '/thread'))
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busyId = null
    }
  }

  $effect(() => {
    void refresh()
  })

  $effect(() => {
    if (refreshHandle) clearInterval(refreshHandle)
    refreshHandle = setInterval(() => {
      void refresh(true)
    }, SERVICE_REFRESH_POLL_MS)
    return () => {
      if (refreshHandle) clearInterval(refreshHandle)
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

  const cards = $derived(summarizeProjects(service))
</script>

<ProjectsShell shellClass="projects-home">
  {#snippet hero()}
  <header class="hero">
    <div>
      <p class="eyebrow">Projects</p>
      <h1>Your local Guildhall service</h1>
      <p class="lede">Open a project, keep a few running, and see which ones need you without dropping into each shell first.</p>
    </div>
    <div class="hero-actions">
      <Button variant="secondary" disabled={busyId === '__attach__'} onclick={attachProject}>
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
      <p>Register or attach a project to start using Guildhall as a local service over your work.</p>
    </div>
  {:else}
    <div class="grid">
      {#each cards as card (card.id)}
        <ProjectCard
          summary={card}
          busy={busyId === card.id}
          onOpen={openProject}
          onStart={startProject}
          onStop={stopProject}
        />
      {/each}
    </div>
  {/if}
</ProjectsShell>

<style>
  .hero {
    display: flex;
    justify-content: space-between;
    gap: var(--s-4);
    align-items: end;
  }
  .hero-actions {
    flex: 0 0 auto;
  }
  .eyebrow {
    margin: 0 0 var(--s-2);
    color: var(--text-muted);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  h1 {
    margin: 0;
    font-size: clamp(1.65rem, 3vw, 2.2rem);
    line-height: 1.05;
  }
  .lede {
    margin: var(--s-2) 0 0;
    max-width: 44rem;
    color: var(--text-muted);
    font-size: var(--fs-2);
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: var(--s-4);
    align-items: stretch;
  }
  @media (max-width: 720px) {
    .hero {
      align-items: start;
      flex-direction: column;
    }
    .hero-actions,
    .hero-actions :global(button) {
      width: 100%;
    }
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
