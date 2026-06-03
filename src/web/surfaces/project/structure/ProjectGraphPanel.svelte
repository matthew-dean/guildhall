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
  import type { ProjectGraphStore } from './project-graph-store.svelte.js'

  interface Props {
    store: ProjectGraphStore
  }

  let { store }: Props = $props()

  $effect(() => {
    void store.load()
  })

  const graph = $derived(store.projectGraph)
  const pickerResponsibility = $derived(store.assignmentPickerResponsibility())
  const relatedLocalProjectCount = $derived((graph?.localProjects ?? []).filter(item => item.role !== 'current').length)
  const graphDomainCount = $derived(store.structuralDomains().length)

  function surfaceScopeLabel(scopedReason: string): string {
    if (scopedReason === 'owner') return 'Owned here'
    if (scopedReason === 'consumer') return 'Consumed here'
    if (scopedReason === 'domain') return 'Domain match'
    return scopedReason
  }

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }
</script>

<SectionHeader
  eyebrow="Structure"
  title="Project graph"
  description="See detected domains, local projects, and dependency requests moving between project coordinators."
  headingTag="h2"
  density="compact"
>
  {#snippet meta()}
    <StatusPill
      label={`${graph?.dependencyEdges?.filter(edge => edge.unresolved).length ?? 0} open`}
      tone={(graph?.dependencyEdges?.some(edge => edge.unresolved) ?? false) ? 'warn' : 'ok'}
    />
  {/snippet}
</SectionHeader>

{#if store.error}
  <NoticeBand tone="danger" role="alert" label="Project graph" title="Could not load project graph" density="compact">
    <p>{store.error}</p>
  </NoticeBand>
{/if}

<div class="graph-grid">
  <FrameCard class="graph-card">
    {#snippet header()}
      <SectionHeader title="Domains" description="Click a domain to see where its work belongs." headingTag="h3" density="dense" />
    {/snippet}
    {#if !graph}
      <p class="muted">Loading project graph domains...</p>
    {:else if store.structuralDomains().length === 0}
      <p class="muted">Accept a structural map before assigning domain responsibilities.</p>
    {:else}
      <div class="domain-assignment-list">
        {#each store.structuralDomains() as domain (domain.id)}
          <button
            type="button"
            class:active={store.selectedDomainId === domain.id}
            class="domain-graph-node"
            aria-label={`Open ${domain.label} domain`}
            aria-pressed={store.selectedDomainId === domain.id}
            onclick={() => store.setSelectedDomainId(domain.id ?? null)}
          >
            <div class="domain-assignment-copy">
              <strong>{domain.label}</strong>
              <span class="muted">{store.domainSourceLabel(domain)}</span>
            </div>
            <StatusPill label={store.domainGraphSummary(domain)} tone={store.primaryAssignableResponsibility(domain.id)?.assigned ? 'ok' : 'neutral'} />
          </button>
        {/each}
      </div>
    {/if}
  </FrameCard>

  <FrameCard class="graph-card">
    {#snippet header()}
      <SectionHeader title="Managed projects" description="Guildhall can search this local project index when you assign a domain." headingTag="h3" density="dense" />
    {/snippet}
    {#if !graph}
      <p class="muted">Loading project graph...</p>
    {:else if (graph.localProjects?.length ?? 0) === 0}
      <p class="muted">No local projects registered yet.</p>
    {:else}
      <div class="project-index-summary">
        <strong>{store.localProjectIndexLabel()}</strong>
        <span class="muted">Current project: {graph.currentProject?.label ?? project.detail?.name ?? 'this project'}</span>
        <span class="muted">{countLabel(relatedLocalProjectCount, 'related local project')}</span>
        <span class="muted">{countLabel(graphDomainCount, 'project graph domain')}</span>
        {#if store.connectedProjectRows().length > 0}
          <span class="muted">{store.connectedProjectRows().length} connected by open requests</span>
        {/if}
      </div>
    {/if}
  </FrameCard>
</div>

<FrameCard class="graph-card graph-contract-surfaces-card">
  {#snippet header()}
    <SectionHeader
      title="Contract surfaces"
      description="Review durable component, API, schema, and design-system contracts connected to this project."
      headingTag="h3"
      density="dense"
    />
  {/snippet}
  {#if !graph}
    <p class="muted">Loading contract surfaces...</p>
  {:else if (graph.contractSurfaces?.length ?? 0) === 0}
    <p class="muted">No contract surfaces are scoped to this project yet.</p>
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
                    ]}
                  />
                  {#if (packet.existingInvariants?.length ?? 0) > 0}
                    <div class="surface-review-section">
                      <strong>Existing invariants</strong>
                      <ul>
                        {#each packet.existingInvariants ?? [] as invariant (invariant.id)}
                          <li><span>{invariant.label}</span><p>{invariant.rule}</p></li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if (packet.existingDecisions?.length ?? 0) > 0}
                    <div class="surface-review-section">
                      <strong>Decisions</strong>
                      <ul>
                        {#each packet.existingDecisions ?? [] as decision (decision.id)}
                          <li><span>{decision.summary}</span></li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if (packet.proofObligations?.length ?? 0) > 0}
                    <div class="surface-review-section">
                      <strong>Proof obligations</strong>
                      <ul>
                        {#each packet.proofObligations ?? [] as obligation (obligation)}
                          <li><span>{obligation}</span></li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if (packet.reviewFocus?.length ?? 0) > 0}
                    <div class="surface-review-section">
                      <strong>Review focus</strong>
                      <ul>
                        {#each packet.reviewFocus ?? [] as focus (focus)}
                          <li><span>{focus}</span></li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </section>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</FrameCard>

{#if store.selectedDomain()}
  {@const domain = store.selectedDomain()}
  {@const assignableResponsibility = store.primaryAssignableResponsibility(domain?.id)}
  <FrameCard class="graph-card">
    {#snippet header()}
      <SectionHeader
        title={domain?.label ?? 'Domain'}
        description="Keep local product decisions here. Assign reusable work only when another project should provide it."
        headingTag="h3"
        density="dense"
      />
    {/snippet}
    <div class="domain-detail">
      <section class="domain-detail-section domain-detail-section-local">
        <strong>Stays in {project.detail?.name ?? 'this project'}</strong>
        {#each store.localResponsibilitiesForDomain(domain?.id) as responsibility (responsibility.id)}
          <p>{responsibility.description}</p>
        {/each}
      </section>
      {#if assignableResponsibility}
        <section class="domain-detail-section">
          <strong>Can be assigned</strong>
          <p>{assignableResponsibility.description}</p>
          {#if assignableResponsibility.assigned && assignableResponsibility.responsibleProjectId !== project.detail?.id}
            <p class="muted">Currently assigned to {assignableResponsibility.responsibleProjectLabel}.</p>
          {/if}
          {#if store.graphAssignmentTargets(assignableResponsibility).length > 0}
            <Button
              variant="secondary"
              size="sm"
              className="assign-project-button"
              disabled={store.busy === `assign-responsibility:${assignableResponsibility.id}`}
              onclick={() => store.openAssignmentPicker(assignableResponsibility)}
            >
              Assign to project
            </Button>
          {/if}
        </section>
      {/if}
    </div>
  </FrameCard>
{/if}

<Modal
  open={Boolean(pickerResponsibility)}
  title={`Assign ${pickerResponsibility?.domainLabel ?? 'domain'}`}
  size="md"
  onClose={store.closeAssignmentPicker}
>
  <div class="assignment-picker">
    <p>Search Guildhall’s managed local projects and choose who should provide this reusable capability.</p>
    <Input
      type="search"
      ariaLabel="Find project"
      placeholder="Search projects"
      value={store.assignmentPickerQuery}
      oninput={store.setAssignmentPickerQuery}
    />
    {#if store.assignmentPickerQuery.trim().length === 0}
      <p class="muted">Start typing to search the local project index.</p>
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

<FrameCard class="graph-card graph-requests-card">
  {#snippet header()}
    <SectionHeader
      title="Dependency requests"
      description="Requests move through provider delivery and consumer verification."
      headingTag="h3"
      density="dense"
    />
  {/snippet}
  {#if !graph}
    <p class="muted">Loading dependency requests...</p>
  {:else if (graph.dependencyEdges?.length ?? 0) === 0}
    <div class="empty-graph-state">
      <strong>No dependency requests or contracts are active yet.</strong>
      <p>Use this graph to see who owns each domain now; request edges will appear here when one project asks another to provide or verify a contract.</p>
    </div>
  {:else}
    <div class="graph-request-list">
      {#each graph.dependencyEdges ?? [] as edge (edge.id)}
        {@const role = store.edgeRole(edge)}
        {@const actions = store.requestActionsForEdge(edge)}
        <section class:graph-request-inbound={role === 'inbound'} class="graph-request">
          <div class="graph-request-head">
            <div>
              <strong>{role === 'inbound' ? 'Inbound' : role === 'outgoing' ? 'Outgoing' : 'Related'} request</strong>
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
              ['Domain', edge.domainLabel ?? edge.domainId ?? 'none'],
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
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .graph-grid,
  .domain-assignment-list,
  .graph-request-list,
  .contract-surface-list,
  .domain-detail,
  .assignment-picker {
    display: grid;
    gap: var(--gh-space-3);
  }
  :global(.graph-card) {
    margin-block-end: var(--gh-space-3);
  }
  .domain-assignment-copy {
    display: grid;
    gap: var(--gh-space-1);
  }
  .domain-graph-node {
    appearance: none;
    border: 1px solid var(--border-muted);
    background: var(--surface);
    border-radius: var(--gh-radius-2);
    color: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-3);
    padding: var(--gh-space-3);
    text-align: left;
    width: 100%;
  }
  .domain-graph-node:hover,
  .domain-graph-node.active {
    border-color: var(--border-strong);
    background: var(--surface-raised);
  }
  .domain-detail-section {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-2);
    padding-block-start: var(--gh-space-3);
  }
  .domain-detail-section:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }
  .domain-detail-section-local {
    border-inline-start: 2px solid var(--accent);
    padding-inline-start: var(--gh-space-3);
  }
  .domain-detail p,
  .assignment-picker p,
  .graph-request-head p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.assign-project-button) {
    justify-self: start;
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
  .project-index-summary {
    border-inline-start: 2px solid var(--accent);
    display: grid;
    gap: var(--gh-space-2);
    padding-inline-start: var(--gh-space-3);
  }
  .empty-graph-state {
    display: grid;
    gap: var(--gh-space-2);
  }
  .empty-graph-state p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .graph-request {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-3);
  }
  .graph-request:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }
  .graph-request-inbound {
    border-inline-start: 2px solid var(--accent);
    padding-inline-start: var(--gh-space-3);
  }
  .contract-surface-row {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-2);
    padding-block-start: var(--gh-space-3);
  }
  .contract-surface-row:first-child {
    border-block-start: 0;
    padding-block-start: 0;
  }
  .contract-surface-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--gh-space-3);
  }
  .surface-review-packet-list {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-3);
  }
  .surface-review-packet {
    border-inline-start: 2px solid var(--accent);
    display: grid;
    gap: var(--gh-space-2);
    padding-inline-start: var(--gh-space-3);
  }
  .surface-review-packet-head {
    align-items: start;
    display: flex;
    gap: var(--gh-space-3);
    justify-content: space-between;
  }
  .surface-review-packet-head h4 {
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
    margin: 0;
  }
  .thread-link {
    color: var(--link);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    white-space: nowrap;
  }
  .surface-review-section {
    display: grid;
    gap: var(--gh-space-1);
  }
  .surface-review-section ul {
    display: grid;
    gap: var(--gh-space-1);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .surface-review-section li {
    display: grid;
    gap: var(--gh-space-1);
  }
  .surface-review-section p {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    margin: 0;
  }
  .graph-request-head {
    display: flex;
    justify-content: space-between;
    gap: var(--gh-space-3);
    align-items: flex-start;
  }
  .request-status-stack {
    display: grid;
    justify-items: end;
    gap: var(--gh-space-1);
    min-width: max-content;
  }
  @container (min-width: 42rem) {
    .graph-grid {
      grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 0.8fr);
    }
  }
</style>
