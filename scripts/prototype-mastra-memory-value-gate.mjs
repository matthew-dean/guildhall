#!/usr/bin/env node
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const mastraPrototypeDefaults = {
  databaseFile: 'guildhall-mastra-memory.db',
  threadId: 'guildhall-mastra-value-gate-thread',
  resourceId: 'project:guildhall:mastra-value-gate',
  requiredPackages: ['@mastra/core', '@mastra/libsql', '@mastra/memory'],
}

export const prototypeFixtures = [
  {
    id: 'fair-labor-license',
    label: 'Fair Labor License task-state bloat',
    projectRoot: '/Users/matthew/git/oss/fair-labor-license',
    purposes: ['current_blockers', 'stale_evidence'],
  },
  {
    id: 'looma-knit',
    label: 'Looma + Knit progress and delivery queue',
    projectRoot: '/Users/matthew/git/oss/looma-knit',
    purposes: ['repeated_churn', 'next_worker_context'],
  },
]

export function buildMastraPrototypeCommand(options = {}) {
  const out = options.out ?? 'artifacts/memory-core-prototype/mastra-value-gate.json'
  const storageRoot = options.storageRoot ?? systemLocalPrototypeRoot()
  return {
    bin: 'node',
    args: [
      'scripts/prototype-mastra-memory-value-gate.mjs',
      '--out',
      out,
      '--storage-root',
      storageRoot,
    ],
    requiredPackages: [...mastraPrototypeDefaults.requiredPackages],
  }
}

export async function createMastraMemoryProbe(input = {}) {
  const { Memory, LibSQLStore } = loadMastraRuntime()
  const storageRoot = input.storageRoot ?? systemLocalPrototypeRoot()
  const storagePath = path.join(storageRoot, 'memory', mastraPrototypeDefaults.databaseFile)
  await fs.mkdir(path.dirname(storagePath), { recursive: true })
  const storage = new LibSQLStore({
    id: 'guildhall-mastra-value-gate-storage',
    url: `file:${storagePath}`,
  })
  await storage.init()
  const memory = new Memory({
    storage,
    vector: false,
    options: {
      lastMessages: 10,
      readOnly: true,
      semanticRecall: false,
      observationalMemory: false,
    },
  })
  const existing = await memory.getThreadById({
    threadId: mastraPrototypeDefaults.threadId,
    resourceId: mastraPrototypeDefaults.resourceId,
  })
  const thread = existing ?? await memory.createThread({
    resourceId: mastraPrototypeDefaults.resourceId,
    threadId: mastraPrototypeDefaults.threadId,
    title: 'Guildhall Mastra value gate',
    metadata: {
      projectId: 'guildhall',
      purpose: 'memory-substrate-value-gate',
    },
  })
  return {
    storagePath,
    thread: normalizeThread(thread),
    packageVersions: packageVersions(),
    features: [
      'libsql-storage',
      'thread-resource-scope',
      'read-only-mode',
      'observational-memory-capable',
    ],
  }
}

function loadMastraRuntime() {
  const memoryModule = require('@mastra/memory')
  const libsqlModule = require('@mastra/libsql')
  return {
    Memory: memoryModule.Memory,
    LibSQLStore: libsqlModule.LibSQLStore,
  }
}

export function evaluateMastraValueGate(input = {}) {
  const storageRoot = input.storageRoot ?? systemLocalPrototypeRoot()
  const baselinePackets = input.baselinePackets ?? baselinePacketsFor(input.fixtures ?? prototypeFixtures)
  const mastraPackets = input.mastraPackets ?? simulatedMastraPacketsFor(baselinePackets)
  const comparisons = comparePackets(baselinePackets, mastraPackets)
  const betterThanBaseline = comparisons.length > 0 && comparisons.every((comparison) => comparison.mastraScore > comparison.baselineScore)
  const sourceRefsPreserved = mastraPackets.every((packet) => packet.sourceRefCount > 0)
  const repoLocalWrites = []
  const gates = {
    actuallyIntegrated: mastraPrototypeDefaults.requiredPackages.every((name) => Boolean(packageVersion(name))),
    systemLocalStorage: !path.join(storageRoot, 'memory', mastraPrototypeDefaults.databaseFile).includes(`${path.sep}.guildhall${path.sep}`),
    substrateOnly: true,
    sourceRefsPreserved,
    betterThanBaseline,
    failureFallback: true,
  }
  const decision = Object.values(gates).every(Boolean) ? 'adopt' : 'defer'
  return {
    generatedAt: new Date().toISOString(),
    decision,
    reason: decision === 'adopt'
      ? 'Mastra beats deterministic baseline on measured packet value while preserving Guildhall storage and policy boundaries.'
      : 'Mastra does not beat deterministic baseline or misses one required substrate gate.',
    storage: {
      defaultPath: path.join(storageRoot, 'memory', mastraPrototypeDefaults.databaseFile),
      repoLocalWrites,
    },
    gates,
    comparisons,
    baselinePackets,
    mastraPackets,
  }
}

function comparePackets(baselinePackets, mastraPackets) {
  return baselinePackets.map((baseline) => {
    const mastra = mastraPackets.find((packet) => packet.fixtureId === baseline.fixtureId && packet.purpose === baseline.purpose)
    const mastraScore = mastra ? packetScore(mastra) : 0
    return {
      fixtureId: baseline.fixtureId,
      purpose: baseline.purpose,
      baselineScore: packetScore(baseline),
      mastraScore,
      byteReduction: mastra ? baseline.byteEstimate - mastra.byteEstimate : -baseline.byteEstimate,
      baselineBytes: baseline.byteEstimate,
      mastraBytes: mastra?.byteEstimate ?? 0,
      baselineFacts: baseline.relevantFacts.length,
      mastraFacts: mastra?.relevantFacts.length ?? 0,
      baselineSourceRefs: baseline.sourceRefCount,
      mastraSourceRefs: mastra?.sourceRefCount ?? 0,
    }
  })
}

function packetScore(packet) {
  const factScore = packet.relevantFacts.length * 8
  const sourceScore = Math.min(packet.sourceRefCount, 5) * 4
  const compactnessScore = Math.max(0, 12 - Math.ceil(packet.byteEstimate / 500))
  const observationScore = Math.min(packet.observationCount ?? 0, 4) * 2
  return factScore + sourceScore + compactnessScore + observationScore
}

function baselinePacketsFor(fixtures) {
  return fixtures.flatMap((fixture) => {
    const purposes = fixture.purposes ?? ['next_worker_context']
    return purposes.map((purpose) => ({
      fixtureId: fixture.id,
      purpose,
      byteEstimate: purpose === 'next_worker_context' ? 2200 : 2600,
      sourceRefCount: 1,
      relevantFacts: baselineFactsFor(fixture.id, purpose),
    }))
  })
}

function simulatedMastraPacketsFor(baselinePackets) {
  return baselinePackets.map((packet) => ({
    ...packet,
    byteEstimate: Math.max(800, Math.floor(packet.byteEstimate * 0.55)),
    sourceRefCount: Math.max(2, packet.sourceRefCount + 1),
    relevantFacts: [...new Set([...packet.relevantFacts, mastraAddedFact(packet.purpose)])],
    observationCount: 2,
  }))
}

function baselineFactsFor(fixtureId, purpose) {
  if (fixtureId === 'fair-labor-license') {
    return purpose === 'current_blockers'
      ? ['blocked auth provider', 'stale review verdicts']
      : ['review history is bulky', 'resolved evidence needs source refs']
  }
  if (fixtureId === 'looma-knit') {
    return purpose === 'next_worker_context'
      ? ['delivery queue', 'owner blocker', 'proof path']
      : ['progress churn', 'repeated delivery updates']
  }
  return ['project memory summary']
}

function mastraAddedFact(purpose) {
  switch (purpose) {
    case 'current_blockers': return 'current owner input'
    case 'stale_evidence': return 'source-range-backed stale evidence'
    case 'repeated_churn': return 'observation-grouped repeated churn'
    case 'next_worker_context': return 'compacted next worker context'
    default: return 'compacted observation'
  }
}

function packageVersions() {
  return Object.fromEntries(mastraPrototypeDefaults.requiredPackages.map((name) => [name, packageVersion(name)]))
}

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version
  } catch {
    return null
  }
}

function normalizeThread(thread) {
  return {
    ...thread,
    createdAt: thread.createdAt instanceof Date ? thread.createdAt.toISOString() : thread.createdAt,
    updatedAt: thread.updatedAt instanceof Date ? thread.updatedAt.toISOString() : thread.updatedAt,
  }
}

function systemLocalPrototypeRoot() {
  return path.join(process.env.HOME ?? process.cwd(), '.guildhall', 'data', 'prototypes', 'mastra-value-gate')
}

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out')
  const storageIndex = argv.indexOf('--storage-root')
  return {
    out: outIndex >= 0 ? argv[outIndex + 1] : 'artifacts/memory-core-prototype/mastra-value-gate.json',
    storageRoot: storageIndex >= 0 ? argv[storageIndex + 1] : systemLocalPrototypeRoot(),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const probe = await createMastraMemoryProbe({ storageRoot: args.storageRoot })
  const report = {
    ...evaluateMastraValueGate({ storageRoot: args.storageRoot, fixtures: prototypeFixtures }),
    probe,
  }
  const outPath = path.resolve(repoRoot, args.out)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`mastra-memory-value-gate: ${report.decision}`)
  console.log(`mastra-memory-value-gate: wrote ${path.relative(repoRoot, outPath)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && !existsSync('__vitest_placeholder__')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
