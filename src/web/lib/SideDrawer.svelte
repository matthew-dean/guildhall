<script lang="ts">
  import type { Snippet } from 'svelte'
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'

  interface Props {
    open: boolean
    title: string
    onClose: () => void
    children?: Snippet
    footer?: Snippet
  }

  let { open, title, onClose, children, footer }: Props = $props()

  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <div class="gh-side-drawer-backdrop" role="presentation" onclick={onClose}></div>
  <aside class="gh-side-drawer" aria-label={title}>
    <header class="gh-side-drawer-head">
      <h3>{title}</h3>
      <Button variant="ghost" size="sm" ariaLabel="Close" onclick={onClose}>
        <Icon name="x" size={16} />
      </Button>
    </header>
    <div class="gh-side-drawer-body">
      {#if children}{@render children()}{/if}
    </div>
    {#if footer}
      <footer class="gh-side-drawer-foot">
        {@render footer()}
      </footer>
    {/if}
  </aside>
{/if}

<style>
  .gh-side-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: var(--z-drawer-backdrop);
  }

  .gh-side-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(560px, 92vw);
    height: 100vh;
    background: var(--bg-raised);
    border-left: 1px solid var(--border);
    z-index: var(--z-drawer);
    display: flex;
    flex-direction: column;
    box-shadow: -16px 0 48px rgba(0, 0, 0, 0.35);
  }

  .gh-side-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-4);
    border-bottom: 1px solid var(--border);
  }

  .gh-side-drawer-head h3 {
    margin: 0;
    font-size: var(--fs-4);
    line-height: var(--lh-tight);
  }

  .gh-side-drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-4);
  }

  .gh-side-drawer-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-top: 1px solid var(--border);
    background: var(--bg-sunken, var(--bg));
  }
  @media (max-width: 800px) {
    .gh-side-drawer {
      width: 100vw;
    }
  }
</style>
