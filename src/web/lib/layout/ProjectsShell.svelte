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
    padding: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
  }
  .projects-shell-hero,
  .projects-shell-notices,
  .projects-shell-body {
    min-width: 0;
  }
</style>
