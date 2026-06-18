import { genericWorkGraphDomainAdapter } from './work-graph-domain-adapters.js'

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
  taskTitle?: string
  need: string
  targetArea: string
  producedArtifact: string
  workShape: 'ui-component' | 'frontend-integration' | 'backend-api' | 'cli-tool' | 'docs' | 'migration' | 'bugfix' | 'single-edit' | 'generic'
  statusHint: 'missing' | 'shipped' | 'unknown'
  buildsOn: string[]
  sharedFoundations: string[]
  consumerSurfaces: string[]
  sourceRefs: Array<{ path: string; snippet: string }>
  sequenceGroup?: string
  sequenceIndex?: number
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
  sourceRefs: Array<{ path: string; snippet: string }>
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
  titleMode?: 'deliverable' | 'verbatim'
  explicitTargetArea?: string
  sequenceGroup?: string
  sequenceIndex?: number
}

type ExistingTaskMatch = {
  id: string
  status?: string
  producedArtifact?: string
  structuredEnough: boolean
}

const DONEISH_STATUSES = new Set(['done', 'review', 'gate_check'])
const workGraphDomainAdapter = genericWorkGraphDomainAdapter

export function planEvidenceWorkGraph(input: EvidenceWorkGraphInput): EvidenceWorkGraphPlan {
  const currentMilestoneStage = detectCurrentMilestoneStage(input.sources)
  const units = input.sources.flatMap(source => extractUnits(source, currentMilestoneStage))
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

    const dependencies = dependenciesFor(unit, existingTasks, implementationByDeliverable, units)
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

function extractUnits(source: EvidenceSource, currentMilestoneStage: string | null): EvidenceUnit[] {
  return extractSeeds(source, currentMilestoneStage).map(seed => {
    const statusHint = inferStatusHint(seed.need)
    const workShape = inferWorkShape(seed)
    const targetArea = inferTargetArea(seed)
    const producedArtifact = inferProducedArtifact(seed.deliverable, seed.need)
    const buildsOn = parseFoundations(seed.foundation)
    const sharedFoundations = buildsOn.map(foundationToArtifact)

    return {
      name: seed.deliverable,
      ...(seed.titleMode === 'verbatim' ? { taskTitle: seed.deliverable } : {}),
      need: seed.need,
      targetArea,
      producedArtifact,
      workShape,
      statusHint,
      buildsOn,
      sharedFoundations,
      consumerSurfaces: parseConsumers(seed.consumer),
      sourceRefs: [{ path: seed.path, snippet: seed.row }],
      ...(seed.sequenceGroup ? { sequenceGroup: seed.sequenceGroup } : {}),
      ...(typeof seed.sequenceIndex === 'number' ? { sequenceIndex: seed.sequenceIndex } : {}),
    }
  })
}

function extractSeeds(source: EvidenceSource, currentMilestoneStage: string | null): UnitSeed[] {
  return [
    ...extractTableSeeds(source),
    ...extractRoadmapMilestoneSeeds(source),
    ...extractRoadmapStageDeliverableSeeds(source),
    ...extractRecommendedTaskSeeds(source),
  ]
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

function extractRoadmapMilestoneSeeds(source: EvidenceSource): UnitSeed[] {
  const lines = logicalMarkdownLines(source.content)
  const seeds: UnitSeed[] = []
  const currentMilestoneStage = detectCurrentMilestoneStage([{ path: source.path, content: source.content }])
  let inCurrentMilestone = false
  let currentMilestoneTaskIndex = 0

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const currentHeading = heading[1]!.trim()
      inCurrentMilestone = /^current next milestone$/i.test(currentHeading)
      if (inCurrentMilestone) currentMilestoneTaskIndex = 0
      continue
    }

    if (!inCurrentMilestone) {
      continue
    }

    const numbered = /^\s*\d+\.\s+(.+?)\s*$/.exec(line)
    if (!numbered) {
      continue
    }

    const title = stripInlineCode(numbered[1]!.trim())
    if (!title) continue
    currentMilestoneTaskIndex += 1
    seeds.push({
      path: source.path,
      deliverable: title,
      need: `${currentMilestoneStage ?? 'current next milestone'} starter task.`,
      foundation: currentMilestoneStage ?? 'current implementation stage',
      consumer: '',
      row: line.trim(),
      titleMode: 'verbatim',
      explicitTargetArea: inferRoadmapTargetArea(source.path),
      sequenceGroup: `${source.path}#current-next-milestone`,
      sequenceIndex: currentMilestoneTaskIndex,
    })
  }

  return seeds
}

function extractRoadmapStageDeliverableSeeds(source: EvidenceSource): UnitSeed[] {
  const lines = logicalMarkdownLines(source.content)
  const seeds: UnitSeed[] = []
  let currentStageHeading = ''
  let currentStageGoal = ''
  let currentStageIndex: number | null = null
  let inDeliverables = false

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      currentStageHeading = heading[1]!.trim()
      const stageNumber = /^Stage\s+(\d+)\b/i.exec(currentStageHeading)?.[1]
      currentStageIndex = stageNumber ? Number(stageNumber) : null
      currentStageGoal = ''
      inDeliverables = false
      continue
    }

    if (!currentStageHeading || /^current next milestone$/i.test(currentStageHeading)) {
      continue
    }

    const goal = /^Goal:\s+(.+?)\s*$/i.exec(trimmed)
    if (goal) {
      currentStageGoal = stripInlineCode(goal[1]!.trim())
      continue
    }

    if (/^Deliverables:\s*$/i.test(trimmed)) {
      inDeliverables = true
      continue
    }

    if (!inDeliverables) {
      continue
    }

    const bullet = /^\s*[-*]\s+(.+?)\s*$/.exec(line)
    if (!bullet) {
      if (trimmed.length === 0) continue
      inDeliverables = false
      continue
    }

    if (currentStageIndex !== null && currentStageIndex <= 1) {
      continue
    }

    const deliverable = stripInlineCode(bullet[1]!.trim())
    if (!deliverable) continue

    seeds.push({
      path: source.path,
      deliverable,
      need: currentStageGoal
        ? `${currentStageHeading}. ${currentStageGoal}`
        : `${currentStageHeading} deliverable.`,
      foundation: currentStageHeading,
      consumer: '',
      row: trimmed,
      titleMode: 'verbatim',
      explicitTargetArea: inferRoadmapTargetArea(source.path),
    })
  }

  return seeds
}

function extractRecommendedTaskSeeds(source: EvidenceSource): UnitSeed[] {
  const lines = logicalMarkdownLines(source.content)
  const seeds: UnitSeed[] = []
  let currentEntry = ''
  let currentStageAlignment = ''
  let currentDomain = ''
  let currentRecommendedTitle = ''

  const flush = () => {
    const title = stripInlineCode(currentRecommendedTitle.trim())
    const normalizedTitle = title
      .toLowerCase()
      .replace(/[`*_~]/g, '')
      .trim()
    if (!normalizedTitle || /^\(?none\b/i.test(normalizedTitle)) {
      currentRecommendedTitle = ''
      return
    }
    seeds.push({
      path: source.path,
      deliverable: title,
      need: currentStageAlignment
        ? `${currentStageAlignment}. Recommended first implementation task for ${currentEntry || 'this spec'}.`
        : `Recommended first implementation task for ${currentEntry || 'this spec'}.`,
      foundation: currentEntry || 'spec inventory',
      consumer: '',
      row: `Recommended first task title: ${title}`,
      titleMode: 'verbatim',
      explicitTargetArea: currentDomain && !/^\*?\(none/i.test(currentDomain) ? currentDomain : undefined,
    })
    currentRecommendedTitle = ''
  }

  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flush()
      currentEntry = heading[1]!.trim()
      currentStageAlignment = ''
      currentDomain = ''
      continue
    }

    const stageAlignment = /^-\s+\*\*stage alignment:\*\*\s+(.+?)\s*$/i.exec(line.trim())
    if (stageAlignment) {
      currentStageAlignment = stripInlineCode(stageAlignment[1]!.trim())
      continue
    }

    const domain = /^-\s+\*\*recommended domain:\*\*\s+(.+?)\s*$/i.exec(line.trim())
    if (domain) {
      currentDomain = stripInlineCode(domain[1]!.trim())
      continue
    }

    const recommended = /^-\s+\*\*recommended first task title:\*\*\s+(.+?)\s*$/i.exec(line.trim())
    if (!recommended) {
      continue
    }
    currentRecommendedTitle = recommended[1]!.trim()
  }

  flush()

  return seeds
}

function detectCurrentMilestoneStage(sources: readonly EvidenceSource[]): string | null {
  for (const source of sources) {
    const match = source.content.match(/##\s+Current Next Milestone[\s\S]{0,400}?The next milestone is\s+(Stage\s+\d+)/i)
    if (match?.[1]) {
      return normalizeStageLabel(match[1])
    }
  }
  return null
}

function normalizeStageLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function logicalMarkdownLines(raw: string): string[] {
  const physicalLines = raw.split(/\r?\n/)
  const logicalLines: string[] = []

  for (let index = 0; index < physicalLines.length; index += 1) {
    let line = physicalLines[index] ?? ''
    if (!startsListItem(line)) {
      logicalLines.push(line)
      continue
    }
    while (index + 1 < physicalLines.length && isListContinuationLine(physicalLines[index + 1] ?? '')) {
      line = `${line.trimEnd()} ${(physicalLines[index + 1] ?? '').trim()}`
      index += 1
    }
    logicalLines.push(line)
  }

  return logicalLines
}

function startsListItem(line: string): boolean {
  return /^\s*(?:[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(line)
}

function isListContinuationLine(line: string): boolean {
  if (!/^\s{2,}\S/.test(line)) return false
  const trimmed = line.trim()
  return !/^(?:#{1,6}\s+|\|(?:.+)\||[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(trimmed)
}

function buildImplementationTask(unit: EvidenceUnit, existingMatch?: ExistingTaskMatch): EvidenceTask {
  const id = existingMatch?.id ?? `task-${slugify(unit.name)}`
  const supersedesVagueIntake = existingMatch ? !existingMatch.structuredEnough : undefined

  return {
    id,
    title: unit.taskTitle ?? `Build ${unit.name}`,
    kind: 'implementation',
    deliverableName: unit.name,
    targetArea: unit.targetArea,
    producedArtifact: unit.producedArtifact,
    buildsOn: unit.buildsOn,
    sharedFoundations: unit.sharedFoundations,
    dependsOn: [],
    relatedTasks: [],
    sourceRefs: unit.sourceRefs,
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
    sourceRefs: unit.sourceRefs,
    acceptanceCriteria: integrationAcceptanceCriteria(),
    proofPaths: integrationProofPaths(unit),
  }
}

function dependenciesFor(
  unit: EvidenceUnit,
  existingTasks: Array<Record<string, unknown>>,
  implementationByDeliverable: Map<string, EvidenceTask>,
  units: EvidenceUnit[],
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

  if (unit.sequenceGroup && typeof unit.sequenceIndex === 'number' && unit.sequenceIndex > 1) {
    const previousUnit = units.find(candidate =>
      candidate.sequenceGroup === unit.sequenceGroup &&
      candidate.sequenceIndex === unit.sequenceIndex! - 1,
    )
    if (previousUnit) {
      const previousTask = implementationByDeliverable.get(previousUnit.name)
      if (previousTask && !taskIds.includes(previousTask.id)) {
        taskIds.push(previousTask.id)
        relatedTasks.push({
          taskId: previousTask.id,
          relationship: 'blocks',
          reason: `${unit.name} comes after ${previousUnit.name} in the roadmap starter sequence.`,
        })
      }
    }
  }

  return { taskIds: unique(taskIds), dependsOn: unique(taskIds), relatedTasks }
}

function implementationAcceptanceCriteria(unit: EvidenceUnit): EvidenceTask['acceptanceCriteria'] {
  if (unit.workShape === 'backend-api') {
    return [
      { id: 'api-contract', description: `${unit.name} exposes the requested API behavior.` },
      { id: 'authorization-contract', description: `${unit.name} proves membership, permission, or tenancy checks.` },
      { id: 'integration-proof', description: `${unit.name} has deterministic API integration proof.` },
    ]
  }
  if (unit.workShape === 'cli-tool') {
    return [
      { id: 'cli-contract', description: `${unit.name} exposes the requested command behavior.` },
      { id: 'output-fixture', description: `${unit.name} has stable command output fixture proof.` },
      { id: 'regression-test', description: `${unit.name} is covered by a regression test.` },
    ]
  }
  if (unit.workShape === 'docs') {
    return [
      { id: 'docs-diff', description: `${unit.name} changes only the intended documentation.` },
      { id: 'docs-proof', description: `${unit.name} passes the docs check or deterministic content review.` },
    ]
  }
  if (unit.workShape === 'migration') {
    return [
      { id: 'migration-up', description: `${unit.name} applies the schema/data change.` },
      { id: 'migration-rollback', description: `${unit.name} proves rollback or downgrade behavior.` },
      { id: 'validation-proof', description: `${unit.name} validates migrated data shape.` },
    ]
  }
  if (unit.workShape === 'bugfix') {
    return [
      { id: 'regression-reproduction', description: `${unit.name} starts from a failing regression case.` },
      { id: 'fix-proof', description: `${unit.name} passes the focused regression after the fix.` },
    ]
  }
  if (unit.workShape === 'single-edit') {
    return [
      { id: 'focused-edit', description: `${unit.name} stays bounded to the named edit.` },
      { id: 'focused-proof', description: `${unit.name} has focused diff or test proof.` },
    ]
  }

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
  return workGraphDomainAdapter.proofPaths(unit)
}

function integrationProofPaths(unit: EvidenceUnit): EvidenceTask['proofPaths'] {
  const consumerSurface = primaryConsumerSurface(unit)

  return [
    {
      kind: 'browser',
      expectedEvidence: [
        `${unit.name} is visible or executable in ${consumerSurface}.`,
        `${consumerSurface} works in the live consumer flow.`,
      ],
    },
    {
      kind: 'review',
      expectedEvidence: [
        `${consumerSurface} conventions are respected.`,
      ],
    },
  ]
}

function inferStatusHint(need: string): EvidenceUnit['statusHint'] {
  if (/\b(shipped|complete|done|already)\b/i.test(need)) {
    return 'shipped'
  }
  if (/\b(missing|gap|add|allow|expose|needs?|build|replace|clarify|rename|fix|migration|migrate)\b/i.test(need)) {
    return 'missing'
  }
  return 'unknown'
}

function inferTargetArea(seed: UnitSeed): string {
  if (seed.explicitTargetArea?.trim()) {
    return normalizeTargetArea(seed.explicitTargetArea.trim())
  }
  const { path, deliverable } = seed
  const releaseFixture = path.match(/(?:^|\/)release-proof-matrix\/([^/]+)/)
  if (releaseFixture?.[1]) {
    return releaseFixture[1]
  }
  const firstPathSegment = path.split('/').find(Boolean)
  if (firstPathSegment && !['docs', 'internal'].includes(firstPathSegment)) {
    return firstPathSegment
  }
  if (/dashboard integration/i.test(deliverable)) {
    return 'Admin settings page'
  }
  return firstPathSegment ?? 'project'
}

function normalizeTargetArea(value: string): string {
  const trimmed = value.trim()
  if (/^[a-z0-9-]+$/.test(trimmed)) {
    return trimmed
  }
  return normalizeDeliverableName(trimmed)
}

function inferRoadmapTargetArea(path: string): string {
  if (path.includes('/harness/')) return 'harness'
  if (path.includes('/coherence/')) return 'coherence'
  return 'project'
}

function inferWorkShape(seed: UnitSeed): EvidenceUnit['workShape'] {
  const text = `${seed.deliverable} ${seed.need} ${seed.foundation} ${seed.consumer}`.toLowerCase()
  if (/\b(rename|wording|copy)\b/.test(seed.need) || /\bsettings footer\b/.test(text)) {
    return 'single-edit'
  }
  if (/\b(fix|duplicate|regression)\b/.test(seed.need)) {
    return 'bugfix'
  }
  if (/\b(data-migration|migration|rollback|archived_at|schema)\b/.test(text)) {
    return 'migration'
  }
  if (/\b(cli|command|--json|inspect)\b/.test(text)) {
    return 'cli-tool'
  }
  if (/\b(backend-api|api|endpoint|membership checks?|tenant|permission)\b/.test(text)) {
    return 'backend-api'
  }
  if (/\bdashboard integration\b/i.test(seed.deliverable)) {
    return 'frontend-integration'
  }
  if (/\b(component|component-library|ui-library|primitive|design-system|confirmation|navigation)\b/.test(`${seed.path} ${text}`)) {
    return 'ui-component'
  }
  if (/\b(docs-only|docs|quick start|documentation|install warning|clarify)\b/.test(text)) {
    return 'docs'
  }
  return 'generic'
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
  return workGraphDomainAdapter.primaryConsumerSurface(unit)
}

function needsIntegrationTask(unit: EvidenceUnit): boolean {
  return workGraphDomainAdapter.needsIntegrationTask(unit)
}

function integrationTitle(unit: EvidenceUnit, consumerSurface: string): string {
  return workGraphDomainAdapter.integrationTitle(unit, consumerSurface)
}

function integrationTargetArea(unit: EvidenceUnit, consumerSurface: string): string {
  return workGraphDomainAdapter.integrationTargetArea(unit, consumerSurface)
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
    const productBrief = task.productBrief && typeof task.productBrief === 'object' && !Array.isArray(task.productBrief)
      ? task.productBrief as Record<string, unknown>
      : null
    const hasBriefShape = typeof productBrief?.userJob === 'string' && productBrief.userJob.trim().length > 0
      && typeof productBrief?.whyItMattersNow === 'string' && productBrief.whyItMattersNow.trim().length > 0
      && typeof productBrief?.successMetric === 'string' && productBrief.successMetric.trim().length > 0
    const spec = typeof task.spec === 'string' ? task.spec : ''
    const hasStructuredSpec = Boolean(task.structuredSpec && typeof task.structuredSpec === 'object' && !Array.isArray(task.structuredSpec))
    const structuredEnough = hasStructuredSpec
      || (markdownLooksLikeModernSpec(spec) && hasBriefShape && acceptanceCriteria.length > 0)
      || (hasBriefShape && acceptanceCriteria.length > 0 && dependsOn.length > 0)

    return {
      id,
      status: typeof task.status === 'string' ? task.status : undefined,
      producedArtifact: typeof task.producedArtifact === 'string' ? task.producedArtifact : undefined,
      structuredEnough,
    }
  }

  return undefined
}

function isExistingDone(task: ExistingTaskMatch | undefined): boolean {
  return task?.status ? DONEISH_STATUSES.has(task.status) : false
}

function normalizeDeliverableName(value: string): string {
  return workGraphDomainAdapter.normalizeDeliverableName(value)
}

function markdownLooksLikeModernSpec(spec: string): boolean {
  const headings = [
    /^## What this is$/im,
    /^## Problem \/ context$/im,
    /^## Goals$/im,
    /^## Non-goals$/im,
    /^## Proposed design$/im,
    /^## Key decisions$/im,
    /^## Acceptance criteria$/im,
    /^## Verification$/im,
    /^## Completion boundary$/im,
  ]
  return headings.filter(pattern => pattern.test(spec)).length >= 6
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
