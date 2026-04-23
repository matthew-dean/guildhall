<!--
  Select primitive. Takes an options array; parent controls `value` via
  `bind:value`. Matches Input / Button interactive sizing.
-->
<script lang="ts">
  interface Option {
    value: string
    label: string
    disabled?: boolean
  }

  interface Props {
    value: string
    options: readonly Option[]
    disabled?: boolean
    ariaLabel?: string
    id?: string
    onchange?: (v: string) => void
  }

  let {
    value = $bindable(),
    options,
    disabled = false,
    ariaLabel,
    id,
    onchange,
  }: Props = $props()
</script>

<select
  class="select"
  {disabled}
  {id}
  aria-label={ariaLabel}
  bind:value
  onchange={(e) => onchange?.((e.target as HTMLSelectElement).value)}
>
  {#each options as opt (opt.value)}
    <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
  {/each}
</select>

<style>
  .select {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: var(--control-pad-y) var(--control-pad-x);
    font-family: inherit;
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
    min-height: var(--control-h);
    cursor: pointer;
  }
  .select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
