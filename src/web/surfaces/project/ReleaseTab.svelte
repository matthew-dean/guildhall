<!--
  Release readiness view. Primary/secondary/overflow IA:
    · Primary: single verdict band — shared status treatment + one-line reason.
    · Secondary: criteria list, one row per check, expandable into task links.
    · Overflow: compact release counts and task-state tally.
-->
<script lang="ts">
  import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../lib/Button.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../../lib/project-routes.js'
  import { releaseVerdictSummary } from '../../lib/release-readiness.js'
  import type { ProjectOrientationSpine, ProjectReleaseReadiness, ProjectSummaryRelease } from '../../lib/types.js'

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
  }
  let { subView = null, activeProjectId = null, projectSummary = null }: Props = $props()
  const section = $derived(subView ?? 'verdict')

  let data = $state<ReleasePayload | null>(null)
  let spine = $state<ProjectOrientationSpine | null>(null)
  let error = $state<string | null>(null)
  let initNeeded = $state(false)
  let closeBusy = $state(false)
  let closeError = $state<string | null>(null)

  $effect(() => {
    const endpoint = section === 'criteria'
      ? '/api/project/release-readiness'
      : '/api/project/release-readiness/summary'
    projectFetch(endpoint, undefined, activeProjectId)
      .then(r => r.json())
      .then(j => {
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
        error = err instanceof Error ? err.message : String(err)
      })
  })

  $effect(() => {
    projectFetch('/api/project/spine?compact=true', { cache: 'no-store' }, activeProjectId)
      .then(r => r.json())
      .then(j => {
        spine = (j?.spine ?? null) as ProjectOrientationSpine | null
      })
      .catch(() => {
        spine = null
      })
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

  function isWorkReleaseBlocker(item: ReleaseItem): boolean {
    const id = idOf(item)
    return !(
      id.startsWith('repository-followup:') ||
      id === 'dirty-checkout' ||
      id === 'design-system'
    )
  }

  interface Criterion {
    key: string
    label: string
    items: ReleaseItem[]
    clearLabel: string
  }

  const criteria = $derived<Criterion[]>(
    data
      ? [
          {
            key: 'release-blockers',
            label: hasNamedRelease ? 'Release blockers' : 'Scope blockers',
            items: (data.releaseBlockers ?? []).filter(isWorkReleaseBlocker),
            clearLabel: `No open ${blockerNoun}s.`,
          },
          {
            key: 'escalations',
            label: 'Open escalations',
            items: data.openEscalations,
            clearLabel: 'No open escalations.',
          },
          {
            key: 'incomplete-briefs',
            label: 'Incomplete briefs',
            items: data.incompleteBriefs ?? [],
            clearLabel: 'No incomplete briefs.',
          },
          {
            key: 'briefs',
            label: 'Unapproved briefs',
            items: data.unapprovedBriefs,
            clearLabel: 'All briefs approved.',
          },
          {
            key: 'specs',
            label: 'Specs awaiting approval',
            items: data.unapprovedSpecs,
            clearLabel: 'No specs awaiting approval.',
          },
          {
            key: 'proof',
            label: 'Proof evidence',
            items: data.proofMissingDoneTasks ?? [],
            clearLabel: 'Completed work has proof evidence.',
          },
          {
            key: 'shelved',
            label: 'Shelved tasks',
            items: data.shelvedUnclaimed,
            clearLabel: 'No shelved tasks.',
          },
          {
            key: 'blocked',
            label: 'Agent-blocked tasks',
            items: data.blockedByAgent,
            clearLabel: 'No agent-blocked tasks.',
          },
        ]
      : [],
  )

  const dsLabel = $derived(() => {
    if (!data?.checksLoaded) return { label: 'details not loaded', tone: 'neutral' as const, clear: true }
    const ds = data?.designSystem
    if (!ds) return { label: 'not captured', tone: 'warn' as const, clear: false }
    if (!ds.drafted) return { label: ds.label ?? 'not captured', tone: 'warn' as const, clear: false }
    if (ds.source === 'repo') {
      return { label: ds.label ?? 'detected in repo', tone: 'ok' as const, clear: true }
    }
    if (ds.approved) {
      return { label: ds.label ?? `approved · rev ${ds.revision ?? 0}`, tone: 'ok' as const, clear: true }
    }
    return { label: ds.label ?? `draft · rev ${ds.revision ?? 0}`, tone: 'warn' as const, clear: false }
  })

  const unfinishedCount = $derived.by(() => {
    if (!data) return 0
    const terminal = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
    return Object.entries(data.statusCounts).reduce((total, [status, count]) => {
      return terminal.has(status) ? total : total + count
    }, 0)
  })
  const dirtyCheckoutCount = $derived(data?.dirtyCheckout?.ownedCount ?? 0)
  const dirtyCheckoutError = $derived(data?.dirtyCheckout?.error ?? '')
  const checkoutInspectionError = $derived(
    dirtyCheckoutError
      ? /git status|fatal: not a git repository|spawn git enoent/i.test(dirtyCheckoutError)
        ? 'Guildhall could not inspect the configured repository boundary with git. Check that git is available and that any workspace child repos are reachable.'
        : dirtyCheckoutError
      : '',
  )
  const managedCheckoutFilesLabel = (count: number): string =>
    `${count} Guildhall-managed checkout ${count === 1 ? 'file' : 'files'}`
  const managedCheckoutNeedsVerb = (count: number): string =>
    count === 1 ? 'needs' : 'need'
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

  function statusLabel(status: string): string {
    switch (status) {
      case 'exploring': return 'Being shaped'
      case 'import_draft': return 'Imported drafts'
      case 'gate_check': return 'Gate checks'
      case 'spec_review': return 'Spec review'
      case 'in_progress': return 'In progress'
      case 'pending_pr': return 'Pending PR'
      case 'ready': return 'Ready'
      case 'blocked': return 'Blocked'
      case 'done': return 'Done'
      case 'shelved': return 'Shelved'
      default: return status.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }
  }

  const gitStoryBlockers = $derived(dedupeGitBlockers(data?.gitStory?.blockers ?? []))
  const visibleGitStoryBlockers = $derived(gitStoryBlockers.slice(0, 5))
  const designSystemBlockingCount = $derived(data?.totals.designSystemBlockingCount ?? (dsLabel().clear ? 0 : 1))
  const hasNamedRelease = $derived(Boolean(data?.release?.label ?? projectSummary?.release?.label))
  const readinessNoun = $derived(hasNamedRelease ? 'release' : 'scope')
  const readinessTitle = $derived(hasNamedRelease ? 'Release readiness' : 'Scope readiness')
  const blockerNoun = $derived(hasNamedRelease ? 'release blocker' : 'scope blocker')
  const openCheckNoun = $derived(hasNamedRelease ? 'release check' : 'scope check')
  const openCheckCount = $derived(Math.max(data?.totals.blockingCount ?? 0, unfinishedCount))

  const verdict = $derived(data ? releaseVerdictSummary(data) ?? { label: 'Loading', tone: 'neutral' as const, detail: '', state: 'empty' } : { label: 'Loading', tone: 'neutral' as const, detail: '', state: 'empty' })
  const releaseShipped = $derived(data?.release?.state === 'shipped')
  const canShipRelease = $derived(Boolean(data?.release?.id) && !releaseShipped && verdict.state === 'ready')

  const sectionCopy = $derived(
    section === 'criteria'
        ? {
          title: hasNamedRelease ? 'Release checks' : 'Scope checks',
          description: hasNamedRelease
            ? 'Expand any row to inspect the tasks, approvals, checkout state, and repository follow-ups for the current release.'
            : 'Expand any row to inspect the tasks, approvals, checkout state, and repository follow-ups for the current project scope.',
        }
      : {
          title: readinessTitle,
          description: data?.release?.description ?? data?.scope?.description
            ?? (hasNamedRelease
              ? 'A quick read on whether the current release is ready to hand off, ship, or deliberately defer.'
              : 'A quick read on whether the current project scope is ready to hand off, ship, or deliberately defer.'),
          },
  )
  const releaseLabel = $derived(data?.release?.label ?? data?.scope?.label ?? projectSummary?.release?.label ?? spine?.summary?.selectedScopeLabel ?? spine?.selectedTaskScope?.label ?? spine?.scope?.label ?? spine?.summary?.selectedReleaseLabel ?? spine?.selectedRelease?.label ?? 'Unreleased work')
  const spineReleaseLabel = $derived(spine?.summary?.selectedScopeLabel ?? spine?.selectedTaskScope?.label ?? spine?.scope?.label ?? spine?.summary?.selectedReleaseLabel ?? spine?.selectedRelease?.label ?? projectSummary?.release?.label ?? 'Unreleased work')

  const statusRows = $derived(
    data ? Object.entries(data.statusCounts).sort((a, b) => b[1] - a[1]) : [],
  )
  const releaseBlockerLabel = $derived(
    data
      ? `${openCheckCount} open ${openCheckNoun}${openCheckCount === 1 ? '' : 's'}`
      : `0 open ${openCheckNoun}s`,
  )
  const blockerStack = $derived.by(() => {
    if (!data) return []
    const rows: Array<{ key: string; label: string; count: number; detail: string }> = []
    const add = (key: string, label: string, count: number, detail: string) => {
      if (count > 0) rows.push({ key, label, count, detail })
    }
    add(
      'shaping',
      'Needs shaping',
      data.incompleteBriefs?.length ?? 0,
      extraOf(data.incompleteBriefs?.[0] ?? {}) || titleOf(data.incompleteBriefs?.[0] ?? {}) || 'Imported work needs source-backed briefs before unattended execution.',
    )
    add(
      'escalations',
      'Open escalations',
      data.openEscalations.length,
      escalationDetailOf(data.openEscalations[0] ?? {}) || 'A task is waiting on a recovery decision.',
    )
    const approvalCount = data.unapprovedBriefs.length + data.unapprovedSpecs.length
    add(
      'approval',
      'Approval waiting',
      approvalCount,
      `${approvalCount} ${approvalCount === 1 ? 'brief or spec is' : 'briefs or specs are'} waiting for review.`,
    )
    add(
      'proof',
      'Proof missing',
      data.proofMissingDoneTasks?.length ?? 0,
      titleOf(data.proofMissingDoneTasks?.[0] ?? {}) || 'Completed work still needs proof evidence.',
    )
    add(
      'blocked',
      'Agent-blocked tasks',
      data.blockedByAgent.length,
      extraOf(data.blockedByAgent[0] ?? {}) || titleOf(data.blockedByAgent[0] ?? {}) || 'A task is blocked in automation.',
    )
    add(
      'checkout',
      'Project checkout',
      dirtyCheckoutError ? 1 : dirtyCheckoutCount,
      dirtyCheckoutError ? checkoutInspectionError : `${managedCheckoutFilesLabel(dirtyCheckoutCount)} ${managedCheckoutNeedsVerb(dirtyCheckoutCount)} cleanup.`,
    )
    add(
      'repository',
      'Repository follow-up',
      gitStoryBlockers.length,
      gitStoryBlockers[0] ? gitBlockerCopy(gitStoryBlockers[0]).label : 'Branches or checkouts need landing decisions.',
    )
    return rows
  })
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
        <StatusPill label={verdict.label} tone={verdict.tone} emphasis="default" />
        <StatusPill label={taskDoneLabel} tone="neutral" />
        {#if releaseShipped}
          <StatusPill label="Shipped" tone="ok" />
        {:else if canShipRelease}
          <Button variant="primary" size="sm" disabled={closeBusy} onclick={() => void shipRelease()}>
            {closeBusy ? 'Shipping…' : 'Ship release'}
          </Button>
        {/if}
      {/snippet}
    </SectionHeader>

    {#if closeError}
      <NoticeBand tone="danger" role="alert" label="Release" title="Could not ship release">
        <p>{closeError}</p>
      </NoticeBand>
    {/if}

    {#if spine?.summary?.headline}
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
      <NoticeBand
        tone={verdict.tone === 'ok' ? 'ok' : 'warn'}
        role="status"
        label="Verdict"
        title={verdict.label}
      >
        <p>{verdict.detail}</p>
      </NoticeBand>

      <FrameCard
        tone={data.totals.blockingCount === 0 ? 'ok' : 'warn'}
        padding="compact"
        class="summary-card"
      >
        {#snippet header()}
          <SectionHeader
            title="Current counts"
            description={`A compact view of the signals feeding the ${readinessNoun} verdict.`}
            headingTag="h3"
            density="dense"
          >
            {#snippet meta()}
              <StatusPill label={releaseBlockerLabel} tone={data.totals.blockingCount === 0 ? 'ok' : 'warn'} />
            {/snippet}
          </SectionHeader>
        {/snippet}

        <div class="summary-grid" aria-label={`${readinessTitle} summary counts`}>
          <div class="summary-stat">
            <span class="summary-label">Tasks done</span>
            <strong>{data.totals.tasks === 0 ? 'No tracked work' : `${data.totals.done}/${data.totals.tasks}`}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Open {hasNamedRelease ? 'release checks' : 'checks'}</span>
            <strong>{openCheckCount}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Unfinished tasks</span>
            <strong>{data.totals.unfinishedCount ?? unfinishedCount}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Design system</span>
            <StatusPill label={dsLabel().label} tone={dsLabel().tone} />
          </div>
          {#if data.dirtyCheckout}
            <div class="summary-stat">
              <span class="summary-label">Project checkout</span>
          <StatusPill
                label={dirtyCheckoutError ? 'inspection failed' : dirtyCheckoutCount > 0 ? `${dirtyCheckoutCount} managed ${dirtyCheckoutCount === 1 ? 'file' : 'files'} dirty` : 'clean'}
                tone={dirtyCheckoutError || dirtyCheckoutCount > 0 ? 'warn' : 'ok'}
              />
            </div>
          {/if}
          {#if data.gitStory}
            <div class="summary-stat">
              <span class="summary-label">Repository follow-up</span>
              <StatusPill
                label={gitStoryBlockers.length > 0 ? `${gitStoryBlockers.length} open` : 'clear'}
                tone={gitStoryBlockers.length > 0 ? 'warn' : 'ok'}
              />
            </div>
          {/if}
        </div>
        {#if blockerStack.length > 0}
          <div class="blocker-stack" aria-label="Current blocker stack">
            <strong>What blocks this</strong>
            <ul>
              {#each blockerStack as row (row.key)}
                <li>
                  <span>
                    <b>{row.label}</b>
                    <small>{row.detail}</small>
                  </span>
                  <StatusPill label={`${row.count} open`} tone="warn" />
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if data.dirtyCheckout && dirtyCheckoutCount > 0}
          <p class="dirty-detail">
            {managedCheckoutFilesLabel(dirtyCheckoutCount)} {managedCheckoutNeedsVerb(dirtyCheckoutCount)} cleanup before {data.release?.label ? 'the current release' : 'current work'} can be ready.
            Open diagnostics if you need the exact file list.
          </p>
        {:else if dirtyCheckoutError}
          <p class="dirty-detail">
            <strong>Could not inspect checkout</strong>. {checkoutInspectionError}
          </p>
        {/if}
        {#if gitStoryBlockers.length > 0}
          <div class="git-story-detail">
            <strong>Repository follow-up</strong>
            {#if gitStoryBlockers.length > visibleGitStoryBlockers.length}
              <p class="muted">Showing {visibleGitStoryBlockers.length} of {gitStoryBlockers.length} repository follow-ups.</p>
            {/if}
            <ul>
              {#each visibleGitStoryBlockers as blocker, index (`${blocker.id ?? 'git'}:${index}`)}
                {@const copy = gitBlockerCopy(blocker)}
                <li>
                  <span>{copy.label}</span>
                  {#if copy.detail}
                    <small>{copy.detail}</small>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </FrameCard>
    {/if}

    {#if section === 'criteria'}
      <FrameCard class="criteria-card">
        {#snippet header()}
          <SectionHeader
            title="Criteria"
            description="Each row stays compact until you need the task-level detail."
            headingTag="h3"
            density="dense"
          />
        {/snippet}

        <ul class="criteria">
          {#each criteria as c (c.key)}
            {@const clear = c.items.length === 0}
            <li class="crit-row">
              <details class="crit-det" open={false}>
                <summary class="crit-summary" aria-disabled={clear}>
                  <span class="crit-copy">
                    <span class="crit-label">{c.label}</span>
                    <span class="crit-detail">{clear ? c.clearLabel : `${c.items.length} task${c.items.length === 1 ? '' : 's'} still open.`}</span>
                  </span>
                  <StatusPill
                    label={clear ? 'clear' : `${c.items.length} open`}
                    tone={clear ? 'ok' : 'warn'}
                  />
                </summary>

                {#if !clear}
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
                {/if}
              </details>
            </li>
          {/each}

          <li class="crit-row">
            <div class="crit-summary crit-static">
              <span class="crit-copy">
                <span class="crit-label">Design system</span>
                <span class="crit-detail">How the applicable design rules are chosen.</span>
              </span>
              <StatusPill label={dsLabel().label} tone={dsLabel().tone} />
            </div>
          </li>
          <li class="crit-row">
            <details class="crit-det" open={false}>
              <summary class="crit-summary" aria-disabled={gitStoryBlockers.length === 0}>
                <span class="crit-copy">
                  <span class="crit-label">Repository follow-up</span>
                  <span class="crit-detail">
                    {gitStoryBlockers.length === 0 ? 'No repository follow-ups.' : `${gitStoryBlockers.length} repository follow-up${gitStoryBlockers.length === 1 ? '' : 's'}.`}
                  </span>
                </span>
                <StatusPill
                  label={gitStoryBlockers.length === 0 ? 'clear' : `${gitStoryBlockers.length} open`}
                  tone={gitStoryBlockers.length === 0 ? 'ok' : 'warn'}
                />
              </summary>
              {#if gitStoryBlockers.length > 0}
                {#if gitStoryBlockers.length > visibleGitStoryBlockers.length}
                  <p class="muted">Showing {visibleGitStoryBlockers.length} of {gitStoryBlockers.length} repository follow-ups.</p>
                {/if}
                <ul class="crit-items">
                  {#each visibleGitStoryBlockers as blocker, index (`${blocker.id ?? 'git'}:${index}`)}
                    {@const copy = gitBlockerCopy(blocker)}
                    <li>
                      {#if blocker.taskId}
                        <button type="button" class="link" onclick={() => openTask(blocker.taskId ?? '')}>
                          {copy.label}
                        </button>
                      {:else}
                        <span>{copy.label}</span>
                      {/if}
                      <span class="muted">{copy.detail}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </details>
          </li>
        </ul>
      </FrameCard>

      <FrameCard padding="compact" class="tally-card">
        {#snippet header()}
          <SectionHeader
            title="Task-state tally"
            description="Status distribution across the current project backlog."
            headingTag="h3"
            density="dense"
          >
            {#snippet meta()}
              <StatusPill label={taskDoneLabel} tone="neutral" />
            {/snippet}
          </SectionHeader>
        {/snippet}

        {#if statusRows.length === 0}
          <p class="muted">No tasks yet.</p>
        {:else}
          <table class="tally">
            <tbody>
              {#each statusRows as [k, v] (k)}
                <tr>
                  <td>{statusLabel(k)}</td>
                  <td>{v}</td>
                </tr>
              {/each}
            </tbody>
          </table>
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

  :global(.summary-card),
  :global(.criteria-card),
  :global(.tally-card) {
    min-inline-size: 0;
  }

  .summary-grid {
    display: grid;
    gap: var(--gh-space-3);
  }

  .summary-stat {
    display: grid;
    gap: var(--gh-space-1);
  }

  .summary-label,
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .summary-stat strong {
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
  }

  .dirty-detail {
    margin: var(--gh-space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .blocker-stack {
    display: grid;
    gap: var(--gh-space-2);
    margin-top: var(--gh-space-3);
  }

  .blocker-stack ul {
    display: grid;
    gap: var(--gh-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .blocker-stack li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-3);
    align-items: start;
    padding-top: var(--gh-space-2);
    border-top: 1px solid var(--gh-color-border-subtle);
  }

  .blocker-stack span {
    min-width: 0;
    display: grid;
    gap: var(--gh-space-1);
  }

  .blocker-stack small {
    color: var(--text-muted);
  }

  .git-story-detail {
    display: grid;
    gap: var(--gh-space-2);
    margin: var(--gh-space-3) 0 0;
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }

  .git-story-detail ul {
    display: grid;
    gap: var(--gh-space-1);
    margin: 0;
    padding-inline-start: 1.1rem;
  }

  .git-story-detail li {
    display: grid;
    gap: 0.1rem;
  }

  .git-story-detail small {
    color: var(--text-muted);
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

  .crit-det {
    width: 100%;
  }

  .crit-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-3);
    align-items: center;
    list-style: none;
    cursor: pointer;
    padding: var(--gh-space-3) 0;
  }

  .crit-summary::-webkit-details-marker {
    display: none;
  }

  .crit-static {
    cursor: default;
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

  .tally {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--gh-type-size-body);
  }

  .tally td {
    padding: var(--gh-space-2) 0;
    border-top: 1px solid var(--border);
  }

  .tally tbody tr:first-child td {
    border-top: none;
  }

  @container (min-width: 42rem) {
    .summary-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .release-spine {
      grid-template-columns: 1fr;
    }
  }
</style>
