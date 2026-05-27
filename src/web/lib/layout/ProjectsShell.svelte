<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    shellClass?: string
    hero?: Snippet
    notices?: Snippet
    children?: Snippet
  }

  let { shellClass = '', hero, notices, children }: Props = $props()
</script>

<section class={`projects-shell ${shellClass}`.trim()}>
  <header class="projects-shell-hero">
    {@render hero?.()}
  </header>
  <div class="projects-shell-notices">
    {@render notices?.()}
  </div>
  <div class="projects-shell-body">
    {@render children?.()}
  </div>
</section>

<style>
  .projects-shell {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    block-size: 100%;
    min-block-size: 0;
    overflow: hidden;
    padding: var(--s-5);
    box-sizing: border-box;
  }
  .projects-shell.projects-home {
    gap: var(--s-2);
    padding: var(--s-3);
  }
  .projects-shell.projects-home .projects-shell-hero {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky-local);
    margin: calc(-1 * var(--s-3)) calc(-1 * var(--s-3)) 0;
    padding: var(--s-3);
    border-bottom: 1px solid var(--glass-border);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), transparent 62%),
      color-mix(in srgb, var(--bg-base) 72%, transparent);
    box-shadow:
      0 14px 28px color-mix(in srgb, var(--bg-base) 58%, transparent),
      inset 0 -1px 0 color-mix(in srgb, white 5%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }
  .projects-shell-hero,
  .projects-shell-notices,
  .projects-shell-body {
    min-width: 0;
  }
  .projects-shell-body {
    flex: 1 1 auto;
    min-block-size: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: auto;
    padding-bottom: var(--s-6);
  }
  .projects-shell.projects-home .projects-shell-body {
    padding-bottom: var(--s-3);
  }
</style>
