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

function cleanedFlexibleStringList(label: string): z.ZodType<string[], z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    if (!Array.isArray(value)) return value
    return value.map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const record = item as Record<string, unknown>
      const risk = typeof record.risk === 'string' ? record.risk.trim() : ''
      const mitigation = typeof record.mitigation === 'string' ? record.mitigation.trim() : ''
      const question = typeof record.question === 'string' ? record.question.trim() : ''
      const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
      if (risk && mitigation) return `${risk} - Mitigation: ${mitigation}`
      if (risk) return risk
      if (question) return question
      if (detail) return detail
      return Object.entries(record)
        .filter(([, entryValue]) => typeof entryValue === 'string' && entryValue.trim().length > 0)
        .map(([entryKey, entryValue]) => `${entryKey}: ${(entryValue as string).trim()}`)
        .join('; ')
    })
  }, cleanedStringList(label))
}

function parseStructuredAcceptanceCriterionDescription(description: string): { scenario: string; expectation: string } {
  const normalized = description.trim().replace(/\s+/g, ' ')
  const gwtMatch = /^given\s+(.+?),\s*when\s+(.+?),\s*then\s+(.+)$/i.exec(normalized)
  if (gwtMatch) {
    return {
      scenario: `Given ${gwtMatch[1]!.trim()}, when ${gwtMatch[2]!.trim()}`,
      expectation: `Then ${gwtMatch[3]!.trim()}`,
    }
  }
  return { scenario: normalized, expectation: normalized }
}

export const StructuredAcceptanceCriterion = z.preprocess((value) => {
  if (typeof value === 'string') {
    const parsed = parseStructuredAcceptanceCriterionDescription(value)
    return {
      scenario: parsed.scenario,
      expectation: parsed.expectation,
      verificationMode: 'review',
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in value) {
    const { id: _id, ...criterion } = value as Record<string, unknown>
    return criterion
  }
  return value
}, z.object({
  scenario: cleanedString('Acceptance criterion scenario'),
  expectation: cleanedString('Acceptance criterion expectation'),
  verificationMode: z.enum(['automated', 'review', 'human']),
  evidenceHint: cleanedString('Acceptance criterion evidenceHint').optional(),
  negativeCase: cleanedString('Acceptance criterion negativeCase').optional(),
  expectedExit: z.enum(['zero', 'non_zero']).optional(),
  expectedOutputIncludes: z.array(z.string()).optional(),
  command: cleanedString('Acceptance criterion command').optional(),
}).strict())
export type StructuredAcceptanceCriterion = z.infer<typeof StructuredAcceptanceCriterion>

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

export const StructuredSpecContractSurfaceDelta = z.object({
  surfaceId: cleanedString('Contract surface delta surfaceId').optional(),
  proposedSurfaceLabel: cleanedString('Contract surface delta proposedSurfaceLabel').optional(),
  relation: z.enum(['consumes', 'extends', 'amends', 'deprecates', 'replaces']),
  summary: cleanedString('Contract surface delta summary'),
  invariantRefs: z.array(z.string()).optional(),
  proposedInvariants: z.array(z.object({
    id: cleanedString('Contract surface delta proposed invariant id').optional(),
    label: cleanedString('Contract surface delta proposed invariant label'),
    rule: cleanedString('Contract surface delta proposed invariant rule'),
    reason: cleanedString('Contract surface delta proposed invariant reason'),
    proofObligations: z.array(z.string()).optional(),
  }).strict()).optional(),
  breakingChange: z.boolean().optional(),
  affectedConsumerRefs: z.array(z.string()).optional(),
  proofObligations: cleanedStringList('Contract surface delta proofObligations'),
  migrationNotes: cleanedString('Contract surface delta migrationNotes').optional(),
}).strict()
export type StructuredSpecContractSurfaceDelta = z.infer<typeof StructuredSpecContractSurfaceDelta>

export const StructuredSpec = z.object({
  whatThisIs: cleanedString('whatThisIs'),
  problemContext: cleanedString('problemContext'),
  goals: cleanedStringList('goals'),
  nonGoals: cleanedStringList('nonGoals'),
  proposedDesign: cleanedString('proposedDesign'),
  keyDecisions: cleanedStringList('keyDecisions'),
  contractSurfaceDeltas: z.array(StructuredSpecContractSurfaceDelta).optional(),
  acceptanceCriteria: z.array(StructuredAcceptanceCriterion)
    .refine((values) => values.length > 0, { message: 'acceptanceCriteria must include at least one item.' }),
  verification: cleanedStringList('verification'),
  completionBoundary: StructuredSpecCompletionBoundary,
  userFacingBehavior: cleanedString('userFacingBehavior').optional(),
  visualInteractionNotes: cleanedString('visualInteractionNotes').optional(),
  componentApiShape: cleanedString('componentApiShape').optional(),
  dataModelSchemaChanges: cleanedString('dataModelSchemaChanges').optional(),
  migrationRollout: cleanedString('migrationRollout').optional(),
  performanceReliabilitySecurity: cleanedString('performanceReliabilitySecurity').optional(),
  risksOpenQuestions: cleanedFlexibleStringList('risksOpenQuestions').optional(),
  handoffSequence: cleanedStringList('handoffSequence').optional(),
}).strict()
export type StructuredSpec = z.infer<typeof StructuredSpec>

function renderBulletList(items: string[]): string[] {
  return items.map((item) => `- ${item}`)
}

function renderNumberedList(items: string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`)
}

function renderAcceptanceCriteria(items: StructuredAcceptanceCriterion[]): string[] {
  return items.flatMap((item, index) => {
    const lines = [
      `${index + 1}. Scenario: ${item.scenario}`,
      `   Expectation: ${item.expectation}`,
      `   Verification: ${item.verificationMode}`,
    ]
    if (item.command) lines.push(`   Command: ${item.command}`)
    if (item.expectedExit) lines.push(`   Expected exit: ${item.expectedExit}`)
    if (item.expectedOutputIncludes?.length) {
      lines.push(`   Expected output includes: ${item.expectedOutputIncludes.join(' | ')}`)
    }
    if (item.evidenceHint) lines.push(`   Evidence hint: ${item.evidenceHint}`)
    if (item.negativeCase) lines.push(`   Negative case: ${item.negativeCase}`)
    return lines
  })
}

function renderContractSurfaceDeltas(items: StructuredSpecContractSurfaceDelta[]): string[] {
  return items.flatMap((item) => {
    const surface = item.surfaceId ?? item.proposedSurfaceLabel ?? 'Unspecified surface'
    const lines = [
      `- Surface: ${surface}`,
      `  Relation: ${item.relation}`,
      `  Summary: ${item.summary}`,
      `  Proof obligations: ${item.proofObligations.join('; ')}`,
    ]
    if (item.invariantRefs?.length) lines.push(`  Existing invariants: ${item.invariantRefs.join(', ')}`)
    for (const proposed of item.proposedInvariants ?? []) {
      lines.push(`  Proposed invariant: ${proposed.label} - ${proposed.rule}`)
    }
    if (item.migrationNotes) lines.push(`  Migration notes: ${item.migrationNotes}`)
    return lines
  })
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
  if (spec.contractSurfaceDeltas?.length) appendSection(parts, 'Contract Surface Deltas', renderContractSurfaceDeltas(spec.contractSurfaceDeltas))
  appendSection(parts, 'Acceptance Criteria', renderAcceptanceCriteria(spec.acceptanceCriteria))
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
