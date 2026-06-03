<script lang="ts">
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../../lib/Button.svelte'
  import Row from '../../../lib/Row.svelte'
  import Stack from '../../../lib/Stack.svelte'
  import UtilityPanel from '../../../lib/UtilityPanel.svelte'
  import { nav } from '../../../lib/nav.svelte.js'
  import { project } from '../../../lib/project.svelte.js'
  import { projectActionHref } from '../../../lib/project-routes.js'
  import type { ProjectGraphStore } from './project-graph-store.svelte.js'

  interface Props {
    store?: ProjectGraphStore
  }

  let { store }: Props = $props()

  const review = $derived(project.detail?.structuralMapReview ?? null)
  const domains = $derived([...(review?.domains ?? []), ...(review?.crossCuttingDomains ?? [])])
  const graphDomainCount = $derived(store?.structuralDomains().length ?? 0)
  const conflicts = $derived(review?.conflicts ?? [])
  const ignoredGitRoots = $derived(review?.ignoredGitRoots ?? [])
  const state = $derived(review?.state ?? 'missing')
  const stateTone = $derived(state === 'accepted' ? 'ok' : state === 'draft' ? 'warn' : 'neutral')
  const legacyStateLabel = $derived(state === 'missing' ? 'legacy map missing' : state)
</script>

<SectionHeader
  eyebrow="Structure"
  title="Structural map"
  description="Review the package, domain, executable, and Git authority map before it becomes routing truth."
  headingTag="h2"
  density="compact"
>
  {#snippet meta()}
    <StatusPill label={legacyStateLabel} tone={stateTone} />
    {#if review}
      <StatusPill label={`${domains.length} legacy map domain${domains.length === 1 ? '' : 's'}`} tone={domains.length > 0 ? 'ok' : 'neutral'} />
    {/if}
  {/snippet}
</SectionHeader>

<FrameCard class="structure-card" density="compact">
  {#snippet header()}
    <SectionHeader title="Review status" description="Thread owns the discussion. This panel keeps the detected map visible." headingTag="h3" density="dense" />
  {/snippet}

  {#if !review}
    <NoticeBand tone="neutral" role="note" label="Legacy structural map" title="Legacy structural map missing" density="compact">
      <p>
        {graphDomainCount > 0
          ? 'Project graph domains are still available below.'
          : 'Run structural intake or answer the current Thread prompt before assigning project responsibilities.'}
      </p>
      {#snippet actions()}
        <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/thread'))}>Open Threads</Button>
      {/snippet}
    </NoticeBand>
  {:else}
    <Stack gap="3">
      <Row justify="between" align="center" gap="3" wrap>
        <p class="muted">
          {state === 'accepted'
            ? 'This structural map is accepted and can be used for project routing.'
            : 'Review the proposed map in Thread before using it as routing truth.'}
        </p>
        <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/thread'))}>Open Threads</Button>
      </Row>

      {#if domains.length}
        <div class="structure-list" aria-label="Structural domains">
          {#each domains as domain (domain.id ?? domain.label)}
            <UtilityPanel as="article" className="structure-row" tone="neutral">
              <strong>{domain.label ?? domain.id}</strong>
              {#if domain.path}
                <span>{domain.path}</span>
              {/if}
            </UtilityPanel>
          {/each}
        </div>
      {/if}

      {#if conflicts.length}
        <NoticeBand tone="warn" role="note" label="Conflicts" title={`${conflicts.length} map conflict${conflicts.length === 1 ? '' : 's'}`} density="compact">
          <ul class="mini-list">
            {#each conflicts.slice(0, 4) as conflict, i (`conflict-${i}`)}
              <li>{conflict.summary ?? conflict.reason ?? conflict.id ?? 'Structural map conflict'}</li>
            {/each}
          </ul>
        </NoticeBand>
      {/if}

      {#if ignoredGitRoots.length}
        <NoticeBand tone="neutral" role="note" label="Git roots" title="Ignored vendored Git roots" density="compact">
          <ul class="mini-list">
            {#each ignoredGitRoots.slice(0, 4) as root, i (`root-${i}`)}
              <li>{root.path ?? root}</li>
            {/each}
          </ul>
        </NoticeBand>
      {/if}
    </Stack>
  {/if}
</FrameCard>

<style>
  .muted,
  .mini-list {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .structure-list {
    display: grid;
    gap: var(--gh-space-2);
  }
  :global(.structure-row) {
    display: grid;
    gap: var(--gh-space-1);
  }
  :global(.structure-row) span {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--gh-type-size-meta);
  }
  .mini-list {
    margin: 0;
    padding-inline-start: var(--gh-space-4);
  }
</style>
