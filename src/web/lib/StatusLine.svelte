<script lang="ts">
  import StatusLight from './StatusLight.svelte'

  type Tone = 'neutral' | 'running' | 'ok' | 'warn' | 'danger'

  interface Props {
    label: string
    detail?: string | undefined
    time?: string | null | undefined
    tone?: Tone
    pulse?: boolean
    loud?: boolean
  }

  let {
    label,
    detail,
    time,
    tone = 'neutral',
    pulse = false,
    loud = false,
  }: Props = $props()

  function lightTone(value: Tone): 'running' | 'stopped' | 'ok' | 'warn' | 'idle' {
    if (value === 'danger') return 'stopped'
    if (value === 'neutral') return 'idle'
    return value
  }
</script>

<div class="status-line tone-{tone}" class:loud>
  <StatusLight tone={lightTone(tone)} {pulse} />
  <div class="status-copy">
    <span class="status-label">{label}</span>
    {#if detail}
      <span class="status-detail">{detail}</span>
    {/if}
  </div>
  {#if time}
    <span class="status-time">{time}</span>
  {/if}
</div>

<style>
  .status-line {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-tight);
    min-height: var(--control-h);
  }
  .status-line.loud {
    width: fit-content;
    color: var(--warn);
  }
  .status-line.tone-danger {
    color: var(--danger);
  }
  .status-copy {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .status-label {
    color: var(--text);
  }
  .status-line.loud .status-label {
    color: inherit;
  }
  .status-detail {
    color: inherit;
    line-height: var(--lh-body);
    overflow-wrap: anywhere;
  }
  .status-time {
    align-self: center;
    color: var(--text-muted);
    white-space: nowrap;
  }
</style>
