import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { readRuntimeCommandEvidence } from '../../runtime/project-runtime-command.js'
import { isNonDelegableQuestion, resolveOwnerQuestion } from '../automation-policy.js'
import { resolveBenchmarkFixtureRoot } from '../fixtures.js'
import { inspectHermesPreflight, runHermesComparisonPreflight } from '../hermes.js'
import { renderBenchmarkMarkdown } from '../report.js'
import { runArtifactLocalBenchmark, runLifecycleBenchmark, runSweLocalBenchmark, runTbliteBenchmark } from '../runner.js'
import { BenchmarkRunResult, type BenchmarkOwnerQuestion } from '../types.js'
import { summarizeBenchmarkResults } from '../report.js'

const now = () => '2026-05-28T12:00:00.000Z'

describe('benchmark schemas and reports', () => {
  it('validates benchmark run records with result metadata and redaction defaults', () => {
    const result = BenchmarkRunResult.parse({
      runId: 'run-1',
      benchmarkId: 'guildhall-lifecycle',
      benchmarkVersion: '0.9.0-smoke',
      taskId: 'task-1',
      taskSubsetHash: 'abc123',
      guildhallVersion: '0.9.0',
      guildhallCommit: 'abcdef123456',
      runtimeImage: 'ghcr.io/matthew-dean/guildhall-runtime-debian:0.9',
      modelProvider: 'fixture',
      model: 'deterministic',
      toolPolicy: 'internal',
      taskInstruction: 'Do the task.',
      fixtureRef: 'internal/benchmarks/task.json',
      projectRef: '/tmp/project',
      startedAt: now(),
      completedAt: now(),
      durationMs: 0,
      turns: 1,
      commandCount: 0,
      automationPolicy: 'fully_automated',
      autoResolutionCount: 0,
      blockedByPolicyCount: 0,
      result: 'pass',
      failureClass: 'none',
    })

    expect(result.redaction.internalOnly).toBe(true)
    expect(result.redaction.publishable).toBe(false)
  })

  it('renders JSON-backed Markdown reports without public leaderboard language', async () => {
    const report = await runLifecycleBenchmark('smoke', {
      projectRoot: process.cwd(),
      automationPolicy: 'fully_automated',
      now,
    })

    const markdown = renderBenchmarkMarkdown(report)

    expect(markdown).toContain('Guildhall lifecycle benchmark')
    expect(markdown).toContain('False successes')
    expect(markdown).toContain('Tokens in/out')
    expect(markdown).toContain('Cost USD')
    expect(markdown).toContain('Commands')
    expect(markdown).toContain('Ticks')
    expect(markdown).toContain('Automation')
    expect(markdown).toContain('internal by default')
    expect(markdown).not.toMatch(/Guildhall beats Hermes/i)
  })

  it('includes per-run automation repairs in benchmark summaries', () => {
    const base = BenchmarkRunResult.parse({
      runId: 'run-1',
      benchmarkId: 'artifact-local',
      benchmarkVersion: '0.9.0-smoke',
      taskId: 'task-1',
      taskSubsetHash: 'abc123',
      guildhallVersion: '0.9.0',
      guildhallCommit: 'abcdef123456',
      runtimeImage: 'host',
      modelProvider: 'fixture',
      model: 'deterministic',
      toolPolicy: 'internal',
      taskInstruction: 'Patch one file.',
      fixtureRef: 'internal/benchmarks/task.json',
      projectRef: '/tmp/project',
      startedAt: now(),
      completedAt: now(),
      durationMs: 0,
      turns: 6,
      commandCount: 0,
      automationPolicy: 'fully_automated',
      autoResolutionCount: 2,
      blockedByPolicyCount: 1,
      result: 'pass',
      failureClass: 'none',
    })

    const summary = summarizeBenchmarkResults([base], [])

    expect(summary.autoResolutions).toBe(2)
    expect(summary.blockedByPolicy).toBe(1)
  })
})

describe('benchmark automation policy', () => {
  const question: BenchmarkOwnerQuestion = {
    id: 'q-host-access',
    taskId: 'task-runtime',
    prompt: 'Grant broad host access?',
    choices: [
      { id: 'grant', label: 'Grant access' },
      { id: 'deny', label: 'Keep blocked' },
    ],
    recommendedAnswer: {
      choiceId: 'deny',
      confidence: 'high',
      reason: 'The task can proceed without broad host access.',
      risk: 'Granting access could expose unrelated files.',
      evidenceRefs: [],
      decisionImpacts: ['host_access'],
    },
    nonDelegable: false,
  }

  it('blocks non-delegable decisions unless a fixture supplies a synthetic answer', () => {
    expect(isNonDelegableQuestion(question)).toBe(true)

    const blocked = resolveOwnerQuestion({
      runId: 'run-1',
      question,
      policy: 'fully_automated',
      now,
    })

    expect(blocked.status).toBe('blocked_by_policy')

    const synthetic = resolveOwnerQuestion({
      runId: 'run-1',
      question,
      policy: 'fully_automated',
      syntheticAnswers: [{ questionId: 'q-host-access', choiceId: 'deny', reason: 'Fixture explicitly denies broad host access.' }],
      now,
    })

    expect(synthetic.status).toBe('synthetic_answer_used')
    expect(synthetic.selectedChoiceId).toBe('deny')
  })

  it('auto-resolves high-confidence low-risk recommended answers under normal policy', () => {
    const record = resolveOwnerQuestion({
      runId: 'run-1',
      question: {
        id: 'q-proof',
        taskId: 'task-proof',
        prompt: 'Use the screenshot proof path?',
        choices: [
          { id: 'screenshot', label: 'Use screenshot proof' },
          { id: 'skip', label: 'Skip visual proof' },
        ],
        recommendedAnswer: {
          choiceId: 'screenshot',
          confidence: 'high',
          reason: 'The task changes visible UI.',
          risk: 'Skipping proof could allow a false success.',
          evidenceRefs: [],
          decisionImpacts: [],
        },
        nonDelegable: false,
      },
      policy: 'ask_when_necessary',
      now,
    })

    expect(record.status).toBe('auto_resolved')
    expect(record.recommendationConfidence).toBe('high')
  })
})

describe('benchmark runners', () => {
  it('resolves the fixture root correctly from both src and bundled-dist style directories', () => {
    const fromSrc = resolveBenchmarkFixtureRoot(path.join(process.cwd(), 'src', 'benchmarks'))
    const fromDistStyle = resolveBenchmarkFixtureRoot(path.join(process.cwd(), 'dist', 'benchmarks'))

    expect(fromSrc).toBe(path.join(process.cwd(), 'internal', 'benchmarks', 'fixtures'))
    expect(fromDistStyle).toBe(path.join(process.cwd(), 'internal', 'benchmarks', 'fixtures'))
  })

  it('runs lifecycle smoke fixtures with scorecard metrics and auto-resolution records', async () => {
    const report = await runLifecycleBenchmark('smoke', {
      projectRoot: process.cwd(),
      automationPolicy: 'fully_automated',
      now,
    })

    expect(report.results.map(result => result.taskId)).toEqual(expect.arrayContaining([
      'shape-ambiguous-request',
      'split-feature-work',
      'worker-scope-discipline',
      'review-catches-ui-control-mismatch',
      'gate-rejects-missing-evidence',
      'proof-ui-change',
      'completion-handoff-truthful',
      'mcp-auditability-without-shell',
      'reuse-accepted-memory',
    ]))
    expect(report.autoResolutions).toHaveLength(1)
    expect(report.results[0]?.metrics).toMatchObject({
      task_success: 1,
      split_quality: 1,
      auditability: 1,
    })
  })

  it('runs a SWE-local smoke fixture in a materialized workspace and records scope evidence', async () => {
    const report = await runSweLocalBenchmark('smoke', {
      projectRoot: process.cwd(),
      automationPolicy: 'fully_automated',
      now,
      runTaskOnceImpl: async ({ projectRoot }) => {
        await fs.writeFile(path.join(projectRoot, 'src', 'copy.ts'), "export function helperCopy() {\n  return 'benchmark-ready helper copy'\n}\n", 'utf8')
        return {
          id: 'run-once-1',
          createdAt: now(),
          projectRoot,
          taskId: 'task-001',
          title: 'helper-copy-bug',
          prompt: 'Fix helper copy',
          automationPolicy: 'fully_automated',
          proof: 'commands',
          stopReason: 'all_terminal',
          stopMessage: 'done',
          scopedStatusSummary: 'completed',
          orchestrator: {
            ticks: 6,
            stopReason: 'all_terminal',
            stopMessage: 'done',
            automationResolutionCount: 2,
            automationResolutionKinds: {
              repair_product_brief: 1,
              approve_spec: 1,
            },
          },
        }
      },
    })

    expect(report.results).toHaveLength(1)
    expect(report.results[0]?.benchmarkId).toBe('swe-local')
    expect(report.results[0]?.verificationCommandRefs).toEqual(['node scripts/test.js'])
    expect(report.results[0]?.redaction.internalOnly).toBe(true)
    expect(report.results[0]?.result).toBe('pass')
    expect(report.results[0]?.orchestratorTicks).toBe(6)
    expect(report.results[0]?.turns).toBe(6)
    expect(report.results[0]?.autoResolutionCount).toBe(2)
    expect(report.results[0]?.automationResolutionKinds).toEqual({
      repair_product_brief: 1,
      approve_spec: 1,
    })
    expect(report.results[0]?.touchedFiles).toEqual(['src/copy.ts'])
    expect(report.results[0]?.expectedFiles).toEqual(['src/copy.ts'])
    expect(report.results[0]?.unexpectedTouchedFiles).toEqual([])
    expect(report.results[0]?.qualityScore).toBe(100)
  })

  it('runs a TBLite smoke fixture through disk-backed seed projects and runtime command evidence', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-bench-'))
    const report = await runTbliteBenchmark('smoke', {
      projectRoot,
      automationPolicy: 'fully_automated',
      now,
    })

    expect(report.results.length).toBeGreaterThanOrEqual(1)
    expect(report.results[0]?.commandCount).toBeGreaterThanOrEqual(2)
    expect(report.results[0]?.result).toBe('pass')
    expect(report.results[0]?.touchedFiles.length).toBeGreaterThanOrEqual(1)

    const evidence = await readRuntimeCommandEvidence(projectRoot)
    expect(evidence).toHaveLength(0)
  })

  it('flags artifact-local overreach as a false success when extra files are touched', async () => {
    const report = await runArtifactLocalBenchmark('smoke', {
      projectRoot: process.cwd(),
      automationPolicy: 'fully_automated',
      now,
      runTaskOnceImpl: async ({ projectRoot }) => {
        await fs.writeFile(path.join(projectRoot, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Added benchmark artifact evidence.\n', 'utf8')
        await fs.writeFile(path.join(projectRoot, 'scratch.txt'), 'extra\n', 'utf8')
        return {
          id: 'run-once-2',
          createdAt: now(),
          projectRoot,
          taskId: 'task-001',
          title: 'policy-note-overreach',
          prompt: 'Update the release notes',
          automationPolicy: 'fully_automated',
          proof: 'commands',
          stopReason: 'all_terminal',
          stopMessage: 'done',
          scopedStatusSummary: 'completed',
          orchestrator: {
            ticks: 1,
            stopReason: 'all_terminal',
            stopMessage: 'done',
          },
        }
      },
    })

    expect(report.results).toHaveLength(2)
    const overreach = report.results.find(result => result.taskId === 'policy-note-overreach')
    expect(overreach?.failureClass).toBe('false_success')
    expect(overreach?.unexpectedTouchedFiles).toEqual(['scratch.txt'])
    expect(overreach?.qualityScore).toBe(85)
  })

  it('writes internal JSONL and Markdown outputs when an output directory is supplied', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-bench-project-'))
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-bench-output-'))
    const report = await runLifecycleBenchmark('smoke', {
      projectRoot,
      outputDir,
      automationPolicy: 'fully_automated',
      now,
    })

    expect(report.outputPaths?.jsonl).toContain(outputDir)
    expect(report.outputPaths?.markdown).toContain(outputDir)
    await expect(fs.stat(report.outputPaths!.jsonl)).resolves.toBeTruthy()
    await expect(fs.stat(report.outputPaths!.markdown)).resolves.toBeTruthy()
    await expect(fs.readFile(report.outputPaths!.jsonl, 'utf8')).resolves.toContain('"type":"auto_resolution"')
  })

  it('records Hermes comparison blockers and telemetry gaps as a machine-readable report', async () => {
    const hermesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-root-'))
    const hermesHome = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-home-'))
    const report = await runHermesComparisonPreflight({
      projectRoot: process.cwd(),
      hermesRoot,
      hermesHome,
      automationPolicy: 'fully_automated',
      now,
      env: {},
      execFile: async () => {
        throw new Error('missing hermes')
      },
    })

    expect(report.results).toHaveLength(1)
    expect(report.results[0]?.benchmarkId).toBe('hermes-comparison')
    expect(report.results[0]?.result).toBe('inconclusive')
    expect(report.results[0]?.failureClass).toBe('harness_failure')
    expect(report.results[0]?.failureSummary).toContain('Hermes CLI is not runnable')
    expect(report.results[0]?.settings).toMatchObject({
      telemetry: {
        tokens: 'missing',
        cost: 'missing',
      },
    })
  })

  it('passes Hermes preflight when CLI, benchmark entrypoint, and a Hermes provider config exist', async () => {
    const hermesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-root-'))
    const hermesHome = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-home-'))
    await fs.mkdir(path.join(hermesRoot, 'environments/benchmarks/tblite'), { recursive: true })
    await fs.writeFile(path.join(hermesHome, '.env'), 'OPENAI_API_KEY=redacted\n')
    await fs.writeFile(path.join(hermesHome, 'config.yaml'), [
      'model:',
      '  default: "deepseek-ai/DeepSeek-V4-Flash"',
      '  provider: "openai-api"',
      '  base_url: "https://api.deepinfra.com/v1/openai"',
      '',
    ].join('\n'))

    const preflight = await inspectHermesPreflight({
      projectRoot: process.cwd(),
      hermesRoot,
      hermesHome,
      env: {},
      execFile: async () => ({ stdout: 'Hermes Agent v0.15.0\n', stderr: '' }),
    })

    expect(preflight.blockers).toEqual([])
    expect(preflight.hermesVersion).toBe('Hermes Agent v0.15.0')
    expect(preflight.telemetry.tokens).toBe('direct')
  })

  it('recognizes local custom Hermes providers without requiring an API key', async () => {
    const hermesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-root-'))
    const hermesHome = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-hermes-home-'))
    await fs.mkdir(path.join(hermesRoot, 'environments/benchmarks/tblite'), { recursive: true })
    await fs.writeFile(path.join(hermesHome, 'config.yaml'), [
      'model:',
      '  default: "qwen2.5-coder:32b"',
      '  provider: "custom"',
      '  base_url: "http://localhost:11434/v1"',
      '',
    ].join('\n'))

    const preflight = await inspectHermesPreflight({
      projectRoot: process.cwd(),
      hermesRoot,
      hermesHome,
      env: {},
      execFile: async () => ({ stdout: 'Hermes Agent v0.15.0\n', stderr: '' }),
    })

    expect(preflight.providerConfigured).toBe(true)
    expect(preflight.blockers).toEqual([])
  })
})
