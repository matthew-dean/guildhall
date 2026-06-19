<script lang="ts">
  import Stack from '../../../lib/Stack.svelte'
  import { projectFetch } from '../../../lib/project-routes.js'
  import type { ProjectOrientationSpine } from '../../../lib/types.js'
  import { createProjectGraphStore } from './project-graph-store.svelte.js'
  import ProjectGraphPanel from './ProjectGraphPanel.svelte'
  import SetupAuditPanel from './SetupAuditPanel.svelte'

  const graphStore = createProjectGraphStore(projectFetch)
  let spine = $state<ProjectOrientationSpine | null>(null)

  $effect(() => {
    projectFetch('/api/project/spine', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        spine = (j?.spine ?? null) as ProjectOrientationSpine | null
      })
      .catch(() => {
        spine = null
      })
  })

  const spineTopBlockerLabel = $derived.by(() => {
    const blocker = spine?.summary?.topBlocker
    if (!blocker) return null
    return typeof blocker === 'string' ? blocker : blocker.label ?? null
  })
  const spineScopeCounts = $derived.by(() => {
    if (!spine?.summary) return ''
    const included = spine.summary.includedWorkCount ?? spine.summary.includedCount ?? 0
    const deferred = spine.summary.deferredWorkCount ?? spine.summary.deferredCount ?? 0
    return `${included} included · ${deferred} later`
  })
</script>

<Stack gap="5">
  {#if spine?.summary?.headline}
    <section class="structure-orientation" aria-label="Project orientation">
      <div class="structure-orientation-copy">
        <span>{spine.summary.selectedScopeLabel ?? spine.selectedTaskScope?.label ?? spine.scope?.label ?? spine.summary.selectedReleaseLabel ?? 'Current task scope'}</span>
        <h2>{spine.summary.headline}</h2>
        <p>{spine.summary.purpose ?? spine.charter?.goal ?? 'Project purpose has not been pinned yet.'}</p>
      </div>
      <div class="structure-orientation-side">
        {#if spineScopeCounts}
          <span>{spineScopeCounts}</span>
        {/if}
        {#if spineTopBlockerLabel}
          <span>Top blocker: {spineTopBlockerLabel}</span>
        {/if}
        {#if spine.roots?.[0]}
          <strong>{spine.roots[0].title}</strong>
        {/if}
      </div>
    </section>
  {/if}
  <ProjectGraphPanel store={graphStore} />
  <SetupAuditPanel />
</Stack>

<style>
  .structure-orientation {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, max-content);
    gap: var(--gh-space-4);
    align-items: start;
    padding: var(--gh-space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-raised);
    min-width: 0;
  }

  .structure-orientation-copy,
  .structure-orientation-side {
    display: grid;
    gap: var(--gh-space-1);
    min-width: 0;
  }

  .structure-orientation-copy span,
  .structure-orientation-copy p,
  .structure-orientation-side span {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .structure-orientation h2 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
    overflow-wrap: anywhere;
  }

  .structure-orientation-side strong {
    color: var(--text);
    font-size: var(--gh-type-size-body);
    overflow-wrap: anywhere;
  }

  @media (max-width: 720px) {
    .structure-orientation {
      grid-template-columns: 1fr;
    }
  }
</style>
