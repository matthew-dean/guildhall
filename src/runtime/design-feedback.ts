import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const DESIGN_FEEDBACK_FILE = 'design-feedback.json'

export const DesignFindingClassification = z.enum([
  'project-specific',
  'reusable-pattern',
  'token-system-gap',
  'taste-guidance-gap',
  'design-system-defect',
  'architecture-opportunity',
])
export type DesignFindingClassification = z.infer<typeof DesignFindingClassification>

export const DesignFindingSeverity = z.enum(['low', 'medium', 'high'])
export type DesignFindingSeverity = z.infer<typeof DesignFindingSeverity>

export const DesignEvidenceRef = z.object({
  kind: z.string().min(1),
  summary: z.string().min(1),
  ref: z.string().optional(),
})
export type DesignEvidenceRef = z.infer<typeof DesignEvidenceRef>

export const DesignFindingSource = z.object({
  kind: z.enum(['reviewer', 'owner-feedback', 'automated-visual-check', 'simulated-owner', 'design-lens-review']),
  artifactId: z.string().optional(),
  selector: z.string().optional(),
  viewport: z.string().optional(),
})
export type DesignFindingSource = z.infer<typeof DesignFindingSource>

export const DesignFinding = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  source: DesignFindingSource,
  severity: DesignFindingSeverity.default('medium'),
  dimension: z.string().min(1),
  designSystem: z.string().optional(),
  targetPackage: z.string().optional(),
  evidenceRefs: z.array(DesignEvidenceRef).default([]),
  suggestedClassification: DesignFindingClassification.optional(),
  classification: DesignFindingClassification.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DesignFinding = z.infer<typeof DesignFinding>
export type DesignFindingInput = z.input<typeof DesignFinding>

export const DesignDecision = z.object({
  id: z.string().min(1),
  findingIds: z.array(z.string()).default([]),
  summary: z.string().min(1),
  status: z.enum(['accepted', 'superseded']).default('accepted'),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DesignDecision = z.infer<typeof DesignDecision>

export const DesignSystemCandidate = z.object({
  id: z.string().min(1),
  findingIds: z.array(z.string()).default([]),
  summary: z.string().min(1),
  classification: DesignFindingClassification.exclude(['project-specific']),
  targetDesignSystem: z.string().default('portable'),
  status: z.enum(['queued', 'accepted', 'dismissed']).default('queued'),
  evidenceRefs: z.array(DesignEvidenceRef).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DesignSystemCandidate = z.infer<typeof DesignSystemCandidate>

export const DesignSystemImprovement = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  findingIds: z.array(z.string()).default([]),
  targetDesignSystem: z.string().default('portable'),
  targetPackage: z.enum(['tokens', 'core', 'layout', 'adapter', 'storybook', 'docs', 'rubric']),
  summary: z.string().min(1),
  status: z.enum(['queued', 'accepted', 'dismissed']).default('queued'),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DesignSystemImprovement = z.infer<typeof DesignSystemImprovement>

export const OwnerDesignFeedbackTarget = z.object({
  artifactId: z.string().optional(),
  directionId: z.string().optional(),
  screenshotRef: z.string().optional(),
  selector: z.string().optional(),
  componentName: z.string().optional(),
  viewport: z.string().optional(),
  coordinates: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
})
export type OwnerDesignFeedbackTarget = z.infer<typeof OwnerDesignFeedbackTarget>

export const OwnerDesignFeedbackSentiment = z.enum(['prefer', 'revise', 'reject', 'note'])
export type OwnerDesignFeedbackSentiment = z.infer<typeof OwnerDesignFeedbackSentiment>

export const OwnerDesignFeedbackRationaleTag = z.enum([
  'warmer',
  'calmer',
  'denser',
  'more-premium',
  'more-playful',
  'less-generic',
  'clearer-hierarchy',
  'better-controls',
  'stronger-brand',
  'accessibility',
  'spacing',
  'color',
  'typography',
  'motion',
])
export type OwnerDesignFeedbackRationaleTag = z.infer<typeof OwnerDesignFeedbackRationaleTag>

export const OwnerDesignFeedback = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  target: OwnerDesignFeedbackTarget.default({}),
  sentiment: OwnerDesignFeedbackSentiment.default('note'),
  rationaleTags: z.array(OwnerDesignFeedbackRationaleTag).default([]),
  status: z.enum(['captured', 'accepted', 'dismissed']).default('captured'),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type OwnerDesignFeedback = z.infer<typeof OwnerDesignFeedback>
export type OwnerDesignFeedbackInput = z.input<typeof OwnerDesignFeedback>

export const DesignDecisionPacket = z.object({
  id: z.string().min(1),
  feedbackIds: z.array(z.string()).default([]),
  decisionIds: z.array(z.string()).default([]),
  summary: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  reviewChecklist: z.array(z.string()).default([]),
  workerContext: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DesignDecisionPacket = z.infer<typeof DesignDecisionPacket>

export const DesignFeedbackStore = z.object({
  version: z.literal(1).default(1),
  findings: z.array(DesignFinding).default([]),
  decisions: z.array(DesignDecision).default([]),
  candidates: z.array(DesignSystemCandidate).default([]),
  designSystemImprovements: z.array(DesignSystemImprovement).default([]),
  ownerFeedback: z.array(OwnerDesignFeedback).default([]),
  decisionPackets: z.array(DesignDecisionPacket).default([]),
})
export type DesignFeedbackStore = z.infer<typeof DesignFeedbackStore>

export interface DesignFindingClassificationInput {
  summary: string
  dimension: string
  designSystem?: string
  sourceKind?: DesignFindingSource['kind']
}

export interface RouteDesignFindingResult {
  finding: DesignFinding
  decision?: DesignDecision
  candidate?: DesignSystemCandidate
  designSystemImprovement?: DesignSystemImprovement
}

export async function readDesignFeedbackStore(memoryDir: string): Promise<DesignFeedbackStore> {
  const file = path.join(memoryDir, DESIGN_FEEDBACK_FILE)
  try {
    return DesignFeedbackStore.parse(JSON.parse(await fsp.readFile(file, 'utf-8')))
  } catch {
    return DesignFeedbackStore.parse({})
  }
}

export async function recordDesignFinding(input: {
  memoryDir: string
  finding: Omit<DesignFindingInput, 'createdAt' | 'updatedAt'> & Partial<Pick<DesignFindingInput, 'createdAt' | 'updatedAt'>>
}): Promise<DesignFinding> {
  const store = await readDesignFeedbackStore(input.memoryDir)
  const now = new Date().toISOString()
  const finding = DesignFinding.parse({
    ...input.finding,
    createdAt: input.finding.createdAt ?? now,
    updatedAt: input.finding.updatedAt ?? now,
  })
  await writeDesignFeedbackStore(input.memoryDir, {
    ...store,
    findings: upsert(store.findings, finding),
  })
  return finding
}

export async function routeDesignFinding(input: {
  memoryDir: string
  findingId: string
}): Promise<RouteDesignFindingResult> {
  const store = await readDesignFeedbackStore(input.memoryDir)
  const found = store.findings.find((finding) => finding.id === input.findingId)
  if (!found) throw new Error(`Design finding not found: ${input.findingId}`)

  const classification = found.suggestedClassification ?? found.classification ?? classifyDesignFinding({
    summary: found.summary,
    dimension: found.dimension,
    designSystem: found.designSystem,
    sourceKind: found.source.kind,
  })
  const finding = DesignFinding.parse({
    ...found,
    classification,
    updatedAt: new Date().toISOString(),
  })

  if (classification === 'project-specific') {
    const decision = DesignDecision.parse({
      id: `design-decision-${finding.id}`,
      findingIds: [finding.id],
      summary: finding.summary,
      status: 'accepted',
      createdAt: finding.updatedAt,
      updatedAt: finding.updatedAt,
    })
    await writeDesignFeedbackStore(input.memoryDir, {
      ...store,
      findings: upsert(store.findings, finding),
      decisions: upsert(store.decisions, decision),
    })
    return { finding, decision }
  }

  const candidate = DesignSystemCandidate.parse({
    id: `design-system-candidate-${finding.id}`,
    findingIds: [finding.id],
    summary: finding.summary,
    classification,
    targetDesignSystem: finding.designSystem ?? 'portable',
    status: 'queued',
    evidenceRefs: finding.evidenceRefs,
    createdAt: finding.updatedAt,
    updatedAt: finding.updatedAt,
  })

  const designSystemImprovement = DesignSystemImprovement.parse({
    id: `design-system-improvement-${finding.id}`,
    candidateId: candidate.id,
    findingIds: [finding.id],
    targetDesignSystem: candidate.targetDesignSystem,
    targetPackage: normalizeDesignSystemTargetPackage(finding),
    summary: finding.summary,
    status: 'queued',
    createdAt: finding.updatedAt,
    updatedAt: finding.updatedAt,
  })

  await writeDesignFeedbackStore(input.memoryDir, {
    ...store,
    findings: upsert(store.findings, finding),
    candidates: upsert(store.candidates, candidate),
    designSystemImprovements: upsert(store.designSystemImprovements, designSystemImprovement),
  })
  return { finding, candidate, designSystemImprovement }
}

export async function captureOwnerDesignFeedback(input: {
  memoryDir: string
  feedback: Omit<OwnerDesignFeedbackInput, 'createdAt' | 'updatedAt'> & Partial<Pick<OwnerDesignFeedbackInput, 'createdAt' | 'updatedAt'>>
}): Promise<OwnerDesignFeedback> {
  const now = new Date().toISOString()
  const feedback = OwnerDesignFeedback.parse({
    ...input.feedback,
    createdAt: input.feedback.createdAt ?? now,
    updatedAt: input.feedback.updatedAt ?? now,
  })
  const finding = await recordDesignFinding({
    memoryDir: input.memoryDir,
    finding: {
      id: `finding-${feedback.id}`,
      summary: feedback.summary,
      source: {
        kind: 'owner-feedback',
        ...(feedback.target.artifactId ? { artifactId: feedback.target.artifactId } : {}),
        ...(feedback.target.selector ? { selector: feedback.target.selector } : {}),
        ...(feedback.target.viewport ? { viewport: feedback.target.viewport } : {}),
      },
      severity: feedback.sentiment === 'reject' ? 'high' : 'medium',
      dimension: feedback.rationaleTags.includes('better-controls')
        ? 'interaction-semantics'
        : feedback.rationaleTags[0] ?? 'owner-feedback',
      evidenceRefs: ownerFeedbackEvidenceRefs(feedback),
      suggestedClassification: 'project-specific',
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt,
    },
  })
  await routeDesignFinding({ memoryDir: input.memoryDir, findingId: finding.id })
  const store = await readDesignFeedbackStore(input.memoryDir)
  await writeDesignFeedbackStore(input.memoryDir, {
    ...store,
    ownerFeedback: upsert(store.ownerFeedback, feedback),
  })
  return feedback
}

export async function buildDesignDecisionPacket(input: {
  memoryDir: string
  feedbackIds?: string[]
}): Promise<DesignDecisionPacket> {
  const store = await readDesignFeedbackStore(input.memoryDir)
  const selectedFeedback = store.ownerFeedback
    .filter(feedback =>
      input.feedbackIds?.length
        ? input.feedbackIds.includes(feedback.id)
        : feedback.status === 'accepted',
    )
  if (selectedFeedback.length === 0) {
    throw new Error('No accepted owner design feedback is available for a decision packet.')
  }
  const findingIds = selectedFeedback.map(feedback => `finding-${feedback.id}`)
  const decisionIds = store.decisions
    .filter(decision => decision.findingIds.some(id => findingIds.includes(id)))
    .map(decision => decision.id)
  const constraints = selectedFeedback.map(renderOwnerFeedbackConstraint)
  const reviewChecklist = buildOwnerFeedbackReviewChecklist(selectedFeedback)
  const now = new Date().toISOString()
  const packet = DesignDecisionPacket.parse({
    id: `design-decision-packet-${slugTimestamp(now)}`,
    feedbackIds: selectedFeedback.map(feedback => feedback.id).sort(),
    decisionIds: decisionIds.sort(),
    summary: `${selectedFeedback.length} accepted owner design feedback item${selectedFeedback.length === 1 ? '' : 's'} ready for implementation/review.`,
    constraints,
    reviewChecklist,
    workerContext: renderWorkerContext(selectedFeedback, constraints, reviewChecklist),
    createdAt: now,
    updatedAt: now,
  })
  await writeDesignFeedbackStore(input.memoryDir, {
    ...store,
    decisionPackets: upsert(store.decisionPackets, packet),
  })
  return packet
}

export function classifyDesignFinding(input: DesignFindingClassificationInput): DesignFindingClassification {
  const text = `${input.dimension} ${input.summary}`.toLowerCase()
  if (input.designSystem && /fail|broken|defect|story|storybook|documented|does not/.test(text)) {
    return 'design-system-defect'
  }
  if (/radius|token|semantic lever|scale|density|spacing|motion|contrast/.test(text)) {
    return 'token-system-gap'
  }
  if (/rubric|guidance|taste|palette guidance|example|fashion|trend/.test(text)) {
    return 'taste-guidance-gap'
  }
  if (/third[- ]party|dependency|package|library|bespoke|replace|remove|overhead|bundle|virtuali[sz]ation|positioning|combobox|autocomplete|typeahead|architecture|pivot/.test(text)) {
    return 'architecture-opportunity'
  }
  if (/component|recipe|primitive|segmented|filter|button|toggle|control|pattern|state/.test(text)) {
    return 'reusable-pattern'
  }
  return 'project-specific'
}

function ownerFeedbackEvidenceRefs(feedback: OwnerDesignFeedback): DesignEvidenceRef[] {
  const refs: DesignEvidenceRef[] = []
  if (feedback.target.artifactId) refs.push({ kind: 'artifact', ref: feedback.target.artifactId, summary: 'Rendered direction or proof artifact' })
  if (feedback.target.directionId) refs.push({ kind: 'direction', ref: feedback.target.directionId, summary: 'Rendered design direction' })
  if (feedback.target.screenshotRef) refs.push({ kind: 'screenshot', ref: feedback.target.screenshotRef, summary: 'Owner feedback screenshot target' })
  if (feedback.target.selector) refs.push({ kind: 'selector', ref: feedback.target.selector, summary: 'DOM selector target' })
  if (feedback.target.componentName) refs.push({ kind: 'component', ref: feedback.target.componentName, summary: 'Component target' })
  if (feedback.target.viewport) refs.push({ kind: 'viewport', ref: feedback.target.viewport, summary: 'Viewport target' })
  if (feedback.target.coordinates) {
    refs.push({
      kind: 'coordinates',
      ref: `${feedback.target.coordinates.x},${feedback.target.coordinates.y}`,
      summary: 'Screenshot coordinate target',
    })
  }
  return refs
}

function renderOwnerFeedbackConstraint(feedback: OwnerDesignFeedback): string {
  const target = [
    feedback.target.componentName,
    feedback.target.selector,
    feedback.target.viewport,
  ].filter(Boolean).join(' · ')
  return target ? `${feedback.summary} (${target})` : feedback.summary
}

function buildOwnerFeedbackReviewChecklist(feedback: OwnerDesignFeedback[]): string[] {
  const checklist = new Set<string>(['Verify accepted owner feedback is reflected in the UI.'])
  const tags = new Set(feedback.flatMap(item => item.rationaleTags))
  if (tags.has('better-controls')) checklist.add('Verify better control semantics.')
  if (tags.has('clearer-hierarchy')) checklist.add('Verify hierarchy and scan path.')
  if (tags.has('color') || tags.has('warmer') || tags.has('calmer')) checklist.add('Verify palette rationale and mood fit.')
  if (tags.has('spacing') || tags.has('denser')) checklist.add('Verify density and spacing.')
  if (tags.has('accessibility')) checklist.add('Verify accessibility impact.')
  if (tags.has('typography')) checklist.add('Verify type scale and readability.')
  if (tags.has('motion')) checklist.add('Verify motion behavior and reduced-motion fallback.')
  return [...checklist]
}

function renderWorkerContext(
  feedback: OwnerDesignFeedback[],
  constraints: string[],
  reviewChecklist: string[],
): string {
  return [
    'Accepted design feedback:',
    ...feedback.map(item => `- ${item.id}: ${item.summary}`),
    '',
    'Constraints:',
    ...constraints.map(item => `- ${item}`),
    '',
    'Review checklist:',
    ...reviewChecklist.map(item => `- ${item}`),
  ].join('\n')
}

function slugTimestamp(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function writeDesignFeedbackStore(memoryDir: string, store: DesignFeedbackStore): Promise<void> {
  await fsp.mkdir(memoryDir, { recursive: true })
  const file = path.join(memoryDir, DESIGN_FEEDBACK_FILE)
  const tmp = `${file}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(DesignFeedbackStore.parse(store), null, 2)}\n`, 'utf-8')
  await fsp.rename(tmp, file)
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return [...items.filter((existing) => existing.id !== item.id), item]
    .sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeDesignSystemTargetPackage(finding: DesignFinding): DesignSystemImprovement['targetPackage'] {
  const target = finding.targetPackage?.toLowerCase()
  if (target === 'tokens' || target === 'core' || target === 'layout' || target === 'storybook' || target === 'docs' || target === 'rubric') {
    return target
  }
  if (target === 'react' || target === 'vue' || target === 'svelte' || target === 'adapter') return 'adapter'
  const text = `${finding.dimension} ${finding.summary}`.toLowerCase()
  if (/interaction|component|recipe|primitive|segmented|filter|button|toggle|control|state/.test(text)) return 'core'
  if (/token|radius|color|palette|spacing|motion|contrast/.test(text)) return 'tokens'
  if (/story|storybook|state matrix/.test(text)) return 'storybook'
  if (/doc|guidance/.test(text)) return 'docs'
  if (/rubric|review/.test(text)) return 'rubric'
  if (/layout|grid|stack|cluster/.test(text)) return 'layout'
  return 'core'
}
