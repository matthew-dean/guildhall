import { AcceptanceCriteria, type AcceptanceCriteria as AcceptanceCriterion } from './task.js'

export function parseAcceptanceCriteriaFromSpec(spec: string | undefined): AcceptanceCriterion[] {
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
      ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
      ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
      met: false,
    }))
}
