<script lang="ts">
  type Tone = 'running' | 'stopped' | 'ok' | 'warn' | 'idle'

  interface Props {
    tone?: Tone
    pulse?: boolean
  }

  let { tone = 'running', pulse = false }: Props = $props()
</script>

<span class="status-light tone-{tone}" class:pulse aria-hidden="true"></span>

<style>
  .status-light {
    --light: var(--accent);
    --light-shadow: color-mix(in srgb, var(--light) 20%, transparent);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--light);
    box-shadow: 0 0 0 3px var(--light-shadow);
    display: inline-block;
    flex: 0 0 auto;
  }
  .tone-running {
    --light: var(--warn, #d0a146);
  }
  .tone-stopped {
    --light: var(--danger);
  }
  .tone-ok {
    --light: var(--accent-2);
  }
  .tone-warn {
    --light: var(--warn, #d0a146);
  }
  .tone-idle {
    --light: var(--text-muted);
  }
  .pulse {
    animation: status-light-pulse 1.8s ease-in-out infinite;
  }
  @keyframes status-light-pulse {
    0%, 100% {
      box-shadow: 0 0 0 3px var(--light-shadow);
      opacity: 0.75;
      transform: scale(0.95);
    }
    45% {
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--light) 10%, transparent);
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
