<script lang="ts">
  import type { StatusPillProps } from './types.js'

  let {
    label,
    tone = 'neutral',
    mode = 'operator',
    density = 'compact',
    emphasis = 'quiet',
    class: className = '',
    ...restProps
  }: StatusPillProps = $props()
</script>

<span
  {...restProps}
  class={['gh-status-pill', `tone-${tone}`, `mode-${mode}`, `density-${density}`, `emphasis-${emphasis}`, className].filter(Boolean).join(' ')}
>{label}</span>

<style>
  .gh-status-pill {
    display: inline-flex;
    align-items: center;
    min-inline-size: 0;
    min-block-size: var(--gh-control-height-default);
    padding-inline: var(--gh-control-padding-inline);
    padding-block: var(--gh-control-padding-block);
    border: var(--gh-layout-rule-default) solid transparent;
    border-radius: var(--gh-radius-full);
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    line-height: 1;
    white-space: nowrap;
  }

  .gh-status-pill.mode-display {
    min-block-size: var(--gh-control-height-tall);
    padding-inline: calc(var(--gh-control-padding-inline) + var(--gh-space-1));
  }

  .gh-status-pill.density-comfortable {
    min-block-size: var(--gh-control-height-tall);
  }

  .gh-status-pill.density-dense {
    min-block-size: 22px;
    padding-inline: var(--gh-space-2);
    font-size: var(--gh-type-size-0);
  }

  .gh-status-pill.emphasis-quiet.tone-neutral {
    background: color-mix(in srgb, var(--gh-color-feedback-neutral) 48%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-neutral) 42%, var(--gh-color-border-subtle));
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-quiet.tone-info {
    background: color-mix(in srgb, var(--gh-color-feedback-info) 30%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-info) 44%, var(--gh-color-border-subtle));
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-quiet.tone-ok {
    background: color-mix(in srgb, var(--gh-color-feedback-ok) 30%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-ok) 42%, var(--gh-color-border-subtle));
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-quiet.tone-warn {
    background: color-mix(in srgb, var(--gh-color-feedback-warn) 34%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-warn) 46%, var(--gh-color-border-subtle));
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-quiet.tone-danger {
    background: color-mix(in srgb, var(--gh-color-feedback-danger) 30%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-danger) 44%, var(--gh-color-border-subtle));
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-quiet.tone-accent {
    background: color-mix(in srgb, var(--gh-color-feedback-accent) 32%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-accent) 46%, var(--gh-color-border-subtle));
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-default.tone-neutral {
    background: color-mix(in srgb, var(--gh-color-feedback-neutral) 28%, transparent);
    border-color: color-mix(in srgb, var(--gh-color-feedback-neutral) 45%, transparent);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-default.tone-info {
    background: color-mix(in srgb, var(--gh-color-feedback-info) 18%, transparent);
    border-color: color-mix(in srgb, var(--gh-color-feedback-info) 38%, transparent);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-default.tone-ok {
    background: color-mix(in srgb, var(--gh-color-feedback-ok) 18%, transparent);
    border-color: color-mix(in srgb, var(--gh-color-feedback-ok) 38%, transparent);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-default.tone-warn {
    background: color-mix(in srgb, var(--gh-color-feedback-warn) 18%, transparent);
    border-color: color-mix(in srgb, var(--gh-color-feedback-warn) 42%, transparent);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-default.tone-danger {
    background: color-mix(in srgb, var(--gh-color-feedback-danger) 18%, transparent);
    border-color: color-mix(in srgb, var(--gh-color-feedback-danger) 42%, transparent);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-default.tone-accent {
    background: color-mix(in srgb, var(--gh-color-feedback-accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--gh-color-feedback-accent) 42%, transparent);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-strong.tone-neutral {
    background: var(--gh-color-feedback-neutral);
    border-color: color-mix(in srgb, var(--gh-color-feedback-neutral) 85%, white);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-strong.tone-info {
    background: color-mix(in srgb, var(--gh-color-feedback-info) 28%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-info) 50%, black);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-strong.tone-ok {
    background: color-mix(in srgb, var(--gh-color-feedback-ok) 28%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-ok) 45%, black);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-strong.tone-warn {
    background: color-mix(in srgb, var(--gh-color-feedback-warn) 28%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-warn) 50%, black);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-strong.tone-danger {
    background: color-mix(in srgb, var(--gh-color-feedback-danger) 28%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-danger) 50%, black);
    color: var(--gh-color-text-primary);
  }

  .gh-status-pill.emphasis-strong.tone-accent {
    background: color-mix(in srgb, var(--gh-color-feedback-accent) 32%, var(--gh-color-surface-elevated));
    border-color: color-mix(in srgb, var(--gh-color-feedback-accent) 55%, black);
    color: var(--gh-color-text-primary);
  }
</style>
