<!--
  Coordinator inbox — prioritized list of things the human must resolve so
  the coordinator can plan and dispatch. Lands as the default view for every
  project; tasks move down to the Work tab.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Icon, { type IconName } from '../../lib/Icon.svelte'
  import { nav } from '../../lib/nav.svelte.js'

  type Severity = 'high' | 'medium' | 'low'

  interface InboxItem {
    kind:
      | 'bootstrap_missing'
      | 'workspace_import_pending'
      | 'brief_approval'
      | 'spec_approval'
      | 'open_escalation'
      | 'lever_questions'
    severity: Severity
    title: string
    detail: string
    actionHref?: string
    taskId?: string
    escalationId?: string
    signals?: string[]
    defaultCount?: number
    /** If present, POST to this path to dismiss the item (stays reachable elsewhere). */
    dismissEndpoint?: string
  }

  let items = $state<InboxItem[]>([])
  let loaded = $state(false)
  let error = $state<string | null>(null)
  // Which item (by list index) is currently being handled by an agent action.
  // We key by index so optimistic state doesn't collide across kinds.
  let handlingIndex = $state<number | null>(null)
  let handlingMessage = $state<string | null>(null)

  async function load(): Promise<void> {
    try {
      const r = await fetch('/api/project/inbox')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { items?: InboxItem[] }
      items = j.items ?? []
      error = null
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loaded = true
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
      pending: 'Verifying…',
    },
  }

  async function dismissItem(item: InboxItem, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    if (!item.dismissEndpoint) return
    try {
      const r = await fetch(item.dismissEndpoint, { method: 'POST' })
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
      const r = await fetch(cfg.endpoint, { method: 'POST' })
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
    bootstrap_missing: 'wrench',
    workspace_import_pending: 'package',
    brief_approval: 'file-text',
    spec_approval: 'file-check',
    open_escalation: 'alert-triangle',
    lever_questions: 'sliders',
  }

  const VERBS: Record<InboxItem['kind'], string> = {
    bootstrap_missing: 'Configure',
    workspace_import_pending: 'Review',
    brief_approval: 'Review',
    spec_approval: 'Review',
    open_escalation: 'Resolve',
    lever_questions: 'Answer',
  }

  function goTo(item: InboxItem): void {
    if (item.actionHref) nav(item.actionHref)
  }
</script>

<div class="wrap">
  <header class="head">
    <h2>Needs you</h2>
    {#if loaded}
      <span class="count">({items.length} item{items.length === 1 ? '' : 's'})</span>
    {/if}
  </header>

  {#if error}
    <Card tone="warn">
      <p class="muted">Couldn't load inbox: {error}</p>
    </Card>
  {:else if !loaded}
    <p class="muted">Loading…</p>
  {:else if items.length === 0}
    <div class="empty">
      <Icon name="check-circle-2" size={24} />
      <p>All caught up — coordinator has no open questions.</p>
    </div>
  {:else}
    <ul class="list">
      {#each items as item, i (i)}
        {@const handler = AGENT_HANDLERS[item.kind]}
        {@const handling = handlingIndex === i}
        <li>
          <div class="row row-{item.severity}" class:handling>
            <button
              type="button"
              class="row-main"
              onclick={() => goTo(item)}
              aria-label={item.title}
            >
              <span class="dot dot-{item.severity}" aria-hidden="true"></span>
              <span class="kind-ic" aria-hidden="true">
                <Icon name={ICONS[item.kind]} size={16} />
              </span>
              <div class="body">
                <div class="title" title={item.title}>{item.title}</div>
                <div class="detail" title={item.detail}>{item.detail}</div>
              </div>
              <span class="verb">{VERBS[item.kind]} →</span>
            </button>
            {#if handler}
              <button
                type="button"
                class="agent-verb"
                onclick={e => runAgentHandler(item, i, e)}
                disabled={handlingIndex !== null}
                title="Agent runs this automatically"
              >
                {handling ? handler.pending : handler.verb}
              </button>
            {/if}
            {#if item.dismissEndpoint}
              <button
                type="button"
                class="dismiss-verb"
                onclick={e => dismissItem(item, e)}
                title="Hide from Inbox (stays reachable elsewhere)"
              >
                Dismiss
              </button>
            {/if}
          </div>
        </li>
      {/each}
      {#if handlingMessage}
        <li><div class="handling-msg">{handlingMessage}</div></li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
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

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .list li { margin: 0; padding: 0; }
  .row {
    display: flex;
    align-items: stretch;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    overflow: hidden;
  }
  .row:hover,
  .row:focus-within {
    background: var(--bg-elevated);
    border-color: var(--border-strong);
  }
  .row.handling {
    opacity: 0.7;
  }
  .row-main {
    display: grid;
    grid-template-columns: 4px 20px 1fr auto;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    cursor: pointer;
    outline: none;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .agent-verb {
    flex: none;
    align-self: stretch;
    padding: 0 var(--s-3);
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .agent-verb:hover {
    background: var(--bg-raised-2);
    color: var(--text);
  }
  .agent-verb:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .dismiss-verb {
    flex: none;
    align-self: stretch;
    padding: 0 var(--s-3);
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-1);
    cursor: pointer;
    white-space: nowrap;
  }
  .dismiss-verb:hover {
    background: var(--bg-raised-2);
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
  .verb {
    color: var(--accent);
    font-size: var(--fs-1);
    font-weight: 600;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
