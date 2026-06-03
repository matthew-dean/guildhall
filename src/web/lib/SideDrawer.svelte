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
    --drawer-width: min(560px, 92vw);
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: calc(var(--z-drawer) + 1);
  }

  .gh-side-drawer-backdrop::before {
    content: '';
    position: absolute;
    inset: 0 calc(var(--drawer-width) + (var(--s-2) * 2)) 0 0;
    background:
      radial-gradient(circle at 72% 18%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 34%),
      rgba(0, 0, 0, 0.18);
    pointer-events: none;
  }

  .gh-side-drawer {
    position: fixed;
    top: var(--s-2);
    right: var(--s-2);
    width: min(560px, 92vw);
    height: calc(100vh - (var(--s-2) * 2));
    overflow: hidden;
    background:
      var(--glass-reflect-violet),
      linear-gradient(180deg, color-mix(in srgb, white 5%, transparent), color-mix(in srgb, white 1.5%, transparent)),
      color-mix(in srgb, var(--bg-raised) 72%, transparent);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-2);
    z-index: calc(var(--z-drawer) + 2);
    display: flex;
    flex-direction: column;
    box-shadow:
      var(--glass-shadow),
      var(--glass-etch),
      -18px 0 52px rgba(0, 0, 0, 0.24);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  .gh-side-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-4);
    border-bottom: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--bg-raised) 44%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  .gh-side-drawer-head h3 {
    margin: 0;
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
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
    border-top: 1px solid var(--glass-border);
    background: color-mix(in srgb, var(--bg-sunken, var(--bg)) 62%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }
  @media (max-width: 800px) {
    .gh-side-drawer-backdrop::before {
      display: none;
    }

    .gh-side-drawer {
      top: 0;
      right: 0;
      width: 100vw;
      height: 100vh;
      border-radius: 0;
    }
  }
</style>
