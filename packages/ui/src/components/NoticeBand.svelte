<script lang="ts">
  import type { NoticeBandProps } from './types.js'

  let {
    tone = 'neutral',
    role = 'note',
    mode = 'operator',
    density = 'comfortable',
    headingTag = 'h2',
    title,
    label,
    ariaLabel,
    children,
    actions,
    class: className = '',
    ...restProps
  }: NoticeBandProps = $props()
</script>

<section
  {...restProps}
  class={['gh-notice-band', `tone-${tone}`, `mode-${mode}`, `density-${density}`, className].filter(Boolean).join(' ')}
  role={role}
  aria-label={ariaLabel}
>
  <div class="gh-notice-copy">
    {#if label || title}
      <header class="gh-notice-head">
        {#if label}
          <span class="gh-notice-label">{label}</span>
        {/if}
        {#if title}
          <svelte:element this={headingTag} class="gh-notice-title">{title}</svelte:element>
        {/if}
      </header>
    {/if}

    {#if children}
      <div class="gh-notice-body">
        {@render children()}
      </div>
    {/if}
  </div>

  {#if actions}
    <div class="gh-notice-actions">
      {@render actions()}
    </div>
  {/if}
</section>

<style>
  .gh-notice-band {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gh-space-4);
    min-inline-size: 0;
    padding: var(--gh-space-4);
    border: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
    border-inline-start-width: var(--gh-layout-notice-accent-width);
    border-radius: var(--gh-radius-3);
    background: var(--gh-color-surface-raised);
    color: var(--gh-color-text-primary);
    container-type: inline-size;
  }

  .gh-notice-band.mode-display {
    padding: var(--gh-space-5);
  }

  .gh-notice-band.mode-operator {
    background: var(--gh-color-surface-raised);
  }

  .gh-notice-band:focus-within {
    border-color: var(--gh-color-border-focus);
    box-shadow: 0 0 0 var(--gh-layout-focus-ring-width) color-mix(in srgb, var(--gh-color-border-focus) 30%, transparent);
  }

  .gh-notice-copy,
  .gh-notice-actions,
  .gh-notice-body {
    min-inline-size: 0;
  }

  .gh-notice-head {
    display: grid;
    gap: var(--gh-space-2);
  }

  .gh-notice-label {
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    color: var(--gh-color-text-secondary);
  }

  .gh-notice-title {
    margin: 0;
    font-size: var(--gh-type-size-4);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    text-wrap: balance;
  }

  .gh-notice-body {
    display: grid;
    gap: var(--gh-space-3);
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-3);
    line-height: var(--gh-type-line-height-body);
    max-inline-size: var(--gh-layout-measure-comfortable);
  }

  .gh-notice-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--gh-space-2);
  }

  .gh-notice-band.density-compact {
    gap: var(--gh-space-3);
    padding: var(--gh-space-3);
  }

  .gh-notice-band.density-compact .gh-notice-head,
  .gh-notice-band.density-compact .gh-notice-body {
    gap: var(--gh-space-2);
  }

  .gh-notice-band.density-compact .gh-notice-body {
    font-size: var(--gh-type-size-2);
  }

  .gh-notice-band.density-dense {
    gap: var(--gh-space-2);
    padding: var(--gh-space-3);
  }

  .gh-notice-band.density-dense .gh-notice-label {
    font-size: var(--gh-type-size-0);
  }

  .gh-notice-band.density-dense .gh-notice-title {
    font-size: var(--gh-type-size-3);
  }

  .gh-notice-band.density-dense .gh-notice-body {
    gap: var(--gh-space-2);
    font-size: var(--gh-type-size-2);
  }

  .gh-notice-band.tone-neutral {
    border-inline-start-color: var(--gh-color-feedback-neutral);
    background: linear-gradient(180deg, var(--gh-color-surface-sunken) 0, var(--gh-color-surface-raised) 4rem);
  }

  .gh-notice-band.tone-info {
    border-inline-start-color: var(--gh-color-feedback-info);
    background: linear-gradient(180deg, var(--gh-color-surface-info-subtle) 0, var(--gh-color-surface-raised) 4rem);
  }

  .gh-notice-band.tone-ok {
    border-inline-start-color: var(--gh-color-feedback-ok);
    background: linear-gradient(180deg, var(--gh-color-surface-ok-subtle) 0, var(--gh-color-surface-raised) 4rem);
  }

  .gh-notice-band.tone-warn {
    border-inline-start-color: var(--gh-color-feedback-warn);
    background: linear-gradient(180deg, var(--gh-color-surface-warn-subtle) 0, var(--gh-color-surface-raised) 4rem);
  }

  .gh-notice-band.tone-danger {
    border-inline-start-color: var(--gh-color-feedback-danger);
    background: linear-gradient(180deg, var(--gh-color-surface-danger-subtle) 0, var(--gh-color-surface-raised) 4rem);
  }

  @container (min-width: 34rem) {
    .gh-notice-band {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
    }
  }
</style>
