<!--
  Tab strip primitive. Horizontal list of tab buttons with an underline on
  the active tab. Parent owns the active-tab state so tabs can be driven by
  URL, keyboard, etc.

  Usage:
    <Tabs
      tabs={[{ id: 'spec', label: 'Spec' }, ...]}
      active={tab}
      onselect={(id) => tab = id}
    />
-->
<script lang="ts">
  interface TabDef {
    id: string
    label: string
  }

  interface Props {
    tabs: readonly TabDef[]
    active: string
    onselect: (id: string) => void
  }

  let { tabs, active, onselect }: Props = $props()
</script>

<div class="tabs" role="tablist">
  {#each tabs as t (t.id)}
    <button
      type="button"
      role="tab"
      class="tab"
      class:active={t.id === active}
      aria-selected={t.id === active}
      onclick={() => onselect(t.id)}
    >
      {t.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: var(--s-1);
    border-bottom: 1px solid var(--border);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .tab {
    background: transparent;
    border: none;
    border-radius: var(--r-1) var(--r-1) 0 0;
    color: var(--text-muted);
    padding: var(--control-pad-y) var(--control-pad-x);
    font-size: var(--fs-2);
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    line-height: var(--lh-tight);
    min-height: var(--control-h);
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
</style>
