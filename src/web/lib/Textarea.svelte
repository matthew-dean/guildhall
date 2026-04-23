<!--
  Textarea primitive. Matches Input's visual language; use `rows` to size.
  Default-resizes vertically (set `resize="none"` for fixed-height contexts).
-->
<script lang="ts">
  interface Props {
    value: string
    rows?: number
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    ariaLabel?: string
    id?: string
    resize?: 'vertical' | 'horizontal' | 'both' | 'none'
    mono?: boolean
    oninput?: (v: string) => void
    onblur?: () => void
    onkeydown?: (e: KeyboardEvent) => void
  }

  let {
    value = $bindable(),
    rows = 4,
    placeholder,
    disabled = false,
    readonly = false,
    ariaLabel,
    id,
    resize = 'vertical',
    mono = false,
    oninput,
    onblur,
    onkeydown,
  }: Props = $props()
</script>

<textarea
  class="textarea"
  class:mono
  style:resize
  {rows}
  {placeholder}
  {disabled}
  {readonly}
  {id}
  aria-label={ariaLabel}
  bind:value
  oninput={(e) => oninput?.((e.target as HTMLTextAreaElement).value)}
  onblur={onblur}
  onkeydown={onkeydown}
></textarea>

<style>
  .textarea {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: var(--control-pad-y) var(--control-pad-x);
    font-family: inherit;
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .textarea.mono {
    font-family: 'SF Mono', ui-monospace, monospace;
  }
  .textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
