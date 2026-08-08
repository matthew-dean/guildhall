<script lang="ts">
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert'
  import CheckCircle2 from 'lucide-svelte/icons/check-circle-2'
  import Sparkles from 'lucide-svelte/icons/sparkles'

  import type { AlertBandIcon, AlertBandProps } from './types.js'

  let {
    tone = 'neutral',
    density = 'regular',
    singleLine = false,
    icon,
    role = 'status',
    ariaLabel,
    children,
    actions,
    class: className = '',
    ...restProps
  }: AlertBandProps = $props()

  const resolvedIcon = $derived.by<AlertBandIcon | null>(() => {
    if (icon === false) return null
    if (icon) return icon
    switch (tone) {
      case 'ok':
        return 'check-circle-2'
      case 'accent':
        return 'sparkles'
      case 'attention':
      case 'warn':
      case 'danger':
        return 'alert-triangle'
      default:
        return null
    }
  })
</script>

<div
  {...restProps}
  class={['gh-alert-band', `tone-${tone}`, `density-${density}`, singleLine ? 'single-line' : '', className].filter(Boolean).join(' ')}
  role={role}
  aria-label={ariaLabel}
>
  <div class="gh-alert-band-copy">
    {#if resolvedIcon}
      <span class="gh-alert-band-icon" aria-hidden="true">
        {#if resolvedIcon === 'alert-triangle'}
          <AlertTriangle size={16} strokeWidth={2} />
        {:else if resolvedIcon === 'check-circle-2'}
          <CheckCircle2 size={16} strokeWidth={2} />
        {:else if resolvedIcon === 'sparkles'}
          <Sparkles size={16} strokeWidth={2} />
        {/if}
      </span>
    {/if}
    <div class="gh-alert-band-body">
      {@render children?.()}
    </div>
  </div>
  {#if actions}
    <div class="gh-alert-band-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .gh-alert-band {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-3);
    padding: var(--gh-space-2) var(--gh-space-4);
    border-top: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
    border-inline-start: var(--gh-layout-notice-accent-width) solid transparent;
    border-bottom: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
    background: var(--gh-color-surface-raised);
    color: var(--gh-color-text-primary);
  }

  .gh-alert-band.density-compact {
    gap: var(--gh-space-2);
    padding: var(--gh-space-1) var(--gh-space-3);
  }

  .gh-alert-band-copy {
    min-inline-size: 0;
    display: flex;
    align-items: center;
    gap: var(--gh-space-2);
  }

  .gh-alert-band.single-line .gh-alert-band-copy {
    flex: 1 1 auto;
    overflow: hidden;
  }

  .gh-alert-band-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
  }

  .gh-alert-band-body {
    min-inline-size: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    font-size: var(--gh-type-size-2);
    line-height: var(--gh-type-line-height-control);
  }

  .gh-alert-band.single-line,
  .gh-alert-band.single-line .gh-alert-band-body {
    flex-wrap: nowrap;
  }

  .gh-alert-band.single-line .gh-alert-band-body {
    overflow: hidden;
    white-space: nowrap;
  }

  .gh-alert-band.single-line .gh-alert-band-body :global(strong),
  .gh-alert-band.single-line .gh-alert-band-body :global(span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gh-alert-band-body :global(strong) {
    font-weight: var(--gh-type-weight-strong);
  }

  .gh-alert-band-body :global(strong),
  .gh-alert-band-body :global(span) {
    min-inline-size: 0;
  }

  .gh-alert-band-body :global(strong + span),
  .gh-alert-band-body :global(strong + a),
  .gh-alert-band-body :global(span + span) {
    margin-inline-start: 0.45rem;
  }

  .gh-alert-band-actions :global(.gh-notice-inline-dismiss) {
    text-decoration: none;
    opacity: 0.76;
  }

  .gh-alert-band-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--gh-space-1);
    font-size: var(--gh-type-size-2);
  }

  .gh-alert-band.density-compact .gh-alert-band-actions {
    gap: var(--gh-space-1);
  }

  .gh-alert-band-actions :global(a) {
    display: inline-flex;
    align-items: center;
    color: inherit;
    text-decoration: underline;
    font-size: inherit;
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-control);
  }

  .gh-alert-band-actions :global(button) {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-weight: var(--gh-type-weight-strong);
    cursor: pointer;
    padding: 0;
    line-height: var(--gh-type-line-height-control);
  }

  .gh-alert-band-actions :global(summary) {
    display: inline-flex;
    align-items: center;
    font-size: inherit;
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-control);
  }

  .gh-alert-band.density-compact .gh-alert-band-icon :global(svg) {
    width: 15px;
    height: 15px;
  }

  .gh-alert-band.density-compact .gh-alert-band-body,
  .gh-alert-band.density-compact .gh-alert-band-actions {
    font-size: var(--gh-type-size-1);
  }

  .gh-alert-band.tone-neutral {
    background: var(--gh-color-surface-raised);
    color: var(--gh-color-text-primary);
  }

  .gh-alert-band.tone-accent {
    background: var(--gh-color-surface-raised);
    color: var(--gh-color-text-primary);
    border-inline-start-color: var(--gh-color-feedback-info);
  }

  .gh-alert-band.tone-attention {
    background: var(--gh-color-surface-raised);
    color: var(--gh-color-text-primary);
    border-inline-start-color: var(--gh-color-feedback-warn);
    border-top-color: color-mix(in srgb, var(--gh-color-feedback-warn) 22%, var(--gh-color-border-subtle));
    border-bottom-color: color-mix(in srgb, var(--gh-color-feedback-warn) 22%, var(--gh-color-border-subtle));
  }

  .gh-alert-band.tone-attention .gh-alert-band-icon,
  .gh-alert-band.tone-attention .gh-alert-band-actions :global(a),
  .gh-alert-band.tone-attention .gh-alert-band-actions :global(button) {
    color: var(--gh-color-feedback-warn);
  }

  .gh-alert-band.tone-ok {
    background: var(--gh-color-surface-ok-subtle);
    color: var(--gh-color-text-primary);
  }

  .gh-alert-band.tone-ok .gh-alert-band-icon {
    color: var(--gh-color-feedback-ok);
  }

  .gh-alert-band.tone-warn {
    background: var(--gh-color-surface-warn-subtle);
    color: var(--gh-color-text-primary);
  }

  .gh-alert-band.tone-warn .gh-alert-band-icon,
  .gh-alert-band.tone-warn .gh-alert-band-actions :global(a),
  .gh-alert-band.tone-warn .gh-alert-band-actions :global(button) {
    color: var(--gh-color-feedback-warn);
  }

  .gh-alert-band.tone-danger {
    background: var(--gh-color-surface-danger-subtle);
    color: var(--gh-color-text-primary);
  }

  .gh-alert-band.tone-danger .gh-alert-band-icon,
  .gh-alert-band.tone-danger .gh-alert-band-actions :global(a),
  .gh-alert-band.tone-danger .gh-alert-band-actions :global(button) {
    color: var(--gh-color-feedback-danger);
  }

  @media (max-width: 720px) {
    .gh-alert-band {
      padding: var(--gh-space-2) var(--gh-space-3);
      flex-wrap: wrap;
    }

    .gh-alert-band.density-compact {
      padding: var(--gh-space-1) var(--gh-space-3);
    }

    .gh-alert-band-actions {
      width: auto;
      justify-content: flex-end;
      margin-left: auto;
    }

    .gh-alert-band.single-line {
      flex-wrap: nowrap;
    }
  }
</style>
