<script lang="ts">
  import type { FrameCardProps } from './types.js'

  let {
    as = 'section',
    tone = 'default',
    padding = 'default',
    mode = 'operator',
    density = 'comfortable',
    ariaLabel,
    children,
    header,
    footer,
    class: className = '',
    ...restProps
  }: FrameCardProps = $props()
</script>

<svelte:element
  this={as}
  {...restProps}
  class={['gh-frame-card', `tone-${tone}`, `padding-${padding}`, `mode-${mode}`, `density-${density}`, className].filter(Boolean).join(' ')}
  aria-label={ariaLabel}
>
  {#if header}
    <div class="gh-frame-card-header">
      {@render header()}
    </div>
  {/if}

  <div class="gh-frame-card-body">
    {@render children?.()}
  </div>

  {#if footer}
    <div class="gh-frame-card-footer">
      {@render footer()}
    </div>
  {/if}
</svelte:element>

<style>
  .gh-frame-card {
    display: grid;
    gap: var(--gh-space-4);
    min-inline-size: 0;
    padding: var(--gh-layout-frame-padding-default);
    border: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
    border-radius: var(--gh-radius-3);
    background: var(--gh-color-surface-elevated);
    color: var(--gh-color-text-primary);
    container-type: inline-size;
  }

  .gh-frame-card.mode-display {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--gh-color-surface-raised) 88%, white) 0,
      var(--gh-color-surface-elevated) 5.5rem
    );
  }

  .gh-frame-card.padding-compact {
    padding: var(--gh-layout-frame-padding-compact);
  }

  .gh-frame-card.padding-roomy {
    padding: var(--gh-layout-frame-padding-roomy);
  }

  .gh-frame-card:focus-within {
    border-color: var(--gh-color-border-focus);
    box-shadow:
      0 0 0 var(--gh-layout-focus-ring-width) color-mix(in srgb, var(--gh-color-border-focus) 35%, transparent),
      inset 0 0 0 var(--gh-layout-rule-default) color-mix(in srgb, var(--gh-color-border-focus) 40%, transparent);
  }

  .gh-frame-card-header,
  .gh-frame-card-footer {
    min-inline-size: 0;
  }

  .gh-frame-card-footer {
    padding-block-start: var(--gh-space-3);
    border-block-start: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
  }

  .gh-frame-card-body {
    min-inline-size: 0;
  }

  .gh-frame-card.density-compact {
    gap: var(--gh-space-3);
  }

  .gh-frame-card.density-dense {
    gap: var(--gh-space-2);
  }

  .gh-frame-card.density-dense .gh-frame-card-footer {
    padding-block-start: var(--gh-space-2);
  }

  .gh-frame-card.tone-default {
    background: var(--gh-color-surface-elevated);
  }

  .gh-frame-card.tone-info {
    background: linear-gradient(
      180deg,
      var(--gh-color-surface-info-subtle) 0,
      var(--gh-color-surface-elevated) 4.5rem
    );
  }

  .gh-frame-card.tone-accent {
    background: linear-gradient(
      180deg,
      var(--gh-color-surface-accent-subtle) 0,
      var(--gh-color-surface-elevated) 4.5rem
    );
    border-color: var(--gh-color-border-accent);
  }

  .gh-frame-card.tone-ok {
    background: linear-gradient(
      180deg,
      var(--gh-color-surface-ok-subtle) 0,
      var(--gh-color-surface-elevated) 4.5rem
    );
  }

  .gh-frame-card.tone-warn {
    background: linear-gradient(
      180deg,
      var(--gh-color-surface-warn-subtle) 0,
      var(--gh-color-surface-elevated) 4.5rem
    );
  }

  .gh-frame-card.tone-danger {
    background: linear-gradient(
      180deg,
      var(--gh-color-surface-danger-subtle) 0,
      var(--gh-color-surface-elevated) 4.5rem
    );
  }

  @container (min-width: 36rem) {
    .gh-frame-card {
      gap: var(--gh-space-5);
    }
  }
</style>
