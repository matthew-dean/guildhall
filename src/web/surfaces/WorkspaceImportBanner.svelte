<!--
  FR-34 workspace-import banner. Four states:
    1. hidden — nothing detected, or lever off, or already approved
    2. "N artifacts detected — import?" with Start Import button
    3. "Importer agent working…" while the reserved task is exploring
    4. Draft ready — shows counts and Approve button
-->
<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import { project } from '../lib/project.svelte.js'

  interface ParsedDraft {
    goals: Array<{ title: string }>
    tasks: Array<{ title: string; priority?: string; domain?: string }>
    milestones: Array<{ title: string }>
  }

  let statusLoaded = $state(false)
  let needed = $state(false)
  let seeded = $state(false)
  let specReady = $state(false)
  let taskStatus = $state<string | null>(null)
  let leverPosition = $state<'off' | 'suggest' | 'apply'>('suggest')
  let counts = $state({ goals: 0, tasks: 0, milestones: 0 })
  let inventorySources = $state<string[]>([])
  let parsed = $state<ParsedDraft | null>(null)

  let seedBusy = $state(false)
  let approveBusy = $state(false)
  let actionError = $state<string | null>(null)
  let actionStatus = $state<string | null>(null)

  $effect(() => {
    void loadStatus()
  })

  async function loadStatus() {
    try {
      const r = await fetch('/api/project/workspace-import/status')
      const j = await r.json()
      if (j?.error) return
      needed = Boolean(j.needed)
      seeded = Boolean(j.seeded)
      specReady = Boolean(j.specPresent)
      taskStatus = j.taskStatus ?? null
      leverPosition = j.leverPosition ?? 'suggest'
      counts = {
        goals: j.draft?.goals ?? 0,
        tasks: j.draft?.tasks ?? 0,
        milestones: j.draft?.milestones ?? 0,
      }
      inventorySources = Array.isArray(j.inventory?.ran) ? j.inventory.ran : []
      if (seeded && specReady) await loadDraft()
      statusLoaded = true
    } catch {
      /* silent; banner stays hidden */
    }
  }

  async function loadDraft() {
    try {
      const r = await fetch('/api/project/workspace-import/draft')
      const j = await r.json()
      if (j?.parsed) parsed = j.parsed as ParsedDraft
    } catch {
      /* silent */
    }
  }

  async function startImport() {
    seedBusy = true
    actionError = null
    actionStatus = null
    try {
      const r = await fetch('/api/project/workspace-import', { method: 'POST' })
      const j = await r.json()
      if (j?.error) {
        actionError = j.error
        return
      }
      actionStatus = `Importer agent started — ${j.draft?.tasks ?? 0} tasks, ${j.draft?.goals ?? 0} goals, ${j.draft?.milestones ?? 0} milestones drafted.`
      setTimeout(() => {
        void project.refresh()
        void loadStatus()
      }, 400)
    } finally {
      seedBusy = false
    }
  }

  async function approve() {
    approveBusy = true
    actionError = null
    actionStatus = null
    try {
      const r = await fetch('/api/project/workspace-import/approve', {
        method: 'POST',
      })
      const j = await r.json()
      if (j?.error) {
        actionError = j.error
        return
      }
      actionStatus = `Merged ${j.tasksAdded ?? 0} task(s), ${j.goalsRecorded ?? 0} goal(s), ${j.milestonesLogged ?? 0} milestone(s).`
      setTimeout(() => {
        void project.refresh()
        void loadStatus()
      }, 600)
    } finally {
      approveBusy = false
    }
  }

  const totalDrafted = $derived(counts.goals + counts.tasks + counts.milestones)
  const isDone = $derived(taskStatus === 'done')
  const shouldShow = $derived(
    statusLoaded &&
      leverPosition !== 'off' &&
      !isDone &&
      (needed || (seeded && !isDone)),
  )
</script>

{#if shouldShow}
  {#if seeded && specReady && parsed}
    <Card title="Workspace import draft ready" tone="warn">
      <Stack gap="3">
        <p class="muted">
          The importer agent drafted {parsed.tasks.length} task{parsed.tasks.length === 1 ? '' : 's'},
          {parsed.goals.length} goal{parsed.goals.length === 1 ? '' : 's'}, and
          {parsed.milestones.length} milestone{parsed.milestones.length === 1 ? '' : 's'}
          from your existing workspace. Approve to merge into
          <code>TASKS.json</code>, <code>PROGRESS.md</code>, and
          <code>workspace-goals.json</code>.
        </p>
        {#if parsed.tasks.length > 0}
          <div class="list">
            <div class="section-label">Tasks</div>
            {#each parsed.tasks.slice(0, 6) as t, i (i)}
              <div class="item">
                <strong>{t.title}</strong>
                <span class="muted">
                  {' — '}{t.priority ?? 'normal'}{t.domain ? ' · ' + t.domain : ''}
                </span>
              </div>
            {/each}
            {#if parsed.tasks.length > 6}
              <div class="muted">… and {parsed.tasks.length - 6} more</div>
            {/if}
          </div>
        {/if}
        {#if parsed.milestones.length > 0}
          <div class="list">
            <div class="section-label">Milestones</div>
            {#each parsed.milestones.slice(0, 4) as m, i (i)}
              <div class="item">🏁 {m.title}</div>
            {/each}
          </div>
        {/if}
        {#if parsed.goals.length > 0}
          <div class="list">
            <div class="section-label">Goals</div>
            {#each parsed.goals.slice(0, 4) as g, i (i)}
              <div class="item">{g.title}</div>
            {/each}
          </div>
        {/if}
        <Row justify="end" gap="2" align="center">
          {#if actionError}
            <span class="status error">{actionError}</span>
          {:else if actionStatus}
            <span class="status">{actionStatus}</span>
          {/if}
          <Button variant="primary" disabled={approveBusy} onclick={approve}>
            {approveBusy ? 'Merging…' : 'Approve and merge'}
          </Button>
        </Row>
      </Stack>
    </Card>
  {:else if seeded}
    <Card title="Workspace importer working…" tone="warn">
      <p class="muted">
        The importer agent is refining the draft from {inventorySources.length}
        source{inventorySources.length === 1 ? '' : 's'}. Watch the live activity feed.
      </p>
    </Card>
  {:else if needed}
    <Card title="Existing workspace artifacts detected" tone="warn">
      <Stack gap="3">
        <p class="muted">
          Found {totalDrafted} artifact{totalDrafted === 1 ? '' : 's'} across
          {inventorySources.length} source{inventorySources.length === 1 ? '' : 's'}
          ({inventorySources.join(', ')}). Import them into Guildhall so your
          project doesn't start at 0%.
        </p>
        <Row gap="3">
          <span class="chip">Tasks: {counts.tasks}</span>
          <span class="chip">Goals: {counts.goals}</span>
          <span class="chip">Milestones: {counts.milestones}</span>
        </Row>
        {#if actionError}
          <p class="error">{actionError}</p>
        {/if}
        <Row justify="end" gap="2" align="center">
          {#if actionStatus}
            <span class="status">{actionStatus}</span>
          {/if}
          <Button variant="primary" disabled={seedBusy} onclick={startImport}>
            {seedBusy ? 'Starting…' : 'Start import'}
          </Button>
        </Row>
      </Stack>
    </Card>
  {/if}
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-2);
  }
  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--fs-1);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .section-label {
    font-size: var(--fs-1);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .item {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-2) var(--s-3);
    font-size: var(--fs-2);
  }
  .chip {
    background: var(--bg-raised-2);
    border-radius: var(--r-2);
    padding: var(--s-1) var(--s-2);
    font-size: var(--fs-1);
  }
  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }
  .status.error {
    color: var(--danger);
  }
</style>
