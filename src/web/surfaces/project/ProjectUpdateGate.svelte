<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Icon from '../../lib/Icon.svelte'

  interface Props {
    onReview: () => void | Promise<void>
    returnTo?: { displayKey: string } | null
  }

  let { onReview, returnTo = null }: Props = $props()
</script>

<section class="project-update-gate" aria-label="Project update required">
  <div class="project-update-copy">
    <p class="eyebrow">{returnTo ? `Review paused · ${returnTo.displayKey}` : 'Project update'}</p>
    <h1>One update is needed</h1>
    {#if returnTo}
      <p>Review the update, then apply it to return to this work item.</p>
    {:else}
      <p>Guildhall needs to update this project before work can continue. Review the update, then apply it when you are ready.</p>
    {/if}
  </div>
  <Button variant="human" onclick={() => void onReview()}>
    <Icon name="refresh-cw" size={16} />
    Review project update
  </Button>
</section>

<style>
  .project-update-gate {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--s-5);
    width: min(100%, var(--gh-layout-measure));
    padding: var(--s-6) var(--s-4);
  }

  .project-update-copy {
    display: grid;
    gap: var(--s-2);
    max-width: 52ch;
  }

  .eyebrow {
    color: var(--text-muted);
    font-size: var(--gh-type-size-eyebrow);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    margin: 0;
    text-transform: uppercase;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: var(--gh-type-size-page-title);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  p:not(.eyebrow) {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  @media (max-width: 640px) {
    .project-update-gate {
      align-items: flex-start;
      flex-direction: column;
      padding: var(--s-4);
    }
  }
</style>
