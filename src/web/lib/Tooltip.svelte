<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    placement?: 'top' | 'right' | 'bottom' | 'left'
    disabled?: boolean
    className?: string | undefined
    style?: string | undefined
    children: Snippet
  }

  let { text, placement = 'top', disabled = false, className = '', style, children }: Props = $props()

  let open = $state(false)
  let anchor = $state<HTMLSpanElement | null>(null)
  let bubbleStyle = $state('')
  let bubble: HTMLSpanElement | null = null
  const gap = 8
  const margin = 8

  $effect(() => {
    if (disabled) open = false
    syncBubble()
  })

  $effect(() => {
    if (!open) {
      removeBubble()
      return
    }
    syncBubble()
    updatePosition()
  })

  onDestroy(removeBubble)

  function show() {
    if (disabled) return
    open = true
    updatePosition()
  }

  function hide() {
    open = false
    removeBubble()
  }

  function ensureBubble() {
    if (typeof document === 'undefined') return null
    if (!bubble) {
      bubble = document.createElement('span')
      bubble.className = 'gh-tooltip-bubble'
      bubble.setAttribute('role', 'tooltip')
      document.body.appendChild(bubble)
    }
    return bubble
  }

  function syncBubble() {
    if (!open || disabled) return
    const element = ensureBubble()
    if (!element) return
    element.textContent = text
    element.setAttribute('style', bubbleStyle)
  }

  function removeBubble() {
    bubble?.remove()
    bubble = null
  }

  function updatePosition() {
    if (!anchor) return
    const element = ensureBubble()
    if (!element) return
    const rect = anchor.getBoundingClientRect()
    element.textContent = text
    element.style.left = '0px'
    element.style.top = '0px'
    element.style.right = 'auto'
    element.style.bottom = 'auto'
    element.style.transform = 'none'
    element.style.visibility = 'hidden'
    const bubbleRect = element.getBoundingClientRect()
    const width = Math.min(
      element.offsetWidth || bubbleRect.width || estimateWidth(text),
      Math.max(120, window.innerWidth - margin * 2),
    )
    const height = element.offsetHeight || bubbleRect.height || estimateHeight(text, width)
    const resolved = resolvePlacement(rect, width, height)
    const coordinates = coordinatesFor(rect, width, height, resolved)
    const left = clamp(coordinates.left, margin, Math.max(margin, window.innerWidth - width - margin))
    const top = clamp(coordinates.top, margin, Math.max(margin, window.innerHeight - height - margin))
    bubbleStyle = `left: ${Math.round(left)}px; top: ${Math.round(top)}px; right: auto; bottom: auto; transform: none; visibility: visible;`
    syncBubble()
  }

  function resolvePlacement(rect: DOMRect, width: number, height: number): Props['placement'] {
    if (placement === 'right' && rect.right + gap + width > window.innerWidth - margin) return 'left'
    if (placement === 'left' && rect.left - gap - width < margin) return 'right'
    if (placement === 'bottom' && rect.bottom + gap + height > window.innerHeight - margin) return 'top'
    if (placement === 'top' && rect.top - gap - height < margin) return 'bottom'
    return placement
  }

  function coordinatesFor(rect: DOMRect, width: number, height: number, resolved: Props['placement']): { left: number; top: number } {
    if (resolved === 'right') {
      return { left: rect.right + gap, top: rect.top + rect.height / 2 - height / 2 }
    }
    if (resolved === 'left') {
      return { left: rect.left - gap - width, top: rect.top + rect.height / 2 - height / 2 }
    }
    if (resolved === 'bottom') {
      return { left: rect.left + rect.width / 2 - width / 2, top: rect.bottom + gap }
    }
    return { left: rect.left + rect.width / 2 - width / 2, top: rect.top - gap - height }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  function estimateWidth(value: string): number {
    return Math.min(260, Math.max(56, value.length * 7 + 18))
  }

  function estimateHeight(value: string, width: number): number {
    const lineCount = Math.max(1, Math.ceil((value.length * 7) / Math.max(80, width - 18)))
    return lineCount * 16 + 14
  }
</script>

<span
  bind:this={anchor}
  role="presentation"
  class={`gh-tooltip placement-${placement} ${className}`.trim()}
  {style}
  onmouseenter={show}
  onmouseover={show}
  onmouseleave={hide}
  onmouseout={hide}
  onfocus={show}
  onfocusin={show}
  onblur={hide}
  onfocusout={hide}
>
  {@render children()}
</span>

<style>
  .gh-tooltip {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  :global(.gh-tooltip-bubble) {
    position: fixed;
    z-index: calc(var(--z-tooltip) + 20);
    max-width: min(260px, 80vw);
    width: max-content;
    padding: 6px 8px;
    border: 1px solid var(--glass-border-strong);
    border-radius: var(--r-1);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 8%, transparent), transparent 58%),
      color-mix(in srgb, var(--bg-elevated) 84%, transparent);
    color: var(--text-readable);
    box-shadow:
      var(--glass-shadow),
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
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
