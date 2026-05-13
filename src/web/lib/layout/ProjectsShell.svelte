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
    padding-bottom: var(--s-6);
  }
</style>
