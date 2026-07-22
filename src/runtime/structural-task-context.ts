import {
  buildStructuralContextSlice,
  routeTaskWithStructuralMap,
  type StructuralMapDraft,
  type StructuralMapNode,
} from './structural-map.js'

export interface StructuralTaskContextTask {
  id: string
  title?: string
  files?: string[]
  text?: string
  domainId?: string
  crossCuttingDomainIds?: string[]
}

export interface StructuralTaskContextRef {
  id: string
  label: string
  path?: string
}

export interface StructuralTaskContextCheck extends StructuralTaskContextRef {
  command?: string
}

export interface StructuralTaskContext {
  taskId: string
  status: 'matched' | 'unmatched' | 'unavailable'
  summary: string
  likelyArea?: StructuralTaskContextRef
  primaryDomain?: StructuralTaskContextRef
  crossCuttingDomains: StructuralTaskContextRef[]
  checks: StructuralTaskContextCheck[]
  reasons: string[]
  omittedCount: number
}

export function unavailableStructuralTaskContext(taskId: string): StructuralTaskContext {
  return {
    taskId,
    status: 'unavailable',
    summary: 'Guildhall has not accepted a project structure map yet.',
    crossCuttingDomains: [],
    checks: [],
    reasons: ['No accepted structure map is available for task routing.'],
    omittedCount: 0,
  }
}

export function summarizeStructuralTaskContext(input: {
  map: StructuralMapDraft | null
  task: StructuralTaskContextTask
}): StructuralTaskContext {
  if (isProjectSetupTask(input.task.id)) {
    return {
      taskId: input.task.id,
      status: 'unavailable',
      summary: 'Project setup tasks do not use structural routing context.',
      crossCuttingDomains: [],
      checks: [],
      reasons: ['Setup tasks shape the project map instead of being routed through it.'],
      omittedCount: 0,
    }
  }
  if (!input.map) return unavailableStructuralTaskContext(input.task.id)

  const nodeById = new Map(input.map.nodes.map(node => [node.id, node]))
  const slice = buildStructuralContextSlice(input.map, {
    id: input.task.id,
    title: input.task.title ?? input.task.id,
    files: input.task.files,
    text: input.task.text,
    domainId: input.task.domainId,
    crossCuttingDomainIds: input.task.crossCuttingDomainIds,
  })

  let route = null as ReturnType<typeof routeTaskWithStructuralMap> | null
  try {
    route = routeTaskWithStructuralMap({
      map: input.map,
      task: {
        id: input.task.id,
        title: input.task.title ?? input.task.id,
        files: input.task.files,
        text: input.task.text,
        domainId: input.task.domainId,
        crossCuttingDomainIds: input.task.crossCuttingDomainIds,
      },
    })
  } catch {
    route = null
  }

  const packageNode = firstNode(route?.packageIds ?? [], nodeById, node => node.kind === 'package')
  const domainNode = route?.primaryDomainId ? nodeById.get(route.primaryDomainId) : null
  const hasStructuralMatch = Boolean(packageNode || domainNode || (route?.crossCuttingDomainIds.length ?? 0) > 0)
  const checkNodes = packageNode ? (route?.executableUnitIds ?? [])
    .map(id => nodeById.get(id))
    .filter((node): node is StructuralMapNode => Boolean(node)) : []
  const crossCuttingDomains = (route?.crossCuttingDomainIds ?? [])
    .map(id => nodeById.get(id))
    .filter((node): node is StructuralMapNode => Boolean(node))
    .map(refForNode)

  const matched = hasStructuralMatch
  if (!matched) {
    return {
      taskId: input.task.id,
      status: 'unmatched',
      summary: 'Guildhall does not have a confident structural match for this task yet.',
      crossCuttingDomains: [],
      checks: [],
      reasons: ["No package or domain matched the task's explicit structural references."],
      omittedCount: slice.omitted.length,
    }
  }

  const likelyArea = packageNode ? refForNode(packageNode) : undefined
  const primaryDomain = domainNode ? refForNode(domainNode) : undefined
  const checks = checkNodes.map(checkForNode)
  const reasons = userFacingReasons({
    files: input.task.files ?? [],
    packageNode: packageNode ?? undefined,
    primaryDomain,
    crossCuttingDomains,
    checks,
  })

  return {
    taskId: input.task.id,
    status: 'matched',
    summary: matchedSummary(likelyArea, primaryDomain, checks),
    ...(likelyArea ? { likelyArea } : {}),
    ...(primaryDomain ? { primaryDomain } : {}),
    crossCuttingDomains,
    checks,
    reasons,
    omittedCount: slice.omitted.length,
  }
}

function isProjectSetupTask(taskId: string): boolean {
  return taskId === 'task-meta-intake' || taskId === 'task-workspace-import'
}

export function summarizeStructuralTaskContexts(input: {
  map: StructuralMapDraft | null
  tasks: Array<StructuralTaskContextTask & { description?: string; spec?: string; domain?: string }>
}): Record<string, StructuralTaskContext> {
  const result: Record<string, StructuralTaskContext> = {}
  for (const task of input.tasks) {
    if (!task.id) continue
    result[task.id] = summarizeStructuralTaskContext({
      map: input.map,
      task: {
        id: task.id,
        title: task.title,
        files: task.files,
        text: task.text ?? [task.description, task.spec].filter(Boolean).join('\n'),
        domainId: task.domain,
        crossCuttingDomainIds: task.crossCuttingDomainIds,
      },
    })
  }
  return result
}

function firstNode(
  ids: readonly string[],
  nodeById: Map<string, StructuralMapNode>,
  predicate: (node: StructuralMapNode) => boolean,
): StructuralMapNode | null {
  for (const id of ids) {
    const node = nodeById.get(id)
    if (node && predicate(node)) return node
  }
  return null
}

function refForNode(node: StructuralMapNode): StructuralTaskContextRef {
  return {
    id: node.id,
    label: node.label,
    ...(node.relativePath ? { path: node.relativePath } : {}),
  }
}

function checkForNode(node: StructuralMapNode): StructuralTaskContextCheck {
  return {
    ...refForNode(node),
    ...(node.command ? { command: node.command } : {}),
  }
}

function userFacingReasons(input: {
  files: readonly string[]
  packageNode?: StructuralMapNode
  primaryDomain?: StructuralTaskContextRef
  crossCuttingDomains: StructuralTaskContextRef[]
  checks: StructuralTaskContextCheck[]
}): string[] {
  const reasons: string[] = []
  if (input.packageNode?.relativePath && input.files.some(file => file.startsWith(input.packageNode?.relativePath ?? ''))) {
    reasons.push(`Matched files under ${input.packageNode.relativePath}.`)
  } else if (input.packageNode) {
    reasons.push(`Matched the ${input.packageNode.label} package.`)
  }
  if (input.primaryDomain) reasons.push(`Uses the ${input.primaryDomain.label} work area.`)
  if (input.crossCuttingDomains.length > 0) {
    reasons.push(`Also activates ${input.crossCuttingDomains.map(domain => domain.label).join(', ')}.`)
  }
  if (input.checks.length > 0) reasons.push('Includes package-relevant checks.')
  return reasons.length > 0 ? reasons : ['Matched accepted project structure.']
}

function matchedSummary(
  likelyArea: StructuralTaskContextRef | undefined,
  primaryDomain: StructuralTaskContextRef | undefined,
  checks: readonly StructuralTaskContextCheck[],
): string {
  const target = likelyArea?.label ?? primaryDomain?.label ?? 'the accepted project map'
  const checkText = checks.length > 0 ? ` and ${checks.length} likely check${checks.length === 1 ? '' : 's'}` : ''
  return `Guildhall will start with ${target}${checkText}.`
}
