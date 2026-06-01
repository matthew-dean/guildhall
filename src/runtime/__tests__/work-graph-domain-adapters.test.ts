import { describe, expect, it } from 'vitest'
import { genericWorkGraphDomainAdapter } from '../work-graph-domain-adapters.js'

describe('work graph domain adapters', () => {
  it('does not inject sample product names into generic UI component proof', () => {
    const proof = genericWorkGraphDomainAdapter.proofPaths({
      name: 'Reusable confirmation primitive',
      targetArea: 'design-system',
      workShape: 'ui-component',
      consumerSurfaces: ['admin destructive confirmation flow'],
      sharedFoundations: ['tokens'],
      statusHint: 'missing',
    })
    const serialized = JSON.stringify(proof)
    expect(serialized).not.toMatch(/Looma|Knit|AlertDialog/)
    expect(serialized).toContain('design-system')
  })

  it('uses consumer metadata without renaming it to a known app', () => {
    const label = genericWorkGraphDomainAdapter.primaryConsumerSurface({
      name: 'Saved filter drawer',
      targetArea: 'task-board',
      workShape: 'ui-component',
      consumerSurfaces: ['mobile navigation drawer'],
      sharedFoundations: [],
      statusHint: 'missing',
    })
    expect(label).toBe('mobile navigation drawer')
  })
})
