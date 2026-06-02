<script lang="ts">
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Markdown from '../../../lib/Markdown.svelte'
  import UtilityPanel from '../../../lib/UtilityPanel.svelte'
  import { project } from '../../../lib/project.svelte.js'

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])
</script>

<SectionHeader
  eyebrow="Settings"
  title="Coordinators"
  description="The project’s routing layer for planning, review, and execution."
  headingTag="h2"
  density="compact"
>
  {#snippet meta()}
    <StatusPill label={coordinators.length > 0 ? `${coordinators.length} defined` : 'none'} tone={coordinators.length > 0 ? 'ok' : 'warn'} />
  {/snippet}
</SectionHeader>

{#if coordinators.length === 0}
  <NoticeBand tone="warn" role="note" label="Coordinators" title="No coordinators yet">
    <p>Run meta-intake to bootstrap routing for this project.</p>
  </NoticeBand>
{:else}
  <FrameCard class="coordinators-card">
    <div class="coord-list">
      {#each coordinators as coordinator, i (coordinator.id ?? coordinator.name ?? i)}
        <UtilityPanel as="section" className="coord" tone="neutral">
          <header class="coord-title">
            <strong>{coordinator.name ?? coordinator.id}</strong>
            {#if coordinator.domain}
              <span class="muted">{coordinator.domain}</span>
            {/if}
          </header>
          {#if coordinator.mandate}
            <Markdown source={coordinator.mandate} />
          {/if}
        </UtilityPanel>
      {/each}
    </div>
  </FrameCard>
{/if}

<style>
  .coord-list {
    display: grid;
    gap: var(--gh-space-3);
  }
  :global(.coord) {
    display: grid;
    gap: var(--gh-space-1);
  }
  .coord-title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: baseline;
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
</style>
