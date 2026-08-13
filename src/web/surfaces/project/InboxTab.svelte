<!--
  Human inbox — prioritized list of things the user must resolve before
  Guildhall can keep moving. Lands as the default view for every project;
  tasks move down to the Work tab.
-->
<script lang="ts">
  import CardList from '../../lib/CardList.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon, { type IconName } from '../../lib/Icon.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
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
      const j = (await r.json()) as { items?: InboxItem[] }
      localItems = j.items ?? []
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

  async function reviewContractResult(item: InboxItem, action: 'apply' | 'reject', index: number, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    if (item.kind !== 'contract_result_review' || !item.resultId) return
    handlingIndex = index
    handlingMessage = null
    try {
      const endpoint = `/api/project/delivery-spine/contract-results/${encodeURIComponent(item.resultId)}/${action}`
      const body = action === 'apply'
        ? { ownerOverrideReason: 'Accepted from Needs you.' }
        : { reason: 'Rejected from Needs you.' }
      const r = await projectFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok || j.error) {
        handlingMessage = `${action === 'apply' ? 'Accept' : 'Reject'} failed: ${j.error ?? `HTTP ${r.status}`}`
        return
      }
      await load()
    } catch (err) {
      handlingMessage = `${action === 'apply' ? 'Accept' : 'Reject'} failed: ${err instanceof Error ? err.message : String(err)}`
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
    proof_reconciliation: 'alert-triangle',
    import_draft_queue: 'list-todo',
    contract_result_review: 'file-check',
    lever_questions: 'sliders',
    spec_fill_pending: 'help-circle',
  }

  const DEFAULT_VERBS: Record<InboxItem['kind'], string> = {
    required_migration: 'Migrate',
    project_understanding: 'Review update',
    bootstrap_missing: 'Configure',
    setup_pending: 'Open setup',
    workspace_import_pending: 'Review import',
    proof_reconciliation: 'Review proof',
    import_draft_queue: 'Draft task brief',
    contract_result_review: 'Review result',
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
    if (item.deliveryStepTitle || item.containingWorkTitle) {
      return [
        'Delivery step',
        item.containingWorkTitle,
      ].filter(Boolean).join(' · ')
    }
    if (item.kind === 'lever_questions') {
      return 'Safe defaults are active. Review them only if you want to tune autonomy, recovery, or review strictness.'
    }
    if (item.kind === 'spec_fill_pending') {
      return null
    }
    if (item.kind === 'contract_result_review') {
      const buckets = item.reviewBuckets?.length ? item.reviewBuckets.join(', ') : 'review'
      return `${item.changeCount ?? 0} change${item.changeCount === 1 ? '' : 's'} in ${buckets}.`
    }
    if (item.kind === 'proof_reconciliation') {
      return `${item.count ?? 1} completed task${item.count === 1 ? '' : 's'} need evidence reconciliation.`
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

  const priorityItems = $derived(items.filter(item => item.severity !== 'low' && isOpen(item)))

  function toneFor(item: InboxItem): 'danger' | 'warn' | 'neutral' | 'ok' {
    if (!isOpen(item) && item.status === 'resolved') return 'ok'
    if (item.severity === 'high') return 'danger'
    if (item.severity === 'medium') return 'warn'
    return 'neutral'
  }

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

  function statusTone(item: InboxItem): 'danger' | 'warn' | 'neutral' | 'ok' {
    if (!item.status || item.status === 'open') return item.severity === 'high' ? 'danger' : 'warn'
    if (item.status === 'resolved') return 'ok'
    return 'neutral'
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
  </header>
  <p class="summary">Only decisions that need you appear here.</p>

  {#if error}
    <UtilityPanel tone="warn">
      <p class="muted">Couldn't load inbox: {error}</p>
    </UtilityPanel>
  {:else if !loaded}
    <p class="muted">Loading...</p>
  {:else if priorityItems.length === 0}
    <UtilityPanel className="empty" tone="ok">
      <Icon name="check-circle-2" size={24} />
      <div>
        <strong>Nothing needs your decision</strong>
        <p>Guildhall can continue from current work.</p>
        <a class="threads-link" href={projectActionHref('/work')}>Open current work</a>
      </div>
    </UtilityPanel>
  {:else}
    <section class="group" aria-labelledby="needs-you-alerts">
      <div class="group-head">
        <h3 id="needs-you-alerts">Your decisions</h3>
        <span>{priorityItems.length}</span>
      </div>
      <CardList className="item-list">
        {#each priorityItems as item, i (inboxItemKey(item))}
          {@const handling = handlingIndex === items.indexOf(item)}
          {@const handler = AGENT_HANDLERS[item.kind]}
          <CardListItem className="inbox-row" dense tone={toneFor(item)} railTone={toneFor(item)}>
              <div class="item-head">
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
                <div class="meta">
                  <Chip label={statusLabel(item)} tone={statusTone(item)} />
                  <span class="time">{itemTime(item) || '—'}</span>
                </div>
              </div>
              <div class="actions" class:handling>
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
                {#if isOpen(item) && item.kind === 'contract_result_review'}
                  <button
                    type="button"
                    class="agent-verb"
                    onclick={e => reviewContractResult(item, 'apply', items.indexOf(item), e)}
                    disabled={handlingIndex !== null}
                    title="Accept these validated changes"
                  >
                    {handling ? 'Accepting...' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    class="dismiss-verb"
                    onclick={e => reviewContractResult(item, 'reject', items.indexOf(item), e)}
                    disabled={handlingIndex !== null}
                    title="Reject this contract result"
                  >
                    Reject
                  </button>
                {/if}
                {#if isOpen(item) && item.dismissEndpoint}
                  <button
                    type="button"
                    class="dismiss-verb"
                    onclick={e => dismissItem(item, e)}
                    title="Hide from Needs you (stays reachable elsewhere)"
                  >
                    Dismiss
                  </button>
                {/if}
              </div>
          </CardListItem>
        {/each}
      </CardList>
    </section>

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
    font-size: var(--gh-type-size-section-title);
    font-weight: var(--gh-type-weight-strong);
  }
  .summary {
    margin: calc(var(--s-1) * -1) 0 0;
    color: var(--text-muted);
    max-width: 64ch;
  }
  .count {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .empty {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
  }
  .empty :global(p) { margin: 0; }
  .threads-link {
    color: var(--accent);
    font-weight: var(--gh-type-weight-strong);
    text-decoration: none;
    white-space: nowrap;
  }
  .threads-link:hover {
    color: var(--text);
  }
  .group {
    display: grid;
    gap: var(--s-3);
  }
  .group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .group-head h3 {
    margin: 0;
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
  }
  .group-head span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  :global(.inbox-row) {
    grid-template-columns: auto minmax(0, 1fr) auto;
    column-gap: var(--s-3);
    row-gap: var(--s-2);
    align-items: start;
  }
  .item-head {
    display: contents;
  }
  .signal {
    grid-column: 1;
    grid-row: 1 / span 2;
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    padding-top: 2px;
  }
  .item-main {
    grid-column: 2;
    grid-row: 1;
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
    grid-column: 2;
    grid-row: 2;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: var(--s-2);
    justify-self: start;
    text-align: left;
  }
  .actions.handling {
    opacity: 0.7;
  }
  .agent-verb {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
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
    font-size: var(--gh-type-size-meta);
    cursor: pointer;
    white-space: nowrap;
  }
  .dismiss-verb:hover {
    color: var(--text);
  }
  .handling-msg {
    padding: var(--s-2) var(--s-3);
    font-size: var(--gh-type-size-meta);
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
  .meta {
    grid-column: 3;
    grid-row: 1;
    display: grid;
    gap: var(--s-1);
    justify-items: end;
    align-self: start;
  }
  .title {
    font-weight: var(--gh-type-weight-strong);
    color: var(--text);
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .digest {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-relaxed);
    white-space: normal;
  }
  .verb {
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    padding: 0;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .time {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    white-space: nowrap;
  }
  @media (max-width: 760px) {
    .threads-note {
      grid-template-columns: 1fr;
    }
    :global(.inbox-row) {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .item-head {
      display: contents;
    }
    .signal {
      grid-column: 1;
      grid-row: 1;
    }
    .item-main {
      grid-column: 2;
      grid-row: 1;
    }
    .meta {
      grid-column: 2;
      grid-row: 2;
      justify-items: start;
      grid-auto-flow: column;
      align-items: center;
    }
    .actions {
      grid-column: 2;
      grid-row: 3;
      justify-content: flex-start;
      justify-self: start;
      text-align: left;
    }
  }
</style>
