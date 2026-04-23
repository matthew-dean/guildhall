<!--
  Project root view: detail-header (name, run status pill, Start/Stop/New Task),
  optional meta-intake banner, tab strip, and the active tab's body.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Chip from '../lib/Chip.svelte'
  import Tabs from '../lib/Tabs.svelte'
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
  }

  let { initialView = 'work' }: Props = $props()

  let currentView = $state<ProjectView>(initialView)
  let busy = $state(false)
  let intakeOpen = $state(false)

  $effect(() => {
    currentView = initialView
  })

  $effect(() => {
    void project.refresh()
  })

  // Auto-forward to /setup if the project isn't initialized yet. The empty
  // state was a dead end for first-time users landing on /.
  $effect(() => {
    if (project.detail?.initializationNeeded && path.value !== '/setup') {
      nav('/setup')
    }
  })

  // Refresh on supervisor_* events so the run pill tracks reality.
  $effect(() => {
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      if (t.startsWith('supervisor_')) void project.refresh()
    })
    return off
  })

  const TABS = [
    { id: 'work', label: 'Work' },
    { id: 'planner', label: 'Planner' },
    { id: 'coordinators', label: 'Coordinators' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'release', label: 'Release' },
    { id: 'settings', label: 'Settings' },
  ] as const

  function onSelectTab(id: string) {
    currentView = id as ProjectView
    if (id === 'settings') path.replace('/settings')
    else if (id === 'release') path.replace('/release')
    else if (path.value !== '/') path.replace('/')
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
  const coordinators = $derived(detail?.config?.coordinators ?? [])
  const needsMeta = $derived(coordinators.length === 0)
</script>

{#if detail?.initializationNeeded}
  <div class="page">
    <p class="muted">Redirecting to setup…</p>
  </div>
{:else if project.error}
  <div class="page">
    <p class="muted">Error: {project.error}</p>
  </div>
{:else if !detail}
  <div class="page">
    <p class="muted">Loading project…</p>
  </div>
{:else}
  <div class="page">
    <header class="detail-head">
      <h2>{detail.name}</h2>
      <Chip label={runStatus} tone={runTone} />
      <span class="grow"></span>
      <Button
        variant="secondary"
        disabled={busy || needsMeta}
        onclick={newTask}
        ariaLabel={needsMeta ? 'Bootstrap the project first' : 'New task'}
      >
        + New Task
      </Button>
      <Button
        variant="primary"
        disabled={busy || runStatus === 'running' || runStatus === 'stopping'}
        onclick={start}
      >
        ▶ Start
      </Button>
      <Button
        variant="danger"
        disabled={busy || runStatus !== 'running'}
        onclick={stop}
      >
        ■ Stop
      </Button>
    </header>

    {#if needsMeta}
      <MetaIntakeBanner />
    {:else}
      <WorkspaceImportBanner />
    {/if}

    <Tabs tabs={TABS} active={currentView} onselect={onSelectTab} />

    <div class="body">
      {#if currentView === 'work'}
        <WorkTab {detail} />
      {:else if currentView === 'planner'}
        <PlannerTab {detail} />
      {:else if currentView === 'coordinators'}
        <CoordinatorsTab {detail} />
      {:else if currentView === 'timeline'}
        <TimelineTab {detail} />
      {:else if currentView === 'release'}
        <ReleaseTab />
      {:else if currentView === 'settings'}
        <SettingsTab />
      {/if}
    </div>
  </div>

  {#if intakeOpen}
    <IntakeModal coordinators={coordinators} onClose={() => (intakeOpen = false)} />
  {/if}
{/if}

<style>
  .page {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 1400px;
    margin: 0 auto;
  }
  .detail-head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .detail-head h2 {
    font-size: var(--fs-4);
    font-weight: 700;
  }
  .grow {
    flex: 1;
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
</style>
