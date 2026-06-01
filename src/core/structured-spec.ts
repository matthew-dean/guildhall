import { z } from 'zod'

function cleanedString(label: string): z.ZodType<string, z.ZodTypeDef, unknown> {
  return z.string().transform((value) => value.trim()).refine((value) => value.length > 0, {
    message: `${label} is required.`,
  })
}

function cleanedStringList(label: string): z.ZodType<string[], z.ZodTypeDef, unknown> {
  return z.array(z.string())
    .transform((values) => values.map((value) => value.trim()).filter(Boolean))
    .refine((values) => values.length > 0, {
      message: `${label} must include at least one item.`,
    })
}

export const StructuredSpecCompletionBoundary = z.object({
  productOutcome: cleanedString('Completion Boundary productOutcome'),
  whatGuildhallCanCompleteInCode: cleanedString('Completion Boundary whatGuildhallCanCompleteInCode'),
  externalDependencies: cleanedString('Completion Boundary externalDependencies'),
  ownerOnlySetup: cleanedString('Completion Boundary ownerOnlySetup'),
  verificationEnvironment: cleanedString('Completion Boundary verificationEnvironment'),
  whatCountsAsDone: cleanedString('Completion Boundary whatCountsAsDone'),
  whatMustBeSplitOrBlocked: cleanedString('Completion Boundary whatMustBeSplitOrBlocked'),
}).strict()
export type StructuredSpecCompletionBoundary = z.infer<typeof StructuredSpecCompletionBoundary>

export const StructuredSpec = z.object({
  whatThisIs: cleanedString('whatThisIs'),
  problemContext: cleanedString('problemContext'),
  goals: cleanedStringList('goals'),
  nonGoals: cleanedStringList('nonGoals'),
  proposedDesign: cleanedString('proposedDesign'),
  keyDecisions: cleanedStringList('keyDecisions'),
  acceptanceCriteria: cleanedStringList('acceptanceCriteria'),
  verification: cleanedStringList('verification'),
  completionBoundary: StructuredSpecCompletionBoundary,
  userFacingBehavior: cleanedString('userFacingBehavior').optional(),
  visualInteractionNotes: cleanedString('visualInteractionNotes').optional(),
  componentApiShape: cleanedString('componentApiShape').optional(),
  dataModelSchemaChanges: cleanedString('dataModelSchemaChanges').optional(),
  migrationRollout: cleanedString('migrationRollout').optional(),
  performanceReliabilitySecurity: cleanedString('performanceReliabilitySecurity').optional(),
  risksOpenQuestions: cleanedStringList('risksOpenQuestions').optional(),
  handoffSequence: cleanedStringList('handoffSequence').optional(),
}).strict()
export type StructuredSpec = z.infer<typeof StructuredSpec>

function renderBulletList(items: string[]): string[] {
  return items.map((item) => `- ${item}`)
}

function renderNumberedList(items: string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`)
}

function appendSection(parts: string[], title: string, body: string[]): void {
  if (body.length === 0) return
  parts.push(`## ${title}`, ...body, '')
}

export function renderStructuredSpecMarkdown(spec: StructuredSpec): string {
  const parts: string[] = []
  appendSection(parts, 'What this is', [spec.whatThisIs])
  appendSection(parts, 'Problem / Context', [spec.problemContext])
  appendSection(parts, 'Goals', renderBulletList(spec.goals))
  appendSection(parts, 'Non-goals', renderBulletList(spec.nonGoals))
  if (spec.userFacingBehavior) appendSection(parts, 'User-facing behavior', [spec.userFacingBehavior])
  if (spec.visualInteractionNotes) appendSection(parts, 'Visual / Interaction Notes', [spec.visualInteractionNotes])
  appendSection(parts, 'Proposed Design', [spec.proposedDesign])
  if (spec.componentApiShape) appendSection(parts, 'Component / API Shape', [spec.componentApiShape])
  if (spec.dataModelSchemaChanges) appendSection(parts, 'Data Model / Schema Changes', [spec.dataModelSchemaChanges])
  appendSection(parts, 'Key Decisions', renderBulletList(spec.keyDecisions))
  appendSection(parts, 'Acceptance Criteria', renderNumberedList(spec.acceptanceCriteria))
  appendSection(parts, 'Verification', renderBulletList(spec.verification))
  if (spec.migrationRollout) appendSection(parts, 'Migration / Rollout', [spec.migrationRollout])
  if (spec.performanceReliabilitySecurity) {
    appendSection(parts, 'Performance / Reliability / Security Considerations', [spec.performanceReliabilitySecurity])
  }
  if (spec.risksOpenQuestions?.length) appendSection(parts, 'Risks / Open Questions', renderBulletList(spec.risksOpenQuestions))
  if (spec.handoffSequence?.length) appendSection(parts, 'Handoff sequence', renderNumberedList(spec.handoffSequence))
  appendSection(parts, 'Completion Boundary', [
    `- Product outcome: ${spec.completionBoundary.productOutcome}`,
    `- What Guildhall can complete in code: ${spec.completionBoundary.whatGuildhallCanCompleteInCode}`,
    `- External dependencies: ${spec.completionBoundary.externalDependencies}`,
    `- Owner-only setup: ${spec.completionBoundary.ownerOnlySetup}`,
    `- Verification environment: ${spec.completionBoundary.verificationEnvironment}`,
    `- What counts as done: ${spec.completionBoundary.whatCountsAsDone}`,
    `- What must be split or blocked: ${spec.completionBoundary.whatMustBeSplitOrBlocked}`,
  ])
  return parts.join('\n').trim()
}
