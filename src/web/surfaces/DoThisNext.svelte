<!--
  "Do this next" banner. Picks the top inbox item (inbox is already sorted
  by severity → kind) and renders it as a prescriptive card with ONE primary
  verb + button. Everything else collapses to "N more in Inbox ›".

  Goal: the user never has to scan chips + tabs to figure out what matters.
  The product says "do this", and Inbox remains for the full list.
-->
<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import { onEvent } from '../lib/events.js'
  import { nav, path } from '../lib/nav.svelte.js'

  interface InboxItem {
    kind: string
    severity: 'high' | 'medium' | 'low'
    title: string
    detail?: string
    taskId?: string
    actionHref?: string
  }

  let items = $state<InboxItem[]>([])
  let loaded = $state(false)

  async function load(): Promise<void> {
    try {
      const inboxRes = await fetch('/api/project/inbox')
      if (inboxRes.ok) {
        const j = (await inboxRes.json()) as { items?: InboxItem[] }
        items = j.items ?? []
      }
    } catch {
      /* keep prior */
    } finally {
      loaded = true
    }
  }

  $effect(() => {
    void load()
  })
  $effect(() => {
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      if (
        t.startsWith('task_') ||
        t.startsWith('escalation_') ||
        t.startsWith('bootstrap_') ||
        t.startsWith('supervisor_') ||
        t.startsWith('config_')
      ) {
        void load()
      }
    })
    return off
  })

  interface Prescription {
    verb: string
    why: string
    button: string
    href: string
  }

  function prescribe(item: InboxItem): Prescription {
    const id = item.taskId ? ` on ${item.title}` : ''
    switch (item.kind) {
      case 'bootstrap_missing':
        return {
          verb: 'Verify your bootstrap commands',
          why: 'Agents won’t dispatch until install + gate commands are verified.',
          button: 'Open Ready',
          href: item.actionHref ?? '/settings/ready',
        }
      case 'open_escalation':
        return {
          verb: `Resolve the escalation${id}`,
          why: item.detail ?? 'An agent needs a human decision to continue.',
          button: 'Open task',
          href: item.actionHref ?? '/work',
        }
      case 'brief_approval':
        return {
          verb: `Review the product brief${id}`,
          why: 'The spec agent is waiting for you to confirm the brief (or correct it).',
          button: 'Open brief',
          href: item.actionHref ?? '/work',
        }
      case 'spec_approval':
        return {
          verb: `Approve the spec${id}`,
          why: 'The worker can’t start until the spec is approved.',
          button: 'Open spec',
          href: item.actionHref ?? '/work',
        }
      case 'workspace_import_pending':
        return {
          verb: 'Review what the repo scan found',
          why: item.detail ?? 'README + project files detected. Import or dismiss.',
          button: 'Open import',
          href: item.actionHref ?? '/workspace-import',
        }
      case 'lever_questions':
        return {
          verb: 'Review project policies',
          why: item.detail ?? 'Defaults are still in effect for some project policies.',
          button: 'Open advanced',
          href: item.actionHref ?? '/settings/advanced',
        }
      case 'spec_fill_pending':
        return {
          verb: `Finish the spec${id}`,
          why: item.detail ?? 'Shape the task so the reviewer has something to verify.',
          button: 'Open task',
          href: item.actionHref ?? '/work',
        }
      default:
        return {
          verb: item.title,
          why: item.detail ?? '',
          button: 'Open',
          href: item.actionHref ?? '/inbox',
        }
    }
  }

  function routeOnly(href: string): string {
    return href.split('?')[0]?.split('#')[0] ?? href
  }

  interface TopSource {
    verb: string
    why: string
    button: string
    href: string
    severity: 'high' | 'medium' | 'low'
    moreLabel: string
    moreHref: string
  }

  const prescribedItems = $derived.by(() => items.map(item => ({ item, prescription: prescribe(item) })))
  const topItemIsCurrentPage = $derived(
    prescribedItems[0]
      ? routeOnly(prescribedItems[0].prescription.href) === path.value
      : false,
  )
  const visibleItems = $derived.by(() =>
    topItemIsCurrentPage
      ? []
      : prescribedItems.filter(({ prescription }) => routeOnly(prescription.href) !== path.value),
  )
  const actionableItems = $derived.by(() =>
    visibleItems.filter(({ item }) => item.severity !== 'low'),
  )
  const source = $derived<TopSource | null>(
    actionableItems[0]
        ? (() => {
            const top = actionableItems[0]!
            return {
              verb: top.prescription.verb,
              why: top.prescription.why,
              button: top.prescription.button,
              href: top.prescription.href,
              severity: top.item.severity,
              moreLabel: `${visibleItems.length - 1} more in Inbox ›`,
              moreHref: '/inbox',
            }
          })()
        : null,
  )
  const tone = $derived(
    source?.severity === 'high'
      ? 'danger'
      : source?.severity === 'medium'
        ? 'warn'
        : 'neutral',
  )
  const moreCount = $derived(visibleItems.length - 1)

  function go(href: string) {
    nav(href)
  }
</script>

{#if loaded && source}
  <Card {tone}>
    <div class="row">
      <div class="text">
        <div class="eyebrow">Do this next</div>
        <div class="verb">{source.verb}</div>
        {#if source.why}
          <div class="why">{source.why}</div>
        {/if}
      </div>
      <div class="actions">
        <Button variant="primary" onclick={() => go(source.href)}>
          {source.button} →
        </Button>
        {#if moreCount > 0}
          <button type="button" class="more" onclick={() => go('/inbox')}>
            {moreCount} more in Inbox ›
          </button>
        {/if}
      </div>
    </div>
  </Card>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .text { flex: 1; min-width: 220px; }
  .eyebrow {
    font-size: var(--fs-1);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .verb {
    font-size: var(--fs-3);
    font-weight: 700;
    margin-top: 2px;
    color: var(--text);
  }
  .why {
    margin-top: 4px;
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .more {
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-1);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
  .more:hover { color: var(--text); }
</style>
