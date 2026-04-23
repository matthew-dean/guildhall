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
    background: rgba(136, 136, 153, 0.12);
    color: var(--text-muted);
  }
  .tone-ok,
  .tone-running {
    background: rgba(78, 204, 163, 0.15);
    color: var(--accent-2);
  }
  .tone-warn {
    background: rgba(212, 162, 60, 0.15);
    color: var(--warn);
  }
  .tone-danger {
    background: rgba(224, 82, 82, 0.15);
    color: var(--danger);
  }
  .tone-accent {
    background: rgba(124, 109, 240, 0.15);
    color: var(--accent);
  }
</style>
