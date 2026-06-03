<!--
  "Do this next" banner. Picks the top inbox item (inbox is already sorted
  by severity → kind) and renders it as a prescriptive card with ONE primary
  verb + button. Everything else collapses to "N more in Inbox ›".

  Goal: the user never has to scan chips + tabs to figure out what matters.
  The product says "do this", and Inbox remains for the full list.
-->
<script lang="ts">
  import ActionBar from '../lib/ActionBar.svelte'
  import Button from '../lib/Button.svelte'
  import FrameCard from '../../../packages/ui/src/components/FrameCard.svelte'
  import { onEvent } from '../lib/events.js'
  import { nav, path } from '../lib/nav.svelte.js'
  import { projectActionHref, projectFetch } from '../lib/project-routes.js'

  interface InboxItem {
    kind: string
    severity: 'high' | 'medium' | 'low'
    title: string
    detail?: string
    taskId?: string
    actionHref?: string
  }
  let items = $state<InboxItem[]>([])
  let threadTurn = $state<ThreadTurn | null>(null)
  let loaded = $state(false)

  interface ThreadTurn {
    id: string
    kind: string
    status: 'done' | 'active' | 'pending'
    actionHref?: string
    sessionId?: string
    domainTitle?: string
    targetTitle?: string
    question?: {
      prompt?: string
      why?: string
    }
  }

  async function load(): Promise<void> {
    try {
      const inboxRes = await projectFetch('/api/project/inbox')
      if (inboxRes.ok) {
        const j = (await inboxRes.json()) as { items?: InboxItem[] }
        items = j.items ?? []
      }
      if (!items.some(item => item.severity !== 'low')) {
        const threadRes = await projectFetch('/api/project/thread')
        if (threadRes.ok) {
          const j = (await threadRes.json()) as { activeTurnId?: string | null; turns?: ThreadTurn[] }
          threadTurn = (j.turns ?? []).find(turn => turn.id === j.activeTurnId && turn.status === 'active') ?? null
        }
      } else {
        threadTurn = null
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
          button: 'Open readiness checks',
          href: item.actionHref ?? '/settings/ready',
        }
      case 'setup_pending':
        return {
          verb: item.title,
          why: item.detail ?? 'Finish the next setup step before moving on.',
          button: 'Open setup',
          href: item.actionHref ?? '/thread',
        }
      case 'project_understanding':
        return {
          verb: item.title,
          why: item.detail ?? 'Review the newer project-discovery pass and decide whether to update imported work.',
          button: 'Review update',
          href: item.actionHref ?? '/workspace-import?mode=reconcile',
        }
      case 'import_draft_queue':
        return {
          verb: 'Shape the imported drafts',
          why: item.detail ?? 'Guildhall imported planning work that still needs a quick shaping pass.',
          button: item.taskId === 'task-workspace-import' ? 'Open import review' : 'Draft task brief',
          href: item.actionHref ?? '/thread',
        }
      case 'workspace_import_pending':
        return {
          verb: 'Review existing project work',
          why: item.detail ?? 'Guildhall found planning notes and possible tasks in this project.',
          button: 'Open review',
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
          button: 'Open in Thread',
          href: '/thread',
        }
      default:
        return {
          verb: item.title,
          why: item.detail ?? '',
          button: 'Open',
          href: item.actionHref ?? '/overview/inbox',
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
  const visibleItems = $derived.by(() =>
    prescribedItems.filter(({ prescription }) => routeOnly(projectActionHref(prescription.href)) !== path.value),
  )
  const actionableItems = $derived.by(() =>
    visibleItems.filter(({ item }) => item.severity !== 'low'),
  )
  const moreItems = $derived.by(() => visibleItems.slice(1))
  const moreButtonLabel = $derived.by(() => {
    if (moreItems.length <= 0) return ''
    if (moreItems.every(({ item }) => item.severity === 'low')) {
      return moreItems.length === 1 ? '1 optional cleanup item ›' : `${moreItems.length} optional cleanup items ›`
    }
    return moreItems.length === 1 ? '1 more in Inbox ›' : `${moreItems.length} more in Inbox ›`
  })
  const source = $derived<TopSource | null>(
    actionableItems[0]
        ? (() => {
            const top = actionableItems[0]!
            return {
              verb: top.prescription.verb,
              why: top.prescription.why,
              button: top.prescription.button,
              href: projectActionHref(top.prescription.href),
              severity: top.item.severity,
              moreLabel: moreButtonLabel,
              moreHref: projectActionHref('/overview/inbox'),
            }
          })()
        : threadTurn
          ? {
              verb: 'Answer in Thread',
              why: threadTurn.question?.prompt ?? threadTurn.domainTitle ?? 'Guildhall is waiting for your answer in Thread.',
              button: 'Open Thread',
              href: projectActionHref(threadTurn.actionHref ?? (threadTurn.sessionId ? `/thread?thread=${threadTurn.sessionId}` : '/thread')),
              severity: 'medium',
              moreLabel: moreButtonLabel,
              moreHref: projectActionHref('/overview/inbox'),
            }
          : null,
  )
  const tone = $derived<'default' | 'warn'>(
    source?.severity === 'high'
      ? 'warn'
      : source?.severity === 'medium'
        ? 'warn'
        : 'default',
  )
  const moreCount = $derived(visibleItems.length - 1)

  function go(href: string) {
    const next = projectActionHref(href)
    const route = next.split('?')[0]?.split('#')[0] ?? next
    nav(next, route.includes('/task/') ? { backgroundPath: path.value } : undefined)
  }
</script>

{#if loaded && source}
  <div class="next-wrap">
    <FrameCard tone={tone} padding="compact" density="compact" class="next-card">
      <div class="row">
        <div class="text">
          <div class="eyebrow">Do this next</div>
          <div class="verb">{source.verb}</div>
          {#if source.why}
            <div class="why">{source.why}</div>
          {/if}
        </div>
        <ActionBar>
          <Button variant="primary" onclick={() => go(source.href)}>
            {source.button} →
          </Button>
          {#if moreCount > 0}
            <Button variant="secondary" size="sm" onclick={() => go(projectActionHref('/overview/inbox'))}>
              {source.moreLabel}
            </Button>
          {/if}
        </ActionBar>
      </div>
    </FrameCard>
  </div>
{/if}

<style>
  .next-wrap {
    margin-block: var(--gh-space-3) var(--gh-space-4);
  }

  .next-wrap :global(.next-card) {
    gap: var(--gh-space-3);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--gh-space-3);
    flex-wrap: wrap;
    min-block-size: 3.75rem;
  }

  .text {
    flex: 1 1 30rem;
    min-width: 18rem;
    display: grid;
    align-content: center;
  }

  .eyebrow {
    font-size: var(--gh-type-size-eyebrow);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .verb {
    font-size: var(--gh-type-size-panel-title);
    font-weight: var(--gh-type-weight-emphasis);
    margin-top: var(--gh-space-1);
    color: var(--text);
  }

  .why {
    margin-top: var(--gh-space-1);
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }

  .next-wrap :global(.action-bar) {
    align-self: center;
  }
</style>
