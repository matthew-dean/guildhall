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
    --frame-bg:
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), color-mix(in srgb, white 1%, transparent)),
      var(--glass-bg, linear-gradient(
        180deg,
        color-mix(in srgb, var(--gh-color-surface-raised-alt) 30%, var(--gh-color-surface-elevated)) 0,
        var(--gh-color-surface-elevated) 100%
      ));
    --frame-border: var(--glass-border, color-mix(in srgb, var(--gh-color-border-subtle) 72%, transparent));
    --frame-shadow:
      var(--glass-shadow, 0 16px 32px color-mix(in srgb, black 18%, transparent)),
      var(--glass-etch, inset 0 1px 0 color-mix(in srgb, white 4%, transparent));
    --frame-reflect:
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), transparent 20%),
      radial-gradient(circle at 50% -8%, color-mix(in srgb, white 3%, transparent), transparent 46%);
    --frame-reflect-opacity: 0.18;
    display: grid;
    gap: var(--gh-space-4);
    min-inline-size: 0;
    padding: var(--gh-layout-frame-padding-default);
    border: var(--gh-layout-rule-default) solid var(--frame-border);
    border-radius: var(--gh-radius-3);
    background: var(--frame-bg);
    color: var(--gh-color-text-primary);
    container-type: inline-size;
    box-shadow: var(--frame-shadow);
    position: relative;
    overflow: clip;
    backdrop-filter: var(--glass-blur, blur(18px) saturate(135%));
    -webkit-backdrop-filter: var(--glass-blur, blur(18px) saturate(135%));
  }

  .gh-frame-card.mode-display {
    --frame-reflect-opacity: 0.48;
    --frame-reflect:
      radial-gradient(circle at 82% 20%, color-mix(in srgb, var(--gh-color-surface-accent-subtle) 55%, transparent), transparent 28%),
      var(--glass-reflect-violet, radial-gradient(circle at 84% 18%, color-mix(in srgb, white 5%, transparent), transparent 26%));
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

  .gh-frame-card::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--frame-reflect);
    opacity: var(--frame-reflect-opacity);
    pointer-events: none;
  }

  .gh-frame-card-header,
  .gh-frame-card-footer {
    min-inline-size: 0;
    position: relative;
    z-index: 1;
  }

  .gh-frame-card-footer {
    padding-block-start: var(--gh-space-3);
    border-block-start: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
  }

  .gh-frame-card-body {
    min-inline-size: 0;
    position: relative;
    z-index: 1;
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
    --frame-reflect-opacity: 0.14;
  }

  .gh-frame-card.tone-info {
    --frame-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--gh-color-feedback-info) 20%, transparent), transparent 28%),
      var(--glass-reflect-violet, radial-gradient(circle at 84% 18%, color-mix(in srgb, white 5%, transparent), transparent 26%));
  }

  .gh-frame-card.tone-accent {
    --frame-border: color-mix(in srgb, var(--gh-color-border-accent) 70%, var(--frame-border));
    --frame-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--gh-color-surface-accent-subtle) 70%, transparent), transparent 28%),
      var(--glass-reflect-violet, radial-gradient(circle at 84% 18%, color-mix(in srgb, white 5%, transparent), transparent 26%));
    --frame-reflect-opacity: 0.46;
  }

  .gh-frame-card.tone-ok {
    --frame-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--gh-color-surface-ok-subtle) 68%, transparent), transparent 26%),
      var(--glass-reflect-mint, radial-gradient(circle at 18% 88%, color-mix(in srgb, white 3%, transparent), transparent 30%));
  }

  .gh-frame-card.tone-warn {
    --frame-reflect:
      radial-gradient(circle at 12% 48%, color-mix(in srgb, var(--gh-color-surface-warn-subtle) 72%, transparent), transparent 22%),
      var(--glass-reflect-warn, radial-gradient(circle at 12% 50%, color-mix(in srgb, white 4%, transparent), transparent 24%));
    --frame-reflect-opacity: 0.42;
  }

  .gh-frame-card.tone-danger {
    --frame-reflect:
      radial-gradient(circle at 12% 16%, color-mix(in srgb, var(--gh-color-surface-danger-subtle) 74%, transparent), transparent 24%),
      var(--glass-reflect-violet, radial-gradient(circle at 84% 18%, color-mix(in srgb, white 5%, transparent), transparent 26%));
    --frame-reflect-opacity: 0.42;
  }

  @container (min-width: 36rem) {
    .gh-frame-card {
      gap: var(--gh-space-5);
    }
  }
</style>
