<script lang="ts">
  import { AlertTriangle, CheckCircle2, FolderOpen, Inbox } from 'lucide-svelte'
  import ActionBar from '../lib/ActionBar.svelte'
  import Button from '../lib/Button.svelte'
  import Card from '../lib/ui-compat/Card.svelte'
  import ProjectsShell from '../lib/layout/ProjectsShell.svelte'
  import { nav } from '../lib/nav.svelte.js'
  import { projectHref } from '../lib/project-routes.js'
  import { inboxItemKey, type InboxItem } from '../lib/inbox-item-key.js'
  import type { ServiceProjectSummary } from '../lib/types.js'

  type ProjectInboxGroup = {
    project: ServiceProjectSummary
    items: InboxItem[]
    error: string | null
  }

  interface FleetAttentionSummary {
    groups?: ProjectInboxGroup[]
  }

  let loading = $state(true)
  let error = $state<string | null>(null)
  let groups = $state<ProjectInboxGroup[]>([])
  const REQUEST_TIMEOUT_MS = 5000
  const LOAD_WATCHDOG_MS = 6500

  function requestErrorMessage(err: unknown): string {
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      return 'Guildhall service did not answer that request. The service may have restarted; try again after it reconnects.'
    }
    return err instanceof Error ? err.message : String(err)
  }

  function itemVerb(item: InboxItem): string {
    switch (item.kind) {
      case 'required_migration': return 'Migrate'
      case 'project_understanding': return 'Reconcile'
      case 'workspace_import_pending': return 'Review import'
      case 'import_draft_queue': return 'Review draft'
      case 'bootstrap_missing': return 'Configure'
      case 'lever_questions': return 'Review'
      case 'spec_fill_pending': return item.taskId === 'task-workspace-import' ? 'Review import' : 'Open checklist'
      default: return 'Open'
    }
  }

  async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Request timed out'))
        }, REQUEST_TIMEOUT_MS)
      })
      const response = await Promise.race([
        fetch(url, { cache: 'no-store', signal: controller.signal }),
        timeoutPromise,
      ])
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as T
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Request timed out')
      }
      throw err
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  function goToProject(projectId: string): void {
    nav(projectHref(projectId, '/thread'))
  }

  function goToProjectInbox(projectId: string): void {
    nav(projectHref(projectId, '/overview/inbox'))
  }

  function goToItem(projectId: string, item: InboxItem): void {
    if (item.actionHref) {
      nav(projectHref(projectId, item.actionHref))
      return
    }
    goToProjectInbox(projectId)
  }

  async function load(): Promise<void> {
    loading = true
    groups = []
    try {
      const attention = await fetchJsonWithTimeout<FleetAttentionSummary>('/api/fleet/attention')
      error = null
      groups = (attention.groups ?? []).filter(group => group.items.length > 0 || group.error)
    } catch (err) {
      error = requestErrorMessage(err)
      groups = []
    } finally {
      loading = false
    }
  }

  const totalItems = $derived(groups.reduce((sum, group) => sum + group.items.length, 0))
  const projectCount = $derived(groups.filter(group => group.items.length > 0).length)

  setTimeout(() => {
    void load()
  }, 0)

  setTimeout(() => {
    if (!loading || groups.length > 0) return
    error = 'Guildhall could not finish loading the fleet inbox. Use Refresh to try again, or open a project directly.'
    loading = false
  }, LOAD_WATCHDOG_MS)
</script>

<ProjectsShell shellClass="fleet-needs-you">
  {#snippet hero()}
    <header class="hero">
      <div>
        <h1>Needs you</h1>
        <p class="lede">Project alerts and durable follow-ups grouped by project.</p>
      </div>
      <ActionBar>
        <Button variant="secondary" onclick={() => nav('/')}>Projects</Button>
        <Button variant="secondary" onclick={load}>Refresh</Button>
      </ActionBar>
    </header>
  {/snippet}

  {#snippet notices()}
    {#if error}
      <div class="notice warn">{error}</div>
    {/if}
  {/snippet}

  {#if loading && groups.length === 0}
    <div class="empty">Loading needs-you items...</div>
  {:else if !error && groups.length === 0}
    <div class="empty clear">
      <CheckCircle2 size={24} />
      <p>All caught up. No project needs your attention right now.</p>
    </div>
  {:else}
    <section class="summary" aria-label="Needs-you summary">
      <span><Inbox size={16} /> {totalItems} item{totalItems === 1 ? '' : 's'}</span>
      <span><FolderOpen size={16} /> {projectCount} project{projectCount === 1 ? '' : 's'} need you</span>
    </section>

    <div class="groups">
      {#each groups as group (group.project.id)}
        <Card tone={group.error ? 'warn' : 'accent'} className="fleet-inbox-group">
          <div class="group-head">
            <div>
              <h2>{group.project.name}</h2>
              <p>{group.project.path}</p>
            </div>
            <ActionBar className="group-actions">
              <Button variant="secondary" size="sm" onclick={() => goToProjectInbox(group.project.id)}>
                Queue
              </Button>
              <Button variant="secondary" size="sm" onclick={() => goToProject(group.project.id)}>
                Project
              </Button>
            </ActionBar>
          </div>

          {#if group.error}
            <div class="group-error">
              <AlertTriangle size={16} />
              <span>{group.error}</span>
            </div>
          {:else}
            <ul class="items">
              {#each group.items as item, itemIndex (`${inboxItemKey(item)}:${itemIndex}`)}
                <li>
                  <button type="button" class="item" onclick={() => goToItem(group.project.id, item)}>
                    <span class="severity severity-{item.severity}" aria-hidden="true"></span>
                    <span class="item-body">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </span>
                    <span class="item-verb">{itemVerb(item)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      {/each}
    </div>
  {/if}
</ProjectsShell>

<style>
  .hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s-3);
  }
  h1 {
    margin: 0;
    font-size: var(--gh-type-size-page-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .lede {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .notice,
  .empty,
  .summary {
    border: 1px solid var(--glass-border);
    border-radius: var(--r-2);
    background: var(--glass-bg);
    box-shadow: var(--glass-etch);
  }
  .notice,
  .empty {
    padding: var(--s-4);
    color: var(--text-muted);
  }
  .notice.warn {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
  }
  .empty.clear,
  .summary {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .empty p {
    margin: 0;
  }
  .summary {
    padding: var(--s-2) var(--s-3);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .summary span {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  :global(section.fleet-inbox-group) {
    padding: var(--s-3);
  }
  .group-head {
    display: flex;
    justify-content: space-between;
    gap: var(--s-3);
    align-items: start;
    margin-bottom: var(--s-3);
  }
  .group-head h2 {
    margin: 0;
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .group-head p {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .items {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
  }
  .item {
    width: 100%;
    display: grid;
    grid-template-columns: 8px minmax(0, 78ch) auto;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg-raised) 82%, transparent);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item:hover,
  .item:focus-visible {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
  }
  .severity {
    width: 8px;
    height: 8px;
    border-radius: 999px;
  }
  .severity-high {
    background: var(--danger);
  }
  .severity-medium {
    background: var(--warn);
  }
  .severity-low {
    background: var(--text-muted);
  }
  .item-body {
    min-width: 0;
    max-width: 78ch;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item-body strong {
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-body span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: var(--gh-type-line-height-body);
  }
  .item-verb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 1.9rem;
    padding: 0 var(--s-2);
    border: 1px solid color-mix(in srgb, var(--accent) 44%, var(--border));
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    white-space: nowrap;
  }
  :global(.group-actions .btn) {
    opacity: 0.78;
  }
  .group-error {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--warn);
  }
  @media (max-width: 720px) {
    .hero,
    .group-head {
      align-items: stretch;
      flex-direction: column;
    }
    .item {
      grid-template-columns: 8px minmax(0, 1fr);
    }
    .item-verb {
      grid-column: 2;
    }
  }
</style>
