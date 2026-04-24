<!--
  Project Facts — what the agent knows about this project, aggregated from
  on-disk state (guildhall.yaml, memory/design-system.yaml, workspace-goals.json,
  coordinators). Read-only for now; each section links out to the canonical
  place to modify.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import { nav } from '../../lib/nav.svelte.js'

  interface GateEntry {
    command?: string
    available?: boolean
    unavailableReason?: string
  }
  interface Facts {
    identity: { name: string; id: string; path: string; editHref: string }
    environment: {
      packageManager: string
      verifiedAt: string | null
      install: unknown
      gates: Record<string, GateEntry> | null
      editHref: string
    }
    workspace: {
      goals: {
        imported: boolean
        dismissed: boolean
        goalCount: number
        taskCount: number
        milestoneCount: number
      } | null
      reviewHref: string
    }
    coordinators: { count: number; list: Array<{ id: string; name: string }>; editHref: string }
    designSystem: { summary: string | null; editHref: string }
  }

  let facts = $state<Facts | null>(null)
  let error = $state<string | null>(null)

  $effect(() => {
    fetch('/api/project/facts')
      .then(r => r.json())
      .then(j => {
        if (j.error) {
          error = j.error
          return
        }
        if (j.initializationNeeded) {
          error = 'Project not initialized.'
          return
        }
        facts = j as Facts
      })
      .catch(e => (error = e instanceof Error ? e.message : String(e)))
  })

  function editLink(href: string): (e: MouseEvent) => void {
    return (e: MouseEvent) => {
      e.preventDefault()
      nav(href)
    }
  }

  function gateEntries(g: Record<string, GateEntry> | null): Array<[string, GateEntry]> {
    return g ? Object.entries(g) : []
  }
</script>

<div class="wrap">
  <header class="head">
    <h2>Project facts</h2>
    <p class="sub">What the agent knows about this project. Edits live in the section owners — follow the links.</p>
  </header>

  {#if error}
    <Card tone="danger">
      <p class="muted">Couldn't load facts: {error}</p>
    </Card>
  {:else if !facts}
    <p class="muted">Loading…</p>
  {:else}
    <Stack gap="3">
      <Card title="Identity">
        {#snippet actions()}
          <a class="edit-link" href={facts.identity.editHref} onclick={editLink(facts.identity.editHref)}>Edit →</a>
        {/snippet}
        <dl class="kv">
          <dt>Name</dt><dd>{facts.identity.name}</dd>
          <dt>Id</dt><dd><code>{facts.identity.id}</code></dd>
          <dt>Path</dt><dd><code>{facts.identity.path}</code></dd>
        </dl>
      </Card>

      <Card title="Environment">
        {#snippet actions()}
          <a class="edit-link" href={facts.environment.editHref} onclick={editLink(facts.environment.editHref)}>Edit →</a>
        {/snippet}
        <dl class="kv">
          <dt>Package manager</dt><dd>{facts.environment.packageManager}</dd>
          <dt>Last verified</dt>
          <dd>
            {facts.environment.verifiedAt
              ? new Date(facts.environment.verifiedAt).toLocaleString()
              : 'never'}
          </dd>
        </dl>
        {#if gateEntries(facts.environment.gates).length > 0}
          <div class="gate-grid">
            {#each gateEntries(facts.environment.gates) as [name, gate] (name)}
              <div class="gate" class:gate-off={!gate.available}>
                <div class="gate-name">{name}</div>
                <div class="gate-cmd"><code>{gate.command ?? '—'}</code></div>
                {#if !gate.available && gate.unavailableReason}
                  <div class="gate-why">{gate.unavailableReason}</div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="muted">No gate data yet — run Configure on Settings.</p>
        {/if}
      </Card>

      <Card title="Workspace discoveries">
        {#snippet actions()}
          <a class="edit-link" href={facts.workspace.reviewHref} onclick={editLink(facts.workspace.reviewHref)}>Review →</a>
        {/snippet}
        {#if !facts.workspace.goals}
          <p class="muted">No scan run yet.</p>
        {:else if facts.workspace.goals.dismissed}
          <p class="muted">Scan dismissed. <a href={facts.workspace.reviewHref} onclick={editLink(facts.workspace.reviewHref)}>Re-review</a>.</p>
        {:else if facts.workspace.goals.imported}
          <dl class="kv">
            <dt>Goals</dt><dd>{facts.workspace.goals.goalCount}</dd>
            <dt>Tasks</dt><dd>{facts.workspace.goals.taskCount}</dd>
            <dt>Milestones</dt><dd>{facts.workspace.goals.milestoneCount}</dd>
          </dl>
        {:else}
          <p class="muted">Pending review.</p>
        {/if}
      </Card>

      <Card title="Coordinators ({facts.coordinators.count})">
        {#snippet actions()}
          <a class="edit-link" href={facts.coordinators.editHref} onclick={editLink(facts.coordinators.editHref)}>Edit →</a>
        {/snippet}
        {#if facts.coordinators.count === 0}
          <p class="muted">None configured.</p>
        {:else}
          <ul class="coord-list">
            {#each facts.coordinators.list as c (c.id)}
              <li><strong>{c.name}</strong> <code class="muted">({c.id})</code></li>
            {/each}
          </ul>
        {/if}
      </Card>

      <Card title="Design system">
        {#snippet actions()}
          <a class="edit-link" href={facts.designSystem.editHref} onclick={editLink(facts.designSystem.editHref)}>Edit →</a>
        {/snippet}
        {#if facts.designSystem.summary}
          <pre class="summary">{facts.designSystem.summary}</pre>
        {:else}
          <p class="muted">Not defined.</p>
        {/if}
      </Card>
    </Stack>
  {/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: var(--s-3); }
  .head h2 { margin: 0; font-size: var(--fs-4); font-weight: 700; }
  .sub { margin: var(--s-1) 0 0 0; color: var(--text-muted); font-size: var(--fs-1); }
  .muted { color: var(--text-muted); font-size: var(--fs-2); }
  .kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px var(--s-3);
    margin: 0;
    font-size: var(--fs-2);
  }
  .kv dt { color: var(--text-muted); }
  .kv dd { margin: 0; color: var(--text); }
  .edit-link {
    font-size: var(--fs-1);
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
  .edit-link:hover { text-decoration: underline; }
  .gate-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
  .gate {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
  .gate-off { opacity: 0.6; }
  .gate-name { font-weight: 700; font-size: var(--fs-1); text-transform: uppercase; letter-spacing: 0.05em; }
  .gate-cmd { font-size: var(--fs-1); color: var(--text-muted); margin-top: 2px; }
  .gate-why { font-size: var(--fs-1); color: var(--warn); margin-top: 4px; }
  .coord-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  code { font-family: 'SF Mono', monospace; font-size: var(--fs-1); }
  .summary {
    margin: 0;
    padding: var(--s-2);
    background: var(--bg-raised-2);
    border-radius: var(--r-1);
    font-size: var(--fs-1);
    white-space: pre-wrap;
  }
</style>
