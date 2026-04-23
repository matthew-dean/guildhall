<!--
  Status dot. Small circular indicator used for SSE connection state, step
  progress, agent activity, etc. Tone + optional pulse animation convey
  state at a glance without pulling a full Chip.
-->
<script lang="ts">
  type Tone = 'idle' | 'active' | 'ok' | 'warn' | 'danger'
  type Size = 'xs' | 'sm' | 'md'

  interface Props {
    tone?: Tone
    size?: Size
    pulse?: boolean
    ariaLabel?: string
  }

  let { tone = 'idle', size = 'sm', pulse = false, ariaLabel }: Props = $props()
</script>

<span
  class="dot t-{tone} s-{size}"
  class:pulse
  role="status"
  aria-label={ariaLabel}
></span>

<style>
  .dot {
    display: inline-block;
    border-radius: 50%;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .s-xs { width: 6px; height: 6px; }
  .s-sm { width: 8px; height: 8px; }
  .s-md { width: 10px; height: 10px; }

  .t-idle { background: var(--text-muted); }
  .t-active { background: var(--accent-2); }
  .t-ok { background: var(--accent-2); }
  .t-warn { background: var(--warn); }
  .t-danger { background: var(--danger); }

  .pulse {
    animation: sd-pulse 1.6s ease-in-out infinite;
  }
  @keyframes sd-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
</style>
