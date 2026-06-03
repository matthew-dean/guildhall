<!--
  Byline primitive. Small muted metadata line like "by worker-agent · 2026-04-23".
  Renders nothing when there's no actor to attribute. Used for briefs,
  design system revisions, shelve reasons, escalations.

  Usage:
    <Byline by={brief.authoredBy} at={brief.authoredAt} />
    <Byline by={ds.approvedBy} at={ds.approvedAt} verb="Approved" />
-->
<script lang="ts">
  import { labelForIdentifier } from './identifier-labels.js'

  interface Props {
    by?: string | null
    at?: string | null
    verb?: string
  }

  let { by, at, verb = 'by' }: Props = $props()

  const date = $derived(at ? String(at).slice(0, 10) : '')
  const actor = $derived(by ? labelForIdentifier('agent', by).label : '')
</script>

{#if by || date}
  <span class="byline">
    {#if actor}{verb} {actor}{/if}
    {#if by && date} · {/if}
    {#if date}<time>{date}</time>{/if}
  </span>
{/if}

<style>
  .byline {
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
  }
</style>
