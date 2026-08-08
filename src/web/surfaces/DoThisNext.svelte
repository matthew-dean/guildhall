<!-- Renders the shared runtime action model; ranking belongs to the API. -->
<script lang="ts">
  import ActionBar from '../lib/ActionBar.svelte'
  import Button from '../lib/Button.svelte'
  import Eyebrow from '../lib/Eyebrow.svelte'
  import FrameCard from '../../../packages/ui/src/components/FrameCard.svelte'
  import { onEvent } from '../lib/events.js'
  import { nav, path } from '../lib/nav.svelte.js'
  import { project } from '../lib/project.svelte.js'
  import { projectActionHref, projectFetch } from '../lib/project-routes.js'
  import type { ProjectActionModel } from '../lib/types.js'

  let actionModel = $state<ProjectActionModel | null>(null)
  let loaded = $state(false)

  async function load(): Promise<void> {
    try {
      const current = project.detail
      let projectJson: { actionModel?: ProjectActionModel | null } | null = current
        ? { actionModel: current.actionModel ?? null }
        : null
      if (!projectJson) {
        const projectRes = await projectFetch('/api/project?surface=overview&compact=true')
        projectJson = projectRes.ok
          ? await projectRes.json() as typeof projectJson
          : null
      }
      actionModel = projectJson?.actionModel ?? null
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

  const modelPrimary = $derived(actionModel?.primaryAction ?? null)
  const modelSecondaryActions = $derived(actionModel?.secondaryActions ?? [])
  const modelSource = $derived.by<TopSource | null>(() => {
    if (!modelPrimary) return null
    const href = projectActionHref(modelPrimary.href ?? '/overview')
    if (routeOnly(href) === path.value) return null
    return {
      verb: modelPrimary.label ?? 'Open project action',
      why: modelPrimary.detail ?? '',
      button: modelPrimary.buttonLabel ?? 'Open',
      href,
      severity: modelPrimary.tone === 'danger' ? 'high' : modelPrimary.tone === 'warn' ? 'medium' : 'low',
      moreLabel: modelSecondaryActions.length === 1 ? '1 more in Inbox ›' : `${modelSecondaryActions.length} more in Inbox ›`,
      moreHref: projectActionHref('/overview/inbox'),
    }
  })
  const source = $derived(modelSource)
  const tone = $derived<'default' | 'warn'>(
    source?.severity === 'high'
      ? 'warn'
      : source?.severity === 'medium'
        ? 'warn'
        : 'default',
  )
  const moreCount = $derived(modelSecondaryActions.length)

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
          <Eyebrow as="div">Do this next</Eyebrow>
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

  .verb {
    font-size: var(--gh-type-size-panel-title);
    font-weight: var(--gh-type-weight-strong);
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
