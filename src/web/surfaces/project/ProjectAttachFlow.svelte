<script lang="ts">
  import ActionBar from '../../lib/ActionBar.svelte'
  import Button from '../../lib/Button.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref } from '../../lib/project-routes.js'

  interface Props {
    projectName?: string | null
    projectPath?: string | null
    projectId?: string | null
  }

  let {
    projectName = 'This project',
    projectPath = null,
    projectId = null,
  }: Props = $props()
</script>

<section class="attach-flow">
  <div class="copy">
    <p class="eyebrow">Project setup</p>
    <h1>{projectName} is attached, but not initialized yet</h1>
    <p class="lede">
      Guildhall found this folder and added it to your local projects list. The next step is to
      initialize Guildhall inside the project so its provider settings, task flow, and on-disk
      project state have a real home.
    </p>
    {#if projectPath}
      <p class="path">{projectPath}</p>
    {/if}
  </div>

  <ActionBar align="start" className="attach-actions">
    <Button variant="primary" size="md" onclick={() => nav(currentProjectHref('/setup', projectId))}>
      Initialize this project
    </Button>
    <Button variant="secondary" size="md" onclick={() => nav('/')}>
      Back to Projects
    </Button>
  </ActionBar>
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
    font-size: var(--gh-type-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--gh-type-weight-strong);
  }
  h1 {
    margin: 0;
    font-size: var(--gh-type-size-page-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .lede {
    margin: 0;
    color: var(--text-muted);
    max-width: 46rem;
    font-size: var(--gh-type-size-panel-title);
  }
  .path {
    margin: 0;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: var(--gh-type-size-meta);
    overflow-wrap: anywhere;
  }
  @media (max-width: 720px) {
    :global(.attach-actions) {
      flex-direction: column;
    }
  }
</style>
