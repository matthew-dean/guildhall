<script lang="ts">
  import { onDestroy } from 'svelte'
  import Button from '../../../lib/Button.svelte'
  import Icon from '../../../lib/Icon.svelte'

  interface Props {
    label: string
    text: string
  }

  let { label, text }: Props = $props()
  let open = $state(false)
  let root = $state<HTMLSpanElement | null>(null)
  const tooltipId = $derived(`structure-help-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)

  $effect(() => {
    if (!open || typeof document === 'undefined') return
    document.addEventListener('click', onDocumentClick)
    return () => document.removeEventListener('click', onDocumentClick)
  })

  onDestroy(() => {
    if (typeof document !== 'undefined') document.removeEventListener('click', onDocumentClick)
  })

  function toggle(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    open = !open
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') open = false
  }

  function onDocumentClick(event: MouseEvent): void {
    if (!root || root.contains(event.target as Node | null)) return
    open = false
  }
</script>

<span class="structure-help" bind:this={root}>
  <Button
    variant="ghost"
    size="sm"
    iconOnly
    rounded
    className="structure-help-button"
    ariaLabel={`What does ${label} mean?`}
    aria-expanded={open}
    aria-controls={tooltipId}
    onclick={toggle}
    onkeydown={onKeydown}
  >
    <Icon name="help-circle" size={14} />
  </Button>

  {#if open}
    <span id={tooltipId} role="tooltip" class="structure-help-tooltip">
      {text}
    </span>
  {/if}
</span>

<style>
  .structure-help {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex: none;
    vertical-align: middle;
  }

  :global(.structure-help-button) {
    background: transparent;
    border-color: transparent;
    color: var(--text-muted);
    height: 1.35rem;
    min-height: 1.35rem;
    min-width: 1.35rem;
    padding: 0;
    width: 1.35rem;
  }

  :global(.structure-help-button[aria-expanded='true']),
  :global(.structure-help-button:hover),
  :global(.structure-help-button:focus-visible) {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--text);
  }

  .structure-help-tooltip {
    position: absolute;
    z-index: 30;
    inset-block-start: calc(100% + var(--gh-space-1));
    inset-inline-start: 0;
    width: min(19rem, calc(100vw - var(--gh-space-6)));
    padding: var(--gh-space-2) var(--gh-space-3);
    border: 1px solid var(--border);
    border-radius: var(--gh-radius-1);
    background: var(--bg-raised);
    box-shadow: var(--shadow-panel);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-body);
    line-height: var(--gh-type-line-height-body);
    text-transform: none;
    letter-spacing: 0;
  }
</style>
