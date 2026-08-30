<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Icon from '../../lib/Icon.svelte'
  import { formatUserPath } from '../../lib/display-path.js'
  import { taskDisplayKey } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, projectActionHref } from '../../lib/project-routes.js'
  import type { ProjectDetail, ProjectActionTone } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
    activeProjectId?: string | null
    onMigrate?: () => void | Promise<void>
    onStartNextRelease?: () => void
    onRunTask?: (taskId: string) => void | Promise<void>
    busy?: boolean
  }

  type DecisionTone = 'neutral' | 'accent' | 'warn' | 'danger' | 'running'

  let {
    detail,
    activeProjectId = null,
    onMigrate,
    onStartNextRelease,
    onRunTask,
    busy = false,
  }: Props = $props()

  const displayPath = $derived(formatUserPath(detail.path))
  const releaseReadiness = $derived(detail.releaseReadiness ?? null)
  const release = $derived(releaseReadiness?.release ?? releaseReadiness?.scope ?? null)
  const releaseShipped = $derived(release?.state === 'shipped')
  const releaseLabel = $derived(release?.label ?? 'Current scope')
  const releaseTitle = $derived(release?.kind === 'release' ? 'Current release' : 'Current scope')
  const releaseProgress = $derived.by(() => {
    if (releaseShipped) return null
    const counts = releaseReadiness?.releaseCounts
    if (!counts || typeof counts.total !== 'number' || counts.total <= 0) return null
    return `${counts.done} of ${counts.total} complete`
  })

  function decisionTone(tone: ProjectActionTone | string | undefined): DecisionTone {
    if (tone === 'danger' || tone === 'warn' || tone === 'running' || tone === 'accent') return tone
    return 'neutral'
  }

  const nextAction = $derived.by(() => {
    const primary = detail.actionModel?.primaryAction
    if (primary) {
      const migration = primary.code === 'required_migration_pending'
      return {
        label: migration ? 'Project update required' : primary.label ?? 'Open work',
        taskLabel: primary.taskLabel?.trim() || null,
        taskId: primary.taskId?.trim() || null,
        detail: migration ? 'Guildhall needs to update this project before it can run.' : primary.detail ?? '',
        // The shared action model owns the label as well as the destination.
        button: primary.buttonLabel ?? 'Open work',
        href: primary.href ?? '/work',
        tone: decisionTone(primary.tone),
        migration,
        operation: primary.operation,
      }
    }

    // Only pre-action-model responses may use readiness as a compatibility fallback.
    const readiness = detail.actionModel ? null : detail.startReadiness
    if (readiness) {
      const migration = readiness.code === 'required_migration_pending'
      return {
        label: migration ? 'Project update required' : readiness.focusTaskTitle ?? 'Open work',
        taskLabel: null,
        taskId: readiness.focusTaskId?.trim() || null,
        detail: migration ? 'Guildhall needs to update this project before it can run.' : readiness.message ?? '',
        button: migration ? 'Update project' : 'Open work',
        href: readiness.actionHref ?? '/work',
        tone: migration ? 'danger' as DecisionTone : readiness.canStart ? 'accent' as DecisionTone : 'warn' as DecisionTone,
        migration,
        operation: undefined,
      }
    }

    return {
      label: 'Nothing needs your attention',
      taskLabel: null,
      taskId: null,
      detail: 'There is no action waiting on you right now.',
      button: 'View work',
      href: '/work',
      tone: 'neutral' as DecisionTone,
      migration: false,
      operation: undefined,
    }
  })
  const nextActionTaskKey = $derived(nextAction.taskId ? taskDisplayKey(nextAction.taskId, [], activeProjectId) : null)
  const decisionTitle = $derived.by(() => {
    if (releaseShipped) return releaseTitle
    return detail.actionModel?.primaryAction?.ownerHeading ?? 'What needs your attention'
  })
  const actionLabelRepeatsHeading = $derived(nextAction.label === decisionTitle)

  function go(href: string): void {
    nav(projectActionHref(href, activeProjectId), { backgroundPath: path.value })
  }

  function runOrOpen(): void {
    if (nextAction.operation && nextAction.taskId && onRunTask) {
      void onRunTask(nextAction.taskId)
      return
    }
    if (nextAction.migration) {
      void onMigrate?.()
      return
    }
    go(nextAction.href)
  }
</script>

<div class="overview" role="region" aria-label="Project overview">
  <header class="hero">
    <p class="eyebrow">Project</p>
    <h1>{detail.name ?? detail.id ?? 'Project'}</h1>
    {#if displayPath}
      <p class="path">{displayPath}</p>
    {/if}
  </header>

  <Card
    title={decisionTitle}
    titleTag="h2"
    tone={releaseShipped ? 'ok' : nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : 'accent'}
    variant="callout"
    railStrength="strong"
    className="overview-decision-card"
  >
    <div class="decision">
      <div class="decision-copy">
        <p class="decision-milestone">{releaseLabel}</p>
        {#if releaseProgress}
          <p class="decision-progress">{releaseProgress}</p>
        {/if}
        {#if releaseShipped}
          <h2>Shipped</h2>
          <p>This release is complete. There is nothing you need to do here.</p>
        {:else}
          {#if !actionLabelRepeatsHeading}
            <h2>{nextAction.label}</h2>
          {/if}
          {#if nextAction.taskLabel}
            <p class="decision-task" title={nextAction.taskLabel}>
              {#if nextActionTaskKey}<span class="decision-task-key">{nextActionTaskKey}</span>{/if}
              <span class="decision-task-title">{nextAction.taskLabel}</span>
            </p>
          {/if}
          {#if nextAction.detail}
            <p class="decision-detail">{nextAction.detail}</p>
          {/if}
        {/if}
      </div>
      {#if !releaseShipped}
        <div class="decision-actions">
          <Button
            variant={nextAction.tone === 'warn' || nextAction.tone === 'danger' ? 'human' : 'primary'}
            disabled={busy}
            onclick={runOrOpen}
          >
            {#if nextAction.migration}
              <Icon name="refresh-cw" size={16} />
            {/if}
            {nextAction.button}
          </Button>
        </div>
      {:else}
        <div class="decision-actions">
          <Button variant="secondary" onclick={onStartNextRelease}>Start next release</Button>
        </div>
      {/if}
    </div>
  </Card>
</div>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
    max-width: var(--gh-layout-measure-wide);
    padding: var(--s-4) var(--s-4) var(--s-6);
  }

  .hero {
    min-width: 0;
  }

  .eyebrow,
  .decision-milestone {
    margin: 0 0 var(--s-1);
    color: var(--gh-color-text-muted);
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1,
  .decision h2 {
    margin: 0;
    color: var(--gh-color-text-primary);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  h1 {
    font-size: var(--gh-type-size-5);
  }

  .path,
  .decision p {
    margin: var(--s-1) 0 0;
    color: var(--gh-color-text-secondary);
    overflow-wrap: anywhere;
  }

  .decision-task {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    max-inline-size: 100%;
  }

  .decision-task-key {
    flex: none;
    color: var(--gh-color-text-muted);
    font-family: var(--gh-font-mono, ui-monospace, monospace);
    font-size: var(--gh-type-size-1);
  }

  .decision-task-title {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .decision-detail {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .decision-progress {
    color: var(--gh-color-text-muted) !important;
    font-size: var(--gh-type-size-1);
  }

  .decision {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--s-4);
  }

  .decision-copy {
    min-width: 0;
    flex: 1 1 auto;
  }

  .decision h2 {
    font-size: var(--gh-type-size-4);
  }

  .decision-actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  @media (max-width: 760px) {
    .overview {
      padding: var(--s-3) var(--s-3) var(--s-5);
    }

    .decision {
      align-items: stretch;
      flex-direction: column;
    }

    .decision-actions :global(.btn) {
      flex: 1 1 auto;
    }
  }
</style>
