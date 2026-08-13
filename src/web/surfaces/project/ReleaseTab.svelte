<!--
  Release readiness view. Primary/secondary/overflow IA:
    · Primary: single verdict band — shared status treatment + one-line reason.
    · Secondary: only unresolved release exceptions, each with its task route.
    · Overflow: no success ledger or task-state tally; the Work route owns inventory.
-->
<script lang="ts">
  import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../lib/Button.svelte'
  import { taskDisplayKey } from '../../lib/identifier-labels.js'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { releaseVerdictSummary } from '../../lib/release-readiness.js'
  import type { ProjectDetail, ProjectOrientationSpine, ProjectReleaseReadiness, ProjectSummaryRelease } from '../../lib/types.js'

  interface ReleaseItem {
    id?: string
    taskId?: string
    title?: string
    taskTitle?: string
    label?: string
    reason?: string
    detail?: string
    summary?: string
  }

  interface ReleasePayload extends ProjectReleaseReadiness {
    ready?: boolean
    notReadyReason?: string
    initializationNeeded?: boolean
    error?: string
    release?: {
      id?: string
      kind?: string
      label?: string
      state?: string
      source?: string
      description?: string | null
    }
    scope?: {
      kind?: string
      label?: string
      description?: string | null
    }
    openEscalations: ReleaseItem[]
    incompleteBriefs?: ReleaseItem[]
    unapprovedBriefs: ReleaseItem[]
    unapprovedSpecs: ReleaseItem[]
    shelvedUnclaimed: ReleaseItem[]
    blockedByAgent: ReleaseItem[]
    proofMissingDoneTasks?: ReleaseItem[]
    releaseBlockers?: ReleaseItem[]
    designSystem: {
      drafted: boolean
      approved: boolean
      revision?: number
      source?: 'guildhall' | 'repo' | 'none' | string
      label?: string
      reason?: string
    }
    dirtyCheckout?: {
      ownedCount: number
      files: string[]
      error?: string
    }
    gitStory?: {
      ready?: boolean
      state?: string
      blockers?: Array<{
        id?: string
        label?: string
        repoId?: string
        repoLabel?: string
        state?: string
        reason?: string
        nextAction?: string
        taskId?: string
      }>
    }
    statusCounts: Record<string, number>
    totals: {
      blockingCount: number
      humanBlockingCount?: number
      unfinishedCount?: number
      proofEvidenceBlockingCount?: number
      designSystemBlockingCount?: number
      dirtyCheckoutBlockingCount?: number
      gitStoryBlockingCount?: number
      tasks: number
      done: number
    }
    checksLoaded?: boolean
  }

  type GitStoryBlocker = NonNullable<NonNullable<ReleasePayload['gitStory']>['blockers']>[number]

  interface Props {
    subView?: string | null
    activeProjectId?: string | null
    projectSummary?: ProjectSummaryRelease | null
    projectDetail?: ProjectDetail | null
  }
  let { subView = null, activeProjectId = null, projectSummary = null, projectDetail = null }: Props = $props()
  const section = $derived(subView ?? 'verdict')

  let data = $state<ReleasePayload | null>(null)
  let spine = $state<ProjectOrientationSpine | null>(null)
  let error = $state<string | null>(null)
  let initNeeded = $state(false)
  let closeBusy = $state(false)
  let closeError = $state<string | null>(null)

  $effect(() => {
    let disposed = false
    const endpoint = section === 'criteria'
      ? '/api/project/release-readiness?live=true'
      : '/api/project/release-readiness/summary'
    data = null
    error = null
    initNeeded = false
    projectFetch(endpoint, undefined, activeProjectId)
      .then(r => r.json())
      .then(j => {
        if (disposed) return
        if (j?.initializationNeeded) {
          initNeeded = true
          return
        }
        if (j?.error) {
          error = j.error
          return
        }
        const payload = j as Partial<ReleasePayload>
        const compatibilityDetailPayload = payload.designSystem !== undefined ||
          payload.dirtyCheckout !== undefined || payload.gitStory !== undefined
        data = {
          ...payload,
          checksLoaded: payload.checksLoaded === true || compatibilityDetailPayload,
          openEscalations: Array.isArray(payload.openEscalations) ? payload.openEscalations : [],
          incompleteBriefs: Array.isArray(payload.incompleteBriefs) ? payload.incompleteBriefs : [],
          unapprovedBriefs: Array.isArray(payload.unapprovedBriefs) ? payload.unapprovedBriefs : [],
          unapprovedSpecs: Array.isArray(payload.unapprovedSpecs) ? payload.unapprovedSpecs : [],
          shelvedUnclaimed: Array.isArray(payload.shelvedUnclaimed) ? payload.shelvedUnclaimed : [],
          blockedByAgent: Array.isArray(payload.blockedByAgent) ? payload.blockedByAgent : [],
          proofMissingDoneTasks: Array.isArray(payload.proofMissingDoneTasks) ? payload.proofMissingDoneTasks : [],
          releaseBlockers: Array.isArray(payload.releaseBlockers) ? payload.releaseBlockers : [],
          statusCounts: payload.statusCounts && typeof payload.statusCounts === 'object' ? payload.statusCounts : {},
          designSystem: payload.designSystem ?? {
            drafted: false,
            approved: false,
            source: 'none',
            label: 'Details not loaded',
          },
          totals: {
            blockingCount: payload.totals?.blockingCount ?? 0,
            humanBlockingCount: payload.totals?.humanBlockingCount ?? 0,
            ...(payload.totals?.unfinishedCount !== undefined ? { unfinishedCount: payload.totals.unfinishedCount } : {}),
            ...(payload.totals?.proofEvidenceBlockingCount !== undefined ? { proofEvidenceBlockingCount: payload.totals.proofEvidenceBlockingCount } : {}),
            ...(payload.totals?.designSystemBlockingCount !== undefined ? { designSystemBlockingCount: payload.totals.designSystemBlockingCount } : {}),
            ...(payload.totals?.dirtyCheckoutBlockingCount !== undefined ? { dirtyCheckoutBlockingCount: payload.totals.dirtyCheckoutBlockingCount } : {}),
            ...(payload.totals?.gitStoryBlockingCount !== undefined ? { gitStoryBlockingCount: payload.totals.gitStoryBlockingCount } : {}),
            tasks: payload.totals?.tasks ?? 0,
            done: payload.totals?.done ?? 0,
          },
        } as ReleasePayload
      })
      .catch(err => {
        if (disposed) return
        error = err instanceof Error ? err.message : String(err)
      })
    return () => {
      disposed = true
    }
  })

  $effect(() => {
    let disposed = false
    spine = null
    projectFetch('/api/project/spine?compact=true', { cache: 'no-store' }, activeProjectId)
      .then(r => r.json())
      .then(j => {
        if (disposed) return
        spine = (j?.spine ?? null) as ProjectOrientationSpine | null
      })
      .catch(() => {
        if (disposed) return
        spine = null
      })
    return () => {
      disposed = true
    }
  })

  function idOf(it: ReleaseItem): string {
    return (it.id ?? it.taskId) ?? ''
  }

  function titleOf(it: ReleaseItem): string {
    return it.title ?? it.taskTitle ?? idOf(it)
  }

  function extraOf(it: ReleaseItem): string {
    return readableDetail(it.reason ?? it.detail ?? it.summary ?? it.label ?? '')
  }

  function escalationDetailOf(it: ReleaseItem): string {
    return readableDetail(it.summary ?? it.detail ?? it.label ?? titleOf(it) ?? it.reason ?? '')
  }

  function readableDetail(value: string): string {
    return value.replace(/^[a-z][a-z0-9_]+:\s*/i, '').trim()
  }

  function openTask(id: string) {
    if (id) nav(currentTaskHref(id, activeProjectId))
  }

  function openGitDecision(taskId: string) {
    if (taskId) nav(`${currentTaskHref(taskId, activeProjectId)}?detail=full&tab=provenance`)
  }

  async function shipRelease() {
    const releaseId = data?.release?.id
    if (!releaseId || closeBusy) return
    closeBusy = true
    closeError = null
    try {
      const response = await projectFetch('/api/project/release/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ releaseId }),
      }, activeProjectId)
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Could not ship this release.')
      if (payload.release && typeof payload.release === 'object' && !Array.isArray(payload.release)) {
        data = { ...data, release: payload.release as ReleasePayload['release'] }
      }
      const [summaryResponse, spineResponse] = await Promise.all([
        projectFetch('/api/project/release-readiness/summary', { cache: 'no-store' }, activeProjectId),
        projectFetch('/api/project/spine?compact=true', { cache: 'no-store' }, activeProjectId),
      ])
      const summary = await summaryResponse.json().catch(() => null) as Partial<ReleasePayload> | null
      if (summary && !summary.error) data = { ...data, ...summary }
      const spinePayload = await spineResponse.json().catch(() => null) as { spine?: ProjectOrientationSpine | null } | null
      spine = spinePayload?.spine ?? spine
    } catch (err) {
      closeError = err instanceof Error ? err.message : String(err)
    } finally {
      closeBusy = false
    }
  }

  interface Criterion {
    key: string
    label: string
    items: ReleaseItem[]
  }

  const criteria = $derived<Criterion[]>(
    data
      ? [
          {
            key: 'escalations',
            label: 'Open escalations',
            items: data.openEscalations,
          },
          {
            key: 'incomplete-briefs',
            label: 'Incomplete briefs',
            items: data.incompleteBriefs ?? [],
          },
          {
            key: 'briefs',
            label: 'Unapproved briefs',
            items: data.unapprovedBriefs,
          },
          {
            key: 'specs',
            label: 'Specs awaiting approval',
            items: data.unapprovedSpecs,
          },
          {
            key: 'proof',
            label: 'Proof evidence',
            items: data.proofMissingDoneTasks ?? [],
          },
          {
            key: 'shelved',
            label: 'Shelved tasks',
            items: data.shelvedUnclaimed,
          },
          {
            key: 'blocked',
            label: 'Agent-blocked tasks',
            items: data.blockedByAgent,
          },
        ]
      : [],
  )

  function normalizedGitStoryState(state: string | undefined): string {
    return String(state ?? '').trim().toLowerCase()
  }

  function isGitInspectionFailure(blocker: GitStoryBlocker): boolean {
    const haystack = `${blocker.state ?? ''}\n${blocker.reason ?? ''}\n${blocker.nextAction ?? ''}`.toLowerCase()
    return (
      normalizedGitStoryState(blocker.state) === 'unknown' ||
      haystack.includes('spawn git enoent') ||
      haystack.includes('fatal: not a git repository') ||
      haystack.includes('could not read it')
    )
  }

  function repoAwareGitLabel(blocker: GitStoryBlocker, label: string): string {
    return blocker.repoLabel ? `${blocker.repoLabel}: ${label}` : label
  }

  function gitBlockerCopy(blocker: GitStoryBlocker): { label: string; detail: string } {
    if (isGitInspectionFailure(blocker)) {
      return {
        label: repoAwareGitLabel(blocker, 'Could not inspect this checkout.'),
        detail: 'Check that the attached path or child repo is reachable and that git is available to the runtime.',
      }
    }
    const haystack = `${blocker.state ?? ''}\n${blocker.reason ?? ''}\n${blocker.nextAction ?? ''}`.toLowerCase()
    if (haystack.includes('no upstream')) {
      return {
        label: repoAwareGitLabel(blocker, 'A branch needs a sharing decision.'),
        detail: 'Push it, open a PR, or mark the work local-only/deferred if it should not be shared.',
      }
    }
    if (haystack.includes('dirty') || haystack.includes('uncommitted')) {
      return {
        label: repoAwareGitLabel(blocker, 'A checkout has uncommitted work.'),
        detail: 'Review the diff, then commit it or mark the work local-only/deferred.',
      }
    }
    return {
      label: repoAwareGitLabel(blocker, blocker.reason ?? blocker.label ?? blocker.state ?? 'Repository follow-up.'),
      detail: blocker.nextAction ?? (blocker.label && blocker.reason ? blocker.reason : ''),
    }
  }

  function gitBlockerKey(blocker: GitStoryBlocker): string {
    const copy = gitBlockerCopy(blocker)
    if (isGitInspectionFailure(blocker)) return `inspection:${blocker.taskId ?? blocker.id ?? 'project'}`
    return [
      normalizedGitStoryState(blocker.state),
      blocker.taskId ?? '',
      blocker.id ?? '',
      copy.label,
      copy.detail,
    ].join('|')
  }

  function dedupeGitBlockers(blockers: GitStoryBlocker[]): GitStoryBlocker[] {
    const seen = new Set<string>()
    const out: GitStoryBlocker[] = []
    for (const blocker of blockers) {
      const key = gitBlockerKey(blocker)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(blocker)
    }
    return out
  }

  const gitStoryBlockers = $derived(dedupeGitBlockers(data?.gitStory?.blockers ?? []))
  const visibleGitStoryBlockers = $derived(gitStoryBlockers.slice(0, 5))
  const openCriteria = $derived(criteria.filter(criterion => criterion.items.length > 0))
  const hasNamedRelease = $derived(Boolean(data?.release?.label ?? projectSummary?.release?.label))
  const readinessTitle = $derived(hasNamedRelease ? 'Release readiness' : 'Scope readiness')

  const verdict = $derived(data ? releaseVerdictSummary(data) ?? { label: 'Loading', tone: 'neutral' as const, detail: '', state: 'empty' } : { label: 'Loading', tone: 'neutral' as const, detail: '', state: 'empty' })
  const verdictTitle = $derived(data?.verdict?.title ?? verdict.label)
  const releaseShipped = $derived(data?.release?.state === 'shipped')
  const canShipRelease = $derived(Boolean(data?.release?.id) && !releaseShipped && verdict.state === 'ready')
  const ownerAction = $derived(projectDetail?.actionModel?.primaryAction ?? null)
  const ownerActionTaskKey = $derived(ownerAction?.taskId ? taskDisplayKey(ownerAction.taskId, [], activeProjectId) : null)
  const hasOwnerAction = $derived(Boolean(ownerAction?.href && ownerAction?.buttonLabel))
  const ownerActionHeading = $derived(ownerAction?.code === 'ready_work' ? 'Ready to continue' : 'What needs your attention')

  const sectionCopy = $derived(
    section === 'criteria'
      ? {
          title: hasNamedRelease ? 'Release checks' : 'Scope checks',
          description: '',
        }
      : {
          title: releaseShipped ? 'Release shipped' : readinessTitle,
          description: '',
          },
  )
  const releaseLabel = $derived(data?.release?.label ?? data?.scope?.label ?? projectSummary?.release?.label ?? spine?.summary?.selectedScopeLabel ?? spine?.selectedTaskScope?.label ?? spine?.scope?.label ?? spine?.summary?.selectedReleaseLabel ?? spine?.selectedRelease?.label ?? 'Unreleased work')
  const spineReleaseLabel = $derived(spine?.summary?.selectedScopeLabel ?? spine?.selectedTaskScope?.label ?? spine?.scope?.label ?? spine?.summary?.selectedReleaseLabel ?? spine?.selectedRelease?.label ?? projectSummary?.release?.label ?? 'Unreleased work')

  const statusRows = $derived(
    data ? Object.entries(data.statusCounts).sort((a, b) => b[1] - a[1]) : [],
  )
  const taskDoneLabel = $derived(data?.totals.tasks === 0 ? 'No tracked work yet' : `${data?.totals.done ?? 0}/${data?.totals.tasks ?? 0} done`)
  const spineReleaseBlocker = $derived(spine?.release?.blockers?.[0] ?? null)
  const spineBlockerNode = $derived(spineReleaseBlocker?.owningNodeId ? spine?.nodes?.[spineReleaseBlocker.owningNodeId] ?? null : null)
  const spineTopBlockerLabel = $derived.by(() => {
    const blocker = spine?.summary?.topBlocker
    if (!blocker) return spineReleaseBlocker?.label ?? null
    return typeof blocker === 'string' ? blocker : blocker.label ?? spineReleaseBlocker?.label ?? null
  })
  const spineScopeCounts = $derived.by(() => {
    if (!spine?.summary) return ''
    const included = spine.summary.includedWorkCount ?? spine.summary.includedCount ?? 0
    const deferred = spine.summary.deferredWorkCount ?? spine.summary.deferredCount ?? 0
    return `${included} included · ${deferred} later`
  })
</script>

{#if initNeeded}
  <NoticeBand tone="warn" role="note" label="Release" title="Project not initialized yet">
    {#snippet actions()}
      <a class="notice-link" href={currentProjectHref('/setup')}>Open setup wizard</a>
    {/snippet}
    <p>Complete the setup wizard before assessing release readiness.</p>
  </NoticeBand>
{:else if error}
  <NoticeBand tone="danger" role="alert" label="Release" title="Could not load release checks">
    <p>{error}</p>
  </NoticeBand>
{:else if !data}
  <NoticeBand tone="neutral" role="status" label="Release" title={section === 'criteria' ? 'Loading release checks' : 'Loading release summary'}>
    <p>{section === 'criteria' ? 'Collecting detailed task, approval, repository, and checkout checks…' : 'Loading the saved current release summary…'}</p>
  </NoticeBand>
{:else}
  <div class="release-shell">
    <SectionHeader
      eyebrow={releaseLabel}
      title={sectionCopy.title}
      description={sectionCopy.description}
      headingTag="h2"
      density="compact"
    >
      {#snippet meta()}
        {#if releaseShipped}
          <StatusPill label="Shipped" tone="ok" />
        {:else}
          <StatusPill label={taskDoneLabel} tone="neutral" />
        {/if}
      {/snippet}
    </SectionHeader>

    {#if closeError}
      <NoticeBand tone="danger" role="alert" label="Release" title="Could not ship release">
        <p>{closeError}</p>
      </NoticeBand>
    {/if}

    {#if spine?.summary?.headline && !hasNamedRelease && (section === 'criteria' || !releaseShipped)}
      <FrameCard
        tone={spineTopBlockerLabel ? 'warn' : 'neutral'}
        padding="compact"
        class="release-spine-card"
      >
        <div class="release-spine">
          <div>
            <span class="release-spine-label">{spineReleaseLabel}</span>
            <strong>{spine.summary.headline}</strong>
            <p>{spine.summary.purpose ?? spine.charter?.goal ?? 'Project purpose has not been pinned yet.'}</p>
          </div>
          <div class="release-spine-side">
            {#if spineScopeCounts}
              <StatusPill label={spineScopeCounts} tone="neutral" />
            {/if}
            {#if spineTopBlockerLabel}
              <span>Top blocker: {spineTopBlockerLabel}</span>
            {/if}
            {#if spineBlockerNode}
              <button type="button" onclick={() => openTask(spineBlockerNode.refs?.taskIds?.[0] ?? '')}>{spineBlockerNode.title}</button>
            {/if}
          </div>
        </div>
      </FrameCard>
    {/if}

    {#if section === 'verdict'}
      {#if releaseShipped}
        <NoticeBand tone="ok" role="status" label="Release" title="This release is complete">
          <p>There is nothing you need to do here.</p>
        </NoticeBand>
      {:else}
        <FrameCard
          tone={ownerAction?.tone === 'danger' ? 'danger' : ownerAction?.tone === 'warn' ? 'warn' : verdict.tone === 'ok' ? 'ok' : 'neutral'}
          padding="compact"
          class="release-action-card"
        >
          <div class="release-action">
            <div>
              <p class="release-action-label">{hasOwnerAction ? ownerActionHeading : 'Release status'}</p>
              <h3>{hasOwnerAction ? ownerAction?.label : verdictTitle}</h3>
              {#if ownerAction?.taskLabel}
                <p class="release-action-task" title={ownerAction.taskLabel}>
                  {#if ownerActionTaskKey}<span>{ownerActionTaskKey}</span>{/if}
                  {ownerAction.taskLabel}
                </p>
              {/if}
              <p>{hasOwnerAction ? ownerAction?.detail : verdict.detail}</p>
            </div>
            <div class="release-action-controls">
              {#if hasOwnerAction}
                <Button
                  variant={ownerAction?.tone === 'warn' || ownerAction?.tone === 'danger' ? 'human' : 'primary'}
                  onclick={() => nav(projectActionHref(ownerAction?.href ?? '/work', activeProjectId))}
                >
                  {ownerAction?.buttonLabel}
                </Button>
              {:else if canShipRelease}
                <Button variant="primary" disabled={closeBusy} onclick={() => void shipRelease()}>
                  {closeBusy ? 'Shipping…' : 'Ship release'}
                </Button>
              {/if}
              <Button variant="ghost" size="sm" onclick={() => nav(currentProjectHref('/release/criteria', activeProjectId))}>
                Inspect release details
              </Button>
            </div>
          </div>
        </FrameCard>
      {/if}
    {/if}

    {#if section === 'criteria'}
      <FrameCard class="criteria-card">
        {#snippet header()}
          <SectionHeader
            title="Release exceptions"
            description="Only checks with work left are shown here."
            headingTag="h3"
            density="dense"
          />
        {/snippet}

        {#if openCriteria.length === 0 && gitStoryBlockers.length === 0}
          <p class="muted">No release exceptions.</p>
        {:else}
          <ul class="criteria">
            {#each openCriteria as c (c.key)}
              <li class="crit-row">
                <div class="crit-summary">
                  <span class="crit-copy">
                    <span class="crit-label">{c.label}</span>
                    <span class="crit-detail">{c.items.length} task{c.items.length === 1 ? '' : 's'} still open.</span>
                  </span>
                  <StatusPill label={`${c.items.length} open`} tone="warn" />
                </div>
                <ul class="crit-items">
                  {#each c.items as it, i (i)}
                    <li>
                      <button type="button" class="link" onclick={() => openTask(idOf(it))}>
                        {titleOf(it)}
                      </button>
                      {#if extraOf(it)}
                        <span class="muted">{extraOf(it)}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}

            {#if gitStoryBlockers.length > 0}
              <li class="crit-row">
                <div class="crit-summary">
                  <span class="crit-copy">
                    <span class="crit-label">Repository follow-up</span>
                    <span class="crit-detail">{gitStoryBlockers.length} repository follow-up{gitStoryBlockers.length === 1 ? '' : 's'}.</span>
                  </span>
                  <StatusPill label={`${gitStoryBlockers.length} open`} tone="warn" />
                </div>
                {#if gitStoryBlockers.length > visibleGitStoryBlockers.length}
                  <p class="muted">Showing {visibleGitStoryBlockers.length} of {gitStoryBlockers.length} repository follow-ups.</p>
                {/if}
                <ul class="crit-items">
                  {#each visibleGitStoryBlockers as blocker, index (`${blocker.id ?? 'git'}:${index}`)}
                    {@const copy = gitBlockerCopy(blocker)}
                    <li>
                      {#if blocker.taskId}
                        <button type="button" class="link" onclick={() => openGitDecision(blocker.taskId ?? '')}>
                          {copy.label}
                        </button>
                      {:else}
                        <span>{copy.label}</span>
                      {/if}
                      <span class="muted">{copy.detail}</span>
                    </li>
                  {/each}
                </ul>
              </li>
            {/if}
          </ul>
        {/if}
      </FrameCard>
    {/if}
  </div>
{/if}

<style>
  .release-shell {
    display: grid;
    gap: var(--gh-space-4);
    container-type: inline-size;
  }

  :global(.criteria-card) {
    min-inline-size: 0;
  }

  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .release-action {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--gh-space-4);
  }

  .release-action > div:first-child {
    min-inline-size: 0;
  }

  .release-action-label,
  .release-action p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .release-action-label {
    margin-bottom: var(--gh-space-1) !important;
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
  }

  .release-action h3 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }

  .release-action-task {
    display: flex;
    gap: var(--gh-space-2);
    margin-top: var(--gh-space-1) !important;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .release-action-task span {
    flex: none;
    font-family: var(--gh-font-mono, ui-monospace, monospace);
  }

  .release-action-controls {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    justify-content: flex-end;
  }

  .release-spine {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(16rem, 0.75fr);
    gap: var(--gh-space-4);
    align-items: start;
  }

  .release-spine div {
    display: grid;
    gap: var(--gh-space-1);
    min-width: 0;
  }

  .release-spine-label,
  .release-spine p,
  .release-spine-side span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .release-spine strong {
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
    overflow-wrap: anywhere;
  }

  .release-spine p {
    margin: 0;
  }

  .release-spine-side {
    justify-items: start;
    max-inline-size: 36rem;
  }

  .release-spine-side button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    font-weight: var(--gh-type-weight-strong);
    text-align: left;
  }

  .criteria {
    list-style: none;
    display: grid;
    gap: 0;
    padding: 0;
  }

  .crit-row {
    border-top: 1px solid var(--border);
  }

  .crit-row:first-child {
    border-top: none;
  }

  .crit-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-3);
    align-items: center;
    padding: var(--gh-space-3) 0;
  }

  .crit-copy {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: 0;
  }

  .crit-label {
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  .crit-detail {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .crit-items {
    list-style: none;
    display: grid;
    gap: var(--gh-space-2);
    padding: 0 0 var(--gh-space-3) 0;
  }

  .crit-items li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: baseline;
  }

  .link,
  .notice-link {
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
    text-decoration: underline;
  }

  @container (max-width: 760px) {
    .release-spine {
      grid-template-columns: minmax(0, 1fr);
    }

    .release-spine-side {
      max-inline-size: none;
    }
  }

  .notice-link {
    min-height: var(--gh-control-height-default);
    padding: var(--gh-control-padding-block) var(--gh-control-padding-inline);
    border: 1px solid var(--gh-color-border-strong);
    border-radius: var(--gh-radius-full);
    color: var(--gh-color-text-primary);
    text-decoration: none;
  }

  .notice-link:hover {
    background: color-mix(in srgb, var(--gh-color-feedback-warn) 14%, transparent);
  }

  @media (max-width: 720px) {
    .release-spine,
    .release-action {
      grid-template-columns: 1fr;
    }

    .release-action {
      align-items: stretch;
      flex-direction: column;
    }

    .release-action-controls {
      justify-content: flex-start;
    }
  }
</style>
