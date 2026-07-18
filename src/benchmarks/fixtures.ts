import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BenchmarkOwnerQuestion } from './types.js'

export interface LifecycleFixture {
  id: string
  family:
    | 'shaping'
    | 'decomposition'
    | 'worker_scope'
    | 'review'
    | 'gate'
    | 'proof_path'
    | 'completion_handoff'
    | 'mcp_auditability'
    | 'memory_reuse'
  instruction: string
  expectedMetrics: Record<string, number>
  verificationCommands: string[]
  ownerQuestions: BenchmarkOwnerQuestion[]
}

export interface TbliteFixture {
  id: string
  instruction: string
  command: string[]
  verifier: string[]
  seedDir: string
  fixturePath: string
  expectedFiles: string[]
}

export interface ArtifactLocalFixture {
  id: string
  instruction: string
  issueRef: string
  verifier: string[]
  seedDir: string
  fixturePath: string
  expectedFiles: string[]
}

export interface SweLocalFixture {
  id: string
  instruction: string
  issueRef: string
  verifier: string[]
  seedDir: string
  fixturePath: string
  expectedFiles: string[]
}

interface RawFixtureFile {
  id?: string
  instruction?: string
  issueRef?: string
  command?: string[]
  verifier?: string[]
  expectedFiles?: string[]
}

const evidence = {
  id: 'fixture-request',
  kind: 'fixture' as const,
  summary: 'Smoke fixture contains enough context to choose the default path.',
  ref: 'internal/benchmarks/lifecycle-smoke.json',
}

export const lifecycleSmokeFixtures: LifecycleFixture[] = [
  {
    id: 'shape-ambiguous-request',
    family: 'shaping',
    instruction: 'Turn a vague UI quality complaint into a concrete task without asking the owner to choose a Guildhall process.',
    expectedMetrics: { task_success: 1, split_quality: 1, unnecessary_questions: 0, auditability: 1 },
    verificationCommands: ['verify:intake-shape'],
    ownerQuestions: [{
      id: 'q-output-form',
      taskId: 'shape-ambiguous-request',
      prompt: 'Should Guildhall produce a short task spec or start coding immediately?',
      choices: [
        { id: 'spec-first', label: 'Produce a short task spec first' },
        { id: 'code-now', label: 'Start coding immediately' },
      ],
      recommendedAnswer: {
        choiceId: 'spec-first',
        confidence: 'high',
        reason: 'The request is ambiguous enough that a short spec protects intent without making the owner choose process.',
        risk: 'Coding immediately could optimize for the wrong visible behavior.',
        evidenceRefs: [evidence],
        decisionImpacts: [],
      },
      nonDelegable: false,
    }],
  },
  {
    id: 'proof-ui-change',
    family: 'proof_path',
    instruction: 'Require screenshot or DOM evidence for a user-facing UI change before completion.',
    expectedMetrics: { proof_completeness: 1, false_success: 0, handoff_quality: 1 },
    verificationCommands: ['verify:proof-path'],
    ownerQuestions: [],
  },
  {
    id: 'split-feature-work',
    family: 'decomposition',
    instruction: 'Split a broad feature request into coherent nested work without exposing arbitrary parent-task jargon.',
    expectedMetrics: { split_quality: 1, unnecessary_questions: 0, auditability: 1 },
    verificationCommands: ['verify:work-hierarchy'],
    ownerQuestions: [],
  },
  {
    id: 'worker-scope-discipline',
    family: 'worker_scope',
    instruction: 'Keep implementation inside the accepted task scope and record out-of-scope follow-up candidates separately.',
    expectedMetrics: { task_success: 1, false_success: 0, proof_completeness: 1 },
    verificationCommands: ['verify:scope-diff'],
    ownerQuestions: [],
  },
  {
    id: 'review-catches-ui-control-mismatch',
    family: 'review',
    instruction: 'Reviewer catches a functional-but-wrong control choice and asks for a better interaction pattern.',
    expectedMetrics: { task_success: 1, false_success: 0, proof_completeness: 1 },
    verificationCommands: ['verify:review-finding'],
    ownerQuestions: [],
  },
  {
    id: 'gate-rejects-missing-evidence',
    family: 'gate',
    instruction: 'Gate checker rejects a task that claims completion without required automated and visual proof.',
    expectedMetrics: { false_success: 0, proof_completeness: 1, auditability: 1 },
    verificationCommands: ['verify:gate-evidence'],
    ownerQuestions: [],
  },
  {
    id: 'completion-handoff-truthful',
    family: 'completion_handoff',
    instruction: 'Completion handoff names what changed, what passed, what remains uncertain, and what the owner can do next.',
    expectedMetrics: { handoff_quality: 1, auditability: 1 },
    verificationCommands: ['verify:handoff'],
    ownerQuestions: [],
  },
  {
    id: 'mcp-auditability-without-shell',
    family: 'mcp_auditability',
    instruction: 'MCP resources can explain benchmark state, runtime evidence, proof, and memory without raw shell reads.',
    expectedMetrics: { auditability: 1, proof_completeness: 1 },
    verificationCommands: ['verify:mcp-audit'],
    ownerQuestions: [],
  },
  {
    id: 'reuse-accepted-memory',
    family: 'memory_reuse',
    instruction: 'Reuse accepted design feedback while keeping proposed memory inert.',
    expectedMetrics: { memory_precision: 1, auditability: 1 },
    verificationCommands: ['verify:memory-context'],
    ownerQuestions: [],
  },
]

export function resolveBenchmarkFixtureRoot(baseDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const internal = findUpward(baseDir, path.join('internal', 'benchmarks', 'fixtures'))
  if (internal) return internal
  const bundled = findUpward(baseDir, path.join('benchmarks', 'fixtures'))
  if (bundled) return bundled
  throw new Error(`Could not resolve benchmark fixture root from ${baseDir}`)
}

function findUpward(baseDir: string, relativePath: string): string | null {
  let cursor = path.resolve(baseDir)
  while (true) {
    const candidate = path.join(cursor, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(cursor)
    if (parent === cursor) return null
    cursor = parent
  }
}

function readFixtureFile<T extends RawFixtureFile>(family: string, subset: string, dirName: string): T & {
  id: string
  instruction: string
  verifier?: string[]
  command?: string[]
  expectedFiles: string[]
  fixturePath: string
  seedDir: string
} {
  const fixtureRoot = resolveBenchmarkFixtureRoot()
  const fixturePath = path.join(fixtureRoot, family, subset, dirName, 'fixture.json')
  const seedDir = path.join(fixtureRoot, family, subset, dirName, 'seed')
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as T
  const id = raw.id?.trim() || dirName
  const instruction = raw.instruction?.trim()
  if (!instruction) throw new Error(`Fixture ${fixturePath} is missing "instruction".`)
  return {
    ...raw,
    id,
    instruction,
    expectedFiles: raw.expectedFiles ?? [],
    fixturePath,
    seedDir,
  }
}

function loadFixtureDirs(family: string, subset: string): string[] {
  const subsetDir = path.join(resolveBenchmarkFixtureRoot(), family, subset)
  return readdirSync(subsetDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

export function taskSubsetHash(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex').slice(0, 16)
}

export function lifecycleFixturesForSet(fixtureSet: string): LifecycleFixture[] {
  if (fixtureSet !== 'smoke') throw new Error(`Unknown lifecycle fixture set: ${fixtureSet}`)
  return lifecycleSmokeFixtures
}

export function tbliteFixturesForSubset(subset: string): TbliteFixture[] {
  return loadFixtureDirs('tblite', subset).map((dirName) => {
    const raw = readFixtureFile<{ command?: string[]; verifier?: string[] }>('tblite', subset, dirName)
    if (!raw.command?.length) throw new Error(`Fixture ${raw.fixturePath} is missing "command".`)
    if (!raw.verifier?.length) throw new Error(`Fixture ${raw.fixturePath} is missing "verifier".`)
    return {
      id: raw.id,
      instruction: raw.instruction,
      command: raw.command,
      verifier: raw.verifier,
      seedDir: raw.seedDir,
      fixturePath: raw.fixturePath,
      expectedFiles: raw.expectedFiles,
    }
  })
}

export function artifactLocalFixturesForSubset(subset: string): ArtifactLocalFixture[] {
  return loadFixtureDirs('artifact-local', subset).map((dirName) => {
    const raw = readFixtureFile<{ issueRef?: string; verifier?: string[] }>('artifact-local', subset, dirName)
    if (!raw.issueRef?.trim()) throw new Error(`Fixture ${raw.fixturePath} is missing "issueRef".`)
    if (!raw.verifier?.length) throw new Error(`Fixture ${raw.fixturePath} is missing "verifier".`)
    return {
      id: raw.id,
      instruction: raw.instruction,
      issueRef: raw.issueRef,
      verifier: raw.verifier,
      seedDir: raw.seedDir,
      fixturePath: raw.fixturePath,
      expectedFiles: raw.expectedFiles,
    }
  })
}

export function sweLocalFixturesForSubset(subset: string): SweLocalFixture[] {
  return loadFixtureDirs('swe-local', subset).map((dirName) => {
    const raw = readFixtureFile<{ issueRef?: string; verifier?: string[] }>('swe-local', subset, dirName)
    if (!raw.issueRef?.trim()) throw new Error(`Fixture ${raw.fixturePath} is missing "issueRef".`)
    if (!raw.verifier?.length) throw new Error(`Fixture ${raw.fixturePath} is missing "verifier".`)
    return {
      id: raw.id,
      instruction: raw.instruction,
      issueRef: raw.issueRef,
      verifier: raw.verifier,
      seedDir: raw.seedDir,
      fixturePath: raw.fixturePath,
      expectedFiles: raw.expectedFiles,
    }
  })
}
