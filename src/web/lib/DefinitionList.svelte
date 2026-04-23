<!--
  DefinitionList primitive. A two-column dl where keys are small uppercase
  muted labels and values are either plain text or a markdown string. Used
  for provenance trails, facts grids in WhyStuck, escalation details.

  Item shape:
    [key, value]             — plain text dd
    [key, { md: '...' }]     — markdown-rendered dd

  Items with null/undefined values are skipped so callers can pass a fixed
  shape without pre-filtering.
-->
<script lang="ts">
  import Markdown from './Markdown.svelte'

  type Value = string | { md: string } | null | undefined
  interface Props {
    items: ReadonlyArray<readonly [string, Value]>
    size?: 'sm' | 'md'
  }

  let { items, size = 'md' }: Props = $props()
</script>

<dl class="facts s-{size}">
  {#each items as [k, v] (k)}
    {#if v !== undefined && v !== null}
      <dt>{k}</dt>
      <dd>
        {#if typeof v === 'string'}
          {v}
        {:else}
          <Markdown source={v.md} />
        {/if}
      </dd>
    {/if}
  {/each}
</dl>

<style>
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s-1) var(--s-3);
  }
  .s-sm { font-size: var(--fs-1); }
  .s-md { font-size: var(--fs-2); }
  dt {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    font-size: var(--fs-1);
  }
  dd {
    color: var(--text);
    line-height: var(--lh-body);
    margin: 0;
  }
</style>
