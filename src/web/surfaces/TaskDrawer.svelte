<!--
  Task drawer shell. Loads /api/project/task/:id, exposes the four-tab UI,
  and hosts every action (approve/pause/shelve/unshelve/resolve/follow-up).
  Child components handle rendering; this file owns state and HTTP.

  Uses ResolveEscalationModal (no window.prompt) and an inline ApproveSpecModal
  for the optional approval note. Footer with primary actions is sticky.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Icon from '../lib/Icon.svelte'
  import Tabs from '../lib/Tabs.svelte'
  import Modal from '../lib/Modal.svelte'
  import Textarea from '../lib/Textarea.svelte'
  import Field from '../lib/Field.svelte'
  import SpecTab from './drawer/SpecTab.svelte'
  import CurrentTab from './drawer/CurrentTab.svelte'
  import TranscriptTab from './drawer/TranscriptTab.svelte'
  import HistoryTab from './drawer/HistoryTab.svelte'
  import ExpertsTab from './drawer/ExpertsTab.svelte'
  import ProvenanceTab from './drawer/ProvenanceTab.svelte'
  import ResolveEscalationModal from './drawer/ResolveEscalationModal.svelte'
  import type { DrawerPayload, DrawerTab, Escalation } from '../lib/types.js'
  import { onEvent, eventTaskId } from '../lib/events.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../lib/project-routes.js'
  import { project } from '../lib/project.svelte.js'
  import { onMount, onDestroy } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { activeEscalations } from '../lib/escalation.js'

  interface Props {
    taskId: string
    projectId?: string | null
    onClose: () => void
  }

  let { taskId, projectId: _projectId = null, onClose }: Props = $props()

  let payload = $state<DrawerPayload | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)
  let runBusy = $state(false)
  let runError = $state<string | null>(null)
  let activeTab = $state<DrawerTab>('spec')
  let initializedTabForTaskId = $state<string | null>(null)
  let pollHandle: ReturnType<typeof setInterval> | null = null

  // Modal state
  let resolveModal = $state<{ escalation: Escalation; mode: 'retry' | 'resolve' } | null>(null)
  let approveSpecOpen = $state(false)
  let approveSpecNote = $state('')
  let rerunStageBusy = $state<null | 'spec' | 'review' | 'gate'>(null)

  function friendlyFetchError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      return 'Could not reach the local Guildhall server. Restart `pnpm exec guildhall serve` and reload.'
    }
    return message
  }

  function firstSpecSummaryLine(spec: string | undefined): string | null {
    if (typeof spec !== 'string' || !spec.trim()) return null
    const summaryMatch = spec.match(/## Summary\s+([\s\S]*?)(?:\n## |\n### |\Z)/i)
    const summaryBlock = (summaryMatch?.[1] ?? spec).trim()
    if (!summaryBlock) return null
    const firstParagraph = summaryBlock.split(/\n\s*\n/)[0]?.trim() ?? ''
    if (!firstParagraph) return null
    const singleLine = firstParagraph.replace(/\s+/g, ' ').trim()
    if (!singleLine) return null
    const sentence = singleLine.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? singleLine
    return sentence.trim()
  }

  function truncateDisplayTitle(value: string, max = 72): string {
    const singleLine = value.replace(/\s+/g, ' ').trim()
    if (singleLine.length <= max) return singleLine
    return `${singleLine.slice(0, max - 1).trim()}...`
  }

  const BASE_TABS = [
    { id: 'spec', label: 'Spec' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'experts', label: 'Experts' },
    { id: 'history', label: 'History' },
    { id: 'provenance', label: 'Origin' },
  ] as const

  async function load() {
    try {
      const res = await projectFetch(`/api/project/task/${encodeURIComponent(taskId)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        error = body.error ?? `HTTP ${res.status}`
        return
      }
      payload = (await res.json()) as DrawerPayload
      error = null
    } catch (err) {
      error = friendlyFetchError(err)
    }
  }

  async function post(
    action: string,
    body?: Record<string, unknown>,
  ): Promise<boolean> {
    busy = true
    try {
      const res = await projectFetch(
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
    } catch (err) {
      error = friendlyFetchError(err)
      return false
    } finally {
      busy = false
    }
  }

  async function answerQuestion(questionId: string, answer: string): Promise<void> {
    busy = true
    try {
      const res = await projectFetch(`/api/project/task/${encodeURIComponent(taskId)}/answer-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: [{ questionId, answer }],
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        error = b.error ?? `HTTP ${res.status}`
        return
      }
      await load()
    } catch (err) {
      error = friendlyFetchError(err)
    } finally {
      busy = false
    }
  }

  function handleApproveSpec() {
    approveSpecNote = ''
    approveSpecOpen = true
  }

  async function submitApproveSpec() {
    const note = approveSpecNote.trim()
    const body = note ? { approvalNote: note } : undefined
    approveSpecOpen = false
    if (taskId === 'task-workspace-import') {
      busy = true
      try {
        const res = await projectFetch('/api/project/workspace-import/approve', {
          method: 'POST',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!res.ok) {
          const b = await res.json().catch(() => ({}))
          error = b.error ?? `HTTP ${res.status}`
          return
        }
        await load()
        return
      } catch (err) {
        error = friendlyFetchError(err)
        return
      } finally {
        busy = false
      }
    }
    await post('approve-spec', body)
  }

  function handleResolveEscalation(escalation: Escalation, mode: 'retry' | 'resolve' = 'resolve') {
    resolveModal = { escalation, mode }
  }

  async function submitResolveEscalation(args: { resolution: string; nextStatus: string }) {
    const current = resolveModal
    if (!current) return
    resolveModal = null
    await post('resolve-escalation', {
      escalationId: current.escalation.id,
      resolution: args.resolution,
      nextStatus: args.nextStatus,
    })
  }

  async function handleSendFollowUp(message: string) {
    await post('resume', { message })
  }

  async function handleShapeDraft() {
    if (!(await post('shape-draft'))) return
    await project.refresh()
    await load()
    toast.success('Draft handed to Guildhall. Starting now.')
    await runProject('start', taskId)
  }

  async function handleShelve() {
    if (!confirmed('Shelve')) return
    if (!(await post('shelve'))) return
    await project.refresh()
    toast.success('Task put aside.')
    onClose()
  }

  async function handleUnshelve() {
    if (!confirmed('Unshelve')) return
    if (!(await post('unshelve'))) return
    await project.refresh()
    toast.success('Task returned to the queue.')
  }

  async function handleAddAcceptance(description: string) {
    await post('add-acceptance', { description })
  }

  async function rerunStage(stage: 'spec' | 'review' | 'gate') {
    rerunStageBusy = stage
    try {
      await post('rerun-stage', { stage })
      await project.refresh()
    } finally {
      rerunStageBusy = null
    }
  }

  function confirmed(action: string): boolean {
    return window.confirm(`${action} task ${taskId}?`)
  }

  const task = $derived(payload?.task)
  const runStatus = $derived(project.detail?.run?.status ?? 'stopped')
  const hasCurrentTurns = $derived((payload?.threadTurns?.length ?? 0) > 0)
  const tabs = $derived(
    hasCurrentTurns
      ? ([{ id: 'current', label: 'Now' }, ...BASE_TABS] as const)
      : BASE_TABS,
  )
  const canPause = $derived(task && task.status !== 'done' && task.status !== 'shelved')
  const canShelve = $derived(task && task.status !== 'done')
  const isShelved = $derived(task?.status === 'shelved')
  const isWorkspaceImportTask = $derived(task?.id === 'task-workspace-import')
  const openEscalations = $derived(task ? activeEscalations(task) : [])
  const firstOpenEscalation = $derived(openEscalations[0] ?? null)
  const displayTaskTitle = $derived.by(() => {
    if (!task) return taskId
    const raw = typeof task.title === 'string' ? task.title.trim() : ''
    const spec = typeof task.spec === 'string' ? task.spec : ''
    const acceptanceCount = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0
    if (
      task.status === 'exploring' &&
      acceptanceCount > 0 &&
      spec.trim().length > 0 &&
      /^Draft a first starter task for /i.test(raw)
    ) {
      const summary = firstSpecSummaryLine(spec)
      if (summary) return `Starter task spec: ${truncateDisplayTitle(summary)}`
      return 'Starter task spec draft'
    }
    return raw || taskId
  })
  const preferSpecTab = $derived.by(() => {
    if (!task) return false
    if (!hasCurrentTurns) return false
    const status = task.status ?? ''
    const spec = typeof task.spec === 'string' ? task.spec.trim() : ''
    const acceptanceCount = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0
    return status === 'exploring' && spec.length > 0 && acceptanceCount > 0
  })
  const stageRerun = $derived.by(() => {
    if (!task) return null
    if (task.id === 'task-meta-intake' || task.id === 'task-workspace-import') return null
    if (['exploring', 'spec_review', 'ready', 'proposed'].includes(task.status ?? '')) {
      return { stage: 'spec' as const, label: 'Re-draft spec' }
    }
    if (task.status === 'review') {
      return { stage: 'review' as const, label: 'Re-run review' }
    }
    if (task.status === 'gate_check') {
      return { stage: 'gate' as const, label: 'Re-run gates' }
    }
    return null
  })

  $effect(() => {
    void load()
    void project.refresh()
  })

  $effect(() => {
    if (!payload) return
    if (initializedTabForTaskId === taskId) return
    activeTab = hasCurrentTurns && !preferSpecTab ? 'current' : 'spec'
    initializedTabForTaskId = taskId
  })

  $effect(() => {
    if (activeTab === 'current' && !hasCurrentTurns) {
      activeTab = 'spec'
    }
  })

  onMount(() => {
    pollHandle = setInterval(() => {
      void load()
    }, 4000)
  })

  async function runProject(action: 'start' | 'stop', nextTaskId?: string) {
    runBusy = true
    runError = null
    try {
      const res = await projectFetch(`/api/project/${action}`, {
        method: 'POST',
        headers: action === 'start' ? { 'content-type': 'application/json' } : undefined,
        body: action === 'start'
          ? JSON.stringify({
              mode: 'continuous',
              ...(nextTaskId ? { taskId: nextTaskId } : {}),
            })
          : undefined,
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        runError = b.error ?? `${action === 'start' ? 'Start' : 'Stop'} failed (HTTP ${res.status})`
        return
      }
      await project.refresh()
      await load()
      if (action === 'start') {
        const stopMessage = project.detail?.run?.status === 'stopped'
          ? project.detail?.run?.stopMessage
          : null
        if (typeof stopMessage === 'string' && stopMessage.trim()) {
          toast.info(stopMessage)
        }
      }
      setTimeout(() => void project.refresh(), 500)
      setTimeout(() => void project.refresh(), 1800)
    } catch (err) {
      runError = friendlyFetchError(err)
    } finally {
      runBusy = false
    }
  }

  // Live updates: whenever the orchestrator emits an event for THIS task,
  // re-fetch the drawer payload so transitions, notes, escalations, and
  // history reflect reality without the user having to close/reopen the drawer.
  // Coarse refresh is cheaper and simpler than selective merging, and the
  // drawer payload is small.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRefresh() {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void load()
    }, 150)
  }
  const offEvent = onEvent((env) => {
    const tid = eventTaskId(env)
    if (tid && tid === taskId) scheduleRefresh()
  })
  onDestroy(() => {
    offEvent()
    if (pollHandle) {
      clearInterval(pollHandle)
      pollHandle = null
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
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
    <h3>{displayTaskTitle}</h3>
    <Button variant="ghost" size="sm" ariaLabel="Close" onclick={onClose}>
      <Icon name="x" size={16} />
    </Button>
  </header>

  {#if payload}
    <div class="gh-drawer-tabs">
      <Tabs
        tabs={tabs}
        active={activeTab}
        onselect={(id) => (activeTab = id as DrawerTab)}
      />
    </div>
  {/if}

  <div class="gh-drawer-body">
    {#if error}
      <div class="error-stack">
        <p class="error">Error: {error}</p>
        <Button variant="ghost" size="sm" onclick={() => void load()}>Retry</Button>
      </div>
    {:else if !payload}
      <p class="loading">Loading...</p>
    {:else if activeTab === 'current'}
      <CurrentTab
        task={payload.task}
        turns={payload.threadTurns ?? []}
        {busy}
        {runBusy}
        {runError}
        onApproveBrief={() => post('approve-brief')}
        onApproveSpec={handleApproveSpec}
        onRunTask={() => runProject('start', taskId)}
        onShapeDraft={handleShapeDraft}
        onOpenSpecTab={() => (activeTab = 'spec')}
        onAnswerQuestion={answerQuestion}
      />
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
        onAddAcceptance={handleAddAcceptance}
      />
    {:else if activeTab === 'transcript'}
      <TranscriptTab task={payload.task} exploringTranscript={payload.exploringTranscript} />
    {:else if activeTab === 'experts'}
      <ExpertsTab taskId={taskId} />
    {:else if activeTab === 'history'}
      <HistoryTab task={payload.task} />
    {:else if activeTab === 'provenance'}
      <ProvenanceTab task={payload.task} contextDebug={payload.contextDebug ?? []} />
    {/if}
  </div>

  {#if payload && task}
    <footer class="gh-drawer-foot">
      {#if isWorkspaceImportTask}
        <Button
          variant="primary"
          size="sm"
          onclick={() => {
            window.history.pushState({}, '', currentProjectHref('/workspace-import'))
            window.dispatchEvent(new PopStateEvent('popstate'))
          }}
        >
          Open import review
        </Button>
        <a class="copy-link" href={currentTaskHref(task.id)}>copy link</a>
      {:else}
      <div class="run-controls">
        {#if runError}
          <span class="run-error">{runError}</span>
        {/if}
        {#if !hasCurrentTurns}
          {#if runStatus === 'running'}
            <Button
              variant="danger"
              size="sm"
              disabled={runBusy}
              onclick={() => runProject('stop')}
            >
              Stop run
            </Button>
          {:else}
            <Button
              variant="primary"
              size="sm"
              disabled={runBusy || runStatus === 'stopping'}
              onclick={() => runProject('start')}
            >
              Run this task
            </Button>
          {/if}
        {/if}
      </div>
      {#if firstOpenEscalation}
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onclick={() => handleResolveEscalation(firstOpenEscalation, 'retry')}
      >
        Retry blocker
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onclick={() => handleResolveEscalation(firstOpenEscalation, 'resolve')}
      >
        Resolve blocker
      </Button>
      {/if}
      {#if canPause}
        {#if stageRerun}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || rerunStageBusy !== null}
            onclick={() => rerunStage(stageRerun.stage)}
          >
            {rerunStageBusy === stageRerun.stage ? 'Re-running...' : stageRerun.label}
          </Button>
        {/if}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onclick={() => confirmed('Pause') && post('pause')}
        >
          Pause task
        </Button>
      {/if}
      {#if isShelved}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onclick={handleUnshelve}
        >
          Unshelve
        </Button>
      {:else if canShelve}
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onclick={handleShelve}
        >
          Put aside
        </Button>
      {/if}
      <a class="copy-link" href={currentTaskHref(task.id)}>copy link</a>
      {/if}
    </footer>
  {/if}
</aside>

<ResolveEscalationModal
  open={resolveModal !== null}
  escalation={resolveModal?.escalation ?? null}
  mode={resolveModal?.mode ?? 'resolve'}
  {busy}
  onClose={() => (resolveModal = null)}
  onSubmit={submitResolveEscalation}
/>

<Modal
  open={approveSpecOpen}
  title="Approve spec"
  onClose={() => (approveSpecOpen = false)}
  size="sm"
>
  {#snippet children()}
    <Field label="Note (optional)">
      <Textarea
        bind:value={approveSpecNote}
        rows={3}
        placeholder="Context for the coordinator on resume."
      />
    </Field>
  {/snippet}
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (approveSpecOpen = false)}>
      Cancel
    </Button>
    <Button variant="primary" disabled={busy} onclick={submitApproveSpec}>
      Approve
    </Button>
  {/snippet}
</Modal>

<style>
  .gh-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: var(--z-drawer-backdrop);
  }
  .gh-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(640px, 92vw);
    height: 100vh;
    background: var(--bg-raised);
    border-left: 1px solid var(--border);
    z-index: var(--z-drawer);
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
  .gh-drawer-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-top: 1px solid var(--border);
    background: var(--bg-sunken, var(--bg));
  }
  .run-controls {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-right: auto;
    min-width: 0;
  }
  .run-error {
    color: var(--danger);
    font-size: var(--fs-1);
    line-height: var(--lh-tight);
    max-width: 28ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy-link {
    color: var(--text-muted);
    font-size: var(--fs-1);
    text-decoration: underline dotted;
    margin-left: var(--s-2);
  }
  .error-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
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
