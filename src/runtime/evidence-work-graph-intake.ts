export type EvidenceSource = {
  path: string
  content: string
}

export type EvidenceWorkGraphInput = {
  sources: EvidenceSource[]
  existingTasks?: Array<Record<string, unknown>>
}

export type EvidenceUnit = {
  name: string
  need: string
  targetArea: string
  producedArtifact: string
  statusHint: 'missing' | 'shipped' | 'unknown'
  buildsOn: string[]
  sharedFoundations: string[]
  consumerSurfaces: string[]
  sourceRefs: Array<{ path: string; snippet: string }>
}

export type EvidenceTask = {
  id: string
  title: string
  kind: 'implementation' | 'integration'
  deliverableName: string
  targetArea: string
  producedArtifact?: string
  buildsOn: string[]
  sharedFoundations: string[]
  dependsOn: string[]
  relatedTasks: Array<{ taskId: string; relationship: 'blocks' | 'related'; reason: string }>
  consumerSurface?: string
  acceptanceCriteria: Array<{ id: string; description: string; verifiedBy?: string }>
  proofPaths: Array<{ kind: 'command' | 'review' | 'browser'; command?: string; expectedEvidence?: string[] }>
  status?: string
  supersedesVagueIntake?: boolean
}

export type EvidenceWorkGraphPlan = {
  units: EvidenceUnit[]
  tasks: EvidenceTask[]
  reconciliations: Array<{ existingTaskId: string; action: 'reframed_existing_task'; reason: string }>
}

type UnitSeed = {
  path: string
  deliverable: string
  need: string
  foundation: string
  consumer: string
  row: string
}

type ExistingTaskMatch = {
  id: string
  status?: string
  producedArtifact?: string
  structuredEnough: boolean
}

const DONEISH_STATUSES = new Set(['done', 'review', 'gate_check'])

export function planEvidenceWorkGraph(input: EvidenceWorkGraphInput): EvidenceWorkGraphPlan {
  const units = input.sources.flatMap(source => extractUnits(source))
  const existingTasks = input.existingTasks ?? []
  const tasks: EvidenceTask[] = []
  const reconciliations: EvidenceWorkGraphPlan['reconciliations'] = []
  const implementationByDeliverable = new Map<string, EvidenceTask>()

  for (const unit of units) {
    const existingMatch = findExistingTaskForUnit(unit, existingTasks)
    const isAlreadyShipped = unit.statusHint === 'shipped' || isExistingDone(existingMatch)

    if (isAlreadyShipped && !existingMatch) {
      continue
    }

    if (isAlreadyShipped && existingMatch?.structuredEnough) {
      continue
    }

    const implementationTask = buildImplementationTask(unit, existingMatch)
    tasks.push(implementationTask)
    implementationByDeliverable.set(unit.name, implementationTask)

    if (existingMatch && !existingMatch.structuredEnough) {
      reconciliations.push({
        existingTaskId: existingMatch.id,
        action: 'reframed_existing_task',
        reason: `Reframed existing vague task around ${unit.name} into a structured implementation task with dependencies and proof.`,
      })
    }
  }

  for (const task of tasks.filter(task => task.kind === 'implementation')) {
    const unit = units.find(unit => unit.name === task.deliverableName)
    if (!unit) {
      continue
    }

    const dependencies = dependenciesFor(unit, existingTasks, implementationByDeliverable)
    task.dependsOn = dependencies.taskIds
    task.relatedTasks = dependencies.relatedTasks
  }

  for (const unit of units) {
    if (!needsIntegrationTask(unit)) {
      continue
    }

    const integrationTask = buildIntegrationTask(unit, implementationByDeliverable, existingTasks)
    tasks.push(integrationTask)
  }

  return { units, tasks, reconciliations }
}

function extractUnits(source: EvidenceSource): EvidenceUnit[] {
  return extractTableSeeds(source).map(seed => {
    const statusHint = inferStatusHint(seed.need)
    const targetArea = inferTargetArea(seed.path, seed.deliverable)
    const producedArtifact = inferProducedArtifact(seed.deliverable, seed.need)
    const buildsOn = parseFoundations(seed.foundation)
    const sharedFoundations = buildsOn.map(foundationToArtifact)

    return {
      name: seed.deliverable,
      need: seed.need,
      targetArea,
      producedArtifact,
      statusHint,
      buildsOn,
      sharedFoundations,
      consumerSurfaces: parseConsumers(seed.consumer),
      sourceRefs: [{ path: seed.path, snippet: seed.row }],
    }
  })
}

function extractTableSeeds(source: EvidenceSource): UnitSeed[] {
  const lines = source.content.split(/\r?\n/)
  const seeds: UnitSeed[] = []
  let inDeliverableTable = false

  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      inDeliverableTable = false
      continue
    }

    const cells = line.split('|').slice(1, -1).map(cell => stripInlineCode(cell.trim()))
    const [deliverable, need, foundation, consumer] = cells

    if (!deliverable || !need || !foundation || !consumer) {
      continue
    }

    if (/^deliverable$/i.test(deliverable) && /^need$/i.test(need)) {
      inDeliverableTable = true
      continue
    }

    if (!inDeliverableTable || /^-+$/.test(deliverable)) {
      continue
    }

    seeds.push({
      path: source.path,
      deliverable,
      need,
      foundation,
      consumer,
      row: line.trim(),
    })
  }

  return seeds
}

function buildImplementationTask(unit: EvidenceUnit, existingMatch?: ExistingTaskMatch): EvidenceTask {
  const id = existingMatch?.id ?? `task-${slugify(unit.name)}`
  const supersedesVagueIntake = existingMatch ? !existingMatch.structuredEnough : undefined

  return {
    id,
    title: `Build ${unit.name}`,
    kind: 'implementation',
    deliverableName: unit.name,
    targetArea: unit.targetArea,
    producedArtifact: unit.producedArtifact,
    buildsOn: unit.buildsOn,
    sharedFoundations: unit.sharedFoundations,
    dependsOn: [],
    relatedTasks: [],
    acceptanceCriteria: implementationAcceptanceCriteria(unit),
    proofPaths: implementationProofPaths(unit),
    status: supersedesVagueIntake ? 'spec_review' : undefined,
    supersedesVagueIntake,
  }
}

function buildIntegrationTask(
  unit: EvidenceUnit,
  implementationByDeliverable: Map<string, EvidenceTask>,
  existingTasks: Array<Record<string, unknown>>,
): EvidenceTask {
  const consumerSurface = primaryConsumerSurface(unit)
  const implementationTask = implementationByDeliverable.get(unit.name)
  const dependsOn = new Set<string>()

  if (implementationTask) {
    dependsOn.add(implementationTask.id)
  }

  for (const foundation of unit.buildsOn) {
    const implementationDependency = implementationByDeliverable.get(normalizeDeliverableName(foundation))
    if (implementationDependency) {
      dependsOn.add(implementationDependency.id)
      continue
    }

    const existingDependency = findExistingTaskByDeliverable(foundation, existingTasks)
    if (existingDependency && !isExistingDone(existingDependency)) {
      dependsOn.add(existingDependency.id)
    }
  }

  return {
    id: `task-${slugify(unit.name)}-integration`,
    title: integrationTitle(unit, consumerSurface),
    kind: 'integration',
    deliverableName: unit.name,
    targetArea: integrationTargetArea(unit, consumerSurface),
    buildsOn: unit.buildsOn,
    sharedFoundations: unit.sharedFoundations,
    dependsOn: Array.from(dependsOn),
    relatedTasks: [],
    consumerSurface,
    acceptanceCriteria: integrationAcceptanceCriteria(),
    proofPaths: integrationProofPaths(unit),
  }
}

function dependenciesFor(
  unit: EvidenceUnit,
  existingTasks: Array<Record<string, unknown>>,
  implementationByDeliverable: Map<string, EvidenceTask>,
): Pick<EvidenceTask, 'dependsOn' | 'relatedTasks'> & { taskIds: string[] } {
  const taskIds: string[] = []
  const relatedTasks: EvidenceTask['relatedTasks'] = []

  for (const foundation of unit.buildsOn) {
    const normalizedFoundation = normalizeDeliverableName(foundation)
    const plannedTask = implementationByDeliverable.get(normalizedFoundation)
    if (plannedTask && plannedTask.deliverableName !== unit.name) {
      taskIds.push(plannedTask.id)
      relatedTasks.push({
        taskId: plannedTask.id,
        relationship: 'blocks',
        reason: `${unit.name} builds on ${foundation}.`,
      })
      continue
    }

    const existingTask = findExistingTaskByDeliverable(foundation, existingTasks)
    if (existingTask && !isExistingDone(existingTask)) {
      taskIds.push(existingTask.id)
      relatedTasks.push({
        taskId: existingTask.id,
        relationship: 'blocks',
        reason: `${unit.name} builds on ${foundation}.`,
      })
    }
  }

  return { taskIds: unique(taskIds), dependsOn: unique(taskIds), relatedTasks }
}

function implementationAcceptanceCriteria(unit: EvidenceUnit): EvidenceTask['acceptanceCriteria'] {
  return [
    { id: 'source-implementation', description: `${unit.name} is implemented in ${unit.targetArea}.` },
    { id: 'public-contract', description: `${unit.name} exposes the expected public contract.` },
    {
      id: 'foundation-reuse',
      description: unit.buildsOn.length > 0
        ? `${unit.name} reuses ${unit.buildsOn.join(', ')} or documents a deliberate deviation.`
        : `${unit.name} uses the established foundation for its target area.`,
    },
    { id: 'design-system-conformance', description: `${unit.name} follows target-area conventions.` },
    { id: 'accessibility-contract', description: `${unit.name} meets relevant accessibility, security, or reliability requirements.` },
    { id: 'automated-proof', description: `${unit.name} has deterministic test or review proof.` },
  ]
}

function integrationAcceptanceCriteria(): EvidenceTask['acceptanceCriteria'] {
  return [
    { id: 'public-consumer-import', description: 'The consuming surface uses the public deliverable contract.' },
    { id: 'consumer-flow-renders', description: 'The real consumer flow renders or executes successfully.' },
    { id: 'runtime-proof', description: 'Runtime proof exists for the consuming flow.' },
    { id: 'look-and-feel-proof', description: 'The integration fits the consuming surface conventions.' },
    { id: 'integration-regression-test', description: 'A regression test covers the integration.' },
  ]
}

function implementationProofPaths(unit: EvidenceUnit): EvidenceTask['proofPaths'] {
  const packageName = unit.targetArea === 'looma' ? '@looma/core' : unit.targetArea

  return [
    { kind: 'command', command: `pnpm --filter ${packageName} test` },
    {
      kind: 'review',
      expectedEvidence: [
        `${unit.name} reuses ${unit.sharedFoundations.join(', ') || 'named foundations'}.`,
        `tokens or target-area conventions are respected for ${unit.name}.`,
      ],
    },
  ]
}

function integrationProofPaths(unit: EvidenceUnit): EvidenceTask['proofPaths'] {
  const consumerSurface = primaryConsumerSurface(unit)
  const isKnit = unit.consumerSurfaces.some(surface => /knit/i.test(surface))

  return [
    {
      kind: 'browser',
      expectedEvidence: [
        `${unit.name} is visible or executable in ${consumerSurface}.`,
        isKnit ? 'dialog is visible in the Knit flow.' : `${consumerSurface} works in the live consumer flow.`,
      ],
    },
    {
      kind: 'review',
      expectedEvidence: [
        isKnit ? 'Knit tokens and interaction conventions are respected.' : `${consumerSurface} conventions are respected.`,
      ],
    },
  ]
}

function inferStatusHint(need: string): EvidenceUnit['statusHint'] {
  if (/\b(shipped|complete|done|already)\b/i.test(need)) {
    return 'shipped'
  }
  if (/\b(missing|gap|add|allow|expose|needs?|build|replace)\b/i.test(need)) {
    return 'missing'
  }
  return 'unknown'
}

function inferTargetArea(path: string, deliverable: string): string {
  const firstPathSegment = path.split('/').find(Boolean)
  if (firstPathSegment && !['docs', 'internal'].includes(firstPathSegment)) {
    return firstPathSegment
  }
  if (/dashboard integration/i.test(deliverable)) {
    return 'Admin settings page'
  }
  return firstPathSegment ?? 'project'
}

function inferProducedArtifact(deliverable: string, need: string): string {
  const shippedArtifact = need.match(/`([^`]+)`/)
  if (shippedArtifact?.[1]) {
    return shippedArtifact[1]
  }
  if (/^[A-Z][A-Za-z]+$/.test(deliverable)) {
    return `ui-${splitCamelCase(deliverable).toLowerCase().replaceAll(' ', '-')}`
  }
  return slugify(deliverable)
}

function parseFoundations(value: string): string[] {
  const withoutPrefix = value.replace(/^builds on\s+/i, '')
  return unique(withoutPrefix
    .split(/\s+\+\s+|\s+and\s+|,\s*/)
    .map(part => part.replace(/\s+status$/i, '').trim())
    .filter(Boolean)
    .map(normalizeDeliverableName))
}

function parseConsumers(value: string): string[] {
  return unique(value
    .split(/\s+and\s+|,\s*/)
    .map(part => part.trim())
    .filter(Boolean))
}

function primaryConsumerSurface(unit: EvidenceUnit): string {
  const consumer = unit.consumerSurfaces[0] ?? unit.targetArea

  if (/Knit destructive confirmation flow/i.test(consumer)) {
    return 'destructive confirmation flow'
  }
  if (/Knit mobile navigation drawer/i.test(consumer)) {
    return 'mobile navigation drawer'
  }
  if (/Admin settings page/i.test(consumer)) {
    return 'Compliance dashboard'
  }

  return consumer
}

function needsIntegrationTask(unit: EvidenceUnit): boolean {
  return unit.consumerSurfaces.some(surface => /Knit|dashboard|settings page|consumer|admin/i.test(surface))
    && unit.statusHint !== 'shipped'
}

function integrationTitle(unit: EvidenceUnit, consumerSurface: string): string {
  if (unit.consumerSurfaces.some(surface => /Knit/i.test(surface))) {
    return `Integrate ${unit.name} into Knit ${consumerSurface}`
  }
  return `Integrate ${unit.name} into ${consumerSurface}`
}

function integrationTargetArea(unit: EvidenceUnit, consumerSurface: string): string {
  if (unit.consumerSurfaces.some(surface => /Knit/i.test(surface))) {
    return 'knit'
  }
  if (/Compliance dashboard/i.test(consumerSurface)) {
    return 'Admin settings page'
  }
  return consumerSurface
}

function findExistingTaskForUnit(unit: EvidenceUnit, existingTasks: Array<Record<string, unknown>>): ExistingTaskMatch | undefined {
  return findExistingTaskByDeliverable(unit.name, existingTasks)
}

function findExistingTaskByDeliverable(deliverable: string, existingTasks: Array<Record<string, unknown>>): ExistingTaskMatch | undefined {
  const normalized = normalizeForMatch(deliverable)
  const deliverablePattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(deliverable.toLowerCase())}([^a-z0-9]|$)`, 'i')
  for (const task of existingTasks) {
    const id = typeof task.id === 'string' ? task.id : undefined
    if (!id) {
      continue
    }

    const exactFields = [
      task.deliverableName,
      task.producedArtifact,
    ].filter((value): value is string => typeof value === 'string')

    const textFields = [
      task.title,
      task.description,
    ].filter((value): value is string => typeof value === 'string')

    const matches = exactFields.some(value => normalizeForMatch(value) === normalized)
      || textFields.some(value => deliverablePattern.test(value.toLowerCase()))
    if (!matches) {
      continue
    }

    const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []
    const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : []

    return {
      id,
      status: typeof task.status === 'string' ? task.status : undefined,
      producedArtifact: typeof task.producedArtifact === 'string' ? task.producedArtifact : undefined,
      structuredEnough: acceptanceCriteria.length > 0 || dependsOn.length > 0,
    }
  }

  return undefined
}

function isExistingDone(task: ExistingTaskMatch | undefined): boolean {
  return task?.status ? DONEISH_STATUSES.has(task.status) : false
}

function normalizeDeliverableName(value: string): string {
  const trimmed = value.trim()
  if (/^retention policy schema$/i.test(trimmed)) {
    return 'Retention policy schema'
  }
  if (/^retention worker$/i.test(trimmed)) {
    return 'Retention worker'
  }
  if (/^audit export api$/i.test(trimmed)) {
    return 'Audit export API'
  }
  if (/^alertdialog$/i.test(trimmed)) {
    return 'AlertDialog'
  }
  if (/^dialog$/i.test(trimmed)) {
    return 'Dialog'
  }
  if (/^drawer$/i.test(trimmed)) {
    return 'Drawer'
  }
  if (/^button$/i.test(trimmed)) {
    return 'Button'
  }
  return trimmed
}

function foundationToArtifact(foundation: string): string {
  if (/^[A-Z][A-Za-z]+$/.test(foundation)) {
    return `ui-${splitCamelCase(foundation).toLowerCase().replaceAll(' ', '-')}`
  }
  return foundation
}

function slugify(value: string): string {
  return splitCamelCase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function normalizeForMatch(value: string): string {
  return slugify(value).replaceAll('-', '')
}

function stripInlineCode(value: string): string {
  return value.replace(/`([^`]+)`/g, '$1')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
