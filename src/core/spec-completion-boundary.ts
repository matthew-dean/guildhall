import { StructuredSpec } from './structured-spec.js'

export interface SpecCompletionBoundaryAssessment {
  structuredSpecValid: boolean
  briefComplete: boolean
  acceptanceCriteriaPresent: boolean
  structuredAcceptanceCriteriaPresent: boolean
  ok: boolean
}

/**
 * The minimum typed contract required before an owner can approve a spec.
 * Both rich task paths and compact read models use this assessment; rendered
 * Markdown remains display material rather than an execution contract.
 */
export function assessSpecCompletionBoundary(input: {
  structuredSpec?: unknown
  productBrief?: { userJob?: unknown; successMetric?: unknown } | null
  acceptanceCriteria?: unknown
}): SpecCompletionBoundaryAssessment {
  const structured = StructuredSpec.safeParse(input.structuredSpec)
  const structuredSpecValid = structured.success
  const briefComplete = typeof input.productBrief?.userJob === 'string' && input.productBrief.userJob.trim().length > 0 &&
    typeof input.productBrief?.successMetric === 'string' && input.productBrief.successMetric.trim().length > 0
  const acceptanceCriteriaPresent = Array.isArray(input.acceptanceCriteria) && input.acceptanceCriteria.length > 0
  const structuredAcceptanceCriteriaPresent = structured.success && structured.data.acceptanceCriteria.length > 0
  return {
    structuredSpecValid,
    briefComplete,
    acceptanceCriteriaPresent,
    structuredAcceptanceCriteriaPresent,
    ok: structuredSpecValid && briefComplete && acceptanceCriteriaPresent && structuredAcceptanceCriteriaPresent,
  }
}
