<!--
  Internal routing view: one column per routing slice with a textual sparkline
  of recent task statuses, mandate line, and the tasks in that slice.
-->
<script lang="ts">
  import TaskCard from '../../lib/TaskCard.svelte'
  import { friendlyStewardName } from '../../lib/display.js'
  import { nav } from '../../lib/nav.svelte.js'
  import { buildCoordinatorsSurface } from '../../lib/project-data.js'
  import type { ProjectDetail } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
    subView?: string | null
  }

  let { detail, subView = null }: Props = $props()

  const viewModel = $derived(buildCoordinatorsSurface(detail, subView))
  const coordinators = $derived(viewModel.coordinators)
  const running = $derived(viewModel.running)

  function scopeLabel(path?: string): string {
    return path?.trim() ? path.trim() : 'workspace root'
  }

  function summarizeMandate(value?: string, limit = 180): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text
  }

  function protectsLabel(value?: string): string {
    const text = summarizeMandate(value, 110)
    return text.length > 0 ? text : 'No mandate recorded yet.'
  }

  function fullMandate(value?: string): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim()
    return text.length > 0 ? text : 'No mandate recorded yet.'
  }

  const columns = $derived(viewModel.columns)
  const selectedColumn = $derived(viewModel.selectedColumn)
</script>

{#if coordinators.length === 0}
  <p class="muted">No internal routing slices yet. Finish setup first.</p>
{:else}
  <section class="intro">
    <div class="intro-head">
      <h2>{selectedColumn ? friendlyStewardName(undefined, selectedColumn.c.domain, selectedColumn.c.id) : 'Internal routing'}</h2>
      <button type="button" class="linkbtn" onclick={() => nav('/settings/routing')}>
        How routing works →
      </button>
    </div>
    {#if selectedColumn}
      <p class="intro-copy">
        This routing slice covers <code>{selectedColumn.c.domain ?? 'unknown'}</code>. Use this view to
        inspect what kind of work lands here, what context and checks Guildhall tends to apply, and which
        tasks are currently routed through it.
      </p>
    {:else}
      <p class="intro-copy">
        This is Guildhall's internal routing map. The single local coordinator uses it to decide
        what context, checks, and review lenses each task should get.
      </p>
    {/if}
    <ul class="intro-meta">
      <li><code>domain</code> is the routing label Guildhall uses for tasks.</li>
      <li><code>path</code> is optional and only narrows scope when a slice covers a subproject.</li>
      <li>Editing still lives in <code>guildhall.yaml</code>.</li>
    </ul>
  </section>
  {#if selectedColumn}
    <section class="detail-shell">
      <div class="detail-main">
        <div class="detail-card">
            <div class="detail-head">
              <div class="detail-meta-row">
              <span class="domain-chip">Domain: {selectedColumn.c.domain ?? 'unknown'}</span>
              <span class="scope-chip">Scope: {scopeLabel(selectedColumn.c.path)}</span>
              </div>
              <button type="button" class="linkbtn" onclick={() => nav('/routing')}>
              View all routing →
              </button>
            </div>
          <div class="detail-section">
            <div class="label">Protects</div>
            <p class="detail-copy">{fullMandate(selectedColumn.c.mandate)}</p>
          </div>
          <div class="detail-grid">
            <div class="policy-card">
              <div class="label">Concerns</div>
              {#if selectedColumn.c.concerns?.length}
                <div class="policy-list">
                  {#each selectedColumn.c.concerns as concern, i (concern.id ?? i)}
                    <div class="policy-item">
                      <div class="policy-title">{concern.id ?? 'concern'}</div>
                      <p class="policy-copy">{concern.description ?? 'No description recorded.'}</p>
                      {#if concern.reviewQuestions?.length}
                        <ul class="policy-bullets">
                          {#each concern.reviewQuestions as question, qi (question + qi)}
                            <li>{question}</li>
                          {/each}
                        </ul>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="detail-empty">No specific concerns recorded yet.</p>
              {/if}
            </div>
            <div class="policy-card">
              <div class="label">Autonomous decisions</div>
              {#if selectedColumn.c.autonomousDecisions?.length}
                <ul class="policy-bullets">
                  {#each selectedColumn.c.autonomousDecisions as item, i (item + i)}
                    <li>{item}</li>
                  {/each}
                </ul>
              {:else}
                <p class="detail-empty">No autonomous decisions recorded yet.</p>
              {/if}
            </div>
            <div class="policy-card">
              <div class="label">Escalation triggers</div>
              {#if selectedColumn.c.escalationTriggers?.length}
                <ul class="policy-bullets">
                  {#each selectedColumn.c.escalationTriggers as item, i (item + i)}
                    <li>{item}</li>
                  {/each}
                </ul>
              {:else}
                <p class="detail-empty">No escalation triggers recorded yet.</p>
              {/if}
            </div>
          </div>
        </div>
      </div>
      <aside class="detail-side">
        <div class="detail-card">
          <div class="label">Live summary</div>
          <dl class="stats-list">
            <div><dt>Active</dt><dd>{selectedColumn.active}</dd></div>
            <div><dt>Blocked</dt><dd>{selectedColumn.blocked}</dd></div>
            <div><dt>Awaiting approval</dt><dd>{selectedColumn.awaitingApproval}</dd></div>
            <div><dt>Done</dt><dd>{selectedColumn.done}</dd></div>
            <div><dt>Total</dt><dd>{selectedColumn.domainTasks.length}</dd></div>
          </dl>
          <div class="label">Recent flow</div>
          <div class="spark">{selectedColumn.spark}</div>
        </div>
      </aside>
    </section>
  {/if}
  {#if selectedColumn}
    <section class="lane-tasks">
      <div class="lane-tasks-head">
        <h3>Tasks in this routing slice</h3>
        <span class="muted">Showing the highest-priority items first.</span>
      </div>
      {#if selectedColumn.domainTasks.length === 0}
        <div class="empty">No tasks currently routed here.</div>
      {:else}
        <div class="stack">
          {#each selectedColumn.visibleTasks as t (t.id)}
            <TaskCard task={t} coordinatorRunning={running} />
          {/each}
        </div>
        {#if selectedColumn.domainTasks.length > selectedColumn.visibleTasks.length}
          <div class="more-note">
            Showing {selectedColumn.visibleTasks.length} of {selectedColumn.domainTasks.length} tasks in this domain.
          </div>
        {/if}
      {/if}
    </section>
  {:else}
    <div class="board">
      {#each columns as col (col.c.id ?? col.c.domain)}
        <div class="col">
          <div class="col-head">
            <span class="name">{friendlyStewardName(undefined, col.c.domain, col.c.id)}</span>
            <div class="meta-row">
              <span class="domain-chip">Domain: {col.c.domain ?? 'unknown'}</span>
              <span class="scope-chip">Scope: {scopeLabel(col.c.path)}</span>
            </div>
            <span class="mini">
              {col.active} active
              {#if col.blocked > 0}
                · {col.blocked} blocked
              {/if}
              {#if col.awaitingApproval > 0}
                · {col.awaitingApproval} awaiting approval
              {/if}
              · {col.done} done · {col.domainTasks.length} total
            </span>
          </div>
          <div class="spark">{col.spark}</div>
          <div class="mandate-block">
            <div class="label">Protects</div>
            <div class="mandate">{protectsLabel(col.c.mandate)}</div>
          </div>
          <div class="card-actions">
            <button type="button" class="linkbtn" onclick={() => nav('/routing/' + encodeURIComponent((col.c.id ?? col.c.domain ?? '').toString()))}>
              View routing →
            </button>
          </div>
          {#if col.domainTasks.length === 0}
            <div class="empty">No tasks currently routed here.</div>
          {:else}
            <div class="stack">
              {#each col.visibleTasks as t (t.id)}
                <TaskCard task={t} coordinatorRunning={running} />
              {/each}
            </div>
            {#if col.domainTasks.length > col.visibleTasks.length}
              <div class="more-note">
                Showing {col.visibleTasks.length} of {col.domainTasks.length} tasks in this domain.
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  .intro-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .intro h2 {
    margin: 0;
    font-size: var(--fs-4);
    font-weight: 700;
  }
  .intro-copy {
    margin: 0;
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    color: var(--text-muted);
    max-width: 72ch;
  }
  .intro-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .intro-meta li {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: 6px 10px;
  }
  .linkbtn {
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    font-size: var(--fs-1);
    font-weight: 600;
  }
  .linkbtn:hover {
    text-decoration: underline;
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .board {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--s-3);
  }
  .lane-tasks {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .lane-tasks-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .lane-tasks-head h3 {
    margin: 0;
    font-size: var(--fs-3);
  }
  .detail-shell {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.9fr);
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }
  .detail-main,
  .detail-side {
    min-width: 0;
  }
  .detail-card {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-3);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .detail-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .detail-copy {
    margin: 0;
    color: var(--text);
    line-height: var(--lh-body);
    font-size: var(--fs-1);
  }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--s-2);
  }
  .policy-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .policy-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .policy-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .policy-title {
    font-size: var(--fs-1);
    font-weight: 700;
    color: var(--text);
  }
  .policy-copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .policy-bullets {
    margin: 0;
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .detail-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .stats-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    margin: 0;
  }
  .stats-list div {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: 8px 10px;
  }
  .stats-list dt {
    margin: 0;
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .stats-list dd {
    margin: 4px 0 0 0;
    font-size: var(--fs-2);
    font-weight: 600;
    color: var(--text);
  }
  .col {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-3);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  .col-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .name {
    font-size: var(--fs-2);
    font-weight: 600;
    color: var(--text);
  }
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .domain-chip,
  .scope-chip {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: var(--fs-0);
    font-weight: 700;
    border: 1px solid var(--border);
    background: var(--bg-raised-2);
    color: var(--text-muted);
  }
  .domain-chip {
    color: var(--accent-2);
  }
  .mini {
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .spark {
    font-family: 'SF Mono', monospace;
    font-size: var(--fs-2);
    color: var(--accent-2);
    letter-spacing: 0.1em;
  }
  .mandate-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-actions {
    display: flex;
    justify-content: flex-end;
  }
  .label {
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .mandate {
    font-size: var(--fs-1);
    color: var(--text);
    line-height: var(--lh-body);
  }
  .empty {
    color: var(--text-muted);
    font-size: var(--fs-1);
    padding: var(--s-3) 0;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--r-2);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .more-note {
    font-size: var(--fs-0);
    color: var(--text-muted);
  }
  @media (max-width: 1100px) {
    .detail-shell {
      grid-template-columns: 1fr;
    }
  }
</style>
