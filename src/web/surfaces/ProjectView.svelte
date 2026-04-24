<!--
  Project root view. Shell layout:
    · Left rail (220px, collapses to 56px icon-only under 1100px viewport):
      primary nav entries + accordion sub-nav + Providers link pinned
      to the bottom.
    · Top bar (slim): workspace name chip + run-status chip + Start/Stop
      + New Task. No tab strip.
    · Main: the active view component (sub-paths pass a `subView` prop to
      surfaces that support it).
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Chip from '../lib/Chip.svelte'
  import Icon, { type IconName } from '../lib/Icon.svelte'
  import WorkTab from './project/WorkTab.svelte'
  import PlannerTab from './project/PlannerTab.svelte'
  import CoordinatorsTab from './project/CoordinatorsTab.svelte'
  import TimelineTab from './project/TimelineTab.svelte'
  import ReleaseTab from './project/ReleaseTab.svelte'
  import SettingsTab from './project/SettingsTab.svelte'
  import MetaIntakeBanner from './MetaIntakeBanner.svelte'
  import WorkspaceImportBanner from './WorkspaceImportBanner.svelte'
  import IntakeModal from './IntakeModal.svelte'
  import { project } from '../lib/project.svelte.js'
  import { onEvent } from '../lib/events.js'
  import { path, nav } from '../lib/nav.svelte.js'
  import type { ProjectView } from '../lib/types.js'

  interface Props {
    initialView?: ProjectView
    initialSub?: string | null
  }

  let { initialView = 'work', initialSub = null }: Props = $props()

  let currentView = $state<ProjectView>(initialView)
  let currentSub = $state<string | null>(initialSub)
  let busy = $state(false)
  let intakeOpen = $state(false)

  $effect(() => {
    currentView = initialView
  })
  $effect(() => {
    currentSub = initialSub
  })

  $effect(() => {
    void project.refresh()
  })

  // Auto-forward to /setup if the project isn't initialized yet.
  $effect(() => {
    if (project.detail?.initializationNeeded && path.value !== '/setup') {
      nav('/setup')
    }
  })

  $effect(() => {
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      if (t.startsWith('supervisor_')) void project.refresh()
    })
    return off
  })

  interface NavEntry {
    id: ProjectView
    label: string
    icon: IconName
    path: string
    subs?: Array<{ id: string; label: string; path: string }>
  }

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])
  const needsMeta = $derived(coordinators.length === 0)

  const entries = $derived<NavEntry[]>([
    { id: 'work', label: 'Work', icon: 'activity', path: '/' },
    { id: 'planner', label: 'Planner', icon: 'list-checks', path: '/planner' },
    {
      id: 'coordinators',
      label: 'Coordinators',
      icon: 'users',
      path: '/coordinators',
      subs: [
        { id: 'all', label: 'All', path: '/coordinators' },
        ...coordinators.map(c => ({
          id: (c.id ?? c.name ?? '').toString(),
          label: c.name ?? c.id ?? '—',
          path: '/coordinators/' + encodeURIComponent(c.id ?? c.name ?? ''),
        })),
      ],
    },
    { id: 'timeline', label: 'Timeline', icon: 'clock', path: '/timeline' },
    {
      id: 'release',
      label: 'Release',
      icon: 'rocket',
      path: '/release',
      subs: [
        { id: 'verdict', label: 'Verdict', path: '/release' },
        { id: 'criteria', label: 'Criteria', path: '/release/criteria' },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings',
      path: '/settings',
      subs: [
        { id: 'ready', label: 'Ready', path: '/settings' },
        { id: 'coordinators', label: 'Coordinators', path: '/settings/coordinators' },
        { id: 'advanced', label: 'Advanced', path: '/settings/advanced' },
      ],
    },
  ])

  function go(href: string) {
    nav(href)
  }

  async function start() {
    busy = true
    try {
      await fetch('/api/project/start', { method: 'POST' })
      setTimeout(() => void project.refresh(), 300)
    } finally {
      busy = false
    }
  }

  async function stop() {
    busy = true
    try {
      await fetch('/api/project/stop', { method: 'POST' })
      setTimeout(() => void project.refresh(), 300)
    } finally {
      busy = false
    }
  }

  function newTask() {
    intakeOpen = true
  }

  const detail = $derived(project.detail)
  const runStatus = $derived(detail?.run?.status ?? 'stopped')
  const runTone = $derived(
    runStatus === 'running' ? 'ok' : runStatus === 'error' ? 'danger' : 'neutral',
  )
  const providersActive = $derived(path.value === '/providers')
</script>

{#if detail?.initializationNeeded}
  <div class="page-centered">
    <p class="muted">Redirecting to setup…</p>
  </div>
{:else if project.error}
  <div class="page-centered">
    <p class="muted">Error: {project.error}</p>
  </div>
{:else if !detail}
  <div class="page-centered">
    <p class="muted">Loading project…</p>
  </div>
{:else}
  <div class="shell">
    <aside class="rail" aria-label="Project navigation">
      <nav class="rail-nav">
        {#each entries as e (e.id)}
          {@const active = currentView === e.id}
          <button
            type="button"
            class="rail-item"
            class:active
            onclick={() => go(e.path)}
            aria-current={active ? 'page' : undefined}
            title={e.label}
          >
            <span class="rail-stripe"></span>
            <Icon name={e.icon} size={18} />
            <span class="rail-label">{e.label}</span>
          </button>
          {#if active && e.subs}
            <ul class="rail-subs">
              {#each e.subs as s (s.id)}
                {@const subActive = path.value === s.path ||
                  (e.id === 'settings' && currentSub === s.id) ||
                  (e.id === 'release' && currentSub === s.id) ||
                  (e.id === 'coordinators' && currentSub === s.id) ||
                  (e.id === 'release' && !currentSub && s.id === 'verdict') ||
                  (e.id === 'settings' && !currentSub && s.id === 'ready') ||
                  (e.id === 'coordinators' && !currentSub && s.id === 'all')}
                <li>
                  <button
                    type="button"
                    class="rail-sub"
                    class:active={subActive}
                    onclick={() => go(s.path)}
                  >
                    {s.label}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      </nav>
      <div class="rail-bottom">
        <button
          type="button"
          class="rail-item"
          class:active={providersActive}
          onclick={() => go('/providers')}
          title="Providers"
        >
          <span class="rail-stripe"></span>
          <Icon name="plug" size={18} />
          <span class="rail-label">Providers</span>
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <span class="ws-chip" title="Workspace">{detail.name}</span>
        <Chip label={runStatus} tone={runTone} />
        <span class="grow"></span>
        <Button
          variant="secondary"
          disabled={busy || needsMeta}
          onclick={newTask}
          ariaLabel={needsMeta ? 'Bootstrap the project first' : 'New task'}
        >
          <span class="btn-inner"><Icon name="plus" size={16} /> New Task</span>
        </Button>
        <Button
          variant="primary"
          disabled={busy || runStatus === 'running' || runStatus === 'stopping'}
          onclick={start}
        >
          <span class="btn-inner"><Icon name="play" size={16} /> Start</span>
        </Button>
        <Button
          variant="danger"
          disabled={busy || runStatus !== 'running'}
          onclick={stop}
        >
          <span class="btn-inner"><Icon name="square" size={16} /> Stop</span>
        </Button>
      </header>

      <div class="page">
        {#if needsMeta}
          <MetaIntakeBanner />
        {:else}
          <WorkspaceImportBanner />
        {/if}

        <div class="body">
          {#if currentView === 'work'}
            <WorkTab {detail} />
          {:else if currentView === 'planner'}
            <PlannerTab {detail} />
          {:else if currentView === 'coordinators'}
            <CoordinatorsTab {detail} subView={currentSub} />
          {:else if currentView === 'timeline'}
            <TimelineTab {detail} />
          {:else if currentView === 'release'}
            <ReleaseTab subView={currentSub} />
          {:else if currentView === 'settings'}
            <SettingsTab subView={currentSub} />
          {/if}
        </div>
      </div>
    </div>
  </div>

  {#if intakeOpen}
    <IntakeModal coordinators={coordinators} onClose={() => (intakeOpen = false)} />
  {/if}
{/if}

<style>
  .shell {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: calc(100vh - 44px);
    background: var(--bg-base);
  }
  .rail {
    border-right: 1px solid var(--border);
    background: var(--bg-raised);
    display: flex;
    flex-direction: column;
    padding: var(--s-3) 0;
    gap: var(--s-2);
    min-width: 0;
  }
  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .rail-bottom {
    border-top: 1px solid var(--border);
    padding-top: var(--s-2);
  }
  .rail-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-2);
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    text-align: left;
    border-radius: 0;
    line-height: var(--lh-tight);
  }
  .rail-item:hover {
    color: var(--text);
    background: var(--bg-raised-2);
  }
  .rail-item.active {
    color: var(--text);
    background: var(--bg-elevated);
  }
  .rail-stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: transparent;
  }
  .rail-item.active .rail-stripe {
    background: var(--stripe-accent);
  }
  .rail-subs {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--s-2) 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .rail-sub {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-1);
    padding: var(--s-1) var(--s-3) var(--s-1) calc(var(--s-3) + 24px);
    cursor: pointer;
    border-radius: 0;
  }
  .rail-sub:hover { color: var(--text); }
  .rail-sub.active {
    color: var(--text);
    font-weight: 700;
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
  }
  .ws-chip {
    font-size: var(--fs-1);
    color: var(--text);
    padding: 2px var(--s-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    background: var(--bg-elevated);
  }
  .grow { flex: 1; }
  .btn-inner {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .page {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }
  .page-centered {
    padding: var(--s-4);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  @media (max-width: 1100px) {
    .shell { grid-template-columns: 56px 1fr; }
    .rail-label { display: none; }
    .rail-subs { display: none; }
    .rail-item { justify-content: center; padding: var(--s-2); }
  }
</style>
