<script lang="ts">
  import Button from './Button.svelte'

  type SegmentOption = {
    value: string
    label: string
  }

  interface Props {
    label: string
    ariaLabel: string
    value: string
    options: SegmentOption[]
    onChange?: (value: string) => void
  }

  let { label, ariaLabel, value, options, onChange }: Props = $props()
</script>

<div class="segmented-field" role="group" aria-label={ariaLabel}>
  <span class="segmented-label">{label}</span>
  <span class="segmented-control">
    {#each options as option (option.value)}
      {@const active = option.value === value}
      <Button
        variant={active ? 'primary' : 'secondary'}
        size="sm"
        className="segment-button"
        pressed={active}
        onclick={() => onChange?.(option.value)}
      >
        {option.label}
      </Button>
    {/each}
  </span>
</div>

<style>
  .segmented-field {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--s-2);
    white-space: nowrap;
  }
  .segmented-label {
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .segmented-control {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--button-secondary-border);
    border-radius: var(--r-1);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 6%, transparent), transparent 52%),
      color-mix(in srgb, var(--button-secondary-bg) 68%, transparent);
    box-shadow:
      var(--glass-inset-etch),
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }
  .segmented-control :global(.segment-button) {
    border-radius: 0;
    border-width: 0 1px 0 0;
    border-color: color-mix(in srgb, var(--glass-inset-border) 82%, var(--border));
  }
  .segmented-control :global(.segment-button:last-child) {
    border-right: 0;
  }
</style>
