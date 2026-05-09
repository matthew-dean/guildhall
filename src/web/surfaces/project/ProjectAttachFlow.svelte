<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import { nav } from '../../lib/nav.svelte.js'

  interface Props {
    projectName?: string | null
    projectPath?: string | null
  }

  let {
    projectName = 'This project',
    projectPath = null,
  }: Props = $props()
</script>

<section class="attach-flow">
  <div class="copy">
    <p class="eyebrow">Project setup</p>
    <h1>{projectName} is attached, but not initialized yet</h1>
    <p class="lede">
      Guildhall found this folder and added it to your local projects list. The next step is to
      initialize Guildhall inside the project so coordinators, providers, and task flow have a real home.
    </p>
    {#if projectPath}
      <p class="path">{projectPath}</p>
    {/if}
  </div>

  <div class="actions">
    <Button variant="primary" size="md" onclick={() => nav('/setup')}>
      Initialize this project
    </Button>
    <Button variant="secondary" size="md" onclick={() => nav('/')}>
      Back to Projects
    </Button>
  </div>
</section>

<style>
  .attach-flow {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    padding: clamp(var(--s-4), 4vw, var(--s-6));
    border: 1px solid var(--border);
    border-radius: var(--r-3);
    background: color-mix(in srgb, var(--bg-elevated) 82%, var(--accent-9) 8%);
    max-width: 52rem;
  }
  .copy {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .eyebrow {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  h1 {
    margin: 0;
    font-size: clamp(1.6rem, 3vw, 2.3rem);
    line-height: 1.1;
  }
  .lede {
    margin: 0;
    color: var(--text-muted);
    max-width: 46rem;
    font-size: var(--fs-3);
  }
  .path {
    margin: 0;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: var(--fs-1);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
  }
  @media (max-width: 720px) {
    .actions {
      flex-direction: column;
    }
  }
</style>
