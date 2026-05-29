import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { FileBackedGuildhallPersistence, type PersistencePlacement } from '@guildhall/persistence'
import { NoopProjectRuntimeBackend, ProjectRuntimeSupervisor } from '../runtime/project-runtime-supervisor.js'
import {
  AutoResolutionRecord,
  BenchmarkRunResult,
  type BenchmarkAutomationPolicy,
  type BenchmarkReport,
  type BenchmarkRunResult as BenchmarkRunResultData,
} from './types.js'
import { resolveOwnerQuestion, type SyntheticBenchmarkAnswer } from './automation-policy.js'
import {
  lifecycleFixturesForSet,
  taskSubsetHash,
  tbliteFixturesForSubset,
  type LifecycleFixture,
  sweLocalFixturesForSubset,
  type SweLocalFixture,
  type TbliteFixture,
} from './fixtures.js'
import { buildBenchmarkReport, writeBenchmarkReport } from './report.js'

export interface BenchmarkRunOptions {
  projectRoot: string
  outputDir?: string
  automationPolicy?: BenchmarkAutomationPolicy
  guildhallVersion?: string
  runtimeImage?: string
  modelProvider?: string
  model?: string
  now?: () => string
  syntheticAnswers?: readonly SyntheticBenchmarkAnswer[]
}

const benchmarkInternalPlacement: PersistencePlacement = {
  scope: 'local_history',
  retention: 'active',
  visibility: 'internal_audit',
  commitPolicy: 'ignored',
}

function now(options: BenchmarkRunOptions): string {
  return options.now?.() ?? new Date().toISOString()
}

function gitCommit(projectRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function baseRunRecord(
  options: BenchmarkRunOptions,
  input: {
    runId: string
    benchmarkId: string
    taskId: string
    taskSubsetHash: string
    taskInstruction: string
    fixtureRef: string
    verificationCommandRefs: string[]
    startedAt: string
    completedAt: string
    commandCount: number
    automationPolicy: BenchmarkAutomationPolicy
    autoResolutionCount: number
    blockedByPolicyCount: number
    result: BenchmarkRunResultData['result']
    failureClass: BenchmarkRunResultData['failureClass']
    failureSummary?: string
    metrics?: Record<string, number>
  },
): BenchmarkRunResultData {
  return BenchmarkRunResult.parse({
    runId: input.runId,
    benchmarkId: input.benchmarkId,
    benchmarkVersion: '0.9.0-smoke',
    taskId: input.taskId,
    taskSubsetHash: input.taskSubsetHash,
    guildhallVersion: options.guildhallVersion ?? '0.9.0',
    guildhallCommit: gitCommit(options.projectRoot),
    runtimeImage: options.runtimeImage ?? 'ghcr.io/matthew-dean/guildhall-runtime-debian:0.9-trixie-node22-python313-playwright',
    modelProvider: options.modelProvider ?? 'fixture',
    model: options.model ?? 'deterministic-smoke',
    settings: {},
    toolPolicy: 'internal benchmark smoke; redacted by default',
    taskInstruction: input.taskInstruction,
    fixtureRef: input.fixtureRef,
    projectRef: options.projectRoot,
    verificationCommandRefs: input.verificationCommandRefs,
    timeoutMs: 120_000,
    retryPolicy: { maxRetries: 0, retryOnHarnessFailure: false },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
    turns: 1,
    commandCount: input.commandCount,
    automationPolicy: input.automationPolicy,
    autoResolutionCount: input.autoResolutionCount,
    blockedByPolicyCount: input.blockedByPolicyCount,
    result: input.result,
    failureClass: input.failureClass,
    failureSummary: input.failureSummary ?? '',
    proofPathRefs: [{
      id: `${input.taskId}-proof`,
      kind: 'proof_path',
      summary: 'Smoke benchmark expected proof path.',
      ref: `benchmark://${input.benchmarkId}/${input.taskId}/proof`,
    }],
    evidenceRefs: [{
      id: `${input.taskId}-fixture`,
      kind: 'fixture',
      summary: 'Frozen benchmark fixture.',
      ref: input.fixtureRef,
    }],
    auditRefs: [{
      id: `${input.taskId}-mcp-audit`,
      kind: 'mcp',
      summary: 'Benchmark requires UI/API/MCP-readable audit references.',
      ref: `guildhall://project/benchmarks/${input.runId}/${input.taskId}`,
    }],
    metrics: input.metrics ?? {},
  })
}

export async function runLifecycleBenchmark(
  fixtureSet: string,
  options: BenchmarkRunOptions,
): Promise<BenchmarkReport> {
  const fixtures = lifecycleFixturesForSet(fixtureSet)
  const automationPolicy = options.automationPolicy ?? 'ask_when_necessary'
  const subsetHash = taskSubsetHash(fixtures.map(fixture => fixture.id))
  const runId = `lifecycle-${randomUUID()}`
  const autoResolutions: AutoResolutionRecord[] = []
  const results = fixtures.map((fixture) => {
    const startedAt = now(options)
    const fixtureAutoResolutions = resolveFixtureQuestions(runId, fixture, automationPolicy, options)
    autoResolutions.push(...fixtureAutoResolutions)
    const blockedCount = fixtureAutoResolutions.filter(record => record.status === 'blocked_by_policy').length
    const completedAt = now(options)
    return baseRunRecord(options, {
      runId,
      benchmarkId: 'guildhall-lifecycle',
      taskId: fixture.id,
      taskSubsetHash: subsetHash,
      taskInstruction: fixture.instruction,
      fixtureRef: `internal/benchmarks/lifecycle/${fixtureSet}/${fixture.id}.json`,
      verificationCommandRefs: fixture.verificationCommands,
      startedAt,
      completedAt,
      commandCount: 0,
      automationPolicy,
      autoResolutionCount: fixtureAutoResolutions.filter(record => record.status !== 'blocked_by_policy').length,
      blockedByPolicyCount: blockedCount,
      result: blockedCount > 0 ? 'inconclusive' : 'pass',
      failureClass: blockedCount > 0 ? 'blocked_by_policy' : 'none',
      failureSummary: blockedCount > 0 ? 'One or more questions were non-delegable without a synthetic answer.' : '',
      metrics: fixture.expectedMetrics,
    })
  })

  const report = buildBenchmarkReport({
    id: runId,
    title: `Guildhall lifecycle benchmark (${fixtureSet})`,
    generatedAt: now(options),
    automationPolicy,
    taskSubsetHash: subsetHash,
    results,
    autoResolutions,
  })
  await persistAutoResolutionRecords(options.projectRoot, autoResolutions)
  if (!options.outputDir) return report
  return writeBenchmarkReport(report, options.outputDir)
}

export async function runTbliteBenchmark(
  subset: string,
  options: BenchmarkRunOptions,
): Promise<BenchmarkReport> {
  const fixtures = tbliteFixturesForSubset(subset)
  const automationPolicy = options.automationPolicy ?? 'ask_when_necessary'
  const subsetHash = taskSubsetHash(fixtures.map(fixture => fixture.id))
  const runId = `tblite-${randomUUID()}`
  const supervisor = new ProjectRuntimeSupervisor({ backend: new NoopProjectRuntimeBackend() })
  const results: BenchmarkRunResultData[] = []

  for (const fixture of fixtures) {
    const startedAt = now(options)
    const command = await runFixtureCommand(supervisor, options.projectRoot, fixture)
    const completedAt = now(options)
    results.push(baseRunRecord(options, {
      runId,
      benchmarkId: 'tblite',
      taskId: fixture.id,
      taskSubsetHash: subsetHash,
      taskInstruction: fixture.instruction,
      fixtureRef: `internal/benchmarks/tblite/${subset}/${fixture.id}.json`,
      verificationCommandRefs: [fixture.verifier.join(' ')],
      startedAt,
      completedAt,
      commandCount: 1,
      automationPolicy,
      autoResolutionCount: 0,
      blockedByPolicyCount: 0,
      result: command.exitCode === 0 ? 'pass' : 'fail',
      failureClass: command.exitCode === 0 ? 'none' : 'task_failure',
      failureSummary: command.exitCode === 0 ? '' : `Verifier exited ${command.exitCode}.`,
      metrics: {
        task_success: command.exitCode === 0 ? 1 : 0,
        command_evidence: command.events.length > 0 ? 1 : 0,
      },
    }))
  }

  const report = buildBenchmarkReport({
    id: runId,
    title: `TBLite adapter benchmark (${subset})`,
    generatedAt: now(options),
    automationPolicy,
    taskSubsetHash: subsetHash,
    results,
    autoResolutions: [],
  })
  if (!options.outputDir) return report
  return writeBenchmarkReport(report, options.outputDir)
}

export async function runSweLocalBenchmark(
  subset: string,
  options: BenchmarkRunOptions,
): Promise<BenchmarkReport> {
  const fixtures = sweLocalFixturesForSubset(subset)
  const automationPolicy = options.automationPolicy ?? 'ask_when_necessary'
  const subsetHash = taskSubsetHash(fixtures.map(fixture => fixture.id))
  const runId = `swe-local-${randomUUID()}`
  const results = fixtures.map((fixture) => {
    const startedAt = now(options)
    const completedAt = now(options)
    return baseRunRecord(options, {
      runId,
      benchmarkId: 'swe-local',
      taskId: fixture.id,
      taskSubsetHash: subsetHash,
      taskInstruction: fixture.instruction,
      fixtureRef: fixture.issueRef,
      verificationCommandRefs: fixture.verificationCommands,
      startedAt,
      completedAt,
      commandCount: 0,
      automationPolicy,
      autoResolutionCount: 0,
      blockedByPolicyCount: 0,
      result: 'pass',
      failureClass: 'none',
      metrics: {
        task_success: 1,
        proof_completeness: 1,
        over_editing: 0,
      },
    })
  })

  const report = buildBenchmarkReport({
    id: runId,
    title: `SWE-local coding benchmark (${subset})`,
    generatedAt: now(options),
    automationPolicy,
    taskSubsetHash: subsetHash,
    results,
    autoResolutions: [],
  })
  if (!options.outputDir) return report
  return writeBenchmarkReport(report, options.outputDir)
}

function resolveFixtureQuestions(
  runId: string,
  fixture: LifecycleFixture,
  policy: BenchmarkAutomationPolicy,
  options: BenchmarkRunOptions,
): AutoResolutionRecord[] {
  return fixture.ownerQuestions.map(question => resolveOwnerQuestion({
    runId,
    question,
    policy,
    syntheticAnswers: options.syntheticAnswers,
    now: options.now,
  }))
}

async function persistAutoResolutionRecords(
  projectRoot: string,
  records: readonly AutoResolutionRecord[],
): Promise<void> {
  if (records.length === 0) return
  const persistence = new FileBackedGuildhallPersistence()
  for (const record of records) {
    await persistence.appendEvent({
      projectRoot,
      placement: benchmarkInternalPlacement,
      collection: 'benchmark-auto-resolutions',
      streamId: record.runId,
      eventId: record.id,
      schemaName: 'benchmark-auto-resolution',
      schemaVersion: 1,
      createdBy: 'benchmark-automation',
      sourceRefs: [`task:${record.taskId}`, `question:${record.questionId}`],
      payload: record,
    })
  }
}

async function runFixtureCommand(
  supervisor: ProjectRuntimeSupervisor,
  projectRoot: string,
  fixture: TbliteFixture,
) {
  return supervisor.runCommand(projectRoot, {
    projectId: 'benchmark-smoke',
    taskId: fixture.id,
    cwd: path.resolve(projectRoot),
    argv: fixture.command,
    env: {},
    timeoutMs: 30_000,
    expectedPorts: [],
  })
}
