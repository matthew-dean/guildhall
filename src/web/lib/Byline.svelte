<!--
  Byline primitive. Small muted metadata line like "by worker-agent · 2026-04-23".
  Renders nothing when there's no actor to attribute. Used for briefs,
  design system revisions, shelve reasons, escalations.

  Usage:
    <Byline by={brief.authoredBy} at={brief.authoredAt} />
    <Byline by={ds.approvedBy} at={ds.approvedAt} verb="Approved" />
-->
<script lang="ts">
  interface Props {
    by?: string | null
    at?: string | null
    verb?: string
  }

  let { by, at, verb = 'by' }: Props = $props()

  const date = $derived(at ? String(at).slice(0, 10) : '')
</script>

{#if by || date}
  <span class="byline">
    {#if by}{verb} {by}{/if}
    {#if by && date} · {/if}
    {#if date}<time>{date}</time>{/if}
  </span>
{/if}

<style>
  .byline {
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
</style>
