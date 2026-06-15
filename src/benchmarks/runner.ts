import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { randomUUID } from 'node:crypto'
import { execFile as execFileCb, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { FileBackedGuildhallPersistence, type PersistencePlacement } from '@guildhall/persistence'
import { runGuildhallTaskOnce, type RunOnceReport } from '@guildhall/runtime'
import { getProjectSystemStatePath } from '@guildhall/sessions'
import {
  AutoResolutionRecord,
  BenchmarkRunResult,
  type BenchmarkAutomationPolicy,
  type BenchmarkReport,
  type BenchmarkRunResult as BenchmarkRunResultData,
} from './types.js'
import { resolveOwnerQuestion, type SyntheticBenchmarkAnswer } from './automation-policy.js'
import {
  artifactLocalFixturesForSubset,
  lifecycleFixturesForSet,
  resolveBenchmarkFixtureRoot,
  sweLocalFixturesForSubset,
  taskSubsetHash,
  tbliteFixturesForSubset,
  type ArtifactLocalFixture,
  type LifecycleFixture,
  type SweLocalFixture,
  type TbliteFixture,
} from './fixtures.js'
import { buildBenchmarkReport, writeBenchmarkReport } from './report.js'

const execFile = promisify(execFileCb)

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
  runTaskOnceImpl?: typeof runGuildhallTaskOnce
}

const benchmarkInternalPlacement: PersistencePlacement = {
  scope: 'local_history',
  retention: 'active',
  visibility: 'internal_audit',
  commitPolicy: 'ignored',
}

interface CommandResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
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

function scoreBenchmarkResult(input: {
  verifierResults: readonly CommandResult[]
  missingExpectedFiles: readonly string[]
  unexpectedTouchedFiles: readonly string[]
  stopReason?: string
}): number {
  let score = 100
  if (input.verifierResults.some(result => result.exitCode !== 0)) score -= 60
  if (input.missingExpectedFiles.length > 0) score -= 25
  if (input.unexpectedTouchedFiles.length > 0) score -= 15
  if (input.stopReason && input.stopReason !== 'all_terminal') score -= 20
  return Math.max(0, Math.min(100, score))
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
    turns?: number
    orchestratorTicks?: number
    orchestratorStopReason?: string
    automationPolicy: BenchmarkAutomationPolicy
    autoResolutionCount: number
    blockedByPolicyCount: number
    automationResolutionKinds?: Record<string, number>
    tokenUse?: { input: number; output: number }
    result: BenchmarkRunResultData['result']
    failureClass: BenchmarkRunResultData['failureClass']
    failureSummary?: string
    metrics?: Record<string, number>
    projectRef?: string
    expectedFiles?: string[]
    touchedFiles?: string[]
    missingExpectedFiles?: string[]
    unexpectedTouchedFiles?: string[]
    verifierResults?: readonly CommandResult[]
    qualityScore?: number
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
    runtimeImage: options.runtimeImage ?? 'ghcr.io/matthew-dean/guildhall-runtime-debian:0.10-trixie-node22-python313-playwright',
    modelProvider: options.modelProvider ?? 'fixture',
    model: options.model ?? 'deterministic-smoke',
    settings: {},
    toolPolicy: 'internal benchmark smoke; redacted by default',
    taskInstruction: input.taskInstruction,
    fixtureRef: input.fixtureRef,
    projectRef: input.projectRef ?? options.projectRoot,
    verificationCommandRefs: input.verificationCommandRefs,
    timeoutMs: 120_000,
    retryPolicy: { maxRetries: 0, retryOnHarnessFailure: false },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
    turns: input.turns ?? 1,
    orchestratorTicks: input.orchestratorTicks ?? 0,
    orchestratorStopReason: input.orchestratorStopReason ?? '',
    commandCount: input.commandCount,
    automationPolicy: input.automationPolicy,
    autoResolutionCount: input.autoResolutionCount,
    blockedByPolicyCount: input.blockedByPolicyCount,
    automationResolutionKinds: input.automationResolutionKinds ?? {},
    tokenUse: input.tokenUse ?? { input: 0, output: 0 },
    result: input.result,
    failureClass: input.failureClass,
    failureSummary: input.failureSummary ?? '',
    expectedFiles: input.expectedFiles ?? [],
    touchedFiles: input.touchedFiles ?? [],
    missingExpectedFiles: input.missingExpectedFiles ?? [],
    unexpectedTouchedFiles: input.unexpectedTouchedFiles ?? [],
    verifierResults: input.verifierResults ?? [],
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
    qualityScore: input.qualityScore ?? 0,
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
      qualityScore: blockedCount > 0 ? 70 : 100,
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
  const results: BenchmarkRunResultData[] = []

  for (const fixture of fixtures) {
    const materialized = await materializeFixtureProject(`tblite-${fixture.id}`, fixture.seedDir)
    const startedAt = now(options)
    const command = await runFixtureCommand(materialized.projectRoot, fixture)
    const verifierResults = await runVerifierCommands(materialized.projectRoot, fixture.verifier)
    const touchedFiles = await collectTouchedFiles(fixture.seedDir, materialized.projectRoot)
    const expectedFiles = fixture.expectedFiles
    const missingExpectedFiles = expectedFiles.filter(file => !touchedFiles.includes(file))
    const unexpectedTouchedFiles = touchedFiles.filter(file => !expectedFiles.includes(file))
    const completedAt = now(options)
    const verifiersPassed = verifierResults.every(result => result.exitCode === 0)
    const result = !verifiersPassed
      ? 'fail'
      : missingExpectedFiles.length > 0 || unexpectedTouchedFiles.length > 0
        ? 'inconclusive'
        : 'pass'
    const failureClass = !verifiersPassed
      ? 'task_failure'
      : missingExpectedFiles.length > 0 || unexpectedTouchedFiles.length > 0
        ? 'false_success'
        : 'none'
    results.push(baseRunRecord(options, {
      runId,
      benchmarkId: 'tblite',
      taskId: fixture.id,
      taskSubsetHash: subsetHash,
      taskInstruction: fixture.instruction,
      fixtureRef: relativeFixtureRef(fixture.fixturePath),
      verificationCommandRefs: [fixture.command.join(' '), ...fixture.verifier],
      startedAt,
      completedAt,
      commandCount: 1 + verifierResults.length,
      automationPolicy,
      autoResolutionCount: 0,
      blockedByPolicyCount: 0,
      result,
      failureClass,
      failureSummary: summarizeFailure(result, failureClass, verifierResults, undefined, missingExpectedFiles, unexpectedTouchedFiles),
      metrics: {
        task_success: result === 'pass' ? 1 : 0,
        command_evidence: command.events.length > 0 ? 1 : 0,
      },
      projectRef: materialized.projectRoot,
      expectedFiles,
      touchedFiles,
      missingExpectedFiles,
      unexpectedTouchedFiles,
      verifierResults,
      qualityScore: scoreBenchmarkResult({ verifierResults, missingExpectedFiles, unexpectedTouchedFiles }),
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

export async function runArtifactLocalBenchmark(
  subset: string,
  options: BenchmarkRunOptions,
): Promise<BenchmarkReport> {
  return runTaskWorkspaceBenchmark({
    benchmarkId: 'artifact-local',
    title: `Artifact-local benchmark (${subset})`,
    fixtures: artifactLocalFixturesForSubset(subset),
    options,
  })
}

export async function runSweLocalBenchmark(
  subset: string,
  options: BenchmarkRunOptions,
): Promise<BenchmarkReport> {
  return runTaskWorkspaceBenchmark({
    benchmarkId: 'swe-local',
    title: `SWE-local coding benchmark (${subset})`,
    fixtures: sweLocalFixturesForSubset(subset),
    options,
  })
}

async function runTaskWorkspaceBenchmark(input: {
  benchmarkId: 'artifact-local' | 'swe-local'
  title: string
  fixtures: readonly (ArtifactLocalFixture | SweLocalFixture)[]
  options: BenchmarkRunOptions
}): Promise<BenchmarkReport> {
  const automationPolicy = input.options.automationPolicy ?? 'ask_when_necessary'
  const subsetHash = taskSubsetHash(input.fixtures.map(fixture => fixture.id))
  const runId = `${input.benchmarkId}-${randomUUID()}`
  const results: BenchmarkRunResultData[] = []
  const runTaskOnceImpl = input.options.runTaskOnceImpl ?? runGuildhallTaskOnce

  for (const fixture of input.fixtures) {
    const materialized = await materializeFixtureProject(`${input.benchmarkId}-${fixture.id}`, fixture.seedDir)
    const startedAt = now(input.options)
    const runOnceReport = await runTaskOnceImpl({
      projectRoot: materialized.projectRoot,
      prompt: buildBenchmarkPrompt(fixture),
      title: fixture.id,
      automationPolicy,
      proof: 'commands',
      outputPath: getProjectSystemStatePath(materialized.projectRoot, `${fixture.id}-run-once.json`),
    })
    const verifierResults = await runVerifierCommands(materialized.projectRoot, fixture.verifier)
    const touchedFiles = await collectTouchedFiles(fixture.seedDir, materialized.projectRoot)
    const expectedFiles = fixture.expectedFiles
    const missingExpectedFiles = expectedFiles.filter(file => !touchedFiles.includes(file))
    const unexpectedTouchedFiles = touchedFiles.filter(file => !expectedFiles.includes(file))
    const completedAt = now(input.options)
    const verifiersPassed = verifierResults.every(result => result.exitCode === 0)
    const result = !verifiersPassed
      ? 'fail'
      : missingExpectedFiles.length > 0 || unexpectedTouchedFiles.length > 0
        ? 'inconclusive'
        : runOnceReport.stopReason === 'all_terminal'
          ? 'pass'
          : 'inconclusive'
    const failureClass = !verifiersPassed
      ? 'task_failure'
      : missingExpectedFiles.length > 0 || unexpectedTouchedFiles.length > 0
        ? 'false_success'
        : runOnceReport.stopReason === 'all_terminal'
          ? 'none'
          : 'inconclusive'
    results.push(baseRunRecord(input.options, {
      runId,
      benchmarkId: input.benchmarkId,
      taskId: fixture.id,
      taskSubsetHash: subsetHash,
      taskInstruction: fixture.instruction,
      fixtureRef: fixture.issueRef,
      verificationCommandRefs: fixture.verifier,
      startedAt,
      completedAt,
      commandCount: verifierResults.length,
      turns: runOnceReport.orchestrator.ticks,
      orchestratorTicks: runOnceReport.orchestrator.ticks,
      orchestratorStopReason: runOnceReport.orchestrator.stopReason,
      automationPolicy,
      autoResolutionCount: runOnceReport.orchestrator.automationResolutionCount ?? 0,
      blockedByPolicyCount: 0,
      automationResolutionKinds: runOnceReport.orchestrator.automationResolutionKinds ?? {},
      tokenUse: {
        input: runOnceReport.orchestrator.usage?.input_tokens ?? 0,
        output: runOnceReport.orchestrator.usage?.output_tokens ?? 0,
      },
      result,
      failureClass,
      failureSummary: summarizeFailure(result, failureClass, verifierResults, runOnceReport, missingExpectedFiles, unexpectedTouchedFiles),
      metrics: {
        task_success: result === 'pass' ? 1 : 0,
        proof_completeness: verifiersPassed ? 1 : 0,
        over_editing: unexpectedTouchedFiles.length > 0 ? 1 : 0,
      },
      projectRef: materialized.projectRoot,
      expectedFiles,
      touchedFiles,
      missingExpectedFiles,
      unexpectedTouchedFiles,
      verifierResults,
      qualityScore: scoreBenchmarkResult({
        verifierResults,
        missingExpectedFiles,
        unexpectedTouchedFiles,
        stopReason: runOnceReport.stopReason,
      }),
    }))
  }

  const report = buildBenchmarkReport({
    id: runId,
    title: input.title,
    generatedAt: now(input.options),
    automationPolicy,
    taskSubsetHash: subsetHash,
    results,
    autoResolutions: [],
  })
  if (!input.options.outputDir) return report
  return writeBenchmarkReport(report, input.options.outputDir)
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

async function runFixtureCommand(projectRoot: string, fixture: TbliteFixture): Promise<{
  exitCode: number
  events: Array<{ type: 'started' | 'exit'; at: string }>
}> {
  const startedAt = new Date().toISOString()
  try {
    await execFile(fixture.command[0]!, fixture.command.slice(1), { cwd: path.resolve(projectRoot) })
    return {
      exitCode: 0,
      events: [
        { type: 'started', at: startedAt },
        { type: 'exit', at: new Date().toISOString() },
      ],
    }
  } catch (error) {
    const failure = error as { code?: number }
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      events: [
        { type: 'started', at: startedAt },
        { type: 'exit', at: new Date().toISOString() },
      ],
    }
  }
}

function relativeFixtureRef(fixturePath: string): string {
  return path.relative(path.dirname(resolveBenchmarkFixtureRoot()), fixturePath)
}

async function materializeFixtureProject(prefix: string, seedDir: string): Promise<{ projectRoot: string }> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `guildhall-${prefix}-`))
  await fs.cp(seedDir, projectRoot, { recursive: true })
  await ensureBenchmarkWorkspaceConfig(projectRoot, `${prefix}-${path.basename(projectRoot)}`)
  await initializeBenchmarkRepo(projectRoot)
  return { projectRoot }
}

async function ensureBenchmarkWorkspaceConfig(projectRoot: string, id: string): Promise<void> {
  const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'benchmark-fixture'
  const guildhallYamlPath = path.join(projectRoot, 'guildhall.yaml')
  try {
    await fs.access(guildhallYamlPath)
  } catch {
    await writeManagedTextFile(guildhallYamlPath, `name: ${slug}\nid: ${slug}\nprojectPath: .\n`, 'utf8')
  }
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  try {
    await fs.access(tasksPath)
  } catch {
    await writeManagedTextFile(tasksPath, `${JSON.stringify({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] }, null, 2)}\n`, 'utf8')
  }
}

async function initializeBenchmarkRepo(projectRoot: string): Promise<void> {
  await execFile('git', ['init', '--initial-branch=main'], { cwd: projectRoot })
  await execFile('git', ['add', '.'], { cwd: projectRoot })
  await execFile(
    'git',
    ['-c', 'user.name=Guildhall Benchmark', '-c', 'user.email=benchmark@guildhall.local', 'commit', '-m', 'Seed benchmark fixture'],
    { cwd: projectRoot },
  )
}

async function runVerifierCommands(projectRoot: string, commands: readonly string[]): Promise<CommandResult[]> {
  const results: CommandResult[] = []
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execFile('bash', ['-lc', command], { cwd: projectRoot })
      results.push({ command, exitCode: 0, stdout, stderr })
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      results.push({
        command,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      })
    }
  }
  return results
}

async function collectTouchedFiles(seedDir: string, projectRoot: string): Promise<string[]> {
  const touched = new Set<string>()
  const [seedFiles, projectFiles] = await Promise.all([
    listFiles(seedDir),
    listFiles(projectRoot),
  ])
  const allFiles = new Set([...seedFiles, ...projectFiles])
  for (const rel of allFiles) {
    if (rel === 'guildhall.yaml' || rel.startsWith('.guildhall/') || rel.startsWith('.git/')) continue
    const [seedContent, projectContent] = await Promise.all([
      readOptionalFile(path.join(seedDir, rel)),
      readOptionalFile(path.join(projectRoot, rel)),
    ])
    if (seedContent !== projectContent) touched.add(rel)
  }
  return [...touched].sort()
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, rel))
    } else {
      files.push(rel)
    }
  }
  return files.sort()
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readManagedTextFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function summarizeFailure(
  result: BenchmarkRunResultData['result'],
  failureClass: BenchmarkRunResultData['failureClass'],
  verifierResults: readonly CommandResult[],
  runOnceReport: RunOnceReport | undefined,
  missingExpectedFiles: readonly string[],
  unexpectedTouchedFiles: readonly string[],
): string {
  if (result === 'pass') return ''
  if (failureClass === 'task_failure') {
    const failedVerifier = verifierResults.find(candidate => candidate.exitCode !== 0)
    return failedVerifier
      ? `Verifier failed: ${failedVerifier.command} exited ${failedVerifier.exitCode}.`
      : 'Task verification failed.'
  }
  if (failureClass === 'false_success') {
    const parts: string[] = []
    if (missingExpectedFiles.length > 0) parts.push(`missing expected files: ${missingExpectedFiles.join(', ')}`)
    if (unexpectedTouchedFiles.length > 0) parts.push(`unexpected touched files: ${unexpectedTouchedFiles.join(', ')}`)
    return parts.join('; ')
  }
  if (runOnceReport && runOnceReport.stopReason !== 'all_terminal') {
    return runOnceReport.stopMessage
  }
  return 'Benchmark run was inconclusive.'
}

function buildBenchmarkPrompt(fixture: ArtifactLocalFixture | SweLocalFixture): string {
  const lines = [
    fixture.instruction,
    '',
    `Expected file scope: ${fixture.expectedFiles.length > 0 ? fixture.expectedFiles.join(', ') : 'no specific files declared'}.`,
    `Verification commands: ${fixture.verifier.join(' ; ')}.`,
    'This benchmark fixture is local-only. There are no external services, deployed systems, or owner-only setup steps.',
    'Complete the requested change directly in the project files and keep the final edit scope as small as possible.',
  ]
  return lines.join('\n')
}
