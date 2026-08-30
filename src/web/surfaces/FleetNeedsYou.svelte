<script lang="ts">
  import CheckCircle2 from 'lucide-svelte/icons/check-circle-2'
  import ActionBar from '../lib/ActionBar.svelte'
  import Button from '../lib/Button.svelte'
  import ProjectsShell from '../lib/layout/ProjectsShell.svelte'
  import { nav } from '../lib/nav.svelte.js'
  import { projectActionHref, projectHref } from '../lib/project-routes.js'
  import type { InboxItem } from '../lib/inbox-item-key.js'
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
      return 'The local service did not answer that request. It may have restarted; try again after it reconnects.'
    }
    return err instanceof Error ? err.message : String(err)
  }

  function itemVerb(item: InboxItem): string {
    if (item.buttonLabel) return item.buttonLabel
    switch (item.kind) {
      case 'project_action': return 'Open project'
      case 'required_migration': return 'Migrate'
      case 'project_understanding': return 'Reconcile'
      case 'workspace_import_pending': return 'Review import'
      case 'setup_pending': return 'Start setup'
      case 'proof_reconciliation': return 'Review proof'
      case 'import_draft_queue': return 'Review draft'
      case 'contract_result_review': return 'Review result'
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

  function goToProjectInbox(projectId: string): void {
    nav(projectHref(projectId, '/overview/inbox'))
  }

  function goToItem(projectId: string, item: InboxItem): void {
    if (item.actionHref) {
      nav(projectActionHref(item.actionHref, projectId))
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

  const projectCount = $derived(groups.filter(group => group.items.length > 0).length)

  setTimeout(() => {
    void load()
  }, 0)

  setTimeout(() => {
    if (!loading || groups.length > 0) return
    error = 'The fleet inbox could not finish loading. Use Refresh to try again, or open a project directly.'
    loading = false
  }, LOAD_WATCHDOG_MS)
</script>

<ProjectsShell shellClass="fleet-needs-you">
  {#snippet hero()}
    <header class="hero">
      <div>
        <h1>Needs you</h1>
        <p class="lede">One current decision per project.</p>
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
      {projectCount} project{projectCount === 1 ? '' : 's'} need a decision.
    </section>

    <div class="groups">
      {#each groups as group (group.project.id)}
        {@const currentItem = group.items[0]}
        {@const remainingItemCount = Math.max(0, group.items.length - 1)}
        <section class="group" aria-labelledby={`needs-you-${group.project.id}`}>
          <div class="group-copy">
            <h2 id={`needs-you-${group.project.id}`}>{group.project.name}</h2>
            {#if group.error}
              <p class="group-error">Couldn’t load this project’s current decision.</p>
            {:else if currentItem}
              <p class="current-item">{currentItem.title}</p>
              {#if remainingItemCount > 0}
                <button type="button" class="more-items" onclick={() => goToProjectInbox(group.project.id)}>
                  {remainingItemCount} more decision{remainingItemCount === 1 ? '' : 's'}
                </button>
              {/if}
            {/if}
          </div>
          {#if group.error}
            <Button variant="secondary" size="sm" onclick={() => goToProjectInbox(group.project.id)}>Open project</Button>
          {:else if currentItem}
            <Button variant="primary" size="sm" onclick={() => goToItem(group.project.id, currentItem)}>{itemVerb(currentItem)}</Button>
          {/if}
        </section>
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
  .empty {
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
  .empty.clear {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .empty p {
    margin: 0;
  }
  .summary {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    padding-bottom: var(--s-1);
  }
  .groups {
    display: flex;
    flex-direction: column;
  }
  .group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    min-width: 0;
    padding: var(--s-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .group-copy {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  .group h2 {
    margin: 0;
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .current-item,
  .group-error {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    margin: 0;
  }
  .group-error {
    color: var(--warn);
  }
  .more-items {
    appearance: none;
    align-self: start;
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--gh-type-size-meta);
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  @media (max-width: 720px) {
    .hero,
    .group {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
