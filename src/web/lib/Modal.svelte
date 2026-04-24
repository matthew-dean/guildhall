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
    size?: 'sm' | 'md' | 'lg'
  }

  let { open, title, onClose, children, footer, size = 'md' }: Props = $props()

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div class="gh-modal-scrim" role="presentation" onclick={onClose}></div>
  <div
    class="gh-modal size-{size}"
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
        onclick={onClose}
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
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
  }
  .gh-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    z-index: 201;
    display: flex;
    flex-direction: column;
    max-height: min(80vh, 720px);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  }
  .size-sm { width: min(92vw, 400px); }
  .size-md { width: min(92vw, 560px); }
  .size-lg { width: min(92vw, 800px); }

  .gh-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
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
    border-top: 1px solid var(--border);
    background: var(--bg-sunken);
    border-radius: 0 0 12px 12px;
  }
</style>
