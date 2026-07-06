<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import CardList from '../../lib/CardList.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import { friendlyStatus } from '../../lib/display.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import type { ProjectDetail, ProjectOrientationNode, ProjectOrientationSpine } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
    activeProjectId?: string | null
    onReleaseSelected?: () => void | Promise<void>
  }

  let { detail, activeProjectId = null, onReleaseSelected }: Props = $props()
  let showInternalSteps = $state(false)
  let selectingReleaseId = $state<string | null>(null)
  let releaseSelectionError = $state<string | null>(null)

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'
  const MAX_SKELETON_ROOTS = 12

  const spine = $derived<ProjectOrientationSpine | null>(detail.orientationSpine ?? null)
  const progress = $derived(spine?.summary?.progress ?? null)
  const lanes = $derived(spine?.roots ?? [])
  const selectedRelease = $derived(spine?.selectedRelease ?? null)
  const releaseRoadmap = $derived(spine?.releases ?? (selectedRelease ? [selectedRelease] : []))
  const selectedReleaseId = $derived(selectedRelease?.id ?? null)
  const selectedTaskScope = $derived(spine?.selectedTaskScope ?? spine?.scope ?? null)
  const selectedScopeNodeIds = $derived.by(() => {
    const ids = selectedRelease?.nodeIds?.length
      ? selectedRelease.nodeIds
      : selectedTaskScope?.nodeIds ?? []
    return new Set(ids)
  })
  const selectedDeferredNodeIds = $derived.by(() => new Set(selectedRelease?.deferredNodeIds ?? selectedTaskScope?.deferredNodeIds ?? []))
  const selectedDeferredNodes = $derived.by(() => {
    if (!spine || selectedDeferredNodeIds.size === 0) return []
    return [...selectedDeferredNodeIds]
      .map(id => spine.nodes?.[id])
      .filter((node): node is ProjectOrientationNode => Boolean(node))
  })
  const scopedLanes = $derived.by(() => {
    if (selectedScopeNodeIds.size === 0) return lanes
    return lanes
      .map(lane => laneInSelectedScope(lane))
      .filter((lane): lane is ProjectOrientationNode => Boolean(lane))
  })
  const workRoots = $derived.by(() =>
    scopedLanes.filter(root =>
      root.visibility?.countInProjectTotals !== false &&
      (
        (root.progress?.total ?? 0) > 0 ||
        root.kind === 'work' ||
        (root.children ?? []).some(child => child.visibility?.countInProjectTotals)
      ),
    ),
  )
  const allSkeletonRoots = $derived.by(() =>
    lanes.filter(root => supportingChildren(root).length > 0),
  )
  const skeletonRoots = $derived.by(() =>
    allSkeletonRoots.slice(0, MAX_SKELETON_ROOTS),
  )
  const hiddenSkeletonRootCount = $derived.by(() =>
    Math.max(0, allSkeletonRoots.length - skeletonRoots.length),
  )
  const documentedCapabilityCount = $derived.by(() =>
    allSkeletonRoots.reduce((sum, root) => sum + supportingChildren(root).length, 0),
  )
  const documentedLaterCount = $derived.by(() =>
    allSkeletonRoots.reduce((sum, root) => sum + deferredSupportingChildren(root).length, 0),
  )
  const deferredWorkCount = $derived(spine?.summary?.deferredWorkCount ?? spine?.summary?.deferredCount ?? selectedDeferredNodes.length)
  const documentedCurrentCount = $derived.by(() =>
    documentedCapabilityCount - documentedLaterCount,
  )
  const proofGapCount = $derived(spine?.gaps?.filter(gap => gap.kind === 'proof_needed').length ?? 0)
  const sourceGapCount = $derived(spine?.sourceHealth?.gaps ?? spine?.gaps?.length ?? 0)
  const sourceInferredCount = $derived(spine?.sourceHealth?.inferred ?? 0)
  const executionBoundary = $derived(spine?.executionBoundary ?? null)
  const selectedScopeDescendantIds = $derived.by(() => {
    const ids = new Set(selectedScopeNodeIds)
    if (!spine || selectedScopeNodeIds.size === 0) return ids
    const visit = (node: ProjectOrientationNode | undefined) => {
      if (!node) return
      if (node.id) ids.add(node.id)
      for (const child of node.children ?? []) visit(child)
    }
    for (const nodeId of selectedScopeNodeIds) {
      visit(spine.nodes?.[nodeId])
    }
    return ids
  })
  const proofContracts = $derived.by(() => {
    const contracts = spine?.proofContracts ?? []
    if (selectedScopeDescendantIds.size === 0) return contracts.slice(0, 6)
    return contracts
      .filter(contract => selectedScopeDescendantIds.has(contract.nodeId ?? ''))
      .slice(0, 6)
  })
  const mapHeadline = $derived(spine?.charter?.goal ?? spine?.summary?.purpose ?? `${detail.name ?? detail.id ?? 'Project'} needs a confirmed project goal.`)
  const targetAudience = $derived(spine?.charter?.targetAudience ?? null)
  const taskScopeLabel = $derived(spine?.summary?.selectedScopeLabel ?? selectedTaskScope?.label ?? spine?.summary?.selectedReleaseLabel ?? selectedRelease?.label ?? 'Current task scope')
  const selectedScopeSource = $derived(selectedRelease?.source ?? selectedTaskScope?.source)
  const workContainerTitle = $derived(selectedRelease ? 'Release scope' : 'Task scope')
  const scopeRows = $derived(spine?.scopeRows ?? [])
  const currentScopeRows = $derived(scopeRows.filter(row => row.scope !== 'deferred'))
  const laterScopeRows = $derived(scopeRows.filter(row => row.scope === 'deferred'))
  const visibleLaterScopeRows = $derived(laterScopeRows.slice(0, 4))
  const visibleScopeRows = $derived([...currentScopeRows, ...visibleLaterScopeRows])
  const hiddenLaterScopeRowCount = $derived(Math.max(0, laterScopeRows.length - visibleLaterScopeRows.length))
  const mapGaps = $derived.by(() => {
    return (spine?.gaps ?? []).slice(0, 5).map(gap => ({
      ...gap,
      href: gapHref(gap),
      tone: gap.severity === 'blocker' || gap.severity === 'high' ? 'danger' as Tone : 'warn' as Tone,
      title: gap.label ?? friendlyStatus(gap.kind ?? 'Gap'),
      kindLabel: friendlyStatus(gap.kind ?? 'Gap'),
    }))
  })
  const sourceRows = $derived.by(() => {
    if (!spine) return []
    const taskRefs = new Set<string>()
    const artifactRefs = new Set<string>()
    const importRefs = new Set<string>()
    for (const node of collectSourceNodes(spine)) {
      const refs = node.source && typeof node.source === 'object' ? node.source.refs ?? [] : []
      for (const ref of refs) {
        if (ref.startsWith('task:')) taskRefs.add(ref)
        if (ref.startsWith('artifact:')) artifactRefs.add(ref)
        if (isSourceDocumentRef(ref)) importRefs.add(ref)
      }
      for (const artifactId of node.refs?.artifactIds ?? []) artifactRefs.add(`artifact:${artifactId}`)
    }
    const sourceDocNames = [...importRefs].map(sourceRefLabel).filter(Boolean)
    return [
      {
        label: 'Charter',
        value: sourceLabelFor(spine.charter?.source),
        detail: sourceIsInferred(spine.charter?.source)
          ? 'Purpose and audience are inferred from durable project state and should be confirmed when they matter.'
          : 'Purpose and audience were supplied or approved directly.',
        tone: sourceIsInferred(spine.charter?.source) ? 'warn' as Tone : 'ok' as Tone,
      },
      {
        label: 'Scope',
        value: sourceLabelFor(selectedScopeSource),
        detail: `${taskScopeLabel} contains ${spine.summary?.includedWorkCount ?? spine.summary?.includedCount ?? 0} assigned work items and ${spine.summary?.deferredWorkCount ?? spine.summary?.deferredCount ?? 0} later.`,
        tone: sourceIsInferred(selectedScopeSource) ? 'warn' as Tone : 'ok' as Tone,
      },
      {
        label: 'Source docs',
        value: countLabel(importRefs.size, 'source document'),
        detail: sourceDocNames.length > 0
          ? sourceDocNames.slice(0, 4).join(', ')
          : 'No source documents are attached to mapped claims yet.',
        tone: importRefs.size > 0 ? 'ok' as Tone : 'warn' as Tone,
      },
      {
        label: 'Work records',
        value: `${taskRefs.size || detail.tasks?.length || 0} task records`,
        detail: artifactRefs.size > 0
          ? `${artifactRefs.size} artifact references are attached to mapped work.`
          : 'Document-level artifact references are not attached to every lane yet.',
        tone: artifactRefs.size > 0 ? 'ok' as Tone : 'warn' as Tone,
      },
      {
        label: 'Proof mode',
        value: executionBoundary?.label ?? 'Missing',
        detail: executionBoundary?.detail ?? 'Guildhall has not collected how this scope should be proven yet.',
        tone: executionBoundaryTone(executionBoundary?.mode),
      },
    ]
  })

  function go(href: string): void {
    nav(projectActionHref(href, activeProjectId), { backgroundPath: path.value })
  }

  function countLabel(value: number | undefined, singular: string, plural?: string): string {
    const count = value ?? 0
    return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
  }

  function laneTone(node: ProjectOrientationNode): Tone {
    if (node.maturity === 'blocked') return 'danger'
    if (node.maturity === 'proof_needed' || (node.progress?.blocked ?? 0) > 0) return 'warn'
    if (node.maturity === 'active' || (node.progress?.active ?? 0) > 0) return 'accent'
    if (node.maturity === 'proven' || node.maturity === 'done') return 'ok'
    return 'neutral'
  }

  function executionBoundaryTone(mode: unknown): Tone {
    if (mode === 'headless' || mode === 'mixed') return 'accent'
    if (mode === 'ui') return 'neutral'
    return 'warn'
  }

  function maturityLabel(node: ProjectOrientationNode): string {
    return node.maturity ? friendlyStatus(node.maturity) : 'Mapped'
  }

  function nodeProgress(node: ProjectOrientationNode): string {
    const p = node.progress ?? {}
    const childCount = node.children?.length ?? 0
    const total = p.total ?? childCount
    const pieces = [
      total ? countLabel(total, 'work item') : null,
      p.specced ? `${p.specced} specced` : null,
      p.active ? `${p.active} active` : null,
      p.blocked ? `${p.blocked} blocked` : null,
      p.proven ? `${p.proven} proven` : null,
      p.deferred ? `${p.deferred} deferred` : null,
    ].filter(Boolean)
    return pieces.join(' · ') || 'No progress data yet'
  }

  function isInternalNode(node: ProjectOrientationNode): boolean {
    const kind = node.visibility?.kind
    return kind === 'internal_step' || kind === 'hidden' || node.visibility?.countInProjectTotals === false
  }

  function visibleChildren(node: ProjectOrientationNode): ProjectOrientationNode[] {
    const children = node.children ?? []
    return showInternalSteps ? children : children.filter(child => !isInternalNode(child))
  }

  function laneInSelectedScope(node: ProjectOrientationNode): ProjectOrientationNode | null {
    if (selectedScopeNodeIds.has(node.id ?? '')) {
      const scopedChildren = (node.children ?? [])
        .map(child => laneInSelectedScope(child))
        .filter((child): child is ProjectOrientationNode => Boolean(child))
      return scopedChildren.length === (node.children?.length ?? 0)
        ? node
        : { ...node, children: scopedChildren }
    }
    const scopedChildren = (node.children ?? [])
      .map(child => laneInSelectedScope(child))
      .filter((child): child is ProjectOrientationNode => Boolean(child))
    if (scopedChildren.length === 0) return null
    return { ...node, children: scopedChildren }
  }

  function supportingChildren(node: ProjectOrientationNode): ProjectOrientationNode[] {
    return (node.children ?? []).filter(child => child.visibility?.kind === 'supporting')
  }

  function deferredSupportingChildren(node: ProjectOrientationNode): ProjectOrientationNode[] {
    return supportingChildren(node).filter(child => child.maturity === 'deferred')
  }

  function skeletonSummary(node: ProjectOrientationNode): string {
    const all = supportingChildren(node)
    const deferred = deferredSupportingChildren(node).length
    const current = all.length - deferred
    const pieces = [
      current > 0 ? `${current} shaping the current picture` : null,
      deferred > 0 ? `${deferred} documented for later` : null,
    ].filter(Boolean)
    return pieces.join(' · ') || node.summary || 'No documented structure is mapped yet.'
  }

  function hiddenInternalCount(node: ProjectOrientationNode): number {
    return (node.children ?? []).filter(isInternalNode).length
  }

  function childHref(node: ProjectOrientationNode): string | null {
    const taskId = node.refs?.taskIds?.[0] ?? (node.id?.startsWith('work:') ? node.id.slice('work:'.length) : null)
    return taskId ? currentTaskHref(taskId, activeProjectId) : null
  }

  function contractHref(contract: { nodeId?: string; refs?: string[] }): string | null {
    const taskRef = contract.refs?.find(ref => ref.startsWith('task:'))
    const taskId = taskRef?.slice('task:'.length)
      ?? (contract.nodeId?.startsWith('work:') ? contract.nodeId.slice('work:'.length) : null)
    return taskId ? currentTaskHref(taskId, activeProjectId) : null
  }

  function proofContractTone(state: unknown): Tone {
    if (state === 'proven') return 'ok'
    if (state === 'partial' || state === 'needed') return 'warn'
    return 'neutral'
  }

  function releaseTone(release: { id?: string; state?: string; nodeIds?: string[]; deferredNodeIds?: string[] }): Tone {
    if (release.id && release.id === selectedReleaseId) return 'accent'
    if (release.state === 'shipped' || release.state === 'ready') return 'ok'
    if ((release.nodeIds?.length ?? 0) > 0) return 'accent'
    return 'neutral'
  }

  function releaseSummary(release: { nodeIds?: string[]; deferredNodeIds?: string[] }): string {
    const active = release.nodeIds?.length ?? 0
    const later = release.deferredNodeIds?.length ?? 0
    const pieces = [
      active > 0 ? countLabel(active, 'current work item') : null,
      later > 0 ? countLabel(later, 'later work item') : null,
    ].filter(Boolean)
    return pieces.join(' · ') || 'No work assigned yet'
  }

  async function selectRelease(release: { id?: string; label?: string }): Promise<void> {
    if (!release.id || release.id === selectedReleaseId || selectingReleaseId) return
    selectingReleaseId = release.id
    releaseSelectionError = null
    try {
      const response = await projectFetch('/api/project/release/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ releaseId: release.id }),
      }, activeProjectId)
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
      await onReleaseSelected?.()
    } catch (err) {
      releaseSelectionError = err instanceof Error ? err.message : String(err)
    } finally {
      selectingReleaseId = null
    }
  }

  function collectSourceNodes(spine: ProjectOrientationSpine): ProjectOrientationNode[] {
    const nodes: ProjectOrientationNode[] = []
    const seen = new Set<string>()
    const add = (node: ProjectOrientationNode | undefined) => {
      if (!node) return
      const key = node.id ?? `${node.title ?? 'node'}:${nodes.length}`
      if (seen.has(key)) return
      seen.add(key)
      nodes.push(node)
      for (const child of node.children ?? []) add(child)
    }
    for (const node of Object.values(spine.nodes ?? {})) add(node)
    for (const node of spine.roots ?? []) add(node)
    return nodes
  }

  function canonicalNode(node: ProjectOrientationNode): ProjectOrientationNode {
    return (node.id ? spine?.nodes?.[node.id] : null) ?? node
  }

  function importSourceLabels(node: ProjectOrientationNode): string[] {
    const source = canonicalNode(node).source
    const refs = source && typeof source === 'object' ? source.refs ?? [] : []
    return refs
      .filter(isSourceDocumentRef)
      .map(sourceRefLabel)
      .filter(Boolean)
  }

  function nodeSourceSummary(node: ProjectOrientationNode): string | null {
    const labels = importSourceLabels(node)
    return labels.length > 0 ? `Source: ${labels.slice(0, 2).join(', ')}` : null
  }

  function sourceRefLabel(ref: string): string {
    const value = ref.startsWith('import:') ? ref.slice('import:'.length) : ref
    const parts = value.split('/').filter(Boolean)
    return parts.at(-1) ?? value
  }

  function isSourceDocumentRef(ref: string): boolean {
    if (ref.startsWith('task:') || ref.startsWith('artifact:')) return false
    if (ref.startsWith('import:')) return true
    return /[/\\]/.test(ref) || /\.(md|mdx|txt|json|ya?ml)$/i.test(ref)
  }

  function scopeReasonLabel(reason: string | undefined): string {
    if (reason === 'included') return 'directly assigned'
    if (reason === 'included_ancestor') return 'inside selected work'
    if (reason === 'included_prerequisite') return 'needed prerequisite'
    if (reason === 'deferred') return 'later scope'
    if (reason === 'no_scope') return 'current by default'
    return friendlyStatus(reason ?? 'mapped')
  }

  function scopeRowTone(row: { scope?: string; handoffState?: string; humanBlocking?: boolean; blocksRelease?: boolean }): Tone {
    if (row.scope === 'deferred') return 'neutral'
    if (row.humanBlocking || row.blocksRelease || row.handoffState === 'blocked' || row.handoffState === 'brief_cleanup') return 'warn'
    if (row.handoffState === 'paused' || row.handoffState === 'review') return 'accent'
    if (row.handoffState === 'done') return 'ok'
    return 'neutral'
  }

  function scopeRowSourceSummary(row: { sourceRefs?: string[] }): string {
    const labels = (row.sourceRefs ?? [])
      .filter(isSourceDocumentRef)
      .map(sourceRefLabel)
      .filter(Boolean)
    return labels.length > 0 ? `Source: ${labels.slice(0, 2).join(', ')}` : 'Source: task record'
  }

  function scopeRowHref(row: { taskId?: string }): string | null {
    return row.taskId ? currentTaskHref(row.taskId, activeProjectId) : null
  }

  function gapHref(gap: { refs?: string[]; nodeId?: string }): string | null {
    const taskRef = gap.refs?.find(ref => ref.startsWith('task:'))
    const taskId = taskRef?.slice('task:'.length)
      ?? (gap.nodeId?.startsWith('work:') ? gap.nodeId.slice('work:'.length) : null)
    return taskId ? currentTaskHref(taskId, activeProjectId) : null
  }

  function sourceIsInferred(source: unknown): boolean {
    if (!source) return true
    if (typeof source === 'string') return source === 'inferred' || source === 'missing'
    if (typeof source === 'object' && 'inferred' in source) return Boolean((source as { inferred?: unknown }).inferred)
    return false
  }

  function sourceLabelFor(source: unknown): string {
    if (!source) return 'Missing'
    if (typeof source === 'string') return friendlyStatus(source)
    const typed = source as { kind?: string; confidence?: string; inferred?: boolean }
    const kind = typed.kind ? friendlyStatus(typed.kind) : typed.inferred ? 'Inferred' : 'Recorded'
    return typed.confidence ? `${kind} · ${friendlyStatus(typed.confidence)} confidence` : kind
  }
</script>

<div class="project-map">
  <section class="map-hero" aria-label="Project map summary">
    <div class="map-hero-copy">
      <p class="eyebrow">{detail.name ?? detail.id ?? 'Project'}</p>
      <h1>Project map</h1>
      <p>{mapHeadline}</p>
      {#if targetAudience}
        <p class="muted">{targetAudience}</p>
      {/if}
    </div>
    <Card title={workContainerTitle} titleTag="h2" padding="compact" density="dense" className="map-scope-card">
      <div class="scope-stack">
        <Chip label={taskScopeLabel} tone={sourceIsInferred(selectedScopeSource) ? 'warn' : 'accent'} />
        <strong>{countLabel(spine?.summary?.includedWorkCount ?? spine?.summary?.includedCount, 'assigned work item')}</strong>
        <span>{countLabel(deferredWorkCount, 'later work item')} · {countLabel(documentedCapabilityCount, 'documented capability', 'documented capabilities')} · {countLabel(sourceGapCount, 'gap')}</span>
      </div>
    </Card>
    <Card title="Proof mode" titleTag="h2" padding="compact" density="dense" className="map-boundary-card">
      <div class="scope-stack">
        <Chip label={executionBoundary?.label ?? 'Missing'} tone={executionBoundaryTone(executionBoundary?.mode)} />
        <strong>{friendlyStatus(executionBoundary?.proofStyle ?? 'unspecified')}</strong>
        <span>{executionBoundary?.detail ?? 'Guildhall needs this before it can safely run the current task scope unattended.'}</span>
      </div>
    </Card>
  </section>

  {#if !spine}
    <Card title="Map unavailable" titleTag="h2" padding="compact" density="dense">
      <p class="muted">No project spine has been generated yet.</p>
    </Card>
  {:else}
    <section class="map-stats" aria-label="Project map progress">
      <UtilityPanel className="stat" tone="neutral">
        <strong>{countLabel(progress?.total, 'work item')}</strong>
        <span>Mapped work</span>
      </UtilityPanel>
      <UtilityPanel className="stat" tone="neutral">
        <strong>{countLabel(documentedCapabilityCount, 'documented capability', 'documented capabilities')}</strong>
        <span>Project skeleton</span>
      </UtilityPanel>
      <UtilityPanel className="stat" tone="accent">
        <strong>{progress?.specced ?? 0}</strong>
        <span>Specced</span>
      </UtilityPanel>
      <UtilityPanel className="stat" tone="accent">
        <strong>{progress?.active ?? 0}</strong>
        <span>Active</span>
      </UtilityPanel>
      <UtilityPanel className="stat" tone={deferredWorkCount ? 'neutral' : 'ok'}>
        <strong>{deferredWorkCount}</strong>
        <span>Later</span>
      </UtilityPanel>
      <UtilityPanel className="stat" tone={proofGapCount ? 'warn' : 'ok'}>
        <strong>{proofGapCount}</strong>
        <span>Proof gaps</span>
      </UtilityPanel>
      <UtilityPanel className="stat" tone="ok">
        <strong>{progress?.proven ?? 0}</strong>
        <span>Proven</span>
      </UtilityPanel>
    </section>

    {#if releaseRoadmap.length > 0}
      <Card title="Release roadmap" titleTag="h2" padding="compact" density="dense" className="release-roadmap-card">
        {#if releaseSelectionError}
          <p class="form-error" role="alert">{releaseSelectionError}</p>
        {/if}
        <CardList className="release-roadmap-list">
          {#each releaseRoadmap as release (release.id ?? release.label)}
            <CardListItem className="release-roadmap-row" tone={releaseTone(release)} railStrength={release.id === selectedReleaseId ? 'strong' : 'subtle'} dense>
              <div>
                <Chip label={release.id === selectedReleaseId ? 'Selected' : friendlyStatus(release.state ?? 'planned')} tone={releaseTone(release)} />
                <strong>{release.label ?? 'Untitled release'}</strong>
                <p>{releaseSummary(release)}</p>
                {#if release.id && release.id !== selectedReleaseId}
                  <Button variant="secondary" size="sm" disabled={Boolean(selectingReleaseId)} onclick={() => void selectRelease(release)}>
                    {selectingReleaseId === release.id ? 'Selecting' : 'Select'}
                  </Button>
                {/if}
              </div>
            </CardListItem>
          {/each}
        </CardList>
      </Card>
    {/if}

    {#if scopeRows.length > 0}
      <Card title="Scope ledger" titleTag="h2" padding="compact" density="dense" className="scope-ledger-card">
        <div class="lane-meta">
          <span>{countLabel(currentScopeRows.length, 'current work item')} · {countLabel(laterScopeRows.length, 'later work item')}</span>
        </div>
        <CardList className="scope-ledger-list">
          {#each visibleScopeRows as row (`${row.scope}:${row.taskId}`)}
            <CardListItem
              as={scopeRowHref(row) ? 'button' : 'div'}
              interactive={Boolean(scopeRowHref(row))}
              className="scope-ledger-row"
              tone={scopeRowTone(row)}
              dense
              ariaLabel={scopeRowHref(row) ? `${row.title ?? 'Untitled work'} ${row.scope === 'deferred' ? 'Later' : 'Now'} ${friendlyStatus(row.handoffState ?? row.status ?? 'mapped')}` : undefined}
              onclick={() => {
                const href = scopeRowHref(row)
                if (href) go(href)
              }}
            >
              <div>
                <div class="scope-ledger-title">
                  <Chip label={row.scope === 'deferred' ? 'Later' : 'Now'} tone={row.scope === 'deferred' ? 'neutral' : 'accent'} />
                  <strong>{row.title ?? 'Untitled work'}</strong>
                </div>
                <p>{friendlyStatus(row.handoffState ?? row.status ?? 'mapped')} · {scopeReasonLabel(row.eligibilityReason)} · {scopeRowSourceSummary(row)}</p>
              </div>
              <Chip label={friendlyStatus(row.handoffState ?? row.status ?? 'mapped')} tone={scopeRowTone(row)} />
            </CardListItem>
          {/each}
        </CardList>
        {#if hiddenLaterScopeRowCount > 0}
          <p class="overflow-summary">{countLabel(hiddenLaterScopeRowCount, 'additional later row')} summarized in the counts above.</p>
        {/if}
      </Card>
    {/if}

    <section class="map-layout">
      <div class="map-main">
      <Card title="Tasks in scope" titleTag="h2" padding="compact" density="dense" className="map-lanes-card">
        <div class="lane-toolbar">
          <Button variant="ghost" size="sm" onclick={() => { showInternalSteps = !showInternalSteps }}>
            <Icon name="list-todo" size={14} />
            {showInternalSteps ? 'Hide internal steps' : 'Show internal steps'}
          </Button>
        </div>
        {#if workRoots.length === 0}
          <p class="muted">No scoped work is mapped yet.</p>
        {:else}
        <CardList className="lane-list">
          {#each workRoots as lane (lane.id ?? lane.title)}
            <CardListItem className="lane-row" tone={laneTone(lane)} railStrength="strong">
              <div class="lane-head">
                <div>
                  <strong>{lane.title ?? 'Unsorted work'}</strong>
                  <p>{lane.summary ?? nodeProgress(lane)}</p>
                </div>
                <Chip label={maturityLabel(lane)} tone={laneTone(lane)} />
              </div>
              <div class="lane-meta">
                <span>{nodeProgress(lane)}</span>
              </div>
              {#if hiddenInternalCount(lane) > 0 && !showInternalSteps}
                <p class="internal-summary">{countLabel(hiddenInternalCount(lane), 'internal step')} hidden</p>
              {/if}
              {#if visibleChildren(lane).length > 0}
                <div class="child-list">
                  {#each visibleChildren(lane) as child (child.id ?? child.title)}
                    <CardListItem
                      as={childHref(child) ? 'button' : 'div'}
                      interactive={Boolean(childHref(child))}
                      className="child-row"
                      tone={laneTone(child)}
                      dense
                      ariaLabel={childHref(child) ? `${child.title ?? 'Untitled work'} ${maturityLabel(child)}` : undefined}
                      onclick={() => {
                        const href = childHref(child)
                        if (href) go(href)
                      }}
                    >
                      <span>
                        {child.title ?? 'Untitled work'}
                        {#if nodeSourceSummary(child)}
                          <small>{nodeSourceSummary(child)}</small>
                        {/if}
                      </span>
                      <Chip label={maturityLabel(child)} tone={laneTone(child)} />
                    </CardListItem>
                  {/each}
                </div>
              {/if}
            </CardListItem>
          {/each}
        </CardList>
        {/if}
      </Card>

      {#if selectedDeferredNodes.length > 0}
        <Card title="Later in this scope" titleTag="h2" padding="compact" density="dense" className="map-deferred-card">
          <div class="lane-meta">
            <span>{countLabel(deferredWorkCount, 'work item')} outside the current run boundary.</span>
          </div>
          <CardList className="lane-list">
            {#each selectedDeferredNodes.slice(0, 8) as node (node.id ?? node.title)}
              <CardListItem
                as={childHref(node) ? 'button' : 'div'}
                interactive={Boolean(childHref(node))}
                className="child-row"
                tone="neutral"
                dense
                ariaLabel={childHref(node) ? `${node.title ?? 'Untitled work'} Later` : undefined}
                onclick={() => {
                  const href = childHref(node)
                  if (href) go(href)
                }}
              >
                <span>
                  {node.title ?? 'Untitled work'}
                  {#if nodeSourceSummary(node)}
                    <small>{nodeSourceSummary(node)}</small>
                  {/if}
                </span>
                <Chip label="Later" tone="neutral" />
              </CardListItem>
            {/each}
          </CardList>
          {#if deferredWorkCount > selectedDeferredNodes.length || selectedDeferredNodes.length > 8}
            <p class="overflow-summary">{countLabel(Math.max(deferredWorkCount - Math.min(selectedDeferredNodes.length, 8), selectedDeferredNodes.length - 8), 'additional work item')} summarized in the release counts above.</p>
          {/if}
        </Card>
      {/if}

      <Card title="Documented skeleton" titleTag="h2" padding="compact" density="dense" className="map-structure-card">
        <div class="lane-meta">
          <span>{countLabel(documentedCurrentCount, 'current capability', 'current capabilities')} · {countLabel(documentedLaterCount, 'later capability', 'later capabilities')}</span>
        </div>
        {#if skeletonRoots.length === 0}
          <p class="muted">Guildhall has not mapped durable project structure yet.</p>
        {:else}
          <CardList className="lane-list">
            {#each skeletonRoots as root (root.id ?? root.title)}
              <CardListItem className="lane-row" tone="neutral" railStrength="subtle">
                <div class="lane-head">
                  <div>
                    <strong>{root.title}</strong>
                    <p>{skeletonSummary(root)}</p>
                  </div>
                  <Chip label={countLabel(supportingChildren(root).length, 'capability', 'capabilities')} tone="neutral" />
                </div>
                {#if supportingChildren(root).length > 0}
                  <div class="child-list">
                    {#each supportingChildren(root).slice(0, 4) as child (child.id ?? child.title)}
                      <CardListItem className="child-row" tone={child.maturity === 'deferred' ? 'neutral' : laneTone(child)} dense>
                        <span>
                          {child.title ?? 'Untitled capability'}
                          {#if nodeSourceSummary(child)}
                            <small>{nodeSourceSummary(child)}</small>
                          {/if}
                        </span>
                        <Chip label={child.maturity === 'deferred' ? 'Later' : maturityLabel(child)} tone={child.maturity === 'deferred' ? 'neutral' : laneTone(child)} />
                      </CardListItem>
                    {/each}
                  </div>
                {/if}
              </CardListItem>
            {/each}
          </CardList>
          {#if hiddenSkeletonRootCount > 0}
            <p class="overflow-summary">{countLabel(hiddenSkeletonRootCount, 'additional skeleton lane')} summarized in the counts above.</p>
          {/if}
        {/if}
      </Card>
      </div>

      <div class="map-side">
        <Card title="Source trail" titleTag="h2" padding="compact" density="dense">
          <div class="source-list" aria-label="Source trail">
            {#each sourceRows as row (row.label)}
              <div class="source-fact source-fact-{row.tone}">
                <Chip label={row.label} tone={row.tone} />
                <div>
                  <strong>{row.value}</strong>
                  <p>{row.detail}</p>
                </div>
              </div>
            {/each}
          </div>
        </Card>

        <Card title="Proof contract" titleTag="h2" padding="compact" density="dense">
          {#if proofContracts.length === 0}
            <p class="muted">No scoped proof contracts are available yet.</p>
          {:else}
            <CardList>
              {#each proofContracts as contract (`${contract.nodeId}:${contract.title}`)}
                <CardListItem
                  as={contractHref(contract) ? 'button' : 'div'}
                  interactive={Boolean(contractHref(contract))}
                  className="proof-contract-row"
                  tone={proofContractTone(contract.state)}
                  dense
                  onclick={() => {
                    const href = contractHref(contract)
                    if (href) go(href)
                  }}
                >
                  <div>
                    <Chip label={friendlyStatus(contract.state ?? 'unknown')} tone={proofContractTone(contract.state)} />
                    <strong>{contract.title ?? 'Untitled work'}</strong>
                    <p>{contract.missing?.[0] ?? contract.verified?.[0] ?? contract.required?.[0] ?? 'Proof target is not described yet.'}</p>
                  </div>
                </CardListItem>
              {/each}
            </CardList>
          {/if}
        </Card>

        <Card title="Gaps to resolve" titleTag="h2" padding="compact" density="dense">
          {#if mapGaps.length === 0}
            <p class="muted">No map gaps are currently reported.</p>
          {:else}
            <CardList>
              {#each mapGaps as gap (`${gap.kind}:${gap.label}`)}
                <CardListItem
                  as={gap.href ? 'button' : 'div'}
                  interactive={Boolean(gap.href)}
                  className="gap-row"
                  tone={gap.tone}
                  dense
                  onclick={() => {
                    if (gap.href) go(gap.href)
                  }}
                >
                  <Icon name="alert-triangle" size={16} />
                  <div>
                    <Chip label={gap.kindLabel} tone={gap.tone} />
                    <strong>{gap.title}</strong>
                    {#if gap.detail}
                      <p>{gap.detail}</p>
                    {:else if gap.href}
                      <p>Open the linked work item to resolve this gap.</p>
                    {/if}
                  </div>
                </CardListItem>
              {/each}
            </CardList>
          {/if}
        </Card>

        <Card title="Related views" titleTag="h2" padding="compact" density="dense">
          <div class="map-actions">
            <Button variant="secondary" onclick={() => go(currentProjectHref('/work', activeProjectId))}>
              <Icon name="list-checks" size={16} />
              Work
            </Button>
            <Button variant="secondary" onclick={() => go(currentProjectHref('/structure', activeProjectId))}>
              <Icon name="package" size={16} />
              Structure
            </Button>
          </div>
        </Card>
      </div>
    </section>
  {/if}
</div>

<style>
  .project-map {
    container-type: inline-size;
    display: grid;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-4) var(--s-6);
    min-width: 0;
  }

  .map-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(2, minmax(16rem, 22rem));
    gap: var(--s-4);
    align-items: start;
  }

  .map-hero-copy {
    min-width: 0;
  }

  .eyebrow {
    margin: 0 0 var(--s-1);
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  h1 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-display-title);
    line-height: var(--gh-type-line-height-tight);
    letter-spacing: 0;
  }

  .map-hero-copy p {
    max-width: 72rem;
    margin: var(--s-2) 0 0;
    color: var(--text);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .muted,
  .scope-stack span,
  .lane-head p,
  .lane-meta {
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }

  .scope-stack {
    display: grid;
    gap: var(--s-2);
    align-content: start;
  }

  .scope-stack strong {
    color: var(--text);
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
  }

  .map-stats {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--s-3);
  }

  :global(.stat) {
    gap: var(--s-1);
  }

  :global(.stat) strong {
    color: var(--text);
    font-size: var(--gh-type-size-subsection-title);
    line-height: var(--gh-type-line-height-tight);
  }

  :global(.stat) span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }

  :global(.release-roadmap-list) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: var(--s-3);
  }

  :global(.release-roadmap-row) {
    min-width: 0;
  }

  :global(.release-roadmap-row > div) {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  :global(.release-roadmap-row .chip) {
    justify-self: start;
  }

  :global(.release-roadmap-row strong) {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  :global(.scope-ledger-list) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr));
    gap: var(--s-3);
  }

  :global(.scope-ledger-row) {
    min-width: 0;
  }

  :global(.scope-ledger-row > div:first-child) {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  .scope-ledger-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }

  .scope-ledger-title strong {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  :global(.scope-ledger-row p) {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  :global(.release-roadmap-row p) {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .map-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(20rem, 0.55fr);
    gap: var(--s-4);
    align-items: start;
    min-width: 0;
  }

  .map-main {
    display: grid;
    gap: var(--s-4);
    min-width: 0;
  }

  .lane-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-3);
  }

  .internal-summary,
  .overflow-summary {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  :global(.lane-list),
  .source-list {
    gap: var(--s-3);
  }

  :global(.lane-row) {
    gap: var(--s-3);
  }

  .lane-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-3);
    align-items: start;
  }

  .lane-head div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  .lane-head strong,
  .source-fact strong,
  :global(.gap-row strong) {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .lane-head p,
  .source-fact p,
  :global(.gap-row p) {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .lane-meta {
    font-size: var(--gh-type-size-meta);
  }

  .child-list {
    display: grid;
    gap: var(--s-2);
  }

  :global(.child-row) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-3);
    align-items: center;
    text-align: left;
  }

  :global(.child-row span) {
    display: grid;
    gap: var(--s-1);
    overflow-wrap: anywhere;
  }

  :global(.child-row small) {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
  }

  :global(.proof-contract-row div) {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  :global(.proof-contract-row strong) {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  :global(.proof-contract-row p) {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .map-side {
    display: grid;
    gap: var(--s-4);
    min-width: 0;
  }

  .source-list {
    display: grid;
    gap: var(--s-3);
  }

  .source-fact {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
    padding-block: var(--s-2);
    border-block-start: 1px solid var(--border);
  }

  .source-fact:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }

  .source-fact:last-child {
    padding-block-end: 0;
  }

  .source-fact :global(.chip) {
    justify-self: start;
  }

  .source-fact div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  :global(.gap-row) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: var(--s-3);
  }

  :global(.gap-row div) {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  .map-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  @container (max-width: 60rem) {
    .map-layout {
      grid-template-columns: 1fr;
    }

    .map-hero {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .map-hero-copy {
      grid-column: 1 / -1;
    }

    .map-stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @container (max-width: 38rem) {
    .project-map {
      padding: var(--s-3);
      gap: var(--s-3);
    }

    h1 {
      font-size: var(--gh-type-size-page-title);
    }

    .map-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .map-hero,
    .lane-head,
    :global(.child-row) {
      grid-template-columns: 1fr;
    }

    .map-actions :global(.btn) {
      width: 100%;
    }
  }
</style>
