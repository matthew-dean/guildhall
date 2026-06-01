<script lang="ts">
  import type { SectionHeaderProps } from './types.js'

  let {
    title,
    description,
    eyebrow,
    headingTag = 'h2',
    align = 'start',
    metaPlacement = 'edge',
    mode = 'operator',
    density = 'comfortable',
    titleRole = 'title',
    descriptionRole = 'body',
    meta,
    actions,
    class: className = '',
    ...restProps
  }: SectionHeaderProps = $props()
</script>

<header
  {...restProps}
  class={['gh-section-header', `align-${align}`, `meta-${metaPlacement}`, `mode-${mode}`, `density-${density}`, className].filter(Boolean).join(' ')}
>
  <div class="gh-section-header-copy">
    {#if eyebrow}
      <p class="gh-section-header-eyebrow">{eyebrow}</p>
    {/if}

    <div class="gh-section-header-title-row">
      <svelte:element this={headingTag} class={`gh-section-header-title role-${titleRole}`}>{title}</svelte:element>

      {#if meta && metaPlacement === 'inline'}
        <div class="gh-section-header-meta">
          {@render meta()}
        </div>
      {/if}
    </div>

    {#if description}
      <p class={`gh-section-header-description role-${descriptionRole}`}>{description}</p>
    {/if}
  </div>

  {#if meta && metaPlacement === 'edge'}
    <div class="gh-section-header-meta gh-section-header-meta-edge">
      {@render meta()}
    </div>
  {/if}

  {#if actions}
    <div class="gh-section-header-actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .gh-section-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gh-space-4);
    min-inline-size: 0;
    container-type: inline-size;
  }

  .gh-section-header.align-center {
    text-align: center;
    justify-items: center;
  }

  .gh-section-header.mode-display {
    gap: var(--gh-space-5);
  }

  .gh-section-header-copy {
    display: grid;
    gap: var(--gh-space-2);
    min-inline-size: 0;
    max-inline-size: var(--gh-layout-measure-comfortable);
  }

  .gh-section-header.mode-operator .gh-section-header-copy {
    max-inline-size: var(--gh-layout-measure-compact);
  }

  .gh-section-header-title-row {
    display: grid;
    gap: var(--gh-space-2);
    align-items: start;
    min-inline-size: 0;
  }

  .gh-section-header-eyebrow {
    margin: 0;
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    text-transform: uppercase;
  }

  .gh-section-header-title {
    margin: 0;
    color: var(--gh-color-text-primary);
    font-size: var(--gh-type-size-5);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    text-wrap: balance;
  }

  .gh-section-header-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gh-space-2);
    color: var(--gh-color-text-secondary);
  }

  .gh-section-header-meta-edge {
    justify-content: flex-start;
  }

  .gh-section-header-description {
    margin: 0;
    max-inline-size: var(--gh-layout-measure-comfortable);
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-3);
    line-height: var(--gh-type-line-height-relaxed);
    text-wrap: pretty;
  }

  .gh-section-header-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--gh-space-2);
  }

  .gh-section-header.density-compact {
    gap: var(--gh-space-3);
  }

  .gh-section-header.density-compact .gh-section-header-copy,
  .gh-section-header.density-compact .gh-section-header-title-row {
    gap: var(--gh-space-1);
  }

  .gh-section-header.density-compact .gh-section-header-title {
    font-size: var(--gh-type-size-4);
  }

  .gh-section-header.density-compact .gh-section-header-description {
    font-size: var(--gh-type-size-2);
    line-height: var(--gh-type-line-height-body);
  }

  .gh-section-header.density-dense {
    gap: var(--gh-space-2);
  }

  .gh-section-header.density-dense .gh-section-header-copy,
  .gh-section-header.density-dense .gh-section-header-title-row {
    gap: var(--gh-space-1);
  }

  .gh-section-header.density-dense .gh-section-header-eyebrow {
    font-size: var(--gh-type-size-0);
  }

  .gh-section-header.density-dense .gh-section-header-title {
    font-size: var(--gh-type-size-3);
  }

  .gh-section-header.density-dense .gh-section-header-description,
  .gh-section-header.density-dense .gh-section-header-meta {
    font-size: var(--gh-type-size-2);
  }

  .gh-section-header.align-center .gh-section-header-actions {
    justify-content: center;
  }

  @container (min-width: 38rem) {
    .gh-section-header.align-start {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }

    .gh-section-header.align-start .gh-section-header-title-row {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }

    .gh-section-header.align-start.meta-edge {
      align-items: start;
    }

    .gh-section-header.align-start.meta-edge .gh-section-header-meta-edge {
      justify-content: flex-end;
      align-self: start;
    }
  }

  @container (min-width: 42rem) {
    .gh-section-header.mode-display .gh-section-header-title {
      font-size: var(--gh-type-size-6);
    }
  }
</style>
