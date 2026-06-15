<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'default' | 'accent' | 'warn' | 'danger' | 'ok' | 'neutral'
  type RailTone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'
  type RailStrength = 'subtle' | 'strong'

  interface Props {
    as?: 'div' | 'section' | 'article' | 'button' | 'nav'
    tone?: Tone
    className?: string
    railTone?: RailTone | null
    railStrength?: RailStrength
    role?: string
    ariaLabel?: string
    ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false' | null
    interactive?: boolean
    selected?: boolean
    dense?: boolean
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    onclick?: (event: MouseEvent) => void
    onkeydown?: (event: KeyboardEvent) => void
    children?: Snippet
  }

  let {
    as = 'div',
    tone = 'default',
    className = '',
    railTone = null,
    railStrength = 'subtle',
    role,
    ariaLabel,
    ariaCurrent = null,
    interactive = false,
    selected = false,
    dense = false,
    disabled = false,
    type = 'button',
    onclick,
    onkeydown,
    children,
  }: Props = $props()

  const effectiveRailTone = $derived<RailTone | null>(
    railTone ?? (tone === 'default' ? null : tone),
  )
</script>

<svelte:element
  this={as}
  class={[
    'utility-panel',
    `tone-${tone}`,
    effectiveRailTone ? `rail-${effectiveRailTone}` : 'rail-none',
    railStrength === 'strong' ? 'rail-strong' : 'rail-subtle',
    interactive ? 'is-interactive' : '',
    selected ? 'is-selected' : '',
    dense ? 'is-dense' : '',
    disabled ? 'is-disabled' : '',
    className,
  ].filter(Boolean).join(' ')}
  {role}
  aria-label={ariaLabel}
  aria-current={ariaCurrent}
  {...(as === 'button' ? { type, disabled } : {})}
  {onclick}
  {onkeydown}
>
  {@render children?.()}
</svelte:element>

<style>
  .utility-panel {
    --panel-bg:
      linear-gradient(180deg, color-mix(in srgb, white 3%, transparent), color-mix(in srgb, white 1%, transparent)),
      var(--glass-bg);
    --panel-border: color-mix(in srgb, var(--glass-border) 72%, var(--border));
    --panel-shadow:
      0 1px 0 color-mix(in srgb, white 3%, transparent),
      var(--glass-etch);
    --panel-reflect: var(--glass-reflect-violet), var(--glass-reflect-mint);
    --panel-reflect-opacity: 0.2;
    display: grid;
    min-width: 0;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--panel-border);
    border-radius: var(--r-2);
    background: var(--panel-bg);
    box-shadow: var(--panel-shadow);
    color: var(--text);
    position: relative;
    overflow: clip;
  }

  .utility-panel::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    border-top-left-radius: var(--r-2);
    border-bottom-left-radius: var(--r-2);
    background: transparent;
    z-index: 2;
  }

  .utility-panel.rail-none::before { background: transparent; }
  .utility-panel.rail-subtle::before { width: 2px; }
  .utility-panel.rail-strong::before { width: 4px; }
  .utility-panel.rail-neutral::before { background: color-mix(in srgb, var(--glass-border-strong) 72%, var(--border)); }
  .utility-panel.rail-accent::before { background: var(--stripe-accent); }
  .utility-panel.rail-warn::before { background: var(--stripe-warn); }
  .utility-panel.rail-danger::before { background: var(--stripe-danger); }
  .utility-panel.rail-ok::before { background: var(--stripe-ok); }

  .utility-panel.is-dense {
    gap: var(--s-1);
    padding: var(--s-2);
  }

  .utility-panel.tone-neutral {
    --panel-border: color-mix(in srgb, var(--glass-border) 58%, var(--border));
    --panel-shadow:
      0 1px 0 color-mix(in srgb, white 2%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 2%, transparent);
    --panel-reflect-opacity: 0.1;
  }

  .utility-panel.tone-accent {
    --panel-border: color-mix(in srgb, var(--accent) 16%, var(--glass-border));
    --panel-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 28%),
      radial-gradient(circle at 18% 88%, color-mix(in srgb, var(--accent-2) 7%, transparent), transparent 32%),
      var(--glass-reflect-violet);
    --panel-reflect-opacity: 0.28;
  }

  .utility-panel.tone-warn {
    --panel-border: color-mix(in srgb, var(--warn) 18%, var(--glass-border));
    --panel-reflect:
      radial-gradient(circle at 12% 50%, color-mix(in srgb, var(--warn) 16%, transparent), transparent 22%),
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 28%),
      var(--glass-reflect-warn);
    --panel-reflect-opacity: 0.32;
  }

  .utility-panel.tone-danger {
    --panel-border: color-mix(in srgb, var(--danger) 18%, var(--glass-border));
    --panel-reflect:
      radial-gradient(circle at 12% 16%, color-mix(in srgb, var(--danger) 12%, transparent), transparent 24%),
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 4%, transparent), transparent 26%),
      var(--glass-reflect-violet);
    --panel-reflect-opacity: 0.3;
  }

  .utility-panel.tone-ok {
    --panel-border: color-mix(in srgb, var(--accent-2) 18%, var(--glass-border));
    --panel-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent-2) 9%, transparent), transparent 28%),
      radial-gradient(circle at 18% 88%, color-mix(in srgb, var(--accent) 4%, transparent), transparent 32%),
      var(--glass-reflect-mint);
    --panel-reflect-opacity: 0.28;
  }

  .utility-panel::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--panel-reflect);
    opacity: var(--panel-reflect-opacity);
    pointer-events: none;
  }

  .utility-panel.is-selected {
    border-color: color-mix(in srgb, var(--accent) 52%, var(--glass-border));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent),
      var(--panel-shadow);
    --panel-reflect-opacity: 0.34;
  }

  .utility-panel.is-interactive {
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .utility-panel.is-interactive:hover {
    border-color: color-mix(in srgb, var(--accent) 34%, var(--border-strong));
    --panel-reflect-opacity: 0.36;
    box-shadow:
      0 1px 0 color-mix(in srgb, white 4%, transparent),
      0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent),
      var(--glass-etch);
  }

  .utility-panel.is-disabled {
    opacity: 0.56;
    cursor: not-allowed;
  }

  .utility-panel.is-disabled:hover {
    border-color: var(--panel-border);
    box-shadow: var(--panel-shadow);
    --panel-reflect-opacity: 0.2;
  }

  .utility-panel.is-interactive:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 58%, transparent);
    outline-offset: 2px;
  }
</style>
