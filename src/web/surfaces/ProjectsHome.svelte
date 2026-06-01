<script lang="ts">
  import { onEvent } from '../lib/events.js'
  import { nav } from '../lib/nav.svelte.js'
  import { Activity, AlertTriangle, CheckCircle2, Cpu, FileClock, FolderPlus, Folders, Inbox, PlayCircle } from 'lucide-svelte'
  import ActionBar from '../lib/ActionBar.svelte'
  import Button from '../lib/Button.svelte'
  import Chip from '../lib/Chip.svelte'
  import ProjectsShell from '../lib/layout/ProjectsShell.svelte'
  import ProjectCard from '../lib/ProjectCard.svelte'
  import SideDrawer from '../lib/SideDrawer.svelte'
  import Tooltip from '../lib/Tooltip.svelte'
  import UtilityPanel from '../lib/UtilityPanel.svelte'
  import WorkMixChart from '../lib/WorkMixChart.svelte'
  import { avatarToneForRole } from '../lib/avatar-palette.js'
  import { summarizeProjects, type ProjectCardSummary } from '../lib/project-summary.js'
  import { projectHref } from '../lib/project-routes.js'
  import { setCachedService } from '../lib/service-cache.js'
  import type { ServiceDetail } from '../lib/types.js'

  let service = $state<ServiceDetail | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let busyId = $state<string | null>(null)
  let selectedProjectId = $state<string | null>(null)
  let optimisticRuns = $state<Record<string, boolean>>({})
  let refreshHandle: ReturnType<typeof setTimeout> | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshInFlight = false
  let refreshQueued = false
  let lastRefreshAt = 0
  let lastServiceSignature: string | null = null

  const SERVICE_REFRESH_MIN_INTERVAL_MS = 1500
  const SERVICE_REFRESH_POLL_MS = 30000

  function isMeaningfulProjectListEvent(type: string): boolean {
    return (
      type === 'task_transition' ||
      type === 'escalation_raised' ||
      type === 'agent_issue' ||
      type === 'error' ||
      type === 'provider_health_changed' ||
      type.startsWith('supervisor_')
    )
  }

  function requestErrorMessage(err: unknown): string {
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      return 'Guildhall service did not answer that request. The service may have restarted; this will clear on the next successful refresh.'
    }
    return err instanceof Error ? err.message : String(err)
  }

  function servicePayloadSignature(payload: ServiceDetail): string {
    return JSON.stringify({
      defaultProviderStatus: payload.defaultProviderStatus,
      projects: payload.projects.map(project => ({
        id: project.id,
        path: project.path,
        name: project.name,
        summary: project.summary,
        taskCounts: project.taskCounts,
        highlights: project.highlights,
        run: project.run,
        startReadiness: project.startReadiness,
        providerStatus: project.providerStatus,
        gitStory: project.gitStory,
        projectCheckIn: project.projectCheckIn,
      })),
    })
  }

  function pageIsHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  async function refresh(background = false): Promise<void> {
    if (background && pageIsHidden()) return
    if (refreshInFlight) {
      refreshQueued = true
      return
    }
    refreshInFlight = true
    if (!background || service == null) loading = true
    try {
      const response = await fetch('/api/service', { cache: 'no-store' })
      const payload = (await response.json()) as ServiceDetail
      const signature = servicePayloadSignature(payload)
      if (signature !== lastServiceSignature || service == null) {
        service = payload
        setCachedService(payload)
        lastServiceSignature = signature
      }
      error = null
      lastRefreshAt = Date.now()
    } catch (err) {
      error = requestErrorMessage(err)
    } finally {
      refreshInFlight = false
      loading = false
      if (refreshQueued) {
        refreshQueued = false
        void refresh(true)
      }
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) return
    const delay = Math.max(0, SERVICE_REFRESH_MIN_INTERVAL_MS - (Date.now() - lastRefreshAt))
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh(true)
    }, delay)
  }

  async function openProject(projectId: string): Promise<void> {
    busyId = projectId
    try {
      nav(projectHref(projectId, '/overview'))
    } finally {
      busyId = null
    }
  }

  async function startProject(projectId: string): Promise<void> {
    busyId = projectId
    optimisticRuns = { ...optimisticRuns, [projectId]: true }
    try {
      const response = await fetch(`/api/project/start?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? `Unable to start project (${response.status})`)
      }
      await refresh()
    } catch (err) {
      error = requestErrorMessage(err)
      const next = { ...optimisticRuns }
      delete next[projectId]
      optimisticRuns = next
    } finally {
      busyId = null
    }
  }

  async function stopProject(projectId: string): Promise<void> {
    busyId = projectId
    const next = { ...optimisticRuns }
    delete next[projectId]
    optimisticRuns = next
    try {
      const response = await fetch(`/api/project/stop?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? `Unable to stop project (${response.status})`)
      }
      await refresh()
    } catch (err) {
      error = requestErrorMessage(err)
    } finally {
      busyId = null
    }
  }

  async function attachProject(): Promise<void> {
    busyId = '__attach__'
    try {
      const response = await fetch('/api/service/attach-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? `Unable to attach project (${response.status})`)
      }
      if (payload?.cancelled) return
      await refresh()
      if (typeof payload?.project?.id === 'string') nav(projectHref(payload.project.id, '/overview'))
    } catch (err) {
      error = requestErrorMessage(err)
    } finally {
      busyId = null
    }
  }

  $effect(() => {
    void refresh()
  })

  $effect(() => {
    function poll() {
      void refresh(true)
      refreshHandle = setTimeout(poll, SERVICE_REFRESH_POLL_MS)
    }
    if (refreshHandle) clearTimeout(refreshHandle)
    refreshHandle = setTimeout(poll, SERVICE_REFRESH_POLL_MS)
    return () => {
      if (refreshHandle) clearTimeout(refreshHandle)
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
    }
  })

  $effect(() => {
    const off = onEvent((ev) => {
      const type = ev.event?.type ?? ev.type ?? ''
      if (!isMeaningfulProjectListEvent(type)) return
      scheduleRefresh()
    })
    return off
  })

  $effect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => {
      if (!pageIsHidden()) scheduleRefresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  const cards = $derived(summarizeProjects(service))
  const overview = $derived({
    total: cards.length,
    running: cards.filter(card => card.canStop || optimisticRuns[card.id]).length,
    taskTotal: cards.reduce((sum, card) => sum + card.counts.total, 0),
    active: cards.reduce((sum, card) => sum + card.counts.active, 0),
    blocked: cards.reduce((sum, card) => sum + card.counts.blocked, 0),
    drafts: cards.reduce((sum, card) => sum + card.counts.draftReview, 0),
    done: cards.reduce((sum, card) => sum + card.counts.done, 0),
    shelved: cards.reduce((sum, card) => sum + card.counts.shelved, 0),
  })
  const readyTaskCount = $derived(Math.max(0, overview.taskTotal - overview.active - overview.blocked - overview.drafts - overview.done - overview.shelved))
  const needsYouCount = $derived(cards.filter(card => card.counts.blocked > 0 || card.counts.draftReview > 0 || card.projectCheckIn?.needed || card.provider?.tone === 'warn').length)
  const firstNeedsYouProject = $derived(cards.find(card => card.counts.blocked > 0 || card.counts.draftReview > 0 || card.projectCheckIn?.needed || card.provider?.tone === 'warn') ?? null)
  const selectedProject = $derived(cards.find(card => card.id === selectedProjectId) ?? null)
  const dashboardTotal = $derived(Math.max(1, overview.taskTotal))
  const defaultProviderStatus = $derived(service?.defaultProviderStatus ?? null)
  const defaultProviderWarning = $derived(defaultProviderStatus?.warnings?.[0] ?? null)
  const defaultProviderLabel = $derived(defaultProviderStatus?.preferredProviderLabel ?? defaultProviderStatus?.activeProviderLabel ?? 'Providers')
  const defaultWorkerModel = $derived(compactModelLabel(defaultProviderStatus?.activeModel ?? defaultProviderStatus?.models?.worker))
  const defaultProviderTitle = $derived(
    defaultProviderWarning?.message ??
      'Open model settings.',
  )

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function runningNowLabel(count: number): string {
    return `${count} running now`
  }

  function projectSparkTitle(project: ProjectCardSummary): string {
    const running = project.canStop || optimisticRuns[project.id]
    return `${project.name}: ${running ? 'running now' : 'not running now'}. ${project.activityLabel}`
  }

  function compactModelLabel(model: string | null | undefined): string {
    if (!model) return ''
    const trimmed = model.trim()
    if (!trimmed) return ''
    const slash = trimmed.lastIndexOf('/')
    return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  }

  const guildMembers = $derived([
    { role: 'Coordinator', state: overview.running > 0 ? 'directing live work' : 'at table', initial: 'C', active: overview.running > 0 },
    { role: 'Spec', state: overview.running > 0 && overview.drafts > 0 ? 'shaping briefs' : 'at table', initial: 'S', active: overview.running > 0 && overview.drafts > 0 },
    { role: 'Builder', state: overview.running > 0 && overview.active > 0 ? 'working' : 'at table', initial: 'B', active: overview.running > 0 && overview.active > 0 },
    { role: 'Reviewer', state: overview.running > 0 && overview.blocked > 0 ? 'inspecting blocks' : 'at table', initial: 'R', active: overview.running > 0 && overview.blocked > 0 },
  ].map(member => ({ ...member, tone: avatarToneForRole(member.role) })))

  function inspectProject(projectId: string): void {
    selectedProjectId = projectId
  }

  function closeProjectDetails(): void {
    selectedProjectId = null
  }

  function openNeedsYou(): void {
    nav('/needs-you')
  }

  function countNoun(count: number, singular: string, plural = `${singular}s`): string {
    return count === 1 ? singular : plural
  }

</script>

<ProjectsShell shellClass="projects-home">
  {#snippet hero()}
  <header class="hero">
    <div>
      <h1>Projects &amp; Workspaces</h1>
      <p class="lede">Guild members, project queues, and blockers across your local work.</p>
    </div>
    <div class="hero-actions">
      {#if defaultProviderStatus}
        <Button
          variant="secondary"
          className={`default-model-button ${defaultProviderWarning ? 'default-model-button-warn' : ''}`}
          title={defaultProviderTitle}
          ariaLabel="Open model settings"
          onclick={() => nav('/providers')}
        >
          {#if defaultProviderWarning}
            <AlertTriangle size={15} />
          {:else}
            <Cpu size={15} />
          {/if}
          <span class="default-model-copy">
            <span class="default-model-prefix">Models</span>
          </span>
        </Button>
      {/if}
      <Button
        variant={needsYouCount > 0 ? 'human' : 'secondary'}
        disabled={needsYouCount === 0}
        title={needsYouCount > 0
          ? `${countLabel(needsYouCount, 'project')} need you. Opens the grouped fleet inbox.`
          : 'No project needs your attention right now'}
        onclick={openNeedsYou}
      >
        <Inbox size={15} />
        Needs you
        {#if needsYouCount > 0}
          <span class="action-count"><span class="count-glyph">{needsYouCount > 99 ? '99+' : `${needsYouCount} project${needsYouCount === 1 ? '' : 's'}`}</span></span>
        {/if}
      </Button>
      <Button variant="secondary" disabled={busyId === '__attach__'} title="Attach another local project to Guildhall" onclick={attachProject}>
        <FolderPlus size={15} />
        {busyId === '__attach__' ? 'Attaching...' : 'Attach project'}
      </Button>
    </div>
  </header>
  {/snippet}

  {#snippet notices()}
  {#if error}
    <div class="notice warn">{error}</div>
  {/if}
  {/snippet}

  {#if loading && cards.length === 0}
    <div class="empty">Loading projects...</div>
  {:else if cards.length === 0}
    <div class="empty">
      <h2>No projects yet</h2>
      <p>Register or attach a project to start using Guildhall as a local service over your work.</p>
    </div>
  {:else}
    <section class="floor" aria-label="Guild hall project overview">
      <div class="floor-head">
        <p class="floor-kicker">Guild hall</p>
        <Tooltip text={countLabel(overview.total, 'project')}>
          <strong aria-label={countLabel(overview.total, 'project')}>
            <Folders size={18} />
            <span>{overview.total}</span>
          </strong>
        </Tooltip>
      </div>
      <div class="guild-table" aria-label="Guild members at the table">
        <div class="guild-members">
          {#each guildMembers as member (member.role)}
            <Tooltip text={`${member.role}: ${member.state}`}>
              <span
                class={`guild-member avatar-tone-${member.tone}`}
                class:guild-member-active={member.active}
                aria-label={`${member.role}: ${member.state}`}
              >
                <span class="guild-avatar">{member.initial}</span>
              </span>
            </Tooltip>
          {/each}
        </div>
      </div>
      <div class="floor-metrics">
        <Tooltip text={`${runningNowLabel(overview.running)}: projects whose coordinator loop is currently on.`}>
          <span class="floor-metric tone-running" aria-label={runningNowLabel(overview.running)}>
            <PlayCircle size={16} />
            <strong>{overview.running}</strong>
          </span>
        </Tooltip>
        <Tooltip text={`${countLabel(overview.active, 'active task')}: tasks currently queued or in progress across all projects.`}>
          <span class="floor-metric tone-active" aria-label={countLabel(overview.active, 'active task')}>
            <Activity size={16} />
            <strong>{overview.active}</strong>
          </span>
        </Tooltip>
        <Tooltip text={`${countLabel(overview.blocked, 'blocked task')}: work that needs triage, recovery, or a decision.`}>
          <span class="floor-metric tone-warn" aria-label={countLabel(overview.blocked, 'blocked task')}>
            <AlertTriangle size={16} />
            <strong>{overview.blocked}</strong>
          </span>
        </Tooltip>
        <Tooltip text={`${countLabel(overview.drafts, 'draft brief')}: task ideas waiting to become approved work.`}>
          <span class="floor-metric tone-draft" aria-label={countLabel(overview.drafts, 'draft brief')}>
            <FileClock size={16} />
            <strong>{overview.drafts}</strong>
          </span>
        </Tooltip>
        <Tooltip text={`${countLabel(overview.done, 'task done', 'tasks done')}: completed task records across all projects.`}>
          <span class="floor-metric tone-done" aria-label={countLabel(overview.done, 'task done', 'tasks done')}>
            <CheckCircle2 size={16} />
            <strong>{overview.done}</strong>
          </span>
        </Tooltip>
      </div>
    </section>

    <section class="dashboard" aria-label="Projects dashboard">
      <UtilityPanel className="dashboard-panel dashboard-panel-wide" tone="accent">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">Work mix</p>
            <h2>{countLabel(overview.taskTotal, 'task')}</h2>
          </div>
          <span class="panel-value">{countLabel(readyTaskCount, 'ready task')}</span>
        </div>
        <WorkMixChart
          ariaLabel={`Work mix across projects: ${overview.active} active, ${readyTaskCount} ready, ${needsYouCount} projects need attention, ${overview.done} done.`}
          segments={[
            {
              key: 'active',
              label: 'active',
              count: overview.active,
              tone: 'active',
              ariaLabel: `${countLabel(overview.active, 'active task')}: active or in-progress work.`,
              tooltip: `${countLabel(overview.active, 'active task')}: active or in-progress work.`,
            },
            {
              key: 'ready',
              label: 'ready',
              count: readyTaskCount,
              tone: 'ready',
              ariaLabel: `${countLabel(readyTaskCount, 'ready task')}: work that can be picked up without another brief review.`,
              tooltip: `${countLabel(readyTaskCount, 'ready task')}: work that can be picked up without another brief review.`,
            },
            {
              key: 'attention',
              label: 'projects need you',
              count: needsYouCount,
              tone: 'attention',
              ariaLabel: `${countLabel(needsYouCount, 'project needing attention', 'projects needing attention')}: projects with blocked work or draft briefs.`,
              tooltip: `${countLabel(needsYouCount, 'project needing attention', 'projects needing attention')}: projects with blocked work or draft briefs.`,
            },
            {
              key: 'done',
              label: 'done',
              count: overview.done,
              tone: 'done',
              ariaLabel: `${countLabel(overview.done, 'done task', 'done tasks')}: completed work.`,
              tooltip: `${countLabel(overview.done, 'done task', 'done tasks')}: completed work.`,
            },
          ]}
          emptyLabel="No tasks yet"
        />
      </UtilityPanel>
      <UtilityPanel className="dashboard-panel" tone={needsYouCount === 0 ? 'neutral' : 'warn'}>
        <div class="panel-head">
          <div>
            <p class="panel-kicker">Attention</p>
            <h2>{needsYouCount === 0 ? 'Clear' : countLabel(needsYouCount, 'project')}</h2>
          </div>
          <AlertTriangle size={18} />
        </div>
        <p class="panel-copy">
          {needsYouCount === 0
            ? 'No project needs your decision right now.'
            : `${firstNeedsYouProject?.name ?? 'A project'} has the first waiting item.`}
        </p>
      </UtilityPanel>
      <UtilityPanel className="dashboard-panel" tone={overview.running > 0 ? 'ok' : 'neutral'}>
        <div class="panel-head">
          <div>
            <p class="panel-kicker">Running now</p>
            <h2>{runningNowLabel(overview.running)}</h2>
          </div>
          <PlayCircle size={18} />
        </div>
        <div class="project-sparks" aria-label={`${overview.running} projects running now across ${overview.total} projects`}>
          {#each cards as card (card.id)}
            <Tooltip text={projectSparkTitle(card)} className="project-spark-tip">
              <span class:project-spark-live={card.canStop || optimisticRuns[card.id]} aria-label={projectSparkTitle(card)}></span>
            </Tooltip>
          {/each}
        </div>
      </UtilityPanel>
    </section>

    <div class="projects-area">
      <div class="grid">
        {#each cards as card (card.id)}
          <ProjectCard
            summary={card}
            busy={busyId === card.id}
            optimisticRunning={Boolean(optimisticRuns[card.id])}
            onInspect={inspectProject}
            onOpen={openProject}
            onStart={startProject}
            onStop={stopProject}
          />
        {/each}
      </div>
    </div>
  {/if}

  <SideDrawer
    open={selectedProject !== null}
    title={selectedProject?.name ?? 'Project details'}
    onClose={closeProjectDetails}
  >
    {#if selectedProject}
      <div class="project-drawer">
        <div class="drawer-identity">
          <p class="drawer-path">{selectedProject.path}</p>
          <div class="drawer-chips" aria-label="Project status summary">
            <Chip label={selectedProject.statusLabel} tone={selectedProject.tone === 'warn' ? 'warn' : selectedProject.tone === 'active' ? 'running' : selectedProject.tone === 'success' ? 'ok' : 'neutral'} />
            <Chip label={selectedProject.maturityLabel} tone="accent" />
          </div>
        </div>
        {#if selectedProject.blurb}
          <p class="drawer-blurb">{selectedProject.blurb}</p>
        {/if}
        <section class="drawer-section">
          <h3>Where it is</h3>
          <p><strong>{selectedProject.maturityLabel}:</strong> {selectedProject.maturityDescription}</p>
        </section>
        <section class="drawer-section">
          <h3>Current status</h3>
          <p>{selectedProject.activityLabel}</p>
          {#if selectedProject.recentLabel}
            <p class="drawer-muted">{selectedProject.recentLabel}</p>
          {/if}
        </section>
        {#if selectedProject.projectCheckIn?.needed || selectedProject.provider?.tone === 'warn' || selectedProject.gitStory}
          <section class="drawer-section">
            <h3>Needs attention</h3>
            {#if selectedProject.projectCheckIn?.needed}
              <p><strong>{selectedProject.projectCheckIn.title ?? 'Project check-in needed'}:</strong> {selectedProject.projectCheckIn.detail ?? 'Answer the first project questions in Thread.'}</p>
            {/if}
            {#if selectedProject.provider?.tone === 'warn'}
              <p><strong>Provider:</strong> {selectedProject.provider.title}</p>
            {/if}
            {#if selectedProject.gitStory}
              <p><strong>{selectedProject.gitStory.label}:</strong> {selectedProject.gitStory.title}</p>
            {/if}
          </section>
        {/if}
        <section class="drawer-section">
          <h3>Recent and next</h3>
          <div class="drawer-work-grid">
            <div class="drawer-work-card">
              <span class="drawer-work-label">Recently completed</span>
              <strong>{selectedProject.completedLabel ?? 'No completed task recorded yet'}</strong>
            </div>
            <div class="drawer-work-card">
              <span class="drawer-work-label">Next up</span>
              <strong>{selectedProject.nextLabel ?? 'No next task detected'}</strong>
            </div>
          </div>
        </section>
        <section class="drawer-section">
          <h3>Counts</h3>
          <div class="drawer-counts" aria-label="Project task counts">
            {#if selectedProject.counts.active > 0}
              <span class="drawer-count tone-running"><Activity size={13} /><strong>{selectedProject.counts.active}</strong><span>{countNoun(selectedProject.counts.active, 'active task')}</span></span>
            {/if}
            {#if selectedProject.counts.draftReview > 0}
              <span class="drawer-count tone-warn"><FileClock size={13} /><strong>{selectedProject.counts.draftReview}</strong><span>{countNoun(selectedProject.counts.draftReview, 'draft brief')}</span></span>
            {/if}
            {#if selectedProject.counts.blocked > 0}
              <span class="drawer-count tone-warn"><AlertTriangle size={13} /><strong>{selectedProject.counts.blocked}</strong><span>{countNoun(selectedProject.counts.blocked, 'blocked task')}</span></span>
            {/if}
            {#if selectedProject.counts.done > 0}
              <span class="drawer-count tone-ok"><CheckCircle2 size={13} /><strong>{selectedProject.counts.done}</strong><span>{countNoun(selectedProject.counts.done, 'done task')}</span></span>
            {/if}
            <span class="drawer-count tone-neutral"><PlayCircle size={13} /><strong>{selectedProject.counts.total}</strong><span>{countNoun(selectedProject.counts.total, 'total task')}</span></span>
          </div>
        </section>
      </div>
    {/if}

    {#snippet footer()}
      {#if selectedProject}
        <ActionBar>
          <Button variant="secondary" onclick={closeProjectDetails}>Close</Button>
          <Button variant="primary" onclick={() => openProject(selectedProject.id)}>Open project</Button>
        </ActionBar>
      {/if}
    {/snippet}
  </SideDrawer>
</ProjectsShell>

<style>
  .hero {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
    align-items: center;
  }
  .hero-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .hero-actions :global(.btn) {
    box-sizing: border-box;
    height: 34px;
    min-height: 34px;
    align-items: center;
  }
  .hero-actions :global(.default-model-button) {
    gap: var(--s-1);
    min-width: 0;
    max-width: min(22rem, 100%);
    padding-inline: var(--s-2);
  }
  .hero-actions :global(.default-model-button-warn) {
    border-color: color-mix(in srgb, var(--warn) 52%, var(--button-secondary-border));
    color: color-mix(in srgb, var(--warn) 72%, var(--text));
    box-shadow:
      0 0 12px color-mix(in srgb, var(--warn) 14%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 9%, transparent);
  }
  .default-model-copy {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    overflow: hidden;
  }
  .default-model-prefix {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-weight: 800;
    font-size: var(--fs-1);
  }
  .action-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.15rem;
    min-height: 1.15rem;
    padding: 0.08rem 0.42rem;
    box-sizing: border-box;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-base) 24%, transparent);
    color: currentColor;
    font-size: var(--fs-0);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .count-glyph {
    display: block;
    line-height: 1;
    transform: translateY(0.06em);
  }
  h1 {
    margin: 0;
    font-size: clamp(1.25rem, 1.8vw, 1.65rem);
    line-height: var(--lh-tight);
  }
  .lede {
    margin: var(--s-1) 0 0;
    max-width: 44rem;
    color: var(--text-muted);
    font-size: var(--fs-0);
  }
  .notice {
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3) var(--s-4);
    background: var(--bg-elevated);
  }
  .notice.warn {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
  }
  :global(.projects-shell.projects-home .projects-shell-body) {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    background:
      linear-gradient(90deg, transparent 0 9%, color-mix(in srgb, var(--accent) 10%, transparent) 9% 9.12%, transparent 9.12% 58%, color-mix(in srgb, var(--accent-2) 7%, transparent) 58% 58.1%, transparent 58.1%),
      repeating-linear-gradient(0deg, color-mix(in srgb, white 3%, transparent) 0 1px, transparent 1px 38px);
  }
  .empty {
    border: 1px dashed var(--border);
    border-radius: var(--r-3);
    padding: var(--s-6);
    color: var(--text-muted);
    background: var(--bg-elevated);
  }
  .empty h2 {
    margin-top: 0;
    color: var(--text);
  }
  .floor {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
    margin-bottom: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-2);
    background:
      var(--glass-reflect-violet),
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), color-mix(in srgb, white 1%, transparent)),
      var(--glass-bg);
    box-shadow: var(--glass-shadow), var(--glass-etch);
  }
  .floor-head {
    min-width: 0;
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .floor-kicker {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 700;
  }
  .floor-head .floor-kicker {
    margin-bottom: 0;
  }
  .floor-head strong {
    display: inline-flex;
    gap: var(--s-1);
    align-items: center;
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
  }
  .floor-head strong :global(svg) {
    color: var(--accent-2);
  }
  .guild-table {
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .guild-members {
    min-width: 0;
    display: flex;
    gap: var(--s-1);
  }
  .guild-member {
    --avatar-color: var(--avatar-system);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.22rem;
    border: 1px solid color-mix(in srgb, var(--avatar-color) 22%, var(--glass-border));
    border-radius: 999px;
    background: var(--glass-bg-strong);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 9%, transparent);
  }
  .guild-avatar {
    display: grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--avatar-color) 20%, transparent);
    color: color-mix(in srgb, var(--avatar-color) 84%, white);
    font-size: var(--fs-0);
    font-weight: 800;
  }
  .guild-member-active {
    border-color: color-mix(in srgb, var(--avatar-color) 42%, var(--border));
  }
  .guild-member-active .guild-avatar {
    background: color-mix(in srgb, var(--avatar-color) 30%, transparent);
    color: var(--avatar-color);
    animation: guild-member-working 1.6s ease-in-out infinite;
  }
  .avatar-tone-coordinator { --avatar-color: var(--avatar-coordinator); }
  .avatar-tone-spec { --avatar-color: var(--avatar-spec); }
  .avatar-tone-builder { --avatar-color: var(--avatar-builder); }
  .avatar-tone-reviewer { --avatar-color: var(--avatar-reviewer); }
  .avatar-tone-gate { --avatar-color: var(--avatar-gate); }
  .avatar-tone-human { --avatar-color: var(--avatar-human); }
  .avatar-tone-system { --avatar-color: var(--avatar-system); }
  @keyframes guild-member-working {
    0%, 100% {
      transform: translateX(0);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-2) 0%, transparent);
    }
    50% {
      transform: translateX(2px);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-2) 12%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .guild-member-active .guild-avatar {
      animation: none;
    }
  }
  .floor-metrics {
    min-width: 0;
    display: flex;
    justify-content: flex-end;
    gap: var(--s-1);
  }
  .floor-metric {
    min-width: 0;
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    justify-content: center;
    min-inline-size: 3.2rem;
    padding: 0.32rem var(--s-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-1);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 7%, transparent), transparent 52%),
      color-mix(in srgb, var(--glass-bg-strong) 86%, transparent);
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 750;
    line-height: 1.1;
  }
  .floor-metric strong {
    color: currentColor;
    font-size: var(--fs-1);
    line-height: 1;
  }
  .floor-metric.tone-running,
  .floor-metric.tone-active {
    color: var(--accent-2);
    border-color: color-mix(in srgb, var(--accent-2) 30%, var(--border));
  }
  .floor-metric.tone-warn,
  .floor-metric.tone-draft {
    color: var(--signal-warn-strong);
    border-color: color-mix(in srgb, var(--signal-warn-strong) 35%, var(--border));
  }
  .floor-metric.tone-done {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  }
  .dashboard {
    display: grid;
    grid-template-columns: minmax(22rem, 2fr) repeat(2, minmax(13rem, 1fr));
    gap: var(--s-2);
    padding-bottom: var(--s-2);
    align-items: stretch;
  }
  .dashboard-panel {
    min-width: 0;
    display: grid;
    gap: var(--s-2);
    align-content: start;
  }
  .panel-head {
    min-width: 0;
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: var(--s-3);
  }
  .panel-head :global(svg) {
    color: var(--text-muted);
    flex: none;
  }
  .panel-kicker {
    margin: 0 0 2px;
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 800;
    text-transform: uppercase;
  }
  .panel-head h2 {
    margin: 0;
    font-size: var(--fs-4);
    line-height: var(--lh-tight);
  }
  .panel-value,
  .panel-copy {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .panel-copy {
    margin: 0;
  }
  .project-drawer {
    display: grid;
    gap: var(--s-4);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .project-drawer p {
    margin: 0;
  }
  .drawer-identity {
    display: grid;
    gap: var(--s-2);
  }
  .drawer-path {
    font-family: var(--font-mono);
    font-size: var(--fs-1);
    color: var(--text-soft);
    overflow-wrap: anywhere;
  }
  .drawer-chips,
  .drawer-counts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: center;
  }
  .drawer-blurb {
    color: var(--text-readable);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .drawer-section {
    display: grid;
    gap: var(--s-2);
    padding-block-start: var(--s-3);
    border-top: 1px solid var(--border);
  }
  .drawer-section h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 800;
    text-transform: uppercase;
  }
  .drawer-section strong {
    color: var(--text);
  }
  .drawer-muted {
    color: var(--text-soft);
  }
  .drawer-work-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .drawer-work-card {
    min-width: 0;
    display: grid;
    gap: var(--s-1);
    padding: var(--s-3);
    border: 1px solid var(--glass-inset-border);
    border-radius: var(--r-2);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 5%, transparent), color-mix(in srgb, white 1%, transparent)),
      var(--glass-inset-bg);
    box-shadow: var(--glass-inset-etch);
  }
  .drawer-work-label {
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 800;
    text-transform: uppercase;
  }
  .drawer-work-card strong {
    color: var(--text-readable);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .drawer-count {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.48rem;
    border-radius: 999px;
    font-size: var(--fs-0);
    font-weight: 700;
    background: color-mix(in srgb, var(--glass-bg-strong) 82%, transparent);
    border: 1px solid var(--glass-border);
    color: var(--text-muted);
  }
  .drawer-count :global(svg) {
    flex: none;
  }
  .drawer-count strong {
    color: currentColor;
    font-variant-numeric: tabular-nums;
  }
  .drawer-count.tone-running {
    color: var(--accent-2);
    background: color-mix(in srgb, var(--accent-2) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent-2) 32%, var(--border));
  }
  .drawer-count.tone-warn {
    color: var(--signal-warn-strong);
    background: color-mix(in srgb, var(--signal-warn-strong) 13%, transparent);
    border-color: color-mix(in srgb, var(--signal-warn-strong) 32%, var(--border));
  }
  .drawer-count.tone-ok {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
  }
  @media (max-width: 680px) {
    .drawer-work-grid {
      grid-template-columns: 1fr;
    }
  }
  .project-sparks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(1.4rem, 1fr));
    gap: var(--s-1);
  }
  .project-sparks span {
    height: 2rem;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--text-muted) 12%, transparent);
  }
  .project-sparks .project-spark-live {
    border-color: color-mix(in srgb, var(--accent-2) 42%, var(--border));
    background: color-mix(in srgb, var(--accent-2) 22%, transparent);
  }
  :global(.project-sparks .project-spark-tip) {
    display: block;
    min-width: 0;
  }
  :global(.project-sparks .project-spark-tip > span:first-child) {
    display: block;
    width: 100%;
    height: 2rem;
  }
  .projects-area {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-2);
    align-items: start;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: stretch;
  }
  .grid :global(section.project-card) {
    flex: 1 1 24rem;
  }
  @media (max-width: 720px) {
    .hero {
      align-items: start;
      flex-direction: column;
    }
    .hero-actions,
    .hero-actions :global(button) {
      width: 100%;
      justify-content: center;
    }
    .grid {
      flex-direction: column;
    }
    .projects-area {
      grid-template-columns: 1fr;
    }
    .grid :global(section.project-card) {
      width: 100%;
      flex-basis: auto;
    }
    .floor {
      grid-template-columns: 1fr;
    }
    .dashboard {
      grid-template-columns: 1fr;
    }
    .guild-members {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .floor-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
