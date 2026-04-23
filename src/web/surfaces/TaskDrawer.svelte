<!--
  Task drawer shell. Loads /api/project/task/:id, exposes the four-tab UI,
  and hosts every action (approve/pause/shelve/unshelve/resolve/follow-up).
  Child components handle rendering; this file owns state and HTTP.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Tabs from '../lib/Tabs.svelte'
  import SpecTab from './drawer/SpecTab.svelte'
  import TranscriptTab from './drawer/TranscriptTab.svelte'
  import HistoryTab from './drawer/HistoryTab.svelte'
  import ExpertsTab from './drawer/ExpertsTab.svelte'
  import ProvenanceTab from './drawer/ProvenanceTab.svelte'
  import type { DrawerPayload, DrawerTab, Escalation } from '../lib/types.js'

  interface Props {
    taskId: string
    onClose: () => void
  }

  let { taskId, onClose }: Props = $props()

  let payload = $state<DrawerPayload | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)
  let activeTab = $state<DrawerTab>('spec')

  const TABS = [
    { id: 'spec', label: 'Spec' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'experts', label: 'Experts' },
    { id: 'history', label: 'History' },
    { id: 'provenance', label: 'Provenance' },
  ] as const

  async function load() {
    try {
      const res = await fetch(`/api/project/task/${encodeURIComponent(taskId)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        error = body.error ?? `HTTP ${res.status}`
        return
      }
      payload = (await res.json()) as DrawerPayload
      error = null
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function post(
    action: string,
    body?: Record<string, unknown>,
  ): Promise<boolean> {
    busy = true
    try {
      const res = await fetch(
        `/api/project/task/${encodeURIComponent(taskId)}/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      )
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        error = b.error ?? `HTTP ${res.status}`
        return false
      }
      await load()
      return true
    } finally {
      busy = false
    }
  }

  async function handleApproveSpec() {
    const note = window.prompt(
      'Optional approval note for the coordinator (leave blank to just approve):',
    )
    const body = note && note.trim() ? { approvalNote: note.trim() } : undefined
    await post('approve-spec', body)
  }

  async function handleResolveEscalation(escalation: Escalation) {
    const resolution = window.prompt(
      'How should the agent resolve this escalation? (This note is fed back into the coordinator.)',
    )
    if (!resolution || !resolution.trim()) return
    const nextStatus = window.prompt(
      'Next status after resolving (ready | in_progress | exploring | spec_review | review | gate_check)',
      'ready',
    )
    if (!nextStatus) return
    await post('resolve-escalation', {
      escalationId: escalation.id,
      resolution: resolution.trim(),
      nextStatus: nextStatus.trim(),
    })
  }

  async function handleSendFollowUp(message: string) {
    await post('resume', { message })
  }

  function confirmed(action: string): boolean {
    return window.confirm(`${action} task ${taskId}?`)
  }

  $effect(() => {
    void load()
  })
</script>

<div
  class="gh-drawer-backdrop"
  role="button"
  tabindex="0"
  aria-label="Close drawer"
  onclick={onClose}
  onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onClose()}
></div>

<aside class="gh-drawer" aria-label="Task drawer">
  <header class="gh-drawer-head">
    <h3>{payload?.task.title ?? taskId}</h3>
    <Button variant="ghost" size="sm" ariaLabel="Close" onclick={onClose}>
      ✕
    </Button>
  </header>

  {#if payload}
    <div class="gh-drawer-tabs">
      <Tabs
        tabs={TABS}
        active={activeTab}
        onselect={(id) => (activeTab = id as DrawerTab)}
      />
    </div>
  {/if}

  <div class="gh-drawer-body">
    {#if error}
      <p class="error">Error: {error}</p>
    {:else if !payload}
      <p class="loading">Loading…</p>
    {:else if activeTab === 'spec'}
      <SpecTab
        task={payload.task}
        {busy}
        onApproveBrief={() => post('approve-brief')}
        onApproveSpec={handleApproveSpec}
        onPause={() => confirmed('Pause') && post('pause')}
        onShelve={() => confirmed('Shelve') && post('shelve')}
        onUnshelve={() => confirmed('Unshelve') && post('unshelve')}
        onResolveEscalation={handleResolveEscalation}
        onSendFollowUp={handleSendFollowUp}
      />
    {:else if activeTab === 'transcript'}
      <TranscriptTab task={payload.task} />
    {:else if activeTab === 'experts'}
      <ExpertsTab taskId={taskId} />
    {:else if activeTab === 'history'}
      <HistoryTab task={payload.task} />
    {:else if activeTab === 'provenance'}
      <ProvenanceTab task={payload.task} />
    {/if}
  </div>
</aside>

<style>
  .gh-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 150;
  }
  .gh-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(640px, 92vw);
    height: 100vh;
    background: var(--bg-raised);
    border-left: 1px solid var(--border);
    z-index: 151;
    display: flex;
    flex-direction: column;
  }
  .gh-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4);
    border-bottom: 1px solid var(--border);
  }
  .gh-drawer-tabs {
    padding: 0 var(--s-4);
  }
  .gh-drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-4);
  }
  .loading,
  .error {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .error {
    color: var(--danger);
  }
</style>
