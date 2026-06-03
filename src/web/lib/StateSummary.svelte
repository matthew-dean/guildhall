<script lang="ts">
  import Chip from './Chip.svelte'

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'

  interface Props {
    label: string
    description: string
    tone?: Tone
    showLabel?: boolean
  }

  let { label, description, tone = 'neutral', showLabel = true }: Props = $props()
</script>

<div class="state-summary">
  {#if showLabel}
    <Chip {label} {tone} />
  {/if}
  <p>{description}</p>
</div>

<style>
  .state-summary {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .state-summary p {
    min-width: 0;
    margin: 0;
  }
  @media (max-width: 560px) {
    .state-summary {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--s-1);
    }
  }
</style>
