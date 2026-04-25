<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    placement?: 'top' | 'right' | 'bottom' | 'left'
    className?: string | undefined
    children: Snippet
  }

  let { text, placement = 'top', className = '', children }: Props = $props()

  let open = $state(false)
  let anchor = $state<HTMLSpanElement | null>(null)
  let bubbleStyle = $state('')

  function show() {
    open = true
    updatePosition()
  }

  function hide() {
    open = false
  }

  function updatePosition() {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    if (placement === 'right') {
      bubbleStyle = `left: ${rect.right + 8}px; top: ${rect.top + rect.height / 2}px; transform: translateY(-50%);`
    } else if (placement === 'left') {
      bubbleStyle = `right: ${window.innerWidth - rect.left + 8}px; top: ${rect.top + rect.height / 2}px; transform: translateY(-50%);`
    } else if (placement === 'bottom') {
      bubbleStyle = `left: ${rect.left + rect.width / 2}px; top: ${rect.bottom + 8}px; transform: translateX(-50%);`
    } else {
      bubbleStyle = `left: ${rect.left + rect.width / 2}px; bottom: ${window.innerHeight - rect.top + 8}px; transform: translateX(-50%);`
    }
  }
</script>

<span
  bind:this={anchor}
  role="presentation"
  class={`gh-tooltip placement-${placement} ${className}`.trim()}
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {@render children()}
  {#if open}
    <span class="gh-tooltip-bubble" role="tooltip" style={bubbleStyle}>{text}</span>
  {/if}
</span>

<style>
  .gh-tooltip {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .gh-tooltip-bubble {
    position: fixed;
    z-index: 40;
    max-width: min(260px, 80vw);
    width: max-content;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--bg-base) 65%, transparent);
    font-size: var(--fs-1);
    font-weight: 600;
    line-height: var(--lh-tight);
    pointer-events: none;
    animation: gh-tooltip-in 70ms ease;
    white-space: normal;
  }
  @keyframes gh-tooltip-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
