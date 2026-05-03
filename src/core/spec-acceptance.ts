import { AcceptanceCriteria, type AcceptanceCriteria as AcceptanceCriterion } from './task.js'

export function parseAcceptanceCriteriaFromSpec(spec: string | undefined): AcceptanceCriterion[] {
  if (typeof spec !== 'string' || spec.trim() === '') return []

  const lines = spec.split(/\r?\n/)
  const criteria: string[] = []
  let inSection = false
  let current: string | null = null

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
      current = numbered[1]!.trim()
      continue
    }

    if (current) current = `${current} ${line}`.trim()
  }

  if (current) criteria.push(current)

  return criteria
    .map((description, index) => AcceptanceCriteria.parse({
      id: `ac-${index + 1}`,
      description,
      verifiedBy: 'review',
      met: false,
    }))
}
