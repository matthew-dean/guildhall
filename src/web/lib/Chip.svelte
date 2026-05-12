<!--
  Inline pill/badge. State-signals pair a tone with an explicit label — never
  color alone (per frontend.md a11y rule).
-->
<script lang="ts">
  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'

  interface Props {
    label: string
    tone?: Tone
  }

  let { label, tone = 'neutral' }: Props = $props()
</script>

<span class="chip tone-{tone}">{label}</span>

<style>
  .chip {
    display: inline-block;
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px var(--s-2);
    border-radius: 10px;
    line-height: var(--lh-tight);
  }
  .tone-neutral {
    background: var(--chip-neutral-bg);
    color: var(--chip-neutral-fg);
  }
  .tone-ok,
  .tone-running {
    background: var(--chip-ok-bg);
    color: var(--chip-ok-fg);
  }
  .tone-warn {
    background: var(--chip-warn-bg);
    color: var(--chip-warn-fg);
  }
  .tone-danger {
    background: var(--chip-danger-bg);
    color: var(--chip-danger-fg);
  }
  .tone-accent {
    background: var(--chip-accent-bg);
    color: var(--chip-accent-fg);
  }
</style>
