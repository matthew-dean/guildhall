import { genericWorkGraphDomainAdapter } from './work-graph-domain-adapters.js'
import type { ImportSemanticKind } from './import-semantic-kind.js'

export type EvidenceSource = {
  path: string
  content: string
  /** Source-owned identity for extracted units, keyed by explicit deliverable identity. */
  unitIdentities?: Record<string, string>
  /** Optional structured meaning supplied by the source adapter. */
  semanticKinds?: Record<string, ImportSemanticKind>
  /** Optional source-adapter-owned contract membership by deliverable identity. */
  contractNames?: Record<string, readonly string[]>
  workShapes?: Record<string, EvidenceUnit['workShape']>
  statusHints?: Record<string, EvidenceUnit['statusHint']>
  targetAreas?: Record<string, string>
  producedArtifacts?: Record<string, string>
  buildsOn?: Record<string, readonly string[]>
  consumerSurfaces?: Record<string, readonly string[]>
}

export type EvidenceWorkShape =
  | 'ui-component'
  | 'frontend-integration'
  | 'backend-api'
  | 'cli-tool'
  | 'docs'
  | 'migration'
  | 'bugfix'
  | 'single-edit'
  | 'generic'

export type EvidenceStatusHint = 'missing' | 'shipped' | 'unknown'

export type EvidenceWorkGraphInput = {
  sources: EvidenceSource[]
  existingTasks?: Array<Record<string, unknown>>
  refreshStructuredExisting?: boolean
}

export type EvidenceUnit = {
  sourceIdentity: string
  name: string
  taskTitle?: string
  need: string
  targetArea: string
  producedArtifact: string
  workShape: EvidenceWorkShape
  statusHint: EvidenceStatusHint
  semanticKind?: ImportSemanticKind
  contractNames?: readonly string[]
  buildsOn: string[]
  sharedFoundations: string[]
  consumerSurfaces: string[]
  sourceRefs: Array<{ path: string; snippet: string }>
  sequenceGroup?: string
  sequenceIndex?: number
  stageAlignment?: string
}

export type EvidenceTask = {
  sourceIdentity: string
  id: string
  title: string
  kind: 'implementation' | 'integration'
  semanticKind?: ImportSemanticKind
  contractNames?: readonly string[]
  workShape: EvidenceWorkShape
  statusHint: EvidenceStatusHint
  parentAcceptanceCriterionIds?: readonly string[]
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
  proofPaths: Array<{ kind: 'command' | 'review' | 'browser'; command?: string; expectedEvidence?: string[]; source?: 'documented' | 'inferred' }>
  status?: string
  stageAlignment?: string
  supersedesVagueIntake?: boolean
}

export type EvidenceWorkGraphPlan = {
  units: EvidenceUnit[]
  tasks: EvidenceTask[]
  reconciliations: Array<{ existingTaskId: string; action: 'reframed_existing_task'; reason: string }>
  suppressedTaskTitles: string[]
}

type UnitSeed = {
  sourceIdentity?: string
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
  stageAlignment?: string
}

type ExistingTaskMatch = {
  id: string
  status?: string
  producedArtifact?: string
  structuredEnough: boolean
}

const DONEISH_STATUSES = new Set(['done', 'review', 'gate_check'])
const NON_BLOCKING_DEPENDENCY_STATUSES = new Set(['archived', 'shelved'])
const STRUCTURED_PLAN_STATUSES = new Set(['ready', 'spec_review'])
const workGraphDomainAdapter = genericWorkGraphDomainAdapter

export function planEvidenceWorkGraph(input: EvidenceWorkGraphInput): EvidenceWorkGraphPlan {
  const currentMilestoneStage = detectCurrentMilestoneStage(input.sources)
  const suppressRoadmapStageDeliverables = true
  const suppressedTaskTitles = suppressRoadmapStageDeliverables
    ? input.sources.flatMap(source => extractRoadmapStageDeliverableSeeds(source).map(seed => seed.deliverable))
    : []
  const units = input.sources.flatMap(source =>
    extractUnits(source, currentMilestoneStage, { suppressRoadmapStageDeliverables }),
  )
  const existingTasks = input.existingTasks ?? []
  const refreshStructuredExisting = input.refreshStructuredExisting === true
  const tasks: EvidenceTask[] = []
  const reconciliations: EvidenceWorkGraphPlan['reconciliations'] = []
  const implementationByDeliverable = new Map<string, EvidenceTask>()
  const consumedExistingTaskIds = new Set<string>()

  for (const unit of units) {
    const existingMatch = findExistingTaskForUnit(
      unit,
      existingTasks.filter(task => {
        const id = typeof task.id === 'string' ? task.id : ''
        return id.length === 0 || !consumedExistingTaskIds.has(id)
      }),
    )
    if (existingMatch) {
      consumedExistingTaskIds.add(existingMatch.id)
    }
    const isAlreadyShipped = unit.statusHint === 'shipped' || isExistingDone(existingMatch)

    if (isAlreadyShipped && (!existingMatch || isExistingNonBlockingDependency(existingMatch))) {
      continue
    }

    if (existingMatch?.structuredEnough && !refreshStructuredExisting) {
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

  return { units, tasks, reconciliations, suppressedTaskTitles }
}

function extractUnits(
  source: EvidenceSource,
  currentMilestoneStage: string | null,
  options: { suppressRoadmapStageDeliverables: boolean },
): EvidenceUnit[] {
  return extractSeeds(source, currentMilestoneStage, options).map((seed, index) => {
    const sourceIdentity = seed.sourceIdentity ?? sourceMetadataValue(source.unitIdentities, seed.deliverable) ?? `${source.path}#unit:${index + 1}`
    const statusHint = sourceMetadataValue(source.statusHints, seed.deliverable) ?? 'unknown'
    const workShape = sourceMetadataValue(source.workShapes, seed.deliverable) ?? 'generic'
    const targetArea = sourceMetadataValue(source.targetAreas, seed.deliverable) ?? inferTargetArea(seed)
    const producedArtifact = sourceMetadataValue(source.producedArtifacts, seed.deliverable) ?? `artifact:${sourceIdentity}`
    const buildsOn = sourceMetadataList(source.buildsOn, seed.deliverable)
    const sharedFoundations = buildsOn.map(foundationToArtifact)
    const consumerSurfaces = sourceMetadataList(source.consumerSurfaces, seed.deliverable)

    return {
      sourceIdentity,
      name: seed.deliverable,
      ...(seed.titleMode === 'verbatim' ? { taskTitle: seed.deliverable } : {}),
      need: seed.need,
      targetArea,
      producedArtifact,
      workShape,
      ...(semanticKindForSource(source, seed.deliverable) ? { semanticKind: semanticKindForSource(source, seed.deliverable) } : {}),
      ...(contractNamesForSource(source, seed.deliverable) ? { contractNames: contractNamesForSource(source, seed.deliverable) } : {}),
      statusHint,
      buildsOn,
      sharedFoundations,
      consumerSurfaces,
      sourceRefs: [{ path: seed.path, snippet: seed.row }],
      ...(seed.sequenceGroup ? { sequenceGroup: seed.sequenceGroup } : {}),
      ...(typeof seed.sequenceIndex === 'number' ? { sequenceIndex: seed.sequenceIndex } : {}),
      ...(seed.stageAlignment ? { stageAlignment: seed.stageAlignment } : {}),
    }
  })
}

function extractSeeds(
  source: EvidenceSource,
  currentMilestoneStage: string | null,
  options: { suppressRoadmapStageDeliverables: boolean },
): UnitSeed[] {
  return [
    ...extractTableSeeds(source),
    ...extractRoadmapMilestoneSeeds(source),
    ...(options.suppressRoadmapStageDeliverables ? [] : extractRoadmapStageDeliverableSeeds(source)),
  ]
}

function semanticKindForSource(source: EvidenceSource, deliverable: string): ImportSemanticKind | undefined {
  const semanticKinds = source.semanticKinds
  if (!semanticKinds) return undefined
  const exact = semanticKinds[deliverable]
  if (exact) return exact
  const normalizedDeliverable = normalizeDeliverableName(deliverable)
  return Object.entries(semanticKinds).find(([candidate]) =>
    normalizeDeliverableName(candidate) === normalizedDeliverable,
  )?.[1]
}

function contractNamesForSource(source: EvidenceSource, deliverable: string): readonly string[] | undefined {
  const contractNames = source.contractNames
  if (!contractNames) return undefined
  const exact = contractNames[deliverable]
  if (exact?.length) return [...new Set(exact.map(name => name.trim()).filter(Boolean))]
  const normalizedDeliverable = normalizeDeliverableName(deliverable)
  const matched = Object.entries(contractNames).find(([candidate]) =>
    normalizeDeliverableName(candidate) === normalizedDeliverable,
  )?.[1]
  return matched?.length
    ? [...new Set(matched.map(name => name.trim()).filter(Boolean))]
    : undefined
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

function stageNumber(value: string): number | null {
  const match = /^stage\s+(\d+)\b/i.exec(value.trim())
  return match?.[1] ? Number(match[1]) : null
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
    while (index + 1 < physicalLines.length) {
      const nextLine = physicalLines[index + 1] ?? ''
      if (isListCompletionAnnotation(nextLine.trim())) {
        index += 1
        while (index + 1 < physicalLines.length && isListMetadataContinuationLine(physicalLines[index + 1] ?? '')) {
          index += 1
        }
        continue
      }
      if (!isListContinuationLine(nextLine)) break
      line = `${line.trimEnd()} ${nextLine.trim()}`
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
  if (isListCompletionAnnotation(trimmed)) return false
  return !/^(?:#{1,6}\s+|\|(?:.+)\||[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(trimmed)
}

function isListMetadataContinuationLine(line: string): boolean {
  if (!/^\s{2,}\S/.test(line)) return false
  const trimmed = line.trim()
  return !/^(?:#{1,6}\s+|\|(?:.+)\||[-*]\s+(?:\[[xX ]\]\s+)?|\d+\.\s+)/.test(trimmed)
}

function isListCompletionAnnotation(trimmed: string): boolean {
  return /^(?:[✓✔✅]\s*)?(?:completed?|done|shipped|verified|proof|evidence)\b/i.test(trimmed)
}

function buildImplementationTask(unit: EvidenceUnit, existingMatch?: ExistingTaskMatch): EvidenceTask {
  const id = existingMatch?.id ?? `task-${stableIdentityHash(unit.sourceIdentity)}`
  const supersedesVagueIntake = existingMatch ? !existingMatch.structuredEnough : undefined

  return {
    sourceIdentity: unit.sourceIdentity,
    id,
    title: unit.taskTitle ?? `Build ${unit.name}`,
    kind: 'implementation',
    workShape: unit.workShape,
    statusHint: unit.statusHint,
    ...(unit.semanticKind ? { semanticKind: unit.semanticKind } : {}),
    ...(unit.contractNames?.length ? { contractNames: [...unit.contractNames] } : {}),
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
    ...(unit.stageAlignment ? { stageAlignment: unit.stageAlignment } : {}),
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
    if (existingDependency && !isExistingDone(existingDependency) && !isExistingNonBlockingDependency(existingDependency)) {
      dependsOn.add(existingDependency.id)
    }
  }

  return {
    sourceIdentity: `${unit.sourceIdentity}:integration`,
    id: `task-${stableIdentityHash(`${unit.sourceIdentity}:integration`)}`,
    title: integrationTitle(unit, consumerSurface),
    kind: 'integration',
    workShape: 'frontend-integration',
    statusHint: unit.statusHint,
    ...(unit.semanticKind ? { semanticKind: unit.semanticKind } : {}),
    ...(unit.contractNames?.length ? { contractNames: [...unit.contractNames] } : {}),
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
  const currentTaskId = implementationByDeliverable.get(unit.name)?.id

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
    if (existingTask?.id === currentTaskId) continue
    if (existingTask && !isExistingDone(existingTask) && !isExistingNonBlockingDependency(existingTask)) {
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

  const currentMilestoneDependency = dependencyForLaterStageUnit(unit, units, implementationByDeliverable)
  if (currentMilestoneDependency && !taskIds.includes(currentMilestoneDependency.taskId)) {
    taskIds.push(currentMilestoneDependency.taskId)
    relatedTasks.push({
      taskId: currentMilestoneDependency.taskId,
      relationship: 'blocks',
      reason: currentMilestoneDependency.reason,
    })
  }

  return { taskIds: unique(taskIds), dependsOn: unique(taskIds), relatedTasks }
}

function dependencyForLaterStageUnit(
  unit: EvidenceUnit,
  units: EvidenceUnit[],
  implementationByDeliverable: Map<string, EvidenceTask>,
): { taskId: string; reason: string } | null {
  if (!unit.stageAlignment) return null
  const alignedStageNumber = stageNumber(unit.stageAlignment)
  if (alignedStageNumber === null) return null

  const milestoneUnits = units
    .filter(candidate => candidate.sequenceGroup?.includes('#current-next-milestone') && typeof candidate.sequenceIndex === 'number')
    .sort((left, right) => (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0))
  if (milestoneUnits.length === 0) return null

  const milestoneStageLabels = unique(
    milestoneUnits
      .flatMap(candidate => candidate.buildsOn)
      .map(label => normalizeStageLabel(label))
      .filter(label => stageNumber(label) !== null),
  )
  const activeMilestoneStage = milestoneStageLabels[0] ?? null
  const activeMilestoneStageNumber = activeMilestoneStage ? stageNumber(activeMilestoneStage) : null
  if (activeMilestoneStageNumber === null || alignedStageNumber <= activeMilestoneStageNumber) {
    return null
  }

  const terminalMilestoneUnit = milestoneUnits[milestoneUnits.length - 1]
  if (!terminalMilestoneUnit) return null
  const terminalTask = implementationByDeliverable.get(terminalMilestoneUnit.name)
  if (!terminalTask) return null
  return {
    taskId: terminalTask.id,
    reason: `${unit.name} is stage-aligned after the current milestone and should wait for ${terminalMilestoneUnit.name}.`,
  }
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

function inferTargetArea(seed: UnitSeed): string {
  if (seed.explicitTargetArea?.trim()) {
    return normalizeTargetArea(seed.explicitTargetArea.trim())
  }
  const { path } = seed
  const releaseFixture = path.match(/(?:^|\/)release-proof-matrix\/([^/]+)/)
  if (releaseFixture?.[1]) {
    return releaseFixture[1]
  }
  const pathSegments = path.split('/').filter(Boolean)
  const firstPathSegment = pathSegments[0]
  if (firstPathSegment && !['docs', 'internal'].includes(firstPathSegment)) {
    return firstPathSegment
  }
  const documentArea = pathSegments[1]
  if (documentArea && !['docs', 'internal'].includes(documentArea)) {
    return documentArea
  }
  return documentArea ?? firstPathSegment ?? 'project'
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

function sourceMetadataValue<T>(metadata: Record<string, T> | undefined, deliverable: string): T | undefined {
  if (!metadata) return undefined
  const exact = metadata[deliverable]
  if (exact !== undefined) return exact
  const normalized = normalizeDeliverableName(deliverable)
  return Object.entries(metadata).find(([candidate]) => normalizeDeliverableName(candidate) === normalized)?.[1]
}

function sourceMetadataList(metadata: Record<string, readonly string[]> | undefined, deliverable: string): string[] {
  const value = sourceMetadataValue(metadata, deliverable)
  return value ? unique(value.map(item => item.trim()).filter(Boolean)) : []
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
  const exactIdentity = existingTasks.find(task => task.sourceIdentity === unit.sourceIdentity)
  if (exactIdentity) return existingTaskMatch(exactIdentity)
  const claimedSourceIdentity = existingTasks.find(task => taskHasSourceClaimForUnit(task, unit))
  if (claimedSourceIdentity) return existingTaskMatch(claimedSourceIdentity)
  const canonicalLegacyIdentity = existingTasks.find(task => taskHasCanonicalLegacyIdentityForUnit(task, unit))
  if (canonicalLegacyIdentity) return existingTaskMatch(canonicalLegacyIdentity)
  return findExistingTaskByDeliverable(unit.name, existingTasks)
}

function taskHasSourceClaimForUnit(task: Record<string, unknown>, unit: EvidenceUnit): boolean {
  const claims = Array.isArray(task.sourceClaims) ? task.sourceClaims : []
  const unitTitles = new Set([unit.name, unit.taskTitle ?? `Build ${unit.name}`].map(normalizeForMatch))
  return claims.some(claim => {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return false
    const record = claim as Record<string, unknown>
    if (record.confidence !== 'high') return false
    const hints = Array.isArray(record.linkedTaskHints)
      ? record.linkedTaskHints.filter((value): value is string => typeof value === 'string')
      : []
    if (!hints.some(hint => unitTitles.has(normalizeForMatch(hint)))) return false
    const refs = Array.isArray(record.references)
      ? record.references.filter((value): value is string => typeof value === 'string')
      : []
    return refs.some(ref => unit.sourceRefs.some(source => sourcePathMatches(ref, source.path)))
  })
}

function sourcePathMatches(left: string, right: string): boolean {
  const normalizePath = (value: string) => value.replaceAll('\\', '/').replace(/^import:/, '').replace(/^\/+/, '')
  const normalizedLeft = normalizePath(left)
  const normalizedRight = normalizePath(right)
  return normalizedLeft === normalizedRight || normalizedLeft.endsWith(`/${normalizedRight}`)
}

function taskHasCanonicalLegacyIdentityForUnit(task: Record<string, unknown>, unit: EvidenceUnit): boolean {
  const id = typeof task.id === 'string' ? task.id : ''
  if (normalizeForMatch(id) !== `task${normalizeForMatch(unit.name)}`) return false
  const references = Array.isArray(task.references)
    ? task.references.filter((value): value is string => typeof value === 'string')
    : []
  return references.some(ref => unit.sourceRefs.some(source => sourcePathMatches(ref, source.path)))
}

function findExistingTaskByDeliverable(deliverable: string, existingTasks: Array<Record<string, unknown>>): ExistingTaskMatch | undefined {
  const normalized = normalizeForMatch(deliverable)
  for (const task of existingTasks) {
    const id = typeof task.id === 'string' ? task.id : undefined
    if (!id) {
      continue
    }

    const exactFields = [
      task.deliverableName,
      task.producedArtifact,
    ].filter((value): value is string => typeof value === 'string')
    // Task title and description are model-authored prose. They are never an
    // identity join. Only explicit structural fields may reconcile a source
    // deliverable with an existing task.
    if (!exactFields.some(value => normalizeForMatch(value) === normalized)) {
      continue
    }

    return existingTaskMatch(task)
  }

  return undefined
}

function existingTaskMatch(task: Record<string, unknown>): ExistingTaskMatch | undefined {
  const id = typeof task.id === 'string' ? task.id : undefined
  if (!id) return undefined
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []
    const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : []
    const references = Array.isArray(task.references) ? task.references : []
    const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
    const productBrief = task.productBrief && typeof task.productBrief === 'object' && !Array.isArray(task.productBrief)
      ? task.productBrief as Record<string, unknown>
      : null
    const hasBriefShape = typeof productBrief?.userJob === 'string' && productBrief.userJob.trim().length > 0
      && typeof productBrief?.whyItMattersNow === 'string' && productBrief.whyItMattersNow.trim().length > 0
      && typeof productBrief?.successMetric === 'string' && productBrief.successMetric.trim().length > 0
    const spec = typeof task.spec === 'string' ? task.spec : ''
    const hasStructuredSpec = Boolean(task.structuredSpec && typeof task.structuredSpec === 'object' && !Array.isArray(task.structuredSpec))
    const status = typeof task.status === 'string' ? task.status : undefined
    const hasSourceBackedPlanShape = Boolean(
      status &&
      STRUCTURED_PLAN_STATUSES.has(status) &&
      hasBriefShape &&
      spec.trim().length > 0 &&
      references.length > 0 &&
      acceptanceCriteria.length > 0 &&
      proofPaths.length > 0,
    )
    const structuredEnough = hasStructuredSpec
      || (markdownLooksLikeModernSpec(spec) && hasBriefShape && acceptanceCriteria.length > 0)
      || (hasBriefShape && acceptanceCriteria.length > 0 && dependsOn.length > 0)
      || hasSourceBackedPlanShape

    return {
      id,
      status,
      producedArtifact: typeof task.producedArtifact === 'string' ? task.producedArtifact : undefined,
      structuredEnough,
    }
}

function isExistingDone(task: ExistingTaskMatch | undefined): boolean {
  return task?.status ? DONEISH_STATUSES.has(task.status) : false
}

function isExistingNonBlockingDependency(task: ExistingTaskMatch | undefined): boolean {
  return task?.status ? NON_BLOCKING_DEPENDENCY_STATUSES.has(task.status) : false
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
    return `ui-${foundation.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
  }
  return foundation
}

function stableIdentityHash(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).slice(0, 8)
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function stripInlineCode(value: string): string {
  return value.replace(/`([^`]+)`/g, '$1')
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
