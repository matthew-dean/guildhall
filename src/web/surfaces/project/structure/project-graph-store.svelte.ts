import { project } from '../../../lib/project.svelte.js'
import type { projectFetch as projectFetchImpl } from '../../../lib/project-routes.js'

type ProjectFetch = typeof projectFetchImpl

export interface ProjectGraphView {
  currentProject?: { id?: string; label?: string; path?: string }
  localProjects?: Array<{ id: string; label: string; path?: string; role?: string }>
  localProjectIndex?: Array<{ id: string; label: string; path?: string; role?: 'current' | 'indexed' | string }>
  domainAuthorities?: Array<{
    domain?: { id?: string; label?: string }
    providerProject?: { id?: string; label?: string; path?: string }
    assignedAt?: string
    assignedBy?: string
  }>
  domainResponsibilities?: ProjectGraphResponsibility[]
  structuralDomains?: Array<{
    id?: string
    label?: string
    path?: string
    kind?: 'structural_domain' | 'cross_cutting_domain' | 'coordinator_domain' | string
    coordinatorId?: string
    coordinatorName?: string
    authorityProjectId?: string
    authorityProjectLabel?: string
  }>
  dependencyEdges?: ProjectGraphEdge[]
  unresolvedRequests?: Array<{ edgeId?: string; waitingOn?: string; state?: string; summary?: string }>
  contractSurfaces?: ProjectGraphContractSurface[]
}

export interface ProjectGraphContractSurface {
  id: string
  nodeId: string
  label: string
  kind: string
  authority: string
  scope: string
  state: string
  owningProjectId: string
  owningProjectLabel: string
  domainId?: string
  domainLabel?: string
  consumerCount: number
  invariantCount: number
  decisionCount: number
  updatedAt: string
  scopedReason: 'owner' | 'consumer' | 'domain' | string
  reviewPackets?: ProjectGraphSurfaceReviewPacket[]
}

export interface ProjectGraphSurfaceReviewPacket {
  id: string
  surfaceId: string
  currentSpecRef: string
  knownConsumers?: string[]
  existingInvariants?: Array<{
    id: string
    label: string
    rule: string
  }>
  existingDecisions?: Array<{
    id: string
    summary: string
    decidedAt: string
  }>
  siblingSpecRefs?: string[]
  driftFindings?: string[]
  currentDeltaSummary: string
  proofObligations?: string[]
  reviewFocus?: string[]
}

export interface ProjectGraphResponsibility {
  id: string
  domainId: string
  domainLabel: string
  facet: 'provider_capability' | 'shared_contract' | 'consumer_configuration' | 'consumer_verification' | string
  facetLabel: string
  description: string
  authority: 'provider' | 'shared' | 'consumer' | string
  responsibleProjectId: string
  responsibleProjectLabel: string
  responsibleProjectPath?: string
  assignable?: boolean
  assigned?: boolean
}

export interface ProjectGraphEdge {
  id: string
  state: string
  consumerProjectId?: string
  consumerProjectLabel?: string
  providerProjectId?: string
  providerProjectLabel?: string
  domainId?: string
  domainLabel?: string
  consumerNeed?: string
  expectedDelivery?: { format?: string; channel?: string; consumerVerificationPlan?: string[] }
  latestDeliveryReceipt?: { id?: string; format?: string; channel?: string; coordinates?: string; providerProof?: string[] }
  latestReturnPacket?: { requestedCorrection?: string; mismatchKind?: string }
  unresolved?: boolean
  updatedAt?: string
}

export function createProjectGraphStore(projectFetch: ProjectFetch) {
  let projectGraph = $state<ProjectGraphView | null>(null)
  let error = $state<string | null>(null)
  let busy = $state<string | null>(null)
  let selectedDomainId = $state<string | null>(null)
  let assignmentPickerResponsibilityId = $state<string | null>(null)
  let assignmentPickerQuery = $state('')
  let domainAuthoritySelections = $state<Record<string, string>>({})

  async function load(): Promise<void> {
    try {
      const r = await projectFetch('/api/project/project-graph', { cache: 'no-store' })
      const j = await r.json().catch(() => ({})) as { projectGraph?: ProjectGraphView; error?: string }
      if (!r.ok || j.error) {
        error = j.error ?? `HTTP ${r.status}`
        return
      }
      projectGraph = j.projectGraph ?? null
      error = null
      const nextSelections = { ...domainAuthoritySelections }
      for (const authority of projectGraph?.domainAuthorities ?? []) {
        const domainId = authority.domain?.id
        const providerId = authority.providerProject?.id
        if (domainId && providerId) nextSelections[domainId] = providerId
      }
      domainAuthoritySelections = nextSelections
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function structuralDomains() {
    const seen = new Set<string>()
    const nodes = (projectGraph?.structuralDomains?.length ?? 0) > 0
      ? projectGraph?.structuralDomains ?? []
      : [
          ...(project.detail?.structuralMapReview?.domains ?? []),
          ...(project.detail?.structuralMapReview?.crossCuttingDomains ?? []),
        ]
    return nodes.filter((node) => {
      if (!node.id || seen.has(node.id)) return false
      seen.add(node.id)
      return true
    })
  }

  function graphProjectOptions() {
    return (projectGraph?.localProjects ?? [])
      .filter(item => item.id && item.path)
      .map(item => ({
        value: item.id,
        label: `${item.label}${item.role === 'current' ? ' (this project)' : ''}`,
      }))
  }

  function domainAuthorityFor(domainId?: string) {
    if (!domainId) return null
    return projectGraph?.domainAuthorities?.find(item => item.domain?.id === domainId) ?? null
  }

  function domainSourceLabel(domain: { kind?: string; coordinatorName?: string; coordinatorId?: string }): string {
    if (domain.kind === 'cross_cutting_domain') return 'Detected cross-cutting domain'
    if (domain.coordinatorName || domain.coordinatorId) return `Detected here - routed by ${domain.coordinatorName ?? domain.coordinatorId}`
    return 'Detected in this project'
  }

  function domainResponsibilityLabel(domain: { id?: string }): string {
    const authority = domainAuthorityFor(domain.id)
    if (!authority?.providerProject?.id) return 'No external assignment'
    if (authority.providerProject.id === project.detail?.id) return 'Handled by this project'
    return `Handled by ${authority.providerProject.label ?? authority.providerProject.id}`
  }

  function responsibilitiesForDomain(domainId?: string) {
    if (!domainId) return []
    return (projectGraph?.domainResponsibilities ?? []).filter(item => item.domainId === domainId)
  }

  function selectedDomain() {
    if (!selectedDomainId) return null
    return structuralDomains().find(item => item.id === selectedDomainId) ?? null
  }

  function primaryAssignableResponsibility(domainId?: string) {
    const assignable = responsibilitiesForDomain(domainId).filter(item => item.assignable)
    return assignable.find(item => item.facet === 'provider_capability') ?? assignable[0] ?? null
  }

  function localResponsibilitiesForDomain(domainId?: string) {
    return responsibilitiesForDomain(domainId).filter(item => !item.assignable)
  }

  function domainGraphSummary(domain: { id?: string }): string {
    const responsibility = primaryAssignableResponsibility(domain.id)
    if (!responsibility) return domainResponsibilityLabel(domain)
    if (responsibility.assigned && responsibility.responsibleProjectId !== project.detail?.id) {
      return `Assigned to ${responsibility.responsibleProjectLabel}`
    }
    return 'Available to assign'
  }

  function graphAssignmentTargets(responsibility: ProjectGraphResponsibility) {
    return (projectGraph?.localProjectIndex ?? projectGraph?.localProjects ?? [])
      .filter(item => item.id && item.path && item.id !== responsibility.responsibleProjectId)
      .map(item => ({
        id: item.id,
        label: item.id === project.detail?.id ? 'this project' : item.label,
      }))
  }

  function assignmentPickerResponsibility() {
    if (!assignmentPickerResponsibilityId) return null
    return (projectGraph?.domainResponsibilities ?? []).find(item => item.id === assignmentPickerResponsibilityId) ?? null
  }

  function openAssignmentPicker(responsibility: ProjectGraphResponsibility): void {
    assignmentPickerResponsibilityId = responsibility.id
    assignmentPickerQuery = ''
  }

  function closeAssignmentPicker(): void {
    assignmentPickerResponsibilityId = null
    assignmentPickerQuery = ''
  }

  function setAssignmentPickerQuery(value: string): void {
    assignmentPickerQuery = value
  }

  function assignmentPickerTargets() {
    const responsibility = assignmentPickerResponsibility()
    if (!responsibility) return []
    if (assignmentPickerQuery.trim().length === 0) return []
    const query = assignmentPickerQuery.trim().toLowerCase()
    return graphAssignmentTargets(responsibility)
      .filter(target => !query || target.label.toLowerCase().includes(query) || target.id.toLowerCase().includes(query))
      .slice(0, 8)
  }

  async function chooseAssignmentTarget(projectId: string): Promise<void> {
    const responsibility = assignmentPickerResponsibility()
    if (!responsibility) return
    await assignDomainResponsibilityTo(responsibility, projectId)
    closeAssignmentPicker()
  }

  async function assignDomainResponsibilityTo(responsibility: ProjectGraphResponsibility, responsibleProjectId: string): Promise<void> {
    if (!responsibleProjectId) return
    busy = `assign-responsibility:${responsibility.id}`
    try {
      const r = await projectFetch('/api/project/project-graph/domain-responsibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domainId: responsibility.domainId,
          domainLabel: responsibility.domainLabel,
          facet: responsibility.facet,
          responsibleProjectId,
        }),
      })
      const j = await r.json().catch(() => ({})) as { projectGraph?: ProjectGraphView; error?: string }
      if (!r.ok || j.error) {
        error = j.error ?? `HTTP ${r.status}`
        return
      }
      projectGraph = j.projectGraph ?? projectGraph
      error = null
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = null
    }
  }

  async function runRequestAction(edgeId: string, action: string): Promise<void> {
    busy = `${action}:${edgeId}`
    try {
      const r = await projectFetch(`/api/project/project-graph/requests/${encodeURIComponent(edgeId)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(defaultGraphActionPayload(action)),
      })
      const j = await r.json().catch(() => ({})) as { projectGraph?: ProjectGraphView; error?: string }
      if (!r.ok || j.error) {
        error = j.error ?? `HTTP ${r.status}`
        return
      }
      projectGraph = j.projectGraph ?? projectGraph
      error = null
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = null
    }
  }

  function defaultGraphActionPayload(action: string): Record<string, unknown> {
    switch (action) {
      case 'provider-plan':
        return {
          format: 'Project graph delivery',
          channel: 'local project graph',
          providerProofPlan: ['Run provider-owned checks before delivery.'],
          consumerVerificationPlan: ['Verify the delivered result in the consumer project.'],
        }
      case 'provider-deliver':
        return {
          format: 'Project graph delivery',
          channel: 'local project graph',
          coordinates: 'local project graph receipt',
          providerProof: ['Provider recorded delivery through its own project context.'],
        }
      case 'consumer-review':
        return { verificationContext: 'Consumer is verifying the delivery against the negotiated format.' }
      case 'consumer-return':
        return {
          mismatchKind: 'format',
          expected: 'Delivery should match the negotiated format.',
          received: 'Consumer could not use the delivered format.',
          failedVerification: ['Consumer verification failed.'],
          requestedCorrection: 'Redeliver in the negotiated format.',
        }
      case 'consumer-accept':
        return { consumerProof: ['Consumer verified the delivery.'] }
      default:
        return {}
    }
  }

  function requestActionsForEdge(edge: ProjectGraphEdge) {
    const currentId = project.detail?.id
    const provider = edge.providerProjectId === currentId
    const consumer = edge.consumerProjectId === currentId
    if (provider) {
      if (edge.state === 'submitted') return ['provider-accept']
      if (edge.state === 'provider_shaping' || edge.state === 'revision_requested') return ['provider-plan']
      if (edge.state === 'provider_working') return ['provider-deliver']
    }
    if (consumer) {
      if (edge.state === 'delivered') return ['consumer-review']
      if (edge.state === 'consumer_reviewing') return ['consumer-return', 'consumer-accept']
    }
    return []
  }

  function requestActionLabel(action: string): string {
    switch (action) {
      case 'provider-accept': return 'Accept request'
      case 'provider-plan': return 'Commit plan'
      case 'provider-deliver': return 'Record delivery'
      case 'consumer-review': return 'Start review'
      case 'consumer-return': return 'Return for revision'
      case 'consumer-accept': return 'Accept delivery'
      default: return action
    }
  }

  function edgeRole(edge: ProjectGraphEdge): 'inbound' | 'outgoing' | 'related' {
    if (edge.providerProjectId === project.detail?.id) return 'inbound'
    if (edge.consumerProjectId === project.detail?.id) return 'outgoing'
    return 'related'
  }

  function connectedProjectRows() {
    return (projectGraph?.localProjects ?? []).filter(item => item.role === 'consumer' || item.role === 'provider')
  }

  function localProjectIndexLabel(): string {
    const count = (projectGraph?.localProjectIndex ?? projectGraph?.localProjects ?? []).length
    return `${count} ${count === 1 ? 'project' : 'projects'} in the local index`
  }

  function requestWaitingOn(edge: ProjectGraphEdge): string {
    if (!edge.unresolved) return 'Resolved'
    if (edge.state === 'delivered' || edge.state === 'consumer_reviewing') return 'Waiting on consumer'
    return 'Waiting on provider'
  }

  function requestRoleLabel(edge: ProjectGraphEdge): string {
    const role = edgeRole(edge)
    if (role === 'inbound') return 'This project is provider'
    if (role === 'outgoing') return 'This project is consumer'
    return 'Related request'
  }

  return {
    get projectGraph() { return projectGraph },
    get error() { return error },
    get busy() { return busy },
    get selectedDomainId() { return selectedDomainId },
    setSelectedDomainId(value: string | null) { selectedDomainId = value },
    get assignmentPickerQuery() { return assignmentPickerQuery },
    load,
    graphProjectOptions,
    structuralDomains,
    domainSourceLabel,
    domainGraphSummary,
    selectedDomain,
    primaryAssignableResponsibility,
    localResponsibilitiesForDomain,
    graphAssignmentTargets,
    assignmentPickerResponsibility,
    openAssignmentPicker,
    closeAssignmentPicker,
    setAssignmentPickerQuery,
    assignmentPickerTargets,
    chooseAssignmentTarget,
    runRequestAction,
    requestActionsForEdge,
    requestActionLabel,
    edgeRole,
    connectedProjectRows,
    localProjectIndexLabel,
    requestWaitingOn,
    requestRoleLabel,
  }
}

export type ProjectGraphStore = ReturnType<typeof createProjectGraphStore>
