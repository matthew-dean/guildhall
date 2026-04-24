<!--
  Placeholder for the workspace-import wizard. Backend already seeds a
  reserved task via `/api/project/workspace-import`; this surface will host
  the approve/review flow once designed. Listed here so the inbox row has a
  place to land today.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
</script>

<Card title="Scan workspace">
  <p class="muted">
    Coming soon — a guided review of proposed goals, tasks, and milestones
    inferred from your README, roadmap, and packages.
  </p>
  <p class="muted">
    Until the wizard ships, approve the reserved <code>workspace-import</code>
    task from the Planner once agents populate it.
  </p>
</Card>

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    margin: 0 0 var(--s-2) 0;
  }
  code {
    font-family: 'SF Mono', monospace;
    font-size: 0.92em;
  }
</style>
