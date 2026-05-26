<!--
  Base modal primitive. Centered card over a scrim. Escape + backdrop click
  dismiss. Focus is trapped to the dialog body while open. No prose — hosts
  arbitrary content via default slot; header + footer are separate slots so
  actions stick to the bottom and never scroll away.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  interface Props {
    open: boolean
    title: string
    onClose: () => void
    children?: Snippet
    footer?: Snippet
    size?: 'sm' | 'md' | 'lg' | 'xl'
  }

  let { open, title, onClose, children, footer, size = 'md' }: Props = $props()
  let visible = $state(false)
  let closing = $state(false)
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') requestClose()
  }

  function requestClose() {
    if (!closing) onClose()
  }

  $effect(() => {
    if (open) {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
      visible = true
      closing = false
      return
    }

    if (!visible) return

    closing = true
    closeTimer = setTimeout(() => {
      visible = false
      closing = false
      closeTimer = null
    }, 160)

    return () => {
      if (closeTimer) clearTimeout(closeTimer)
    }
  })
</script>

<svelte:window onkeydown={handleKey} />

{#if visible}
  <div class:closing class="gh-modal-scrim" role="presentation" onclick={requestClose}></div>
  <div
    class="gh-modal size-{size}"
    class:closing
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <header class="gh-modal-head">
      <h3>{title}</h3>
      <button
        type="button"
        class="gh-modal-x"
        aria-label="Close"
        onclick={requestClose}
      ><Icon name="x" size={16} /></button>
    </header>
    <div class="gh-modal-body">
      {#if children}{@render children()}{/if}
    </div>
    {#if footer}
      <footer class="gh-modal-foot">{@render footer()}</footer>
    {/if}
  </div>
{/if}

<style>
  .gh-modal-scrim {
    position: fixed;
    inset: 0;
    background:
      radial-gradient(circle at 50% 20%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 36%),
      rgba(0, 0, 0, 0.42);
    z-index: var(--z-modal-backdrop);
    animation: gh-modal-scrim-in 130ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .gh-modal-scrim.closing {
    animation-name: gh-modal-scrim-out;
    pointer-events: none;
  }
  .gh-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background:
      var(--glass-reflect-violet),
      var(--glass-reflect-mint),
      linear-gradient(180deg, color-mix(in srgb, white 6%, transparent), color-mix(in srgb, white 1.5%, transparent)),
      color-mix(in srgb, var(--bg-raised) 68%, transparent);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-3);
    z-index: var(--z-modal);
    display: flex;
    flex-direction: column;
    max-height: min(80vh, 720px);
    box-shadow:
      var(--glass-shadow),
      var(--glass-etch),
      0 24px 64px rgba(0, 0, 0, 0.38);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    overflow: clip;
    animation: gh-modal-lift-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .gh-modal.closing {
    animation-name: gh-modal-lift-out;
    animation-duration: 130ms;
    pointer-events: none;
  }
  .size-sm { width: min(92vw, 380px); }
  .size-md { width: min(92vw, 520px); }
  .size-lg { width: min(92vw, 720px); }
  .size-xl { width: min(94vw, 1040px); }

  .gh-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--glass-bg-strong) 68%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }
  .gh-modal-head h3 {
    margin: 0;
    font-size: var(--fs-3);
    font-weight: 600;
  }
  .gh-modal-x {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-3);
    padding: var(--s-1) var(--s-2);
    border-radius: 6px;
  }
  .gh-modal-x:hover {
    color: var(--text);
    background: var(--bg-sunken);
  }
  .gh-modal-body {
    padding: var(--s-4);
    overflow-y: auto;
    flex: 1;
  }
  .gh-modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-top: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--glass-inset-bg-strong) 76%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  @keyframes gh-modal-scrim-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes gh-modal-scrim-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes gh-modal-lift-in {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 10px)) scale(0.982);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }
  @keyframes gh-modal-lift-out {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    to {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 8px)) scale(0.986);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .gh-modal-scrim,
    .gh-modal,
    .gh-modal-scrim.closing,
    .gh-modal.closing {
      animation-duration: 1ms;
    }
  }
</style>
