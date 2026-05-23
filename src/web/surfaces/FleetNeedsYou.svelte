<script lang="ts">
  import { AlertTriangle, CheckCircle2, FolderOpen, Inbox } from 'lucide-svelte'
  import ActionBar from '../lib/ActionBar.svelte'
  import Button from '../lib/Button.svelte'
  import Card from '../lib/Card.svelte'
  import ProjectsShell from '../lib/layout/ProjectsShell.svelte'
  import { nav } from '../lib/nav.svelte.js'
  import { projectHref } from '../lib/project-routes.js'
  import { getCachedService, setCachedService } from '../lib/service-cache.js'
  import type { InboxItem } from '../lib/inbox-item-key.js'
  import type { ServiceDetail, ServiceProjectSummary } from '../lib/types.js'

  type ProjectInboxGroup = {
    project: ServiceProjectSummary
    items: InboxItem[]
    error: string | null
  }

  const cachedService = getCachedService()
  let loading = $state(cachedService == null)
  let error = $state<string | null>(null)
  let groups = $state<ProjectInboxGroup[]>(cachedService ? groupsFromServiceSummary(cachedService) : [])
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
      case 'workspace_import_pending': return 'Review import'
      case 'agent_question_pending': return 'Answer question'
      case 'import_draft_queue': return 'Review draft'
      case 'brief_approval':
      case 'spec_approval': return 'Review'
      case 'open_escalation': return 'Resolve'
      case 'bootstrap_missing': return 'Configure'
      case 'lever_questions': return 'Review'
      case 'spec_fill_pending': return item.taskId === 'task-workspace-import' ? 'Review import' : 'Open details'
      default: return 'Open'
    }
  }

  function groupsFromServiceSummary(service: ServiceDetail): ProjectInboxGroup[] {
    return (service.projects ?? []).flatMap(project => {
      const counts = project.taskCounts
      if (!counts) return []
      const items: InboxItem[] = []
      if (counts.blocked > 0) {
        items.push({
          kind: 'open_escalation',
          severity: 'high',
          title: `${counts.blocked} blocked ${counts.blocked === 1 ? 'task' : 'tasks'}`,
          detail: project.highlights?.blockedTaskTitle ?? 'Open the project inbox to resolve blockers.',
          actionHref: '/inbox',
        } as InboxItem)
      }
      if (counts.draftReview > 0) {
        items.push({
          kind: 'import_draft_queue',
          severity: 'medium',
          title: `${counts.draftReview} draft ${counts.draftReview === 1 ? 'brief' : 'briefs'}`,
          detail: 'Review drafted task briefs before Guildhall starts implementation.',
          actionHref: '/inbox',
        } as InboxItem)
      }
      return items.length > 0 ? [{ project, items, error: null }] : []
    })
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
    nav(projectHref(projectId, '/inbox'))
  }

  function goToItem(projectId: string, item: InboxItem): void {
    if (item.kind === 'brief_approval' || item.kind === 'spec_approval') {
      nav(projectHref(projectId, '/thread'))
      return
    }
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
      const service = await fetchJsonWithTimeout<ServiceDetail>('/api/service')
      setCachedService(service)
      const projects = service.projects ?? []
      const nextGroups: ProjectInboxGroup[] = []
      error = null
      for (const project of projects) {
        try {
          const body = await fetchJsonWithTimeout<{ items?: InboxItem[] }>(
            `/api/project/inbox?projectId=${encodeURIComponent(project.id)}`,
          )
          const nextGroup = {
            project,
            items: (body.items ?? []).filter(item => item.severity !== 'low'),
            error: null,
          } satisfies ProjectInboxGroup
          if (nextGroup.items.length > 0) {
            nextGroups.push(nextGroup)
            groups = [...nextGroups]
          }
        } catch (err) {
          nextGroups.push({
            project,
            items: [],
            error: requestErrorMessage(err),
          } satisfies ProjectInboxGroup)
          groups = [...nextGroups]
        }
      }
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
        <p class="lede">All project decisions, questions, and recovery items grouped by project.</p>
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
      <span><FolderOpen size={16} /> {projectCount} project{projectCount === 1 ? '' : 's'}</span>
    </section>

    <div class="groups">
      {#each groups as group (group.project.id)}
        <Card tone={group.error ? 'warn' : 'accent'} className="fleet-inbox-group">
          <div class="group-head">
            <div>
              <h2>{group.project.name}</h2>
              <p>{group.project.path}</p>
            </div>
            <ActionBar>
              <Button variant="secondary" size="sm" onclick={() => goToProjectInbox(group.project.id)}>
                Project needs you
              </Button>
              <Button variant="secondary" size="sm" onclick={() => goToProject(group.project.id)}>
                Open project
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
              {#each group.items as item (`${item.kind}-${item.taskId ?? item.title}-${item.actionHref ?? ''}`)}
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
    font-size: clamp(1.25rem, 1.8vw, 1.65rem);
    line-height: var(--lh-tight);
  }
  .lede {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
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
    font-size: var(--fs-1);
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
    font-size: var(--fs-3);
    line-height: var(--lh-tight);
  }
  .group-head p {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
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
    grid-template-columns: 8px minmax(0, 1fr) auto;
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
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item-body strong {
    color: var(--text);
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-body span {
    color: var(--text-muted);
    font-size: var(--fs-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-verb {
    color: var(--accent);
    font-size: var(--fs-1);
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
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
