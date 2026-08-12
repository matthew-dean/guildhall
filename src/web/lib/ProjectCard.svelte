<script lang="ts">
  import Activity from 'lucide-svelte/icons/activity'
  import FolderOpen from 'lucide-svelte/icons/folder-open'
  import PauseCircle from 'lucide-svelte/icons/circle-pause'
  import Sparkles from 'lucide-svelte/icons/sparkles'
  import ActionBar from './ActionBar.svelte'
  import Button from './Button.svelte'
  import Card from './ui-compat/Card.svelte'
  import Chip from './Chip.svelte'
  import Skeleton from '../../../packages/ui/src/components/Skeleton.svelte'
  import type { ProjectCardSummary } from './project-summary.js'

  interface Props {
    summary: ProjectCardSummary
    busy?: boolean
    optimisticRunning?: boolean
    onOpen?: (id: string, href?: string | null) => void
    onStart?: (id: string) => void
    onStop?: (id: string) => void
  }

  let {
    summary,
    busy = false,
    optimisticRunning = false,
    onOpen,
    onStart,
    onStop,
  }: Props = $props()

  const effectiveRunning = $derived(summary.canStop || optimisticRunning)

  const displayStatusLabel = $derived(optimisticRunning ? 'Starting' : summary.statusLabel)
  const statusTitle = $derived(summary.projectCheckIn?.needed
    ? summary.projectCheckIn.detail ?? 'Answer the first project questions so current project context can be used.'
    : `Project status: ${displayStatusLabel}`)
  const statusTone = $derived(
    effectiveRunning
      ? 'running'
      : summary.tone === 'warn'
        ? 'warn'
        : summary.tone === 'success'
          ? 'ok'
          : 'neutral',
  )

  const openTitle = $derived(`${summary.actionLabel}: ${summary.name}`)
</script>

<Card
  className={`project-card ${effectiveRunning ? 'project-card-running' : ''} ${summary.statusLoading ? 'project-card-loading' : ''}`.trim()}
  tone={summary.tone === 'warn' ? 'warn' : effectiveRunning ? 'ok' : summary.tone === 'success' ? 'accent' : 'default'}
>
  {#snippet actions()}
    <div class="top-chips" aria-label="Project status">
      <Chip label={displayStatusLabel} tone={statusTone} title={statusTitle} />
    </div>
  {/snippet}

  <div class="card-layout">
    <div class="stack">
      <div class="title-block">
        <h3>{summary.name}</h3>
        <p class="path">{summary.path}</p>
      </div>

      {#if summary.statusLoading}
        <div class="loading-state" role="status" aria-label={`Still loading project state for ${summary.name}`}>
          <span class="loading-copy">Still loading project state</span>
          <span class="loading-skeletons" aria-hidden="true">
            <Skeleton width="100%" height="0.42rem" />
            <Skeleton width="72%" height="0.42rem" />
            <Skeleton width="42%" height="0.42rem" />
          </span>
        </div>
      {:else}
        <p class="activity">
          <Activity size={14} />
          <span>{summary.activityLabel}</span>
        </p>
      {/if}

    </div>
    <ActionBar className="project-card-actions">
      <Button variant="secondary" size="sm" disabled={busy || !summary.canOpen} title={openTitle} onclick={() => onOpen?.(summary.id, summary.openHref)}>
        <FolderOpen size={14} />
        {summary.actionLabel}
      </Button>
      {#if summary.canStart && !effectiveRunning}
        <Button variant="agent" size="sm" disabled={busy} title={`${summary.runActionLabel}: let Guildhall advance ${summary.name}`} onclick={() => onStart?.(summary.id)}>
          <Sparkles size={14} />
          {summary.runActionLabel}
        </Button>
      {:else if effectiveRunning}
        <Button variant="secondary" size="sm" disabled={busy} title={`Pause Guildhall on ${summary.name}`} onclick={() => onStop?.(summary.id)}>
          <PauseCircle size={14} />
          Pause
        </Button>
      {/if}
    </ActionBar>
  </div>
</Card>

<style>
  :global(section.project-card) {
    min-height: 8.5rem;
    display: flex;
    flex-direction: column;
    padding: var(--s-2);
    border-radius: var(--r-2);
    border-color: color-mix(in srgb, var(--glass-border-strong) 78%, var(--border));
    --card-reflect:
      radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 28%),
      radial-gradient(circle at 92% 24%, color-mix(in srgb, var(--accent-2) 10%, transparent), transparent 30%);
    box-shadow:
      0 16px 34px color-mix(in srgb, var(--bg-base) 56%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent),
      var(--glass-etch);
  }
  :global(section.project-card.project-card-running) {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--accent-2) 26%, transparent),
      var(--light-emitted-agent),
      var(--glass-shadow);
  }
  :global(section.project-card.project-card-loading) {
    border-color: color-mix(in srgb, var(--accent) 32%, var(--glass-border-strong));
  }
  :global(section.project-card .card-head) {
    margin-bottom: var(--s-2);
  }
  :global(section.project-card .card-body) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .card-layout {
    width: 100%;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--gh-type-size-section-title);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .top-chips {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    flex: 1 1 auto;
    min-width: 0;
  }
  .title-block {
    min-width: 0;
  }
  .path {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .loading-state {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(4.5rem, 1fr);
    gap: var(--s-2);
    align-items: center;
    min-height: 1.35rem;
    padding: 0.24rem 0.36rem;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--glass-bg-strong) 72%, var(--bg-raised));
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
  }
  .loading-copy {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .loading-skeletons {
    display: grid;
    grid-template-columns: 1fr 0.72fr 0.42fr;
    gap: 0.24rem;
    min-width: 0;
  }
  .activity {
    margin: 0;
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
  }
  .activity :global(svg) {
    color: var(--accent-2);
    flex: none;
  }
  :global(.project-card-actions) {
    width: 100%;
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid color-mix(in srgb, var(--glass-border) 76%, transparent);
  }
</style>
