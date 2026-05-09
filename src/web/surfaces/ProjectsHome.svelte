<script lang="ts">
  import { onEvent } from '../lib/events.js'
  import { nav } from '../lib/nav.svelte.js'
  import ProjectCard from '../lib/ProjectCard.svelte'
  import { summarizeProjects } from '../lib/project-summary.js'
  import type { ServiceDetail } from '../lib/types.js'

  let service = $state<ServiceDetail | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let busyId = $state<string | null>(null)
  let refreshHandle: ReturnType<typeof setInterval> | null = null

  async function refresh(): Promise<void> {
    loading = true
    try {
      const response = await fetch('/api/service', { cache: 'no-store' })
      const payload = (await response.json()) as ServiceDetail
      service = payload
      error = null
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function selectProject(projectId: string): Promise<void> {
    const response = await fetch('/api/service/select-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error ?? `Unable to select project (${response.status})`)
    }
    await refresh()
  }

  async function openProject(projectId: string): Promise<void> {
    busyId = projectId
    try {
      await selectProject(projectId)
      nav('/project')
    } finally {
      busyId = null
    }
  }

  async function startProject(projectId: string): Promise<void> {
    busyId = projectId
    try {
      await selectProject(projectId)
      const response = await fetch('/api/project/start', { method: 'POST' })
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
      await selectProject(projectId)
      const response = await fetch('/api/project/stop', { method: 'POST' })
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
      nav('/project')
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
      void refresh()
    }, 5000)
    return () => {
      if (refreshHandle) clearInterval(refreshHandle)
    }
  })

  $effect(() => {
    const off = onEvent(() => { void refresh() })
    return off
  })

  const cards = $derived(summarizeProjects(service))
</script>

<section class="projects-home">
  <header class="hero">
    <div>
      <p class="eyebrow">Projects</p>
      <h1>Your local Guildhall service</h1>
      <p class="lede">Open a project, keep a few running, and see which ones need you without dropping into each shell first.</p>
    </div>
    <div class="hero-actions">
      <button
        type="button"
        class="attach-btn"
        disabled={busyId === '__attach__'}
        onclick={attachProject}
      >
        {busyId === '__attach__' ? 'Attaching…' : 'Attach project'}
      </button>
    </div>
  </header>

  {#if error}
    <div class="notice warn">{error}</div>
  {/if}

  {#if loading && cards.length === 0}
    <div class="empty">Loading projects…</div>
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
</section>

<style>
  .projects-home {
    padding: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
  }
  .hero {
    display: flex;
    justify-content: space-between;
    gap: var(--s-4);
    align-items: end;
  }
  .hero-actions {
    flex: 0 0 auto;
  }
  .attach-btn {
    border: 1px solid var(--border);
    background: var(--accent-9);
    color: white;
    border-radius: var(--r-2);
    padding: 0.75rem 1rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-width: 10rem;
  }
  .attach-btn:disabled {
    cursor: wait;
    opacity: 0.8;
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
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    line-height: 1.05;
  }
  .lede {
    margin: var(--s-3) 0 0;
    max-width: 56rem;
    color: var(--text-muted);
    font-size: var(--fs-3);
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
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--s-4);
  }
  @media (max-width: 720px) {
    .hero {
      align-items: start;
      flex-direction: column;
    }
    .hero-actions,
    .attach-btn {
      width: 100%;
    }
  }
</style>
