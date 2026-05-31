<!--
  Human inbox — prioritized list of things the user must resolve before
  Guildhall can keep moving. Lands as the default view for every project;
  tasks move down to the Work tab.
-->
<script lang="ts">
  import AlignedActionList from '../../lib/AlignedActionList.svelte'
  import Card from '../../lib/Card.svelte'
  import Icon, { type IconName } from '../../lib/Icon.svelte'
  import { inboxItemKey, type InboxItem } from '../../lib/inbox-item-key.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { projectActionHref, projectFetch } from '../../lib/project-routes.js'

  interface Props {
    items?: InboxItem[]
    history?: InboxItem[]
    loaded?: boolean
    error?: string | null
    refresh?: (() => Promise<void>) | null
  }

  let {
    items: suppliedItems = undefined,
    history: suppliedHistory = undefined,
    loaded: suppliedLoaded = false,
    error: suppliedError = null,
    refresh = null,
  }: Props = $props()

  let localItems = $state<InboxItem[]>([])
  let localLoaded = $state(false)
  let localError = $state<string | null>(null)
  // Which item (by list index) is currently being handled by an agent action.
  // We key by index so optimistic state doesn't collide across kinds.
  let handlingIndex = $state<number | null>(null)
  let handlingMessage = $state<string | null>(null)

  const items = $derived(suppliedItems ?? localItems)
  const loaded = $derived(suppliedItems ? suppliedLoaded : localLoaded)
  const error = $derived(suppliedItems ? suppliedError : localError)

  async function load(): Promise<void> {
    if (refresh) {
      await refresh()
      return
    }
    try {
      const r = await projectFetch('/api/project/inbox')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { items?: InboxItem[]; history?: InboxItem[] }
      localItems = j.items ?? []
      if (j.history) localItems = j.history
      localError = null
    } catch (e) {
      localError = e instanceof Error ? e.message : String(e)
    } finally {
      localLoaded = true
    }
  }

  // Kinds that have a backend endpoint an agent can run autonomously.
  // Keep this explicit — not every Inbox item is safe to auto-handle.
  //
  // Note: `workspace_import_pending` intentionally omitted — the scan now
  // runs implicitly whenever /api/project/inbox is read, so this row is
  // about reviewing discovered facts, not asking the user to trigger a scan.
  const AGENT_HANDLERS: Partial<Record<InboxItem['kind'], { endpoint: string; verb: string; pending: string }>> = {
    bootstrap_missing: {
      endpoint: '/api/project/bootstrap/run',
      verb: 'Let agent verify',
      pending: 'Verifying...',
    },
  }

  async function dismissItem(item: InboxItem, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    if (!item.dismissEndpoint) return
    try {
      const r = await projectFetch(item.dismissEndpoint, { method: 'POST' })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok || j.error) {
        handlingMessage = `Dismiss failed: ${j.error ?? `HTTP ${r.status}`}`
        return
      }
      await load()
    } catch (err) {
      handlingMessage = `Dismiss failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async function runAgentHandler(item: InboxItem, index: number, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    const cfg = AGENT_HANDLERS[item.kind]
    if (!cfg) return
    handlingIndex = index
    handlingMessage = null
    try {
      const r = await projectFetch(cfg.endpoint, { method: 'POST' })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok || j.error) {
        handlingMessage = `Failed: ${j.error ?? `HTTP ${r.status}`}`
        return
      }
      // Re-pull inbox; the handled item should drop out of the list.
      await load()
      handlingMessage = null
    } catch (err) {
      handlingMessage = `Failed: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      handlingIndex = null
    }
  }

  $effect(() => {
    void load()
  })

  const ICONS: Record<InboxItem['kind'], IconName> = {
    required_migration: 'refresh-cw',
    project_understanding: 'alert-triangle',
    bootstrap_missing: 'wrench',
    setup_pending: 'wrench',
    workspace_import_pending: 'package',
    project_check_in: 'message-square-more',
    pressure_test_pending: 'message-square-more',
    agent_question_pending: 'message-square-more',
    import_draft_queue: 'list-todo',
    brief_approval: 'file-text',
    spec_approval: 'file-check',
    open_escalation: 'alert-triangle',
    lever_questions: 'sliders',
    spec_fill_pending: 'help-circle',
  }

  const DEFAULT_VERBS: Record<InboxItem['kind'], string> = {
    required_migration: 'Migrate',
    project_understanding: 'Review update',
    bootstrap_missing: 'Configure',
    setup_pending: 'Open setup',
    workspace_import_pending: 'Review import',
    project_check_in: 'Start check-in',
    pressure_test_pending: 'Answer question',
    agent_question_pending: 'Answer question',
    import_draft_queue: 'Draft task brief',
    brief_approval: 'Review brief',
    spec_approval: 'Review spec',
    open_escalation: 'Resolve',
    lever_questions: 'Review',
    spec_fill_pending: 'Open checklist',
  }

  function actionVerb(item: InboxItem): string {
    if (item.kind === 'spec_fill_pending' && item.taskId === 'task-workspace-import') {
      return 'Review import'
    }
    return DEFAULT_VERBS[item.kind]
  }

  function itemDigest(item: InboxItem): string | null {
    if (item.kind === 'lever_questions') {
      return 'Safe defaults are active. Review them only if you want to tune autonomy, recovery, or review strictness.'
    }
    if (item.kind === 'spec_fill_pending') {
      return null
    }
    return null
  }

  function goTo(item: InboxItem): void {
    if (item.actionHref) {
      const href = projectActionHref(item.actionHref)
      const route = href.split('?')[0]?.split('#')[0] ?? href
      nav(href, route.includes('/task/') ? { backgroundPath: path.value } : undefined)
    }
  }

  const priorityItems = $derived(items.filter(item => item.severity !== 'low'))
  const housekeepingItems = $derived(items.filter(item => item.severity === 'low'))
  const displayItems = $derived.by(() => {
    const source = suppliedHistory ?? items
    return [...source]
      .sort((left, right) => ((right.updatedAt ?? right.createdAt ?? '')).localeCompare(left.updatedAt ?? left.createdAt ?? ''))
      .slice(0, 50)
  })
  const displayCount = $derived(displayItems.length)

  function statusLabel(item: InboxItem): string {
    if (!item.status || item.status === 'open') return 'Open'
    if (item.status === 'resolved') {
      switch (item.resolution) {
        case 'answered': return 'Answered'
        case 'migrated': return 'Migrated'
        case 'reconciled': return 'Reconciled'
        case 'reviewed': return 'Reviewed'
        case 'verified': return 'Verified'
        default: return 'Resolved'
      }
    }
    if (item.status === 'dismissed') return 'Dismissed'
    if (item.status === 'superseded') return 'Superseded'
    return item.status
  }

  function statusClass(item: InboxItem): string {
    if (!item.status || item.status === 'open') return item.severity === 'high' ? 'status-open-high' : 'status-open'
    if (item.status === 'resolved') return 'status-resolved'
    if (item.status === 'dismissed') return 'status-dismissed'
    return 'status-neutral'
  }

  function itemTime(item: InboxItem): string {
    const value = item.updatedAt ?? item.createdAt
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  function isOpen(item: InboxItem): boolean {
    return !item.status || item.status === 'open'
  }
</script>

<div class="wrap">
  <header class="head">
    <h2>Needs you</h2>
    {#if loaded}
      <span class="count">({displayCount} item{displayCount === 1 ? '' : 's'})</span>
    {/if}
  </header>

  {#if error}
    <Card tone="warn">
      <p class="muted">Couldn't load inbox: {error}</p>
    </Card>
  {:else if !loaded}
    <p class="muted">Loading...</p>
  {:else if items.length === 0}
    <div class="empty">
      <Icon name="check-circle-2" size={24} />
      <p>All caught up — nothing is waiting on you right now.</p>
    </div>
  {:else}
    {#if priorityItems.length === 0}
      <Card tone="neutral">
        <p class="muted">Nothing is blocked right now. The remaining items are optional cleanup.</p>
      </Card>
    {/if}

    {#if displayItems.length > 0}
      <AlignedActionList
        ariaLabel="Needs you items"
        columns="64px minmax(360px, 1fr) minmax(116px, max-content) minmax(136px, max-content) minmax(220px, max-content)"
        headers={['', 'Item', 'State', 'Updated', 'Action']}
      >
        {#each displayItems as item, i (inboxItemKey(item))}
          {@const handling = handlingIndex === items.indexOf(item)}
          {@const handler = AGENT_HANDLERS[item.kind]}
          <div class="inbox-row aligned-list-row row-{item.severity}" class:handling role="listitem">
            <span class="signal" aria-hidden="true">
              <span class="dot dot-{item.severity}"></span>
              <span class="kind-ic">
                <Icon name={ICONS[item.kind]} size={16} />
              </span>
            </span>
            <button
              type="button"
              class="item-main"
              onclick={() => goTo(item)}
              aria-label={item.title}
            >
              <span class="body">
                <span class="title" title={item.title}>{item.title}</span>
                <span class="detail" title={item.detail}>{item.detail}</span>
                {#if itemDigest(item)}
                  <span class="digest">{itemDigest(item)}</span>
                {/if}
                {#if item.resolutionDetail}
                  <span class="digest">{item.resolutionDetail}</span>
                {/if}
              </span>
            </button>
            <span class={`status-pill ${statusClass(item)}`}>{statusLabel(item)}</span>
            <span class="time">{itemTime(item) || '—'}</span>
            <span class="actions">
              <button type="button" class="verb" onclick={() => goTo(item)}>
                {actionVerb(item)} →
              </button>
              {#if isOpen(item) && handler}
                <button
                  type="button"
                  class="agent-verb"
                  onclick={e => runAgentHandler(item, items.indexOf(item), e)}
                  disabled={handlingIndex !== null}
                  title="Agent runs this automatically"
                >
                  {handling ? handler.pending : handler.verb}
                </button>
              {/if}
              {#if isOpen(item) && item.dismissEndpoint}
                <button
                  type="button"
                  class="dismiss-verb"
                  onclick={e => dismissItem(item, e)}
                  title="Hide from Inbox (stays reachable elsewhere)"
                >
                  Dismiss
                </button>
              {/if}
            </span>
          </div>
        {/each}
      </AlignedActionList>
    {/if}

    {#if handlingMessage}
      <div class="handling-msg">{handlingMessage}</div>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding-block-start: var(--s-3);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    margin-block-end: var(--s-1);
  }
  .head h2 {
    margin: 0;
    font-size: var(--fs-4);
    font-weight: 700;
  }
  .count {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .empty {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    padding: var(--s-4);
    border: 1px dashed var(--border);
    border-radius: var(--r-1);
  }
  .empty p { margin: 0; }

  .inbox-row {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding-block: var(--s-3);
    min-width: 0;
  }
  .inbox-row:hover,
  .inbox-row:focus-within {
    background: var(--bg-elevated);
    border-color: var(--border-strong);
  }
  .inbox-row.handling {
    opacity: 0.7;
  }
  .signal {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .item-main {
    display: block;
    min-width: 0;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    outline: none;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .item-main:hover .title,
  .item-main:focus-visible .title {
    color: var(--accent);
  }
  .actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-2);
    min-width: 0;
    padding-inline-end: var(--s-3);
  }
  .agent-verb {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .agent-verb:hover {
    color: var(--text);
  }
  .agent-verb:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .dismiss-verb {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-1);
    cursor: pointer;
    white-space: nowrap;
  }
  .dismiss-verb:hover {
    color: var(--text);
  }
  .handling-msg {
    padding: var(--s-2) var(--s-3);
    font-size: var(--fs-1);
    color: var(--danger);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-left: -2px;
  }
  .dot-high { background: var(--danger); }
  .dot-medium { background: var(--warn); }
  .dot-low { background: var(--text-muted); }

  .kind-ic {
    color: var(--text-muted);
    display: inline-flex;
  }
  .body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--fs-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .digest {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-copy);
    white-space: normal;
  }
  .verb {
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 600;
    padding: 0;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-pill {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px var(--s-2);
    font-size: var(--fs-0);
    font-weight: 650;
    white-space: nowrap;
  }
  .status-open-high {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  }
  .status-open {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
  }
  .status-resolved {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 45%, var(--border));
  }
  .status-dismissed,
  .status-neutral {
    color: var(--text-muted);
  }
  .time {
    color: var(--text-muted);
    font-size: var(--fs-1);
    white-space: nowrap;
  }
  @media (min-width: 861px) {
    .status-pill,
    .time {
      justify-self: start;
    }
    .actions {
      justify-self: end;
    }
  }
  @media (max-width: 760px) {
    .inbox-row {
      align-items: start;
    }
    .status-pill,
    .time,
    .actions {
      justify-self: start;
    }
    .signal {
      grid-row: 1;
    }
  }
</style>
