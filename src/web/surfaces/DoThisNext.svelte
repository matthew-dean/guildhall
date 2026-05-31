<!--
  "Do this next" banner. Picks the top inbox item (inbox is already sorted
  by severity → kind) and renders it as a prescriptive card with ONE primary
  verb + button. Everything else collapses to "N more in Inbox ›".

  Goal: the user never has to scan chips + tabs to figure out what matters.
  The product says "do this", and Inbox remains for the full list.
-->
<script lang="ts">
  import ActionBar from '../lib/ActionBar.svelte'
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
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
  interface StartReadiness {
    canStart?: boolean
    code?: string
    message?: string
    actionHref?: string
  }

  let items = $state<InboxItem[]>([])
  let startReadiness = $state<StartReadiness | null>(null)
  let loaded = $state(false)

  async function load(): Promise<void> {
    try {
      const inboxRes = await projectFetch('/api/project/inbox')
      if (inboxRes.ok) {
        const j = (await inboxRes.json()) as { items?: InboxItem[] }
        items = j.items ?? []
      }
      const projectRes = await projectFetch('/api/project')
      if (projectRes.ok) {
        const j = (await projectRes.json()) as { startReadiness?: StartReadiness | null }
        startReadiness = j.startReadiness ?? null
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
      case 'start_readiness':
        return {
          verb:
            item.title ||
            (item.detail?.toLowerCase().includes('migration')
              ? 'Run the required migration'
              : 'Resolve the project blocker'),
          why: item.detail?.toLowerCase().includes('migration')
            ? item.detail
            : 'Guildhall needs this resolved before project work can move safely.',
          button: item.detail?.toLowerCase().includes('migration')
            ? 'Migrate project'
            : item.detail?.toLowerCase().includes('question') || item.detail?.toLowerCase().includes('answer')
              ? 'Answer question'
              : item.detail?.toLowerCase().includes('spec')
                ? 'Review spec'
                : 'Review recovery',
          href: item.actionHref ?? '/overview/inbox',
        }
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
      case 'open_escalation':
        return {
          verb: `Review the blocked task${id}`,
          why: item.detail ?? 'Choose the next recovery action so Guildhall can continue.',
          button: 'Review recovery',
          href: item.actionHref ?? '/work',
        }
      case 'agent_question_pending':
        return {
          verb: `Answer Guildhall’s question${id}`,
          why: item.detail ?? 'Guildhall needs one answer before it can continue shaping the work.',
          button: 'Answer question',
          href: item.actionHref ?? '/thread',
        }
      case 'pressure_test_pending':
        return {
          verb: `Continue pressure test${id}`,
          why: item.detail ?? 'Guildhall is pressure-testing this request before turning it into work.',
          button: 'Answer question',
          href: item.actionHref ?? '/thread',
        }
      case 'project_check_in':
        return {
          verb: item.title,
          why: item.detail ?? 'Start the project check-in so Guildhall can use current context.',
          button: 'Start check-in',
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
      case 'brief_approval':
        return {
          verb: `Review the product brief${id}`,
          why: 'The spec agent is waiting for you to confirm the brief (or correct it).',
          button: 'Review brief',
          href: item.actionHref ?? '/thread',
        }
      case 'spec_approval':
        return {
          verb: `Approve the spec${id}`,
          why: 'The worker can’t start until the spec is approved.',
          button: 'Review spec',
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

  const readinessItem = $derived<InboxItem | null>(
    startReadiness?.canStart === false && startReadiness.code !== 'all_terminal'
      ? {
          kind: 'start_readiness',
          severity: 'high',
          title: startReadiness.code === 'required_migration_pending'
            ? 'Required migration'
            : startReadiness.message ?? 'Resolve project blocker',
          detail: startReadiness.message,
          actionHref: startReadiness.actionHref,
        }
      : null,
  )
  const prescribedItems = $derived.by(() => [
    ...(readinessItem ? [readinessItem] : []),
    ...items,
  ].map(item => ({ item, prescription: prescribe(item) })))
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
    const next = projectActionHref(href)
    const route = next.split('?')[0]?.split('#')[0] ?? next
    nav(next, route.includes('/task/') ? { backgroundPath: path.value } : undefined)
  }
</script>

{#if loaded && source}
  <div class="next-wrap">
    <Card {tone}>
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
    </Card>
  </div>
{/if}

<style>
  .next-wrap {
    margin-block: var(--s-3) var(--s-4);
  }
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
</style>
