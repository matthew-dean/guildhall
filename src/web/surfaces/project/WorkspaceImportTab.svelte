<!--
  Workspace import review. Shows the deterministic detector output
  (goals / tasks / milestones parsed from README, roadmaps, TODO comments,
  git log, etc.) so the user can Approve or Dismiss without waiting on an
  agent round-trip. If the importer agent has refined the spec (YAML fences
  in the reserved task), we show that instead.

  Endpoints:
    GET  /api/project/workspace-import/draft   → detected + parsed + state
    POST /api/project/workspace-import/approve → merges into TASKS.json
    POST /api/project/workspace-import/dismiss → writes dismissed marker
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import { nav } from '../../lib/nav.svelte.js'

  interface DetectedGoal {
    id: string
    title: string
    rationale: string
    source: string
    references?: readonly string[]
    confidence: 'high' | 'medium' | 'low'
  }
  interface DetectedTask {
    suggestedId: string
    title: string
    description: string
    domain: string
    priority: 'critical' | 'high' | 'normal' | 'low'
    source: string
    references?: readonly string[]
    confidence: 'high' | 'medium' | 'low'
  }
  interface DetectedMilestone {
    title: string
    evidence: string
    source: string
    references?: readonly string[]
  }
  interface DetectedContext {
    label: string
    excerpt: string
    source: string
  }
  interface DetectedDraft {
    goals: DetectedGoal[]
    tasks: DetectedTask[]
    milestones: DetectedMilestone[]
    context: DetectedContext[]
    stats: { inputSignals: number; drafted: number; deduped: number }
  }
  interface ParsedGoal { id: string; title: string; rationale: string }
  interface ParsedTask {
    id: string
    title: string
    description: string
    domain: string
    priority: string
    references?: readonly string[]
  }
  interface ParsedMilestone { title: string; evidence: string }
  interface ParsedImport {
    goals: ParsedGoal[]
    tasks: ParsedTask[]
    milestones: ParsedMilestone[]
  }
  interface DraftResponse {
    taskExists: boolean
    specReady: boolean
    taskStatus?: string | null
    parsed: ParsedImport | null
    detected: DetectedDraft | null
    dismissed: boolean
    /** Repo anchors detected by the inbox-side cheap check (README.md,
     *  package.json, ROADMAP.md…). Shown in the empty state so "found 5
     *  signals in the inbox" doesn't contradict "no signals" on this tab.
     */
    anchors?: readonly string[]
    error?: string
  }

  let data = $state<DraftResponse | null>(null)
  let error = $state<string | null>(null)
  let busy = $state<null | 'approve' | 'dismiss'>(null)
  let toast = $state<{ text: string; tone: 'ok' | 'danger' } | null>(null)

  async function load() {
    error = null
    try {
      const r = await fetch('/api/project/workspace-import/draft')
      const j = (await r.json()) as DraftResponse
      if (j.error) {
        error = j.error
        return
      }
      data = j
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  $effect(() => {
    load()
  })

  function flash(text: string, tone: 'ok' | 'danger') {
    toast = { text, tone }
    setTimeout(() => {
      if (toast?.text === text) toast = null
    }, 4500)
  }

  async function approve() {
    busy = 'approve'
    try {
      const r = await fetch('/api/project/workspace-import/approve', {
        method: 'POST',
      })
      const j = (await r.json()) as {
        ok?: boolean
        tasksAdded?: number
        goalsRecorded?: number
        milestonesLogged?: number
        error?: string
      }
      if (!r.ok || j.error) {
        flash(j.error ?? `Approve failed (${r.status})`, 'danger')
        return
      }
      flash(
        `Imported ${j.tasksAdded ?? 0} tasks · ${j.goalsRecorded ?? 0} goals · ${j.milestonesLogged ?? 0} milestones`,
        'ok',
      )
      await load()
      // Bounce to planner so user sees the new tasks.
      setTimeout(() => nav('/planner'), 900)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'danger')
    } finally {
      busy = null
    }
  }

  async function dismiss() {
    busy = 'dismiss'
    try {
      const r = await fetch('/api/project/workspace-import/dismiss', {
        method: 'POST',
      })
      if (!r.ok) {
        flash(`Dismiss failed (${r.status})`, 'danger')
        return
      }
      flash('Dismissed. Findings remain visible here if you change your mind.', 'ok')
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'danger')
    } finally {
      busy = null
    }
  }

  // Prefer the agent-refined spec when specReady; otherwise show the
  // deterministic detector output so the user can act without waiting.
  const showSource = $derived<'agent' | 'detector' | 'empty'>(
    data?.specReady && data.parsed
      ? 'agent'
      : data?.detected &&
          (data.detected.goals.length +
            data.detected.tasks.length +
            data.detected.milestones.length >
            0)
        ? 'detector'
        : 'empty',
  )

  const goals = $derived(
    showSource === 'agent'
      ? (data?.parsed?.goals ?? []).map(g => ({
          id: g.id,
          title: g.title,
          rationale: g.rationale,
        }))
      : (data?.detected?.goals ?? []).map(g => ({
          id: g.id,
          title: g.title,
          rationale: g.rationale,
        })),
  )
  const tasks = $derived(
    showSource === 'agent'
      ? (data?.parsed?.tasks ?? []).map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          domain: t.domain,
          priority: t.priority,
        }))
      : (data?.detected?.tasks ?? []).map(t => ({
          id: t.suggestedId,
          title: t.title,
          description: t.description,
          domain: t.domain,
          priority: t.priority,
        })),
  )
  const milestones = $derived(
    showSource === 'agent'
      ? data?.parsed?.milestones ?? []
      : data?.detected?.milestones ?? [],
  )

  const hasAnything = $derived(
    goals.length + tasks.length + milestones.length > 0,
  )
</script>

<div class="wrap">
  <header class="head">
    <h2>Workspace import</h2>
    <p class="sub">
      Goals, tasks, and milestones discovered in your repo — from README,
      roadmaps, TODO comments, and git history. Review and approve to seed
      the planner, or dismiss if this isn't useful.
    </p>
  </header>

  {#if toast}
    <div class="toast toast-{toast.tone}">{toast.text}</div>
  {/if}

  {#if error}
    <Card tone="danger">
      <p class="muted">Couldn't load findings: {error}</p>
      <Button variant="secondary" onclick={load}>Retry</Button>
    </Card>
  {:else if !data}
    <p class="muted">Loading findings…</p>
  {:else if data.dismissed && showSource !== 'empty'}
    <Card>
      <p class="muted">
        Previously dismissed. Findings shown below so you can re-review.
      </p>
    </Card>
    <!-- fall through to render below -->
  {/if}

  {#if data && !error}
    <Stack gap="3">
      <Card>
        <div class="summary-row">
          <div class="summary-text">
            <div class="summary-primary">
              {#if showSource === 'agent'}
                Importer agent refined these findings.
              {:else if showSource === 'detector'}
                Detector findings — no agent refinement yet.
              {:else if (data?.anchors?.length ?? 0) > 0}
                Repo anchors detected, but nothing extracted yet.
              {:else}
                No repo anchors detected in this workspace.
              {/if}
            </div>
            {#if data.detected}
              <div class="summary-meta">
                {data.detected.stats.inputSignals} signal{data.detected.stats.inputSignals === 1 ? '' : 's'}
                scanned ·
                {data.detected.stats.drafted} drafted ·
                {data.detected.stats.deduped} deduped
              </div>
            {/if}
          </div>
          <div class="summary-actions">
            {#if hasAnything}
              <Button
                variant="primary"
                onclick={approve}
                disabled={busy !== null}
              >
                {busy === 'approve' ? 'Approving…' : 'Approve & import'}
              </Button>
              <Button
                variant="secondary"
                onclick={dismiss}
                disabled={busy !== null}
              >
                {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
              </Button>
            {/if}
          </div>
        </div>
      </Card>

      {#if goals.length > 0}
        <Card title="Goals ({goals.length})">
          <ul class="items">
            {#each goals as g (g.id)}
              <li>
                <div class="item-title">{g.title}</div>
                {#if g.rationale}
                  <div class="item-sub">{g.rationale}</div>
                {/if}
                <div class="item-meta"><code>{g.id}</code></div>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      {#if tasks.length > 0}
        <Card title="Tasks ({tasks.length})">
          <ul class="items">
            {#each tasks as t (t.id)}
              <li>
                <div class="item-title">
                  {t.title}
                  <Chip
                    label={t.priority}
                    tone={t.priority === 'critical' || t.priority === 'high' ? 'danger' : 'neutral'}
                  />
                </div>
                {#if t.description}
                  <div class="item-sub">{t.description}</div>
                {/if}
                <div class="item-meta">
                  <code>{t.id}</code>
                  · domain <code>{t.domain}</code>
                </div>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      {#if milestones.length > 0}
        <Card title="Milestones ({milestones.length})">
          <ul class="items">
            {#each milestones as m (m.title)}
              <li>
                <div class="item-title">{m.title}</div>
                {#if m.evidence}
                  <div class="item-sub">{m.evidence}</div>
                {/if}
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      {#if showSource === 'empty'}
        <Card>
          {#if (data?.anchors?.length ?? 0) > 0}
            <p class="muted">
              Found repo anchors ({data!.anchors!.join(', ')}) but the
              detector couldn't extract any goals, tasks, or milestones
              from them yet. The scan looks at README headings, ROADMAP.md,
              AGENTS.md, TODO/FIXME comments, and recent git log — add
              substantive content to any of those and findings will appear
              here.
            </p>
          {:else}
            <p class="muted">
              Nothing to import yet. The detector scans README, roadmaps,
              TODO comments, and git log — once any of those have
              substantive content, findings will appear here.
            </p>
          {/if}
        </Card>
      {/if}
    </Stack>
  {/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: var(--s-3); }
  .head h2 { margin: 0; font-size: var(--fs-4); font-weight: 700; }
  .sub {
    margin: var(--s-1) 0 0 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .muted { color: var(--text-muted); font-size: var(--fs-2); }
  .toast {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-1);
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .toast-ok { background: var(--ok-bg, #1a3a1f); color: var(--ok, #6fcf6f); }
  .toast-danger { background: var(--danger-bg, #3a1a1a); color: var(--danger, #ff6b6b); }
  .summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .summary-text { flex: 1; min-width: 220px; }
  .summary-primary { font-weight: 700; font-size: var(--fs-2); }
  .summary-meta {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .summary-actions {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .items li {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
  .item-title {
    font-weight: 600;
    font-size: var(--fs-2);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .item-sub {
    margin-top: 2px;
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .item-meta {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  code {
    font-family: 'SF Mono', monospace;
    font-size: 0.92em;
  }
</style>
