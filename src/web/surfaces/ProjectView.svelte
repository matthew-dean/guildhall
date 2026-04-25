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
  import Tooltip from '../lib/Tooltip.svelte'
  import ThreadTab from './project/ThreadTab.svelte'
  import InboxTab from './project/InboxTab.svelte'
  import WorkTab from './project/WorkTab.svelte'
  import WorkspaceImportTab from './project/WorkspaceImportTab.svelte'
  import PlannerTab from './project/PlannerTab.svelte'
  import FactsTab from './project/FactsTab.svelte'
  import CoordinatorsTab from './project/CoordinatorsTab.svelte'
  import TimelineTab from './project/TimelineTab.svelte'
  import ReleaseTab from './project/ReleaseTab.svelte'
  import SettingsTab from './project/SettingsTab.svelte'
  import DoThisNext from './DoThisNext.svelte'
  import IntakeModal from './IntakeModal.svelte'
  import { project } from '../lib/project.svelte.js'
  import { onEvent } from '../lib/events.js'
  import { path, nav } from '../lib/nav.svelte.js'
  import type { ProjectView } from '../lib/types.js'

  interface Props {
    initialView?: ProjectView
    initialSub?: string | null
  }

  let { initialView = 'thread', initialSub = null }: Props = $props()

  let currentView = $state<ProjectView>(initialView)
  let currentSub = $state<string | null>(initialSub)
  let busy = $state(false)
  let runError = $state<string | null>(null)
  let intakeOpen = $state(false)

  // Inbox blockers drive disabled-state on top-bar actions so hard blockers
  // (e.g. bootstrap not verified) can't be bypassed by pressing Start.
  interface Blockers { bootstrap: boolean; workspaceImport: boolean }
  let blockers = $state<Blockers>({ bootstrap: false, workspaceImport: false })
  let inboxHighCount = $state(0)

  async function loadInbox(): Promise<void> {
    try {
      const r = await fetch('/api/project/inbox')
      if (!r.ok) return
      const j = (await r.json()) as {
        items?: Array<{ severity?: string }>
        blockers?: Blockers
      }
      if (j.blockers) blockers = j.blockers
      inboxHighCount = (j.items ?? []).filter(i => i.severity === 'high').length
    } catch {
      /* leave prior values intact */
    }
  }

  $effect(() => {
    void loadInbox()
  })
  $effect(() => {
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      // Refresh on anything that might change inbox state.
      if (
        t.startsWith('task_') ||
        t.startsWith('escalation_') ||
        t.startsWith('bootstrap_') ||
        t.startsWith('supervisor_')
      ) {
        void loadInbox()
      }
    })
    return off
  })

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
    { id: 'thread', label: 'Thread', icon: 'sparkles', path: '/thread' },
    { id: 'inbox', label: 'Notifications', icon: 'inbox', path: '/notifications' },
    { id: 'work', label: 'Work', icon: 'activity', path: '/work' },
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
        { id: 'providers', label: 'Providers', path: '/settings/providers' },
        { id: 'facts', label: 'Facts', path: '/settings/facts' },
        { id: 'advanced', label: 'Advanced', path: '/settings/advanced' },
      ],
    },
  ])

  function go(href: string) {
    nav(href)
  }

  async function start() {
    busy = true
    runError = null
    try {
      const res = await fetch('/api/project/start', { method: 'POST' })
      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: string; code?: string }
          runError = body.error ?? `Start failed (HTTP ${res.status})`
        } catch {
          runError = `Start failed (HTTP ${res.status})`
        }
        return
      }
      setTimeout(() => void project.refresh(), 300)
      setTimeout(() => {
        void project.refresh()
        void loadInbox()
      }, 1500)
      setTimeout(() => {
        void project.refresh()
        void loadInbox()
      }, 3200)
    } finally {
      busy = false
    }
  }

  async function stop() {
    busy = true
    runError = null
    try {
      const res = await fetch('/api/project/stop', { method: 'POST' })
      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: string }
          runError = body.error ?? `Stop failed (HTTP ${res.status})`
        } catch {
          runError = `Stop failed (HTTP ${res.status})`
        }
        return
      }
      setTimeout(() => void project.refresh(), 300)
    } finally {
      busy = false
    }
  }

  function newTask() {
    intakeOpen = true
  }

  function bootstrapOutputLine(output: string): string | null {
    const lines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line =>
        line.length > 0 &&
        !line.startsWith('>') &&
        !line.startsWith('Scope:') &&
        !line.startsWith(' ERR_PNPM_') &&
        !line.startsWith(' ELIFECYCLE'),
      )
    return lines.find(line => /\berror\b|failed|Cannot find module|command not found|spawn ENOENT/i.test(line)) ?? lines[0] ?? null
  }

  const detail = $derived(project.detail)
  const runStatus = $derived(detail?.run?.status ?? 'stopped')
  const failedBootstrapStep = $derived(
    detail?.bootstrapStatus?.success === false
      ? detail.bootstrapStatus.steps?.find(s => s.result === 'fail') ?? null
      : null,
  )
  const bootstrapFailureText = $derived.by(() => {
    const step = failedBootstrapStep
    if (!step) return null
    const command = step.command ?? 'Bootstrap'
    const exit = typeof step.exitCode === 'number' ? ` exited ${step.exitCode}` : ' failed'
    const usefulLine = bootstrapOutputLine(step.output ?? '')
    return usefulLine ? `${command}${exit}: ${usefulLine}` : `${command}${exit}.`
  })

  // Project phase surfaced in the top-bar chip. Distinguishes "setup isn't
  // done yet" (hard blockers open, or no coordinator) from "operating — just
  // not currently running". Gives the user a clear mental model of what the
  // controls actually do right now.
  type Phase = 'setting-up' | 'paused' | 'running' | 'error'
  const phase = $derived<Phase>(
    runStatus === 'error'
      ? 'error'
      : runStatus === 'running'
        ? 'running'
        : needsMeta || blockers.bootstrap
          ? 'setting-up'
          : 'paused',
  )
  const phaseLabel = $derived(
    phase === 'setting-up'
      ? 'Setting up'
      : phase === 'running'
        ? 'Running'
        : phase === 'error'
          ? 'Error'
          : 'Paused',
  )
  const phaseTone = $derived(
    phase === 'running'
      ? 'ok'
      : phase === 'error'
        ? 'danger'
        : phase === 'setting-up'
          ? 'warn'
          : 'neutral',
  )
  const providersActive = $derived(path.value === '/providers')

  // Task counts for the top-bar indicator. Stuck = has at least one open
  // escalation. Active = running/in-progress-like statuses.
  const taskList = $derived(detail?.tasks ?? [])
  const metaIntakePending = $derived(
    taskList.some(t => {
      const id = (t as { id?: string }).id
      const status = (t as { status?: string }).status
      return id === 'task-meta-intake' && status !== 'done' && status !== 'shelved'
    }),
  )
  const activeCount = $derived(
    taskList.filter(t => {
      const s = (t as { status?: string }).status
      return s && !['done', 'blocked', 'cancelled', 'archived'].includes(s)
    }).length,
  )
  const stuckCount = $derived(
    taskList.filter(t => {
      const escs = (t as { escalations?: Array<{ resolvedAt?: unknown }> }).escalations
      return Array.isArray(escs) && escs.some(e => !e.resolvedAt)
    }).length,
  )

  const startDisabledReason = $derived(
    blockers.bootstrap && !metaIntakePending
      ? failedBootstrapStep
        ? 'Fix the bootstrap failure before starting'
        : 'Complete bootstrap in Thread before starting'
      : null,
  )
  const newTaskDisabledReason = $derived(
    needsMeta
      ? 'Bootstrap the project first'
      : blockers.bootstrap
        ? 'Complete bootstrap in Thread before adding tasks'
        : null,
  )
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
      <div class="rail-head" title={detail.name}>
        <div class="rail-project">{detail.name}</div>
        <div class="rail-status">
          <Chip label={phaseLabel} tone={phaseTone} />
        </div>
      </div>
      <nav class="rail-nav">
        {#each entries as e (e.id)}
          {@const active = currentView === e.id}
          <Tooltip text={e.label} placement="right" className="rail-tooltip">
            <button
              type="button"
              class="rail-item"
              class:active
              onclick={() => go(e.path)}
              aria-current={active ? 'page' : undefined}
            >
              <span class="rail-stripe"></span>
              <Icon name={e.icon} size={18} />
              <span class="rail-label">{e.label}</span>
            </button>
          </Tooltip>
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
        <Tooltip text="Providers" placement="right" className="rail-tooltip">
          <button
            type="button"
            class="rail-item"
            class:active={providersActive}
            onclick={() => go('/providers')}
          >
            <span class="rail-stripe"></span>
            <Icon name="plug" size={18} />
            <span class="rail-label">Providers</span>
          </button>
        </Tooltip>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        {#if activeCount > 0 || stuckCount > 0}
          <button
            type="button"
            class="tasks-indicator"
            class:has-stuck={stuckCount > 0}
            onclick={() => go('/work')}
            title="Jump to Work"
            aria-label="{activeCount} active, {stuckCount} stuck"
          >
            <span class="tasks-count">{activeCount} active</span>
            {#if stuckCount > 0}
              <span class="tasks-stuck">· {stuckCount} stuck</span>
            {/if}
          </button>
        {/if}
        {#if inboxHighCount > 0}
          <button
            type="button"
            class="inbox-indicator"
            onclick={() => go('/notifications')}
            title="Jump to Notifications"
            aria-label="{inboxHighCount} notifications need you"
          >
            <Icon name="inbox" size={14} />
            <span>{inboxHighCount}</span>
          </button>
        {/if}
        <span class="grow"></span>
        <Button
          variant="secondary"
          disabled={busy || newTaskDisabledReason !== null}
          onclick={newTask}
          ariaLabel={newTaskDisabledReason ?? 'New task'}
        >
          <span class="btn-inner" title={newTaskDisabledReason ?? ''}>
            <Icon name="plus" size={16} /> New Task
          </span>
        </Button>
        <Button
          variant="primary"
          disabled={busy || runStatus === 'running' || runStatus === 'stopping' || startDisabledReason !== null}
          onclick={start}
          ariaLabel={startDisabledReason ?? 'Start orchestrator'}
        >
          <span class="btn-inner" title={startDisabledReason ?? ''}>
            <Icon name="play" size={16} /> Start
          </span>
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
        {#if runError}
          <div class="start-error" role="alert">
            <Icon name="alert-triangle" size={14} />
            <span>{runError}</span>
            {#if /provider/i.test(runError)}
              <a href="/providers" onclick={(e) => { e.preventDefault(); nav('/providers') }}>Open Providers</a>
            {/if}
            <button class="dismiss" onclick={() => (runError = null)} aria-label="Dismiss">×</button>
          </div>
        {/if}
        {#if bootstrapFailureText}
          <div class="start-error" role="alert">
            <Icon name="alert-triangle" size={14} />
            <span>{bootstrapFailureText}</span>
            <a href="/settings/ready" onclick={(e) => { e.preventDefault(); nav('/settings/ready') }}>Open Ready</a>
          </div>
        {/if}
        {#if currentView !== 'thread' && currentView !== 'inbox'}
          <DoThisNext />
        {/if}

        <div class="body">
          {#if currentView === 'thread'}
            <ThreadTab />
          {:else if currentView === 'inbox'}
            <InboxTab />
          {:else if currentView === 'workspace-import'}
            <WorkspaceImportTab />
          {:else if currentView === 'work'}
            <WorkTab {detail} />
          {:else if currentView === 'planner'}
            <PlannerTab {detail} />
          {:else if currentView === 'facts'}
            <FactsTab />
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
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
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
  :global(.rail-tooltip) {
    display: block;
    width: 100%;
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
  .rail-head {
    padding: var(--s-3) var(--s-3) var(--s-4) var(--s-3);
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .rail-project {
    font-size: var(--fs-2);
    font-weight: 700;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rail-status {
    display: flex;
  }
  .grow { flex: 1; }
  .tasks-indicator,
  .inbox-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    color: var(--text-muted);
    font-size: var(--fs-1);
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }
  .tasks-indicator:hover,
  .inbox-indicator:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--bg-raised-2);
  }
  .tasks-indicator.has-stuck {
    color: var(--warn);
    border-color: var(--warn);
  }
  .tasks-stuck { font-weight: 600; }
  .inbox-indicator {
    color: var(--danger);
    border-color: var(--danger);
    font-weight: 600;
  }
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
  .start-error {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--color-danger, #c0392b);
    background: var(--color-danger-bg, #fdecea);
    color: var(--color-danger-fg, #8a1f1a);
    border-radius: var(--radius-md, 6px);
    font-size: 13px;
  }
  .start-error a {
    color: inherit;
    text-decoration: underline;
    margin-left: auto;
  }
  .start-error .dismiss {
    background: none;
    border: none;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
    padding: 0 var(--s-1);
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
    .rail-project { display: none; }
    .rail-head { padding: var(--s-2); align-items: center; }
  }
</style>
