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
  }

  let items = $state<InboxItem[]>([])
  let loaded = $state(false)
  let error = $state<string | null>(null)

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
    workspace_import_pending: 'Scan workspace',
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
        <li>
          <button
            type="button"
            class="row row-{item.severity}"
            onclick={() => goTo(item)}
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
        </li>
      {/each}
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
    display: grid;
    grid-template-columns: 4px 20px 1fr auto;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    cursor: pointer;
    outline: none;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .row:hover,
  .row:focus-visible {
    background: var(--bg-elevated);
    border-color: var(--border-strong);
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
