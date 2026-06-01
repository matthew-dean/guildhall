<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon, { type IconName } from './Icon.svelte'

  type Tone = 'neutral' | 'accent' | 'attention' | 'ok' | 'warn' | 'danger'
  type Density = 'regular' | 'compact'

  interface Props {
    tone?: Tone
    icon?: IconName
    density?: Density
    children?: Snippet
    actions?: Snippet
  }

  let {
    tone = 'neutral',
    icon,
    density = 'regular',
    children,
    actions,
  }: Props = $props()
</script>

<div class={`notice-band tone-${tone} density-${density}`.trim()} role="status">
  <div class="notice-band-copy">
    {#if icon}
      <span class="notice-band-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
    {/if}
    <div class="notice-band-body">
      {@render children?.()}
    </div>
  </div>
  {#if actions}
    <div class="notice-band-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .notice-band {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    padding: var(--s-3) var(--s-4);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .density-compact {
    gap: var(--s-3);
    padding: var(--s-1) var(--s-4);
  }
  .notice-band-copy {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  .notice-band-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .notice-band-body {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2);
  }
  .notice-band-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .density-compact .notice-band-actions {
    gap: var(--s-1);
  }
  .notice-band-actions :global(a) {
    color: inherit;
    text-decoration: underline;
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .notice-band-actions :global(button) {
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .tone-neutral {
    background: var(--surface-neutral);
    color: var(--text);
  }
  .tone-accent {
    background: var(--surface-neutral);
    color: var(--text);
    box-shadow: inset 3px 0 0 var(--stripe-accent);
  }
  .tone-accent .notice-band-icon {
    color: var(--accent);
  }
  .tone-attention {
    background: var(--surface-neutral);
    color: var(--text);
    box-shadow: inset 3px 0 0 var(--stripe-warn);
    border-top-color: color-mix(in srgb, var(--warn) 22%, var(--border));
    border-bottom-color: color-mix(in srgb, var(--warn) 22%, var(--border));
  }
  .tone-attention .notice-band-icon,
  .tone-attention .notice-band-actions :global(a),
  .tone-attention .notice-band-actions :global(button) {
    color: var(--warn);
  }
  .tone-ok {
    background: var(--surface-ok);
    color: var(--text);
  }
  .tone-warn {
    background: var(--surface-warn);
    color: var(--warn);
  }
  .tone-danger {
    background: var(--surface-danger);
    color: var(--text);
  }
  @media (max-width: 720px) {
    .notice-band {
      padding: var(--s-2) var(--s-3);
      flex-wrap: wrap;
    }
    .density-compact {
      padding: var(--s-1) var(--s-3);
    }
    .notice-band-actions {
      width: auto;
      justify-content: flex-end;
      margin-left: auto;
    }
  }
</style>
