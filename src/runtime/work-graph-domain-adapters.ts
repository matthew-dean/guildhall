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
    return [
      {
        kind: 'review',
        expectedEvidence: [
          `${unit.name} has a bounded proof plan for ${unit.targetArea}.`,
          `${unit.name} reuses ${unit.sharedFoundations.join(', ') || 'named foundations'}.`,
        ],
        source: 'inferred',
      },
    ]
  },
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
