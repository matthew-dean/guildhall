import { AcceptanceCriteria, type AcceptanceCriteria as AcceptanceCriterion } from './task.js'
import type { StructuredSpec } from './structured-spec.js'

/**
 * Convert the machine-authored acceptance contract into the legacy task
 * evidence shape. The structured payload is authoritative; the Markdown
 * renderer is deliberately not read back to reconstruct this state.
 */
export function acceptanceCriteriaFromStructuredSpec(spec: StructuredSpec | undefined): AcceptanceCriterion[] {
  if (!spec) return []
  return spec.acceptanceCriteria.map((criterion, index) => AcceptanceCriteria.parse({
    id: `ac-${index + 1}`,
    description: `${criterion.scenario} ${criterion.expectation}`.trim(),
    scenario: criterion.scenario,
    expectation: criterion.expectation,
    verifiedBy: criterion.verificationMode,
    ...(criterion.command ? { command: criterion.command } : {}),
    ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
    ...(criterion.expectedOutputIncludes ? { expectedOutputIncludes: criterion.expectedOutputIncludes } : {}),
    ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
    ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
    ...(criterion.sourceCapabilityIds ? { sourceCapabilityIds: criterion.sourceCapabilityIds } : {}),
    met: false,
  }))
}

/**
 * One-way migration helper for pre-structured task records. This is not a
 * planning or execution API: rendered Markdown must never be read back as
 * authoritative state after migration.
 */
export function migrateLegacyAcceptanceCriteriaFromMarkdown(spec: string | undefined): AcceptanceCriterion[] {
  if (typeof spec !== 'string' || spec.trim() === '') return []

  const lines = spec.split(/\r?\n/)
  const criteria: Array<Record<string, string>> = []
  let inSection = false
  let current: Record<string, string> | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!inSection) {
      if (/^##+\s+Acceptance Criteria\s*$/i.test(line)) inSection = true
      continue
    }

    if (/^##+\s+\S/.test(line)) break
    if (line === '') continue

    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (numbered) {
      if (current) criteria.push(current)
      const firstLine = numbered[1]!.trim()
      const scenarioMatch = /^scenario:\s*(.+)$/i.exec(firstLine)
      current = scenarioMatch
        ? { scenario: scenarioMatch[1]!.trim() }
        : { description: firstLine }
      continue
    }

    if (!current) continue
    const expectationMatch = /^expectation:\s*(.+)$/i.exec(line)
    if (expectationMatch) {
      current.expectation = expectationMatch[1]!.trim()
      continue
    }
    const verificationMatch = /^verification:\s*(.+)$/i.exec(line)
    if (verificationMatch) {
      current.verifiedBy = verificationMatch[1]!.trim().toLowerCase()
      continue
    }
    const commandMatch = /^command:\s*(.+)$/i.exec(line)
    if (commandMatch) {
      current.command = commandMatch[1]!.trim()
      continue
    }
    const expectedExitMatch = /^expected\s+exit(?:\s+code)?:\s*(.+)$/i.exec(line)
    if (expectedExitMatch) {
      current.expectedExit = expectedExitMatch[1]!.trim().toLowerCase().replace(/[ -]+/g, '_')
      continue
    }
    const expectedOutputMatch = /^(?:expected\s+output\s+includes|output\s+includes):\s*(.+)$/i.exec(line)
    if (expectedOutputMatch) {
      current.expectedOutputIncludes = expectedOutputMatch[1]!.trim()
      continue
    }
    const evidenceMatch = /^evidence hint:\s*(.+)$/i.exec(line)
    if (evidenceMatch) {
      current.evidenceHint = evidenceMatch[1]!.trim()
      continue
    }
    const negativeCaseMatch = /^negative case:\s*(.+)$/i.exec(line)
    if (negativeCaseMatch) {
      current.negativeCase = negativeCaseMatch[1]!.trim()
      continue
    }
    current.description = current.description
      ? `${current.description} ${line}`.trim()
      : line
  }

  if (current) criteria.push(current)

  return criteria
    .map((criterion, index) => AcceptanceCriteria.parse({
      id: `ac-${index + 1}`,
      description: criterion.description ?? [criterion.scenario, criterion.expectation].filter(Boolean).join(' '),
      ...(criterion.scenario ? { scenario: criterion.scenario } : {}),
      ...(criterion.expectation ? { expectation: criterion.expectation } : {}),
      verifiedBy: criterion.verifiedBy ?? 'review',
      ...(criterion.command ? { command: criterion.command } : {}),
      ...(criterion.expectedExit === 'zero' || criterion.expectedExit === 'non_zero'
        ? { expectedExit: criterion.expectedExit }
        : {}),
      ...(criterion.expectedOutputIncludes
        ? { expectedOutputIncludes: [criterion.expectedOutputIncludes] }
        : {}),
      ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
      ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
      met: false,
    }))
}
