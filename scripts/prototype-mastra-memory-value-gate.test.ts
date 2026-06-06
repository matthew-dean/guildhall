import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import {
  buildMastraPrototypeCommand,
  createMastraMemoryProbe,
  evaluateMastraValueGate,
  mastraPrototypeDefaults,
  prototypeFixtures,
} from './prototype-mastra-memory-value-gate.mjs'

describe('Mastra memory value gate', () => {
  it('runs a TypeScript-native Mastra prototype without Python or external services', () => {
    const command = buildMastraPrototypeCommand({
      out: 'artifacts/memory-core-prototype/mastra-value-gate.json',
    })

    expect(command.bin).toBe('node')
    expect(command.args).toContain('scripts/prototype-mastra-memory-value-gate.mjs')
    expect(command.args).toContain('--out')
    expect(command.args).toContain('artifacts/memory-core-prototype/mastra-value-gate.json')
    expect(command.requiredPackages).toEqual([
      '@mastra/core',
      '@mastra/libsql',
      '@mastra/memory',
    ])
    expect(command.args.join(' ')).not.toMatch(/\bpython\b|uv|docker|podman/i)
  })

  it('instantiates real Mastra memory against system-local libSQL storage', async () => {
    const storageRoot = join('/tmp', 'guildhall-mastra-value-gate')
    const probe = await createMastraMemoryProbe({ storageRoot })

    expect(probe.packageVersions['@mastra/memory']).toMatch(/^\d+\.\d+\.\d+/)
    expect(probe.packageVersions['@mastra/libsql']).toMatch(/^\d+\.\d+\.\d+/)
    expect(probe.thread).toMatchObject({
      id: 'guildhall-mastra-value-gate-thread',
      resourceId: 'project:guildhall:mastra-value-gate',
    })
    expect(probe.storagePath).toBe(join(storageRoot, 'memory', mastraPrototypeDefaults.databaseFile))
    expect(probe.storagePath).not.toContain('/.guildhall/')
    expect(probe.features).toEqual(expect.arrayContaining([
      'libsql-storage',
      'thread-resource-scope',
      'read-only-mode',
      'observational-memory-capable',
    ]))
  })

  it('keeps prototype storage system-local and evaluates live-value gates', () => {
    const storageRoot = join('/tmp', 'guildhall-mastra-value-gate')
    const report = evaluateMastraValueGate({
      storageRoot,
      fixtures: prototypeFixtures,
      baselinePackets: [
        {
          fixtureId: 'fair-labor-license',
          purpose: 'current_blockers',
          byteEstimate: 2400,
          sourceRefCount: 1,
          relevantFacts: ['blocked auth provider', 'stale review verdicts'],
        },
      ],
      mastraPackets: [
        {
          fixtureId: 'fair-labor-license',
          purpose: 'current_blockers',
          byteEstimate: 1200,
          sourceRefCount: 3,
          relevantFacts: ['blocked auth provider', 'stale review verdicts', 'current owner input'],
          observationCount: 2,
        },
      ],
    })

    expect(report.decision).toBe('adopt')
    expect(report.reason).toMatch(/beats deterministic baseline/i)
    expect(report.storage.defaultPath).toBe(join(storageRoot, 'memory', mastraPrototypeDefaults.databaseFile))
    expect(report.storage.repoLocalWrites).toEqual([])
    expect(report.gates).toMatchObject({
      actuallyIntegrated: true,
      systemLocalStorage: true,
      substrateOnly: true,
      sourceRefsPreserved: true,
      betterThanBaseline: true,
      failureFallback: true,
    })
  })

  it('defers Mastra when packet quality does not beat the deterministic baseline', () => {
    const report = evaluateMastraValueGate({
      storageRoot: '/tmp/guildhall-mastra-value-gate',
      fixtures: prototypeFixtures,
      baselinePackets: [
        {
          fixtureId: 'looma-knit',
          purpose: 'next_worker_context',
          byteEstimate: 1500,
          sourceRefCount: 3,
          relevantFacts: ['delivery queue', 'owner blocker', 'proof path'],
        },
      ],
      mastraPackets: [
        {
          fixtureId: 'looma-knit',
          purpose: 'next_worker_context',
          byteEstimate: 1800,
          sourceRefCount: 1,
          relevantFacts: ['delivery queue'],
          observationCount: 1,
        },
      ],
    })

    expect(report.decision).toBe('defer')
    expect(report.reason).toMatch(/does not beat deterministic baseline/i)
    expect(report.gates.betterThanBaseline).toBe(false)
  })
})
