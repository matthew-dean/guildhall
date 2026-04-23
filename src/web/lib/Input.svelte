<!--
  Text input primitive. Matches Button's interactive sizing (--control-h /
  --control-pad-*). Two-way binds via `bind:value`.
-->
<script lang="ts">
  interface Props {
    value: string
    type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'search'
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    autocomplete?: string
    ariaLabel?: string
    id?: string
    onchange?: (v: string) => void
    oninput?: (v: string) => void
    onblur?: () => void
    onkeydown?: (e: KeyboardEvent) => void
  }

  let {
    value = $bindable(),
    type = 'text',
    placeholder,
    disabled = false,
    readonly = false,
    autocomplete,
    ariaLabel,
    id,
    onchange,
    oninput,
    onblur,
    onkeydown,
  }: Props = $props()
</script>

<input
  class="input"
  {type}
  {placeholder}
  {disabled}
  {readonly}
  {autocomplete}
  {id}
  aria-label={ariaLabel}
  bind:value
  onchange={(e) => onchange?.((e.target as HTMLInputElement).value)}
  oninput={(e) => oninput?.((e.target as HTMLInputElement).value)}
  onblur={onblur}
  onkeydown={onkeydown}
/>

<style>
  .input {
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
  }
  .input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
