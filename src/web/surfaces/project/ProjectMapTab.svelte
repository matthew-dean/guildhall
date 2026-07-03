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
  import { currentProjectHref, currentTaskHref, projectActionHref } from '../../lib/project-routes.js'
  import type { ProjectDetail, ProjectOrientationNode, ProjectOrientationSpine } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
    activeProjectId?: string | null
  }

  let { detail, activeProjectId = null }: Props = $props()
  let showInternalSteps = $state(false)

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

  const spine = $derived<ProjectOrientationSpine | null>(detail.orientationSpine ?? null)
  const progress = $derived(spine?.summary?.progress ?? null)
  const lanes = $derived(spine?.roots ?? [])
  const workRoots = $derived.by(() =>
    lanes.filter(root =>
      root.visibility?.countInProjectTotals !== false &&
      (
        (root.progress?.total ?? 0) > 0 ||
        root.kind === 'work' ||
        (root.children ?? []).some(child => child.visibility?.countInProjectTotals)
      ),
    ),
  )
  const skeletonRoots = $derived.by(() =>
    lanes.filter(root => supportingChildren(root).length > 0),
  )
  const documentedCapabilityCount = $derived.by(() =>
    skeletonRoots.reduce((sum, root) => sum + supportingChildren(root).length, 0),
  )
  const documentedLaterCount = $derived.by(() =>
    skeletonRoots.reduce((sum, root) => sum + deferredSupportingChildren(root).length, 0),
  )
  const documentedCurrentCount = $derived.by(() =>
    documentedCapabilityCount - documentedLaterCount,
  )
  const proofGapCount = $derived(spine?.gaps?.filter(gap => gap.kind === 'proof_needed').length ?? 0)
  const sourceGapCount = $derived(spine?.sourceHealth?.gaps ?? spine?.gaps?.length ?? 0)
  const sourceInferredCount = $derived(spine?.sourceHealth?.inferred ?? 0)
  const executionBoundary = $derived(spine?.executionBoundary ?? null)
  const proofContracts = $derived((spine?.proofContracts ?? []).slice(0, 6))
  const mapHeadline = $derived(spine?.charter?.goal ?? spine?.summary?.purpose ?? `${detail.name ?? detail.id ?? 'Project'} needs a confirmed project goal.`)
  const targetAudience = $derived(spine?.charter?.targetAudience ?? null)
  const selectedRelease = $derived(spine?.selectedRelease ?? null)
  const selectedTaskScope = $derived(spine?.selectedTaskScope ?? spine?.scope ?? null)
  const taskScopeLabel = $derived(spine?.summary?.selectedScopeLabel ?? selectedTaskScope?.label ?? spine?.summary?.selectedReleaseLabel ?? selectedRelease?.label ?? 'Current task scope')
  const workContainerTitle = $derived('Task scope')
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
        if (ref.startsWith('import:')) importRefs.add(ref)
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
        value: sourceLabelFor(selectedTaskScope?.source),
        detail: `${taskScopeLabel} contains ${spine.summary?.includedWorkCount ?? spine.summary?.includedCount ?? 0} assigned work items and ${spine.summary?.deferredWorkCount ?? spine.summary?.deferredCount ?? 0} later.`,
        tone: sourceIsInferred(selectedTaskScope?.source) ? 'warn' as Tone : 'ok' as Tone,
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

  function sourceRefLabel(ref: string): string {
    const value = ref.startsWith('import:') ? ref.slice('import:'.length) : ref
    const parts = value.split('/').filter(Boolean)
    return parts.at(-1) ?? value
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
        <Chip label={taskScopeLabel} tone={sourceIsInferred(selectedTaskScope?.source) ? 'warn' : 'accent'} />
        <strong>{countLabel(spine?.summary?.includedWorkCount ?? spine?.summary?.includedCount, 'assigned work item')}</strong>
        <span>{countLabel(documentedCapabilityCount, 'documented capability', 'documented capabilities')} · {countLabel(documentedLaterCount, 'later capability', 'later capabilities')} · {countLabel(sourceGapCount, 'gap')}</span>
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
        <span>Tasks in scope</span>
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
      <UtilityPanel className="stat" tone={documentedLaterCount ? 'neutral' : 'ok'}>
        <strong>{documentedLaterCount}</strong>
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
                      onclick={() => {
                        const href = childHref(child)
                        if (href) go(href)
                      }}
                    >
                      <span>{child.title ?? 'Untitled work'}</span>
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
                        <span>{child.title ?? 'Untitled capability'}</span>
                        <Chip label={child.maturity === 'deferred' ? 'Later' : maturityLabel(child)} tone={child.maturity === 'deferred' ? 'neutral' : laneTone(child)} />
                      </CardListItem>
                    {/each}
                  </div>
                {/if}
              </CardListItem>
            {/each}
          </CardList>
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

  .internal-summary {
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
    overflow-wrap: anywhere;
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
