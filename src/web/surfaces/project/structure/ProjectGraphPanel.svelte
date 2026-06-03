<script lang="ts">
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../../lib/Button.svelte'
  import DefinitionList from '../../../lib/DefinitionList.svelte'
  import Input from '../../../lib/Input.svelte'
  import Modal from '../../../lib/Modal.svelte'
  import Row from '../../../lib/Row.svelte'
  import { project } from '../../../lib/project.svelte.js'
  import { projectActionHref } from '../../../lib/project-routes.js'
  import type { ProjectGraphResponsibility, ProjectGraphStore } from './project-graph-store.svelte.js'

  interface Props {
    store: ProjectGraphStore
  }

  let { store }: Props = $props()
  let contractDialog = $state<null | 'scan' | 'declare'>(null)

  $effect(() => {
    void store.load()
  })

  const graph = $derived(store.projectGraph)
  const pickerResponsibility = $derived(store.assignmentPickerResponsibility())
  const workAreas = $derived(store.structuralDomains())
  const connectedProjects = $derived(store.connectedProjectRows())
  const assignableResponsibilities = $derived((graph?.domainResponsibilities ?? []).filter(item => item.assignable))
  const localResponsibilities = $derived((graph?.domainResponsibilities ?? []).filter(item => !item.assignable))
  const openHandoffs = $derived(graph?.dependencyEdges?.filter(edge => edge.unresolved).length ?? 0)

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function cleanLabel(value: string | undefined): string {
    return (value ?? 'Work area')
      .replace(/^domain:/, '')
      .replaceAll(/[-_]/g, ' ')
      .replace(/\b\w/g, match => match.toUpperCase())
  }

  function areaTitle(domain: { id?: string; label?: string; coordinatorId?: string; coordinatorName?: string; path?: string }): string {
    const key = `${domain.id ?? ''} ${domain.label ?? ''} ${domain.coordinatorId ?? ''} ${domain.coordinatorName ?? ''} ${domain.path ?? ''}`.toLowerCase()
    if (key.includes('coherence')) return 'Story coherence and reviewer quality'
    if (key.includes('harness')) return 'Harness workflow and runtime'
    if (key.includes('spec')) return 'Specs and contracts'
    if (key.includes('product')) return 'Product direction'
    if (key.includes('meta')) return 'Project planning and Guildhall memory'
    if (key.includes('editor')) return 'Editor workflow and interface'
    if (key.includes('licens')) return 'Licensing and policy'
    if (key.includes('model')) return 'Model behavior and evaluation'
    if (key.includes('docs')) return 'Documentation and knowledge'
    if (key.includes('app')) return 'Application experience'
    return cleanLabel(domain.label ?? domain.id)
  }

  function areaDescription(domain: { id?: string; label?: string; coordinatorId?: string; coordinatorName?: string; path?: string }): string {
    const key = `${domain.id ?? ''} ${domain.label ?? ''} ${domain.coordinatorId ?? ''} ${domain.coordinatorName ?? ''} ${domain.path ?? ''}`.toLowerCase()
    if (key.includes('coherence')) return 'Preserves voice, continuity, character behavior, and scene logic across writing changes.'
    if (key.includes('harness')) return 'Keeps the project harness, prototype loop, and runtime workflow understandable.'
    if (key.includes('spec')) return 'Turns project intent into durable specs, acceptance criteria, and contract records.'
    if (key.includes('product')) return 'Owns product direction, user value, and what the project should become.'
    if (key.includes('meta')) return 'Keeps Guildhall state, planning notes, and project memory coherent.'
    if (key.includes('editor')) return 'Shapes the editing experience, interaction model, and reusable editor capabilities.'
    if (key.includes('licens')) return 'Tracks license rules, policy boundaries, and commercial obligations.'
    if (key.includes('model')) return 'Tracks model behavior, quality checks, and evaluation boundaries.'
    if (key.includes('docs')) return 'Keeps documentation and knowledge surfaces aligned with the project.'
    if (key.includes('app')) return 'Shapes the user-facing application experience.'
    return 'A work area Guildhall detected from project structure, coordinator routing, or project graph records.'
  }

  function internalLabel(domain: { label?: string; coordinatorName?: string; coordinatorId?: string; path?: string }): string {
    const parts = [
      domain.label,
      domain.coordinatorName ?? domain.coordinatorId,
      domain.path,
    ].filter(Boolean)
    return parts.join(' - ')
  }

  function localResponsibilityText(domainId?: string): string {
    const local = localResponsibilities.filter(item => item.domainId === domainId)
    if (local.length === 0) return `${project.detail?.name ?? 'This project'} owns the project-specific decisions and verification for this area.`
    return local.map(item => item.description).join(' ')
  }

  function primaryAssignable(domainId?: string): ProjectGraphResponsibility | null {
    return store.primaryAssignableResponsibility(domainId)
  }

  function assignmentSummary(responsibility: ProjectGraphResponsibility | null): string {
    if (!responsibility) return 'No reusable capability is recorded for this area yet.'
    if (responsibility.assigned && responsibility.responsibleProjectId !== project.detail?.id) {
      return `Assigned to ${responsibility.responsibleProjectLabel}.`
    }
    return responsibility.description
  }

  function surfaceScopeLabel(scopedReason: string): string {
    if (scopedReason === 'owner') return 'Owned here'
    if (scopedReason === 'consumer') return 'Consumed here'
    if (scopedReason === 'domain') return 'Domain match'
    return scopedReason
  }

  function handoffTitle(edge: { consumerProjectLabel?: string; providerProjectLabel?: string }): string {
    const consumer = edge.consumerProjectLabel ?? 'Consumer project'
    const provider = edge.providerProjectLabel ?? 'Provider project'
    if (edge.providerProjectLabel === project.detail?.name) return `${consumer} is asking this project for work`
    if (edge.consumerProjectLabel === project.detail?.name) return `${project.detail?.name} is waiting on ${provider}`
    return `${consumer} needs ${provider}`
  }
</script>

<SectionHeader
  eyebrow="Structure"
  title="Structure"
  description={`What Guildhall understands about ${project.detail?.name ?? 'this project'}: work areas, boundaries, contracts, and project handoffs.`}
  headingTag="h2"
  density="compact"
/>

{#if store.error}
  <NoticeBand tone="danger" role="alert" label="Structure" title="Could not load project structure" density="compact">
    <p>{store.error}</p>
  </NoticeBand>
{/if}

<section class="structure-chart" aria-label="Project structure chart">
  <div class="chart-project-node">
    <span>Project</span>
    <strong>{graph?.currentProject?.label ?? project.detail?.name ?? 'This project'}</strong>
  </div>
  <div class="chart-ring" aria-label="Work areas">
    {#if !graph}
      <span class="muted">Loading project shape...</span>
    {:else if workAreas.length === 0}
      <span class="muted">No work areas recorded yet.</span>
    {:else}
      {#each workAreas as domain (domain.id)}
        <span class="chart-work-area">{areaTitle(domain)}</span>
      {/each}
    {/if}
  </div>
  <div class="chart-summary" aria-label="Boundary summary">
    <span>{countLabel(workAreas.length, 'work area')}</span>
    <span>{countLabel(graph?.contractSurfaces?.length ?? 0, 'contract')}</span>
    <span>{countLabel(openHandoffs, 'active handoff')}</span>
    <span>{connectedProjects.length > 0 ? countLabel(connectedProjects.length, 'connected project') : 'No connected external projects'}</span>
  </div>
</section>

<FrameCard class="structure-section work-areas-section">
  {#snippet header()}
    <SectionHeader
      title="Work areas"
      description="Human-readable areas Guildhall uses to route work. Internal labels are shown only as metadata."
      headingTag="h3"
      density="dense"
    />
  {/snippet}

  {#if !graph}
    <p class="muted">Loading work areas...</p>
  {:else if workAreas.length === 0}
    <p class="muted">No work areas are recorded yet.</p>
  {:else}
    <div class="work-area-list" aria-label="Work areas">
      {#each workAreas as domain (domain.id)}
        {@const assignable = primaryAssignable(domain.id)}
        <section class="work-area-row" aria-label={`${areaTitle(domain)} work area`}>
          <div class="work-area-main">
            <strong>{areaTitle(domain)}</strong>
            <p>{areaDescription(domain)}</p>
            <span class="metadata">{internalLabel(domain)}</span>
          </div>
          <div class="work-area-owned">
            <span class="column-label">Owned here</span>
            <p>{localResponsibilityText(domain.id)}</p>
          </div>
          <div class="work-area-assignment">
            <span class="column-label">Reusable work</span>
            <p>{assignmentSummary(assignable)}</p>
            {#if assignable && store.graphAssignmentTargets(assignable).length > 0}
              <Button
                variant="secondary"
                size="sm"
                ariaLabel={`Assign ${areaTitle(domain)}`}
                disabled={store.busy === `assign-responsibility:${assignable.id}`}
                onclick={() => store.openAssignmentPicker(assignable)}
              >
                Assign
              </Button>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</FrameCard>

<FrameCard class="structure-section">
  {#snippet header()}
    <SectionHeader
      title="Boundaries and assignments"
      description="What stays inside this project, what can move, and which projects are actually connected."
      headingTag="h3"
      density="dense"
    />
  {/snippet}

  <div class="boundary-grid">
    <section>
      <strong>Owned by {project.detail?.name ?? 'this project'}</strong>
      <p class="muted">Project-specific taste, acceptance criteria, configuration, and verification stay here unless a real handoff says otherwise.</p>
    </section>
    <section>
      <strong>Can move</strong>
      <p class="muted">{assignableResponsibilities.length > 0 ? `${countLabel(assignableResponsibilities.length, 'reusable capability')} can be assigned through the row actions above.` : 'No reusable capabilities are recorded yet.'}</p>
    </section>
    <section>
      <strong>Connected projects</strong>
      {#if connectedProjects.length === 0}
        <p class="muted">No other project is connected to this graph yet.</p>
      {:else}
        <ul class="plain-list">
          {#each connectedProjects as item (item.id)}
            <li>{item.label}</li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</FrameCard>

<FrameCard class="structure-section contracts-section">
  {#snippet header()}
    <SectionHeader
      title="Contracts"
      description="APIs, schemas, components, review packets, or other boundaries Guildhall should preserve across work."
      headingTag="h3"
      density="dense"
    />
  {/snippet}

  {#if !graph}
    <p class="muted">Loading contracts...</p>
  {:else if (graph.contractSurfaces?.length ?? 0) === 0}
    <div class="empty-action-state">
      <div>
        <strong>No contracts are tracked yet.</strong>
        <p>Contracts make important boundaries durable so Guildhall can preserve them across future work.</p>
      </div>
      <Row gap="2" wrap>
        <Button variant="secondary" size="sm" onclick={() => { contractDialog = 'scan' }}>Scan for contracts</Button>
        <Button variant="secondary" size="sm" onclick={() => { contractDialog = 'declare' }}>Declare contract</Button>
      </Row>
    </div>
  {:else}
    <div class="contract-surface-list">
      {#each graph.contractSurfaces ?? [] as surface (surface.id)}
        <section class="contract-surface-row">
          <div class="contract-surface-head">
            <div>
              <strong>{surface.label}</strong>
              <p class="muted">{surface.domainLabel ?? surface.owningProjectLabel}</p>
            </div>
            <div class="request-status-stack">
              <StatusPill label={surface.state.replaceAll('_', ' ')} tone={surface.state === 'accepted' ? 'ok' : 'warn'} />
              <span class="muted">{surfaceScopeLabel(surface.scopedReason)}</span>
            </div>
          </div>
          <DefinitionList
            items={[
              ['Kind', surface.kind.replaceAll('_', ' ')],
              ['Authority', surface.authority],
              ['Scope', surface.scope.replaceAll('_', ' ')],
              ['Invariants', `${surface.invariantCount} ${surface.invariantCount === 1 ? 'invariant' : 'invariants'}`],
              ['Consumers', `${surface.consumerCount} ${surface.consumerCount === 1 ? 'consumer' : 'consumers'}`],
            ]}
          />
          {#if (surface.reviewPackets?.length ?? 0) > 0}
            <div class="surface-review-packet-list">
              {#each surface.reviewPackets ?? [] as packet (packet.id)}
                <section class="surface-review-packet">
                  <div class="surface-review-packet-head">
                    <div>
                      <h4>Surface review packet</h4>
                      <p class="muted">{packet.currentSpecRef}</p>
                    </div>
                    <a class="thread-link" href={projectActionHref('/thread')}>Open Threads</a>
                  </div>
                  <DefinitionList
                    items={[
                      ['Current delta', packet.currentDeltaSummary],
                      ['Known consumers', packet.knownConsumers?.join(', ') || 'None recorded'],
                      ['Sibling specs', packet.siblingSpecRefs?.join(', ') || null],
                      ['Drift', packet.driftFindings?.join('; ') || null],
                      ...(packet.existingInvariants?.flatMap((invariant) => [
                        ['Invariant', invariant.label],
                        ['Rule', invariant.rule],
                      ]) ?? []),
                      ...(packet.existingDecisions?.map((decision) => ['Decision', decision.summary]) ?? []),
                      ...(packet.proofObligations?.map((proof) => ['Proof needed', proof]) ?? []),
                    ]}
                  />
                </section>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</FrameCard>

<Modal
  open={Boolean(contractDialog)}
  title={contractDialog === 'scan' ? 'Scan for contracts' : 'Declare contract'}
  size="md"
  onClose={() => { contractDialog = null }}
>
  <div class="contract-dialog">
    {#if contractDialog === 'scan'}
      <p>Guildhall should inspect the project for APIs, schemas, components, review packets, and other durable boundaries worth tracking as contracts.</p>
      <p class="muted">This first implementation exposes the action and explanation. The follow-up runtime command should turn this into a real contract-discovery request.</p>
    {:else}
      <p>Declare a contract when you already know a boundary Guildhall should preserve, such as a component API, schema, design-system primitive, or review packet.</p>
      <p class="muted">The follow-up runtime command should create a contract record from this flow.</p>
    {/if}
  </div>
</Modal>

<Modal
  open={Boolean(pickerResponsibility)}
  title={`Assign ${pickerResponsibility?.domainLabel ?? 'work'}`}
  size="md"
  onClose={store.closeAssignmentPicker}
>
  <div class="assignment-picker">
    <p>Choose the project that should provide this reusable capability. This project still owns its local requirements and verification.</p>
    <Input
      type="search"
      ariaLabel="Find provider project"
      placeholder="Search projects"
      value={store.assignmentPickerQuery}
      oninput={store.setAssignmentPickerQuery}
    />
    {#if store.assignmentPickerQuery.trim().length === 0}
      <p class="muted">Start typing to search available provider projects.</p>
    {:else if store.assignmentPickerTargets().length === 0}
      <p class="muted">No matching projects.</p>
    {:else}
      <div class="assignment-picker-list">
        {#each store.assignmentPickerTargets() as target (target.id)}
          <button
            type="button"
            class="assignment-picker-row"
            disabled={store.busy === `assign-responsibility:${pickerResponsibility?.id}`}
            onclick={() => store.chooseAssignmentTarget(target.id)}
          >
            <strong>{target.label}</strong>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Modal>

<FrameCard class="structure-section handoffs-section">
  {#snippet header()}
    <SectionHeader
      title="Project handoffs"
      description="Provider or consumer work crossing a project boundary."
      headingTag="h3"
      density="dense"
    />
  {/snippet}
  {#if !graph}
    <p class="muted">Loading project handoffs...</p>
  {:else if (graph.dependencyEdges?.length ?? 0) === 0}
    <div class="empty-graph-state">
      <strong>No active handoffs.</strong>
      <p>{project.detail?.name ?? 'This project'} is not waiting on another project, and no other project is waiting on it.</p>
    </div>
  {:else}
    <div class="graph-request-list">
      {#each graph.dependencyEdges ?? [] as edge (edge.id)}
        {@const role = store.edgeRole(edge)}
        {@const actions = store.requestActionsForEdge(edge)}
        <section class:graph-request-inbound={role === 'inbound'} class="graph-request">
          <div class="graph-request-head">
            <div>
              <strong>{handoffTitle(edge)}</strong>
              <p>{edge.consumerNeed}</p>
            </div>
            <div class="request-status-stack">
              <StatusPill label={store.requestWaitingOn(edge)} tone={edge.unresolved ? 'warn' : 'ok'} />
              <span class="muted">{store.requestRoleLabel(edge)}</span>
            </div>
          </div>
          <DefinitionList
            items={[
              ['State', edge.state.replaceAll('_', ' ')],
              ['Work area', edge.domainLabel ?? edge.domainId ?? 'none'],
              ['Consumer', edge.consumerProjectLabel ?? edge.consumerProjectId ?? 'unknown'],
              ['Provider', edge.providerProjectLabel ?? edge.providerProjectId ?? 'unknown'],
              ['Delivery', edge.expectedDelivery ? `${edge.expectedDelivery.format ?? 'delivery'} via ${edge.expectedDelivery.channel ?? 'unspecified channel'}` : 'not planned'],
              ['Latest return', edge.latestReturnPacket?.requestedCorrection ?? null],
            ]}
          />
          {#if actions.length > 0}
            <Row justify="end" wrap>
              {#each actions as action (action)}
                <Button
                  variant={action === 'consumer-return' ? 'secondary' : 'agent'}
                  size="sm"
                  disabled={store.busy === `${action}:${edge.id}`}
                  onclick={() => store.runRequestAction(edge.id, action)}
                >
                  {store.requestActionLabel(action)}
                </Button>
              {/each}
            </Row>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</FrameCard>

<style>
  .muted,
  .metadata,
  .column-label {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  .structure-chart {
    border: 1px solid var(--border-muted);
    border-radius: var(--gh-radius-2);
    display: grid;
    gap: var(--gh-space-4);
    padding: var(--gh-space-4);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 3%, transparent), transparent),
      var(--surface);
  }

  .chart-project-node {
    border: 1px solid var(--border-strong);
    border-radius: var(--gh-radius-2);
    display: grid;
    gap: var(--gh-space-1);
    justify-self: center;
    max-width: 28rem;
    padding: var(--gh-space-3) var(--gh-space-4);
    text-align: center;
  }

  .chart-project-node span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    text-transform: uppercase;
  }

  .chart-ring,
  .chart-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    justify-content: center;
  }

  .chart-work-area,
  .chart-summary span {
    border: 1px solid var(--border-muted);
    border-radius: var(--gh-radius-full);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    padding: var(--gh-space-2) var(--gh-space-3);
  }

  .chart-summary span {
    color: var(--text-muted);
  }

  :global(.structure-section) {
    margin-block-end: var(--gh-space-3);
  }

  .work-area-list,
  .boundary-grid,
  .graph-request-list,
  .contract-surface-list,
  .assignment-picker,
  .contract-dialog {
    display: grid;
    gap: var(--gh-space-3);
  }

  .work-area-row {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-3);
  }

  .work-area-row:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }

  .work-area-main,
  .work-area-owned,
  .work-area-assignment,
  .empty-action-state,
  .empty-graph-state {
    display: grid;
    gap: var(--gh-space-2);
  }

  .work-area-main p,
  .work-area-owned p,
  .work-area-assignment p,
  .empty-action-state p,
  .empty-graph-state p,
  .assignment-picker p,
  .contract-dialog p,
  .graph-request-head p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  .column-label {
    text-transform: uppercase;
  }

  .plain-list {
    margin: 0;
    padding-inline-start: var(--gh-space-4);
  }

  .assignment-picker-list {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    max-height: min(42vh, 24rem);
    overflow: auto;
  }

  .assignment-picker-row {
    appearance: none;
    background: transparent;
    border: 0;
    border-block-end: 1px solid var(--border-muted);
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: var(--gh-space-3) 0;
    text-align: left;
  }

  .contract-surface-row,
  .graph-request {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-3);
  }

  .contract-surface-row:first-child,
  .graph-request:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }

  .contract-surface-head,
  .surface-review-packet-head,
  .graph-request-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--gh-space-3);
  }

  .surface-review-packet-list {
    display: grid;
    gap: var(--gh-space-3);
  }

  .surface-review-packet {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-3);
  }

  .surface-review-packet h4 {
    margin: 0;
  }

  .thread-link {
    color: var(--link);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    text-decoration: none;
  }

  .request-status-stack {
    display: grid;
    gap: var(--gh-space-1);
    justify-items: end;
  }

  .graph-request-inbound {
    border-inline-start: 2px solid var(--accent);
    padding-inline-start: var(--gh-space-3);
  }

  @media (min-width: 880px) {
    .work-area-row {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }

    .boundary-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
