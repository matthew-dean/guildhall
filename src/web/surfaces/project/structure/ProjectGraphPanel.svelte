<script lang="ts">
  import { tick } from 'svelte'
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../../lib/Button.svelte'
  import DefinitionList from '../../../lib/DefinitionList.svelte'
  import Field from '../../../lib/Field.svelte'
  import Icon from '../../../lib/Icon.svelte'
  import Input from '../../../lib/Input.svelte'
  import Modal from '../../../lib/Modal.svelte'
  import Row from '../../../lib/Row.svelte'
  import Select from '../../../lib/Select.svelte'
  import { portal } from '../../../lib/portal.js'
  import { project } from '../../../lib/project.svelte.js'
  import { projectActionHref } from '../../../lib/project-routes.js'
  import type { ProjectGraphContractSurface, ProjectGraphResponsibility, ProjectGraphStore } from './project-graph-store.svelte.js'
  import StructureHelpTip from './StructureHelpTip.svelte'

  interface Props {
    store: ProjectGraphStore
  }

  type WorkAreaDomain = ReturnType<ProjectGraphStore['structuralDomains']>[number]
  type ContractSurface = ProjectGraphContractSurface
  type ProjectMapRow = {
    id: string
    title: string
    path: string
    domains: WorkAreaDomain[]
    contracts: ContractSurface[]
  }

  let { store }: Props = $props()
  let capabilityDialogOpen = $state(false)
  let capabilitySearch = $state('')
  let capabilityListOpen = $state(false)
  let capabilityPickerElement = $state<HTMLElement | null>(null)
  let capabilityControlElement = $state<HTMLElement | null>(null)
  let capabilityDropdownElement = $state<HTMLElement | null>(null)
  let capabilityDropdownStyle = $state('')
  let selectedCapabilityId = $state('')
  let selectedProviderProjectId = $state('')

  $effect(() => {
    void store.load()
  })

  $effect(() => {
    if (!capabilityDialogOpen || !capabilityListOpen) return

    function handleDocumentPointerDown(event: PointerEvent): void {
      if (!capabilityPickerElement || !(event.target instanceof Node)) return
      if (capabilityDropdownElement?.contains(event.target)) return
      if (!capabilityPickerElement.contains(event.target)) capabilityListOpen = false
    }

    function handleViewportChange(): void {
      updateCapabilityDropdownPosition()
    }

    updateCapabilityDropdownPosition()
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  })

  const graph = $derived(store.projectGraph)
  const workAreas = $derived(store.structuralDomains())
  const connectedProjects = $derived(store.connectedProjectRows())
  const linkableCapabilities = $derived(
    (graph?.domainResponsibilities ?? []).filter(item => item.assignable && store.graphAssignmentTargets(item).length > 0),
  )
  const openHandoffs = $derived(graph?.dependencyEdges?.filter(edge => edge.unresolved).length ?? 0)
  const contractSurfaces = $derived(graph?.contractSurfaces ?? [])
  const projectMapRows = $derived(projectMapRowsFor(workAreas, contractSurfaces))
  const trimmedCapabilitySearch = $derived(capabilitySearch.trim())
  const matchingCapabilities = $derived(linkableCapabilities.filter((item) => {
    const needle = trimmedCapabilitySearch.toLowerCase()
    if (!needle) return true
    return capabilitySearchMatches(item, needle)
  }))
  const filteredCapabilities = $derived(matchingCapabilities.slice(0, 25))
  const selectedCapability = $derived(linkableCapabilities.find(item => item.id === selectedCapabilityId) ?? null)
  const providerOptions = $derived([
    { value: '', label: selectedCapability ? 'Choose provider project' : 'Choose a capability first', disabled: true },
    ...(selectedCapability ? store.graphAssignmentTargets(selectedCapability).map(target => ({ value: target.id, label: target.label })) : []),
  ])

  function capabilitySearchMatches(item: ProjectGraphResponsibility, needle: string): boolean {
    return [
      capabilityOptionLabel(item),
      item.description,
      item.domainLabel,
      item.facetLabel,
      item.responsibleProjectLabel,
      item.id,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle)
  }

  function capabilityOptionLabel(capability: ProjectGraphResponsibility): string {
    return `${capability.domainLabel} - ${capability.facetLabel}`
  }

  function capabilityCurrentOwner(capability: ProjectGraphResponsibility): string {
    if (capability.assigned && capability.responsibleProjectId !== project.detail?.id) {
      return capability.responsibleProjectLabel
    }
    return `${project.detail?.name ?? 'This project'} keeps this unless you assign it`
  }

  function capabilitySearchHelp(): string | null {
    if (matchingCapabilities.length > filteredCapabilities.length) {
      return `Showing the first ${filteredCapabilities.length} matches. Keep typing to narrow the list.`
    }
    return null
  }

  function handleCapabilitySearch(value: string): void {
    capabilitySearch = value
    openCapabilityList()
    const needle = value.trim().toLowerCase()
    const selectedStillMatches = selectedCapability && (!needle || capabilitySearchMatches(selectedCapability, needle))
    if (selectedCapabilityId && !selectedStillMatches) {
      selectedCapabilityId = ''
      selectedProviderProjectId = ''
    }
  }

  function chooseCapability(capability: ProjectGraphResponsibility): void {
    selectedCapabilityId = capability.id
    selectedProviderProjectId = ''
    capabilitySearch = capabilityOptionLabel(capability)
    closeCapabilityList()
  }

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function cleanLabel(value: string | undefined): string {
    return (value ?? 'Work area').replace(/^domain:/, '').trim() || 'Work area'
  }

  function areaTitle(domain: { id?: string; label?: string; coordinatorId?: string; coordinatorName?: string; path?: string }): string {
    const sourcePath = areaPath(domain)
    if (sourcePath) return sourcePath.split('/').filter(Boolean).at(-1) ?? sourcePath
    return cleanLabel(domain.label ?? domain.id)
  }

  function areaPath(domain: { path?: string }): string {
    return domain.path?.trim() ?? ''
  }

  function surfaceMatchesWorkArea(
    surface: { domainId?: string; domainLabel?: string; label?: string },
    domain: { id?: string; label?: string; coordinatorId?: string; coordinatorName?: string; path?: string },
  ): boolean {
    if (surface.domainId && domain.id && surface.domainId === domain.id) return true
    const areaCandidates = normalizedAreaKeys(domain)
    const surfaceCandidates = normalizedSurfaceKeys(surface)
    return surfaceCandidates.some(surfaceKey =>
      areaCandidates.some(areaKey =>
        surfaceKey === areaKey ||
        surfaceKey.endsWith(`/${areaKey}`) ||
        areaKey.endsWith(surfaceKey) ||
        areaKey.replace(/^jess-/, '') === surfaceKey,
      ),
    )
  }

  function normalizedAreaKeys(domain: { id?: string; label?: string; coordinatorId?: string; coordinatorName?: string; path?: string }): string[] {
    return [
      areaTitle(domain),
      cleanLabel(domain.label ?? domain.id),
      domain.coordinatorId,
      areaPath(domain).split('/').filter(Boolean).at(-1),
    ].map(normalizedKey).filter(Boolean)
  }

  function normalizedSurfaceKeys(surface: { domainId?: string; domainLabel?: string; label?: string }): string[] {
    return [
      surface.domainLabel,
      surface.label?.replace(/\s+package contract$/i, ''),
      surface.domainId?.replace(/^domain:/, ''),
    ].map(normalizedKey).filter(Boolean)
  }

  function normalizedKey(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/^@[^/]+\//, '')
  }

  function projectMapRowsFor(domains: WorkAreaDomain[], surfaces: ContractSurface[]): ProjectMapRow[] {
    const rows = new Map<string, ProjectMapRow>()
    for (const domain of domains) {
      const path = areaPath(domain)
      const title = areaTitle(domain)
      const key = path || normalizedKey(title) || domain.id || `domain-${rows.size}`
      const existing = rows.get(key)
      if (existing) {
        existing.domains.push(domain)
      } else {
        rows.set(key, {
          id: key.replace(/[^a-zA-Z0-9_-]+/g, '-'),
          title,
          path,
          domains: [domain],
          contracts: [],
        })
      }
    }
    for (const surface of surfaces) {
      for (const row of rows.values()) {
        if (!row.domains.some(domain => surfaceMatchesWorkArea(surface, domain))) continue
        if (!row.contracts.some(contract => contract.id === surface.id)) row.contracts.push(surface)
      }
    }
    return Array.from(rows.values()).sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }),
    )
  }

  function rowRouteSummary(row: ProjectMapRow): string {
    const labels = row.domains
      .map(domain => {
        const coordinator = domain.coordinatorName ?? domain.coordinatorId
        const label = cleanLabel(domain.label ?? domain.id)
        if (coordinator && coordinator !== row.title) return coordinator
        if (!row.path && label !== row.title) return label
        return null
      })
      .filter((value): value is string => Boolean(value))
    return [...new Set(labels)].join(', ')
  }

  function contractFacts(surface: ContractSurface): string[] {
    return [
      surface.kind.replaceAll('_', ' '),
      countLabel(surface.invariantCount, 'invariant'),
      surface.consumerCount > 0 ? countLabel(surface.consumerCount, 'consumer') : null,
    ].filter((value): value is string => Boolean(value))
  }

  function handoffTitle(edge: { consumerProjectLabel?: string; providerProjectLabel?: string }): string {
    const consumer = edge.consumerProjectLabel ?? 'Consumer project'
    const provider = edge.providerProjectLabel ?? 'Provider project'
    if (edge.providerProjectLabel === project.detail?.name) return `${consumer} is asking this project for work`
    if (edge.consumerProjectLabel === project.detail?.name) return `${project.detail?.name} is waiting on ${provider}`
    return `${consumer} needs ${provider}`
  }

  function openCapabilityDialog(): void {
    capabilityDialogOpen = true
    capabilitySearch = ''
    capabilityListOpen = false
    selectedCapabilityId = ''
    selectedProviderProjectId = ''
  }

  function openCapabilityList(): void {
    capabilityListOpen = true
    void tick().then(updateCapabilityDropdownPosition)
  }

  function closeCapabilityList(): void {
    capabilityListOpen = false
  }

  function toggleCapabilityList(): void {
    if (capabilityListOpen) {
      closeCapabilityList()
      return
    }
    openCapabilityList()
  }

  function updateCapabilityDropdownPosition(): void {
    if (!capabilityControlElement || typeof window === 'undefined') return
    const rect = capabilityControlElement.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.max(180, Math.min(rect.width, viewportWidth - margin * 2))
    const left = clamp(rect.left, margin, Math.max(margin, viewportWidth - width - margin))
    const below = viewportHeight - rect.bottom - margin - gap
    const above = rect.top - margin - gap
    const openAbove = below < 180 && above > below
    const availableHeight = Math.max(160, Math.min(320, openAbove ? above : below))
    const top = openAbove
      ? Math.max(margin, rect.top - gap - availableHeight)
      : Math.min(viewportHeight - margin, rect.bottom + gap)

    capabilityDropdownStyle = [
      `left: ${Math.round(left)}px`,
      `top: ${Math.round(top)}px`,
      `width: ${Math.round(width)}px`,
      `--capability-dropdown-max-height: ${Math.round(availableHeight)}px`,
    ].join('; ')
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  async function assignCapability(): Promise<void> {
    if (!selectedCapability || !selectedProviderProjectId) return
    await store.assignDomainResponsibilityTo(selectedCapability, selectedProviderProjectId)
    capabilityDialogOpen = false
    selectedCapabilityId = ''
    selectedProviderProjectId = ''
    capabilitySearch = ''
    capabilityListOpen = false
  }
</script>

<SectionHeader
  eyebrow="Structure"
  title="Structure"
  description={`What Guildhall uses when starting work in ${project.detail?.name ?? 'this project'}: likely areas, review boundaries, and rare project handoffs.`}
  headingTag="h2"
  density="compact"
  metaPlacement="inline"
>
  {#snippet meta()}
    <StructureHelpTip
      label="Structure"
      text="Structure is the maintenance view for Guildhall's task-start context. Most of its value should appear when a task starts; this page is for corrections, contracts, and handoffs."
    />
  {/snippet}
</SectionHeader>

{#if store.error}
  <NoticeBand tone="danger" role="alert" label="Structure" title="Could not load project structure" density="compact">
    <p>{store.error}</p>
  </NoticeBand>
{/if}

<section class="structure-section project-map-section" aria-label="Project map">
  <SectionHeader
    title="Project map"
    description="The local areas Guildhall can use as starting context. Correct this only when future tasks would start in the wrong place."
    headingTag="h3"
    density="dense"
    metaPlacement="inline"
  >
    {#snippet meta()}
      <StructureHelpTip
        label="Project map"
        text="The project map is not meant to be a taxonomy assignment chore. Guildhall uses it to choose likely context and checks for tasks; edit it when that starting context would be wrong."
      />
    {/snippet}
  </SectionHeader>
  {#if !graph}
    <p class="muted">Loading project map...</p>
  {:else if workAreas.length === 0}
    <p class="muted">No work areas are recorded yet.</p>
  {:else}
    <div class="project-map-summary" aria-label="Project map summary">
      <span>{countLabel(projectMapRows.length, 'work area')}</span>
      <span>{countLabel(graph?.contractSurfaces?.length ?? 0, 'contract')}</span>
      <span>{countLabel(openHandoffs, 'active handoff')}</span>
      <span>{connectedProjects.length > 0 ? countLabel(connectedProjects.length, 'connected project') : 'No connected external projects'}</span>
    </div>

    {#if linkableCapabilities.length > 0}
      <div class="project-map-actions">
        <Button variant="secondary" size="sm" onclick={openCapabilityDialog}>
          Link capability
        </Button>
      </div>
    {/if}
    {#if contractSurfaces.length === 0}
      <p class="muted">No contracts are recorded yet.</p>
    {/if}

    <section class="project-map-list" aria-label="Work areas">
      <div class="project-map-list-head">
        <strong>Work area</strong>
        <span class="project-map-contract-head">
          <strong>Context and review boundaries</strong>
          <StructureHelpTip
            label="Contracts"
            text="Contracts are boundaries Guildhall should preserve, such as package APIs, schemas, components, or review packets. Tracked here means this project owns the boundary; a consumer contract means another project depends on it."
          />
        </span>
      </div>
      {#each projectMapRows as row (row.id)}
        {@const routeSummary = rowRouteSummary(row)}
        <section
          id={`work-area-${row.id}`}
          class="work-area-row"
        >
          <div class="work-area-name">
            <strong>{row.title}</strong>
            {#if routeSummary}
              <span class="metadata">{routeSummary}</span>
            {/if}
          </div>
          <div class="work-area-detail">
            {#if row.path}
              <span class="metadata">{row.path}</span>
            {/if}
            {#if row.contracts.length > 0}
              <details class="area-contract-disclosure">
                <summary>{countLabel(row.contracts.length, 'review boundary')}</summary>
                <div class="area-contract-list" aria-label={`Contracts for ${row.title}`}>
                  {#each row.contracts as surface (surface.id)}
                    {@const facts = contractFacts(surface)}
                    <section class="area-contract-row">
                      <div class="area-contract-head">
                        <div>
                          <strong>{surface.label}</strong>
                          <p class="contract-facts">
                            {#each facts as fact}
                              <span>{fact}</span>
                            {/each}
                          </p>
                        </div>
                      </div>
                      {#if (surface.reviewPackets?.length ?? 0) > 0}
                        <div class="surface-review-packet-list">
                          {#each surface.reviewPackets ?? [] as packet (packet.id)}
                            <section class="surface-review-packet">
                              <div class="surface-review-packet-head">
                                <div>
                                  <span class="inline-heading">
                                    <h4>Surface review packet</h4>
                                    <StructureHelpTip
                                      label="Surface review packet"
                                      text="A surface review packet is the evidence Guildhall has about a contract for one task: what changed, which invariants already exist, and what proof reviewers should check."
                                    />
                                  </span>
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
              </details>
            {/if}
          </div>
        </section>
      {/each}
    </section>
  {/if}
</section>

<Modal
  open={capabilityDialogOpen}
  title="Link capability to another project"
  size="md"
  onClose={() => {
    capabilityDialogOpen = false
    capabilitySearch = ''
    capabilityListOpen = false
    selectedCapabilityId = ''
    selectedProviderProjectId = ''
  }}
>
  <div class="assignment-picker">
    <p>This is for the rare case where another registered Guildhall project owns a durable capability or contract. Most local areas should stay in this project.</p>
    <div class="capability-picker" bind:this={capabilityPickerElement}>
      <Field label="Capability">
        <div class="capability-combobox-control" bind:this={capabilityControlElement}>
          <Input
            type="search"
            ariaLabel="Capability"
            placeholder="Search capability or folder"
            autocomplete="off"
            value={capabilitySearch}
            oninput={handleCapabilitySearch}
            onkeydown={(event) => {
              if (event.key === 'ArrowDown') {
                openCapabilityList()
              }
              if (event.key === 'Escape') {
                closeCapabilityList()
              }
            }}
          />
          <button
            type="button"
            class="capability-combobox-toggle"
            aria-label={capabilityListOpen ? 'Hide capabilities' : 'Show capabilities'}
            aria-controls="capability-dropdown-panel"
            aria-expanded={capabilityListOpen}
            onclick={toggleCapabilityList}
          >
            <span class:open={capabilityListOpen}>
              <Icon name="chevron-down" size={16} />
            </span>
          </button>
        </div>
      </Field>
      {#if capabilityListOpen}
        <div
          bind:this={capabilityDropdownElement}
          use:portal
          id="capability-dropdown-panel"
          class="capability-dropdown-panel"
          aria-label="Matching capabilities"
          style={capabilityDropdownStyle}
        >
          {#if capabilitySearchHelp()}
            <p class="capability-dropdown-note">{capabilitySearchHelp()}</p>
          {/if}
          {#if filteredCapabilities.length > 0}
            <div class="capability-result-list">
              {#each filteredCapabilities as capability (capability.id)}
                <button
                  type="button"
                  class:selected={selectedCapabilityId === capability.id}
                  class="capability-result"
                  aria-pressed={selectedCapabilityId === capability.id}
                  onclick={() => { chooseCapability(capability) }}
                >
                  <strong>{capabilityOptionLabel(capability)}</strong>
                  <span>{capabilityCurrentOwner(capability)}</span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="capability-dropdown-note">No matching capabilities.</p>
          {/if}
        </div>
      {/if}
    </div>
    {#if selectedCapability}
      <section class="capability-preview" aria-label="Selected assignment">
        <strong>{capabilityOptionLabel(selectedCapability)}</strong>
        <DefinitionList
          size="sm"
          items={[
            ['Meaning', selectedCapability.description],
            ['Current owner', capabilityCurrentOwner(selectedCapability)],
          ]}
        />
      </section>
    {/if}
    <Field label="Provider project">
      <Select
        ariaLabel="Provider project"
        value={selectedProviderProjectId}
        options={providerOptions}
        disabled={!selectedCapability}
        onchange={(value) => { selectedProviderProjectId = value }}
      />
    </Field>
  </div>
  {#snippet footer()}
    <Button
      variant="ghost"
      onclick={() => {
        capabilityDialogOpen = false
        capabilitySearch = ''
        capabilityListOpen = false
        selectedCapabilityId = ''
        selectedProviderProjectId = ''
      }}
    >
      Cancel
    </Button>
    <Button
      variant="primary"
      disabled={!selectedCapability || !selectedProviderProjectId || store.busy === `assign-responsibility:${selectedCapabilityId}`}
      onclick={() => { void assignCapability() }}
    >
      Assign
    </Button>
  {/snippet}
</Modal>

<FrameCard class="structure-section handoffs-section">
  {#snippet header()}
    <SectionHeader
      title="Project handoffs"
      description="Provider or consumer work crossing a project boundary."
      headingTag="h3"
      density="dense"
      metaPlacement="inline"
    >
      {#snippet meta()}
        <StructureHelpTip
          label="Project handoffs"
          text="A project handoff is work that crosses a Guildhall project boundary. It appears here only when this project is waiting on another project, or another project is waiting on this one."
        />
      {/snippet}
    </SectionHeader>
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
  .metadata {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  .project-map-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-3);
    margin-block: var(--gh-space-2) var(--gh-space-3);
  }

  .project-map-summary span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }

  .project-map-summary span + span::before {
    content: '/';
    color: var(--gh-color-text-disabled);
    margin-inline-end: var(--gh-space-3);
  }

  :global(.structure-section) {
    margin-block-end: var(--gh-space-3);
  }

  .project-map-section {
    display: grid;
    gap: var(--gh-space-3);
    padding-block: var(--gh-space-1) var(--gh-space-3);
    border-block-end: 1px solid var(--border-muted);
  }

  .project-map-list,
  .graph-request-list,
  .assignment-picker {
    display: grid;
    gap: var(--gh-space-3);
  }

  .project-map-list {
    gap: 0;
    border-block-start: 1px solid var(--border-muted);
  }

  .project-map-list-head {
    display: grid;
    grid-template-columns: minmax(10rem, 0.35fr) minmax(0, 0.65fr);
    gap: var(--gh-space-4);
    padding: var(--gh-space-2) var(--gh-space-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }

  .project-map-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    margin-block-end: var(--gh-space-2);
  }

  .project-map-contract-head {
    align-items: center;
    display: inline-flex;
    gap: var(--gh-space-1);
  }

  .capability-combobox-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--control-h);
    gap: var(--gh-space-1);
  }

  .capability-combobox-toggle {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--r-1);
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    justify-content: center;
    min-height: var(--control-h);
    padding: 0;
  }

  .capability-combobox-toggle:hover,
  .capability-combobox-toggle:focus-visible,
  .capability-combobox-toggle[aria-expanded="true"] {
    color: var(--text);
    background: color-mix(in srgb, var(--bg-raised-2) 58%, transparent);
  }

  .capability-combobox-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .capability-combobox-toggle span {
    display: inline-flex;
    transition: transform 140ms ease;
  }

  .capability-combobox-toggle span.open {
    transform: rotate(180deg);
  }

  .capability-dropdown-panel {
    position: fixed;
    z-index: calc(var(--z-modal) + 5);
    box-sizing: border-box;
    background:
      linear-gradient(180deg, color-mix(in srgb, white 6%, transparent), color-mix(in srgb, white 1.5%, transparent)),
      color-mix(in srgb, var(--bg-raised) 94%, black 6%);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-2);
    box-shadow:
      0 16px 34px color-mix(in srgb, black 34%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
    max-height: var(--capability-dropdown-max-height, min(18rem, 42vh));
    overflow: auto;
    padding: var(--gh-space-1);
  }

  .capability-dropdown-note {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    margin: 0;
    padding: var(--gh-space-2);
  }

  .capability-result-list {
    display: grid;
    gap: var(--gh-space-1);
  }

  .capability-result {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    display: grid;
    gap: var(--gh-space-1);
    font: inherit;
    padding: var(--gh-space-2);
    border-radius: var(--r-1);
    text-align: left;
  }

  .capability-result:hover,
  .capability-result:focus-visible,
  .capability-result.selected {
    color: var(--text);
    background: var(--bg-raised-2);
  }

  .capability-result.selected {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .capability-result:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .capability-result span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }

  .capability-preview {
    border-block-start: 1px solid var(--border-muted);
    display: grid;
    gap: var(--gh-space-2);
    padding-block-start: var(--gh-space-3);
  }

  .work-area-row {
    background: transparent;
    border-block-start: 1px solid var(--border-muted);
    color: inherit;
    display: grid;
    gap: var(--gh-space-4);
    grid-template-columns: minmax(10rem, 0.35fr) minmax(0, 0.65fr);
    padding: var(--gh-space-3) var(--gh-space-2);
    text-align: left;
  }

  .work-area-name,
  .work-area-detail,
  .empty-graph-state {
    display: grid;
    gap: var(--gh-space-2);
    align-content: start;
  }

  .area-contract-list {
    display: grid;
    gap: var(--gh-space-2);
  }

  .area-contract-disclosure {
    display: grid;
    gap: var(--gh-space-2);
  }

  .area-contract-disclosure > summary {
    width: fit-content;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--gh-type-size-meta);
  }

  .area-contract-disclosure > summary:hover {
    color: var(--text);
  }

  .area-contract-row {
    display: grid;
    gap: var(--gh-space-2);
    padding-block-start: var(--gh-space-2);
    border-block-start: 1px solid color-mix(in srgb, var(--border-muted) 72%, transparent);
  }

  .area-contract-row:first-child {
    padding-block-start: 0;
    border-block-start: 0;
  }

  .area-contract-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--gh-space-3);
  }

  .contract-facts {
    color: var(--text-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: var(--gh-type-size-meta);
    gap: var(--gh-space-2) var(--gh-space-3);
    line-height: var(--gh-type-line-height-body);
    margin: var(--gh-space-1) 0 0;
  }

  .contract-facts span + span::before {
    content: '/';
    color: var(--gh-color-text-disabled);
    margin-inline-end: var(--gh-space-3);
  }

  .empty-graph-state p,
  .assignment-picker p,
  .graph-request-head p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
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

  .inline-heading {
    display: inline-flex;
    align-items: center;
    gap: var(--gh-space-1);
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

  @media (max-width: 760px) {
    .project-map-list-head,
    .work-area-row {
      grid-template-columns: 1fr;
      gap: var(--gh-space-2);
    }
  }
</style>
