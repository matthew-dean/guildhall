import { createHash } from 'node:crypto'

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
}

export interface SweLocalFixture {
  id: string
  instruction: string
  issueRef: string
  expectedFiles: string[]
  verificationCommands: string[]
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

export const tbliteSmokeFixtures: TbliteFixture[] = [
  {
    id: 'tblite-echo-smoke',
    instruction: 'Create a proof file and verify its contents.',
    command: ['node', '-e', 'console.log("guildhall tblite smoke")'],
    verifier: ['node', '-e', 'process.exit(0)'],
  },
]

export const sweLocalSmokeFixtures: SweLocalFixture[] = [
  {
    id: 'swe-local-copy-fix',
    instruction: 'Patch a tiny local fixture so the expected user-facing copy is present and the focused verifier passes.',
    issueRef: 'internal/benchmarks/swe-local/smoke/copy-fix.md',
    expectedFiles: ['src/App.tsx'],
    verificationCommands: ['pnpm test -- copy-fix'],
  },
]

export function taskSubsetHash(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex').slice(0, 16)
}

export function lifecycleFixturesForSet(fixtureSet: string): LifecycleFixture[] {
  if (fixtureSet !== 'smoke') throw new Error(`Unknown lifecycle fixture set: ${fixtureSet}`)
  return lifecycleSmokeFixtures
}

export function tbliteFixturesForSubset(subset: string): TbliteFixture[] {
  if (subset !== 'smoke') throw new Error(`Unknown TBLite subset: ${subset}`)
  return tbliteSmokeFixtures
}

export function sweLocalFixturesForSubset(subset: string): SweLocalFixture[] {
  if (subset !== 'smoke') throw new Error(`Unknown SWE-local subset: ${subset}`)
  return sweLocalSmokeFixtures
}
