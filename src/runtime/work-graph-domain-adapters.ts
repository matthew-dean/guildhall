export interface WorkGraphDomainUnit {
  name: string
  targetArea: string
  workShape: string
  consumerSurfaces: string[]
  sharedFoundations: string[]
  statusHint: 'missing' | 'shipped' | 'unknown'
}

export interface WorkGraphProofPath {
  kind: 'command' | 'review' | 'browser'
  command?: string
  expectedEvidence: string[]
  source?: 'documented' | 'inferred'
}

export interface WorkGraphDomainAdapter {
  id: string
  normalizeDeliverableName(value: string): string
  primaryConsumerSurface(unit: WorkGraphDomainUnit): string
  integrationTitle(unit: WorkGraphDomainUnit, consumerSurface: string): string
  integrationTargetArea(unit: WorkGraphDomainUnit, consumerSurface: string): string
  needsIntegrationTask(unit: WorkGraphDomainUnit): boolean
  proofPaths(unit: WorkGraphDomainUnit): WorkGraphProofPath[]
}

export const genericWorkGraphDomainAdapter: WorkGraphDomainAdapter = {
  id: 'generic',

  normalizeDeliverableName(value) {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    if (!trimmed) return trimmed
    if (/[A-Z]/.test(trimmed)) return trimmed
    if (trimmed.includes('-')) return trimmed
    return sentenceCase(trimmed)
  },

  primaryConsumerSurface(unit) {
    return unit.consumerSurfaces[0] ?? unit.targetArea
  },

  integrationTitle(unit, consumerSurface) {
    return `Integrate ${unit.name} into ${consumerSurface}`
  },

  integrationTargetArea(_unit, consumerSurface) {
    return consumerSurface
  },

  needsIntegrationTask(unit) {
    if (unit.statusHint === 'shipped' || unit.consumerSurfaces.length === 0) return false
    const consumers = unit.consumerSurfaces.join(' ').toLowerCase()
    if (unit.workShape === 'ui-component') {
      return /\b(app|application|flow|surface|page|view|consumer|navigation)\b/.test(consumers)
    }
    return /\b(admin|dashboard|settings page|client|integration|application)\b/.test(consumers)
  },

  proofPaths(unit) {
    const deliverableSlug = commandSlug(unit.name)
    if (unit.workShape === 'ui-component') {
      return [
        {
          kind: 'command',
          command: `pnpm test -- component-${deliverableSlug}`,
          expectedEvidence: [
            `${unit.name} component behavior is covered in ${unit.targetArea}.`,
            `${unit.name} reuses ${unit.sharedFoundations.join(', ') || 'named foundations'}.`,
          ],
          source: 'inferred',
        },
      ]
    }
    if (unit.workShape === 'backend-api') {
      return [
        {
          kind: 'command',
          command: `pnpm test -- integration-${deliverableSlug}`,
          expectedEvidence: [
            `${unit.name} exposes the requested API behavior with membership, permission, or tenancy checks.`,
          ],
          source: 'inferred',
        },
      ]
    }
    if (unit.workShape === 'cli-tool') {
      return [
        {
          kind: 'command',
          command: `pnpm test -- ${deliverableSlug}`,
          expectedEvidence: [
            `${unit.name} has stable command output fixture proof.`,
          ],
          source: 'inferred',
        },
      ]
    }
    if (unit.workShape === 'docs') {
      return [
        {
          kind: 'command',
          command: `pnpm docs:check -- ${deliverableSlug}`,
          expectedEvidence: [
            `${unit.name} passes the docs check or deterministic content review.`,
          ],
          source: 'inferred',
        },
      ]
    }
    if (unit.workShape === 'migration') {
      return [
        {
          kind: 'command',
          command: `pnpm test -- migration-${deliverableSlug}`,
          expectedEvidence: [
            `${unit.name} proves rollback or downgrade behavior.`,
            `${unit.name} validates the migrated data shape.`,
          ],
          source: 'inferred',
        },
      ]
    }
    if (unit.workShape === 'bugfix') {
      return [
        {
          kind: 'command',
          command: `pnpm test -- regression-${deliverableSlug}`,
          expectedEvidence: [
            `${unit.name} starts from a failing regression case and passes after the fix.`,
          ],
          source: 'inferred',
        },
      ]
    }
    if (unit.workShape === 'single-edit') {
      return [
        {
          kind: 'review',
          expectedEvidence: [
            `${unit.name} stays bounded to the named edit.`,
            `${unit.name} has focused diff or test proof.`,
          ],
          source: 'inferred',
        },
      ]
    }
    return [
      {
        kind: 'review',
        expectedEvidence: [
          `${unit.name} records focused implementation, verification, or reviewer evidence for ${unit.targetArea}.`,
          unit.sharedFoundations.length > 0
            ? `${unit.name} cites how ${unit.sharedFoundations.join(', ')} shaped the completed work.`
            : `${unit.name} cites the source material that shaped the completed work.`,
        ],
        source: 'inferred',
      },
    ]
  },
}

function commandSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sentenceCase(value: string): string {
  return value.split(/\s+/).map((word, index) => {
    const lower = word.toLowerCase()
    const acronym = normalizeAcronym(lower)
    if (acronym) return acronym
    return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
  }).join(' ')
}

function normalizeAcronym(value: string): string | undefined {
  if (['api', 'cli', 'id', 'json', 'ui', 'url', 'html', 'css'].includes(value)) {
    return value.toUpperCase()
  }
  return undefined
}
