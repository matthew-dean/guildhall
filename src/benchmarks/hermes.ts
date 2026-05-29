import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

import { buildBenchmarkReport, writeBenchmarkReport } from './report.js'
import { taskSubsetHash } from './fixtures.js'
import {
  BenchmarkRunResult,
  type BenchmarkAutomationPolicy,
  type BenchmarkReport,
  type BenchmarkRunResult as BenchmarkRunResultData,
} from './types.js'

const execFileDefault = promisify(execFileCb)

export interface HermesComparisonOptions {
  projectRoot: string
  hermesRoot?: string
  outputDir?: string
  hermesHome?: string
  automationPolicy?: BenchmarkAutomationPolicy
  now?: () => string
  execFile?: (file: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>
  env?: NodeJS.ProcessEnv
}

export interface HermesPreflight {
  hermesVersion: string | null
  hermesRoot: string | null
  hermesHome: string
  benchmarkEntrypoints: Array<{ id: string; path: string; exists: boolean }>
  providerConfigured: boolean
  modalConfigured: boolean
  blockers: string[]
  telemetry: {
    tokens: 'direct' | 'provider_estimated' | 'missing'
    cost: 'direct' | 'provider_estimated' | 'missing'
    notes: string[]
  }
}

const DEFAULT_DEV_HERMES_ROOT = '.guildhall/dev-tools/hermes-agent'

export async function runHermesComparisonPreflight(
  options: HermesComparisonOptions,
): Promise<BenchmarkReport> {
  const automationPolicy = options.automationPolicy ?? 'fully_automated'
  const at = options.now?.() ?? new Date().toISOString()
  const preflight = await inspectHermesPreflight(options)
  const subsetHash = taskSubsetHash(['hermes-tblite-smoke'])
  const runId = `hermes-compare-${randomUUID()}`
  const blockers = preflight.blockers
  const result: BenchmarkRunResultData = BenchmarkRunResult.parse({
    runId,
    benchmarkId: 'hermes-comparison',
    benchmarkVersion: '0.9.0-preflight',
    taskId: 'hermes-tblite-smoke',
    taskSubsetHash: subsetHash,
    guildhallVersion: '0.9.0',
    guildhallCommit: 'unknown',
    runtimeImage: 'not-applicable-hermes-preflight',
    modelProvider: preflight.providerConfigured ? 'configured-provider' : 'missing-provider',
    model: 'unselected',
    settings: {
      hermesVersion: preflight.hermesVersion,
      hermesRoot: preflight.hermesRoot,
      hermesHome: preflight.hermesHome,
      benchmarkEntrypoints: preflight.benchmarkEntrypoints,
      telemetry: preflight.telemetry,
    },
    toolPolicy: 'Hermes comparison preflight; no public claims from blocked runs.',
    taskInstruction: 'Run Hermes against the shared TBLite-style smoke subset with token/cost telemetry.',
    fixtureRef: 'internal/benchmarks/hermes-comparison-runbook.md',
    projectRef: options.projectRoot,
    verificationCommandRefs: [
      'hermes --version or uv run --project <hermes-root> hermes --version',
      'environments/benchmarks/tblite entrypoint exists',
      'Hermes model provider is configured in env or ~/.hermes',
    ],
    timeoutMs: 120_000,
    retryPolicy: { maxRetries: 0, retryOnHarnessFailure: false },
    startedAt: at,
    completedAt: options.now?.() ?? new Date().toISOString(),
    durationMs: 0,
    tokenUse: { input: 0, output: 0 },
    costUsd: 0,
    turns: 0,
    commandCount: preflight.hermesVersion ? 1 : 0,
    automationPolicy,
    autoResolutionCount: 0,
    blockedByPolicyCount: 0,
    result: blockers.length > 0 ? 'inconclusive' : 'pass',
    failureClass: blockers.length > 0 ? 'harness_failure' : 'none',
    failureSummary: blockers.join(' '),
    evidenceRefs: [{
      id: 'hermes-preflight',
      kind: 'report',
      summary: blockers.length > 0
        ? 'Hermes comparison preflight is blocked before a task run.'
        : 'Hermes comparison preflight has the required local prerequisites.',
      ref: 'internal/benchmarks/hermes-comparison-2026-05-28.md',
    }],
    auditRefs: [{
      id: 'hermes-telemetry',
      kind: 'report',
      summary: `Token telemetry: ${preflight.telemetry.tokens}; cost telemetry: ${preflight.telemetry.cost}.`,
      ref: 'internal/benchmarks/hermes-comparison-runbook.md',
    }],
    redaction: {
      internalOnly: true,
      publishable: false,
      redactionNotes: ['Hermes provider and Modal credential presence is reported without secret values.'],
    },
    metrics: {
      hermes_available: preflight.hermesVersion ? 1 : 0,
      benchmark_entrypoints_available: preflight.benchmarkEntrypoints.every(entry => entry.exists) ? 1 : 0,
      provider_configured: preflight.providerConfigured ? 1 : 0,
      modal_configured: preflight.modalConfigured ? 1 : 0,
    },
  })

  const report = buildBenchmarkReport({
    id: runId,
    title: 'Hermes comparison preflight',
    generatedAt: at,
    automationPolicy,
    taskSubsetHash: subsetHash,
    results: [result],
    autoResolutions: [],
  })
  if (!options.outputDir) return report
  return writeBenchmarkReport(report, options.outputDir)
}

export async function inspectHermesPreflight(options: HermesComparisonOptions): Promise<HermesPreflight> {
  const env = options.env ?? process.env
  const execFile = options.execFile ?? execFileDefault
  const hermesRoot = await resolveHermesRoot(options)
  const hermesHome = resolveHermesHome(options)
  const blockers: string[] = []
  const hermesVersion = await resolveHermesVersion({ hermesRoot, execFile })
  if (!hermesVersion) {
    blockers.push('Hermes CLI is not runnable from PATH or the optional dev Hermes checkout.')
  }

  const benchmarkEntrypoints = [
    'environments/benchmarks/tblite',
    'environments/benchmarks/terminalbench_2',
  ].map(entry => ({
    id: entry.split('/').at(-1) ?? entry,
    path: hermesRoot ? path.join(hermesRoot, entry) : entry,
    exists: false,
  }))
  for (const entry of benchmarkEntrypoints) {
    entry.exists = hermesRoot ? await pathExists(entry.path) : false
  }
  if (!benchmarkEntrypoints.some(entry => entry.exists)) {
    blockers.push('Hermes benchmark entrypoints were not found; no shared TBLite/TerminalBench task can run.')
  }

  const providerConfigured = await detectHermesProviderConfigured(env, hermesHome)
  const modalConfigured = Boolean(env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET)
  if (!providerConfigured) blockers.push('No Hermes-compatible inference provider credential is configured.')

  return {
    hermesVersion,
    hermesRoot,
    hermesHome,
    benchmarkEntrypoints,
    providerConfigured,
    modalConfigured,
    blockers,
    telemetry: {
      tokens: hermesVersion ? 'direct' : 'missing',
      cost: hermesVersion ? 'direct' : 'missing',
      notes: hermesVersion
        ? ['Hermes session telemetry should be exported with `hermes sessions export` and `hermes insights`; per-task benchmark fields still need confirmation after a real run.']
        : ['No Hermes session can run, so token and cost telemetry are missing rather than estimated.'],
    },
  }
}

function resolveHermesHome(options: HermesComparisonOptions): string {
  const fromOption = options.hermesHome?.trim()
  if (fromOption) return path.resolve(fromOption)
  const fromEnv = options.env?.HERMES_HOME?.trim() ?? process.env.HERMES_HOME?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(os.homedir(), '.hermes')
}

async function resolveHermesRoot(options: HermesComparisonOptions): Promise<string | null> {
  const fromOption = options.hermesRoot?.trim()
  if (fromOption) return path.resolve(fromOption)
  const fromEnv = options.env?.GUILDHALL_HERMES_ROOT?.trim() ?? process.env.GUILDHALL_HERMES_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  const localDevRoot = path.resolve(options.projectRoot, DEFAULT_DEV_HERMES_ROOT)
  return await pathExists(localDevRoot) ? localDevRoot : null
}

async function detectHermesProviderConfigured(env: NodeJS.ProcessEnv, hermesHome: string): Promise<boolean> {
  const hermesEnv = await readDotEnv(path.join(hermesHome, '.env'))
  const combinedEnv = { ...hermesEnv, ...env }
  if (hasProviderCredential(combinedEnv)) return true

  const config = await readOptional(path.join(hermesHome, 'config.yaml'))
  if (!config) return false
  const provider = scalarValue(config, 'provider')
  const baseUrl = scalarValue(config, 'base_url')
  const apiKey = scalarValue(config, 'api_key')
  if (apiKey && apiKey !== '<redacted>') return true
  if (!provider) return false
  if (isOAuthProvider(provider)) return await pathExists(path.join(hermesHome, 'auth.json'))
  if (provider === 'lmstudio') return true
  if (provider === 'custom' || provider === 'ollama' || provider === 'vllm' || provider === 'llamacpp') {
    return Boolean(baseUrl && (isLocalEndpoint(baseUrl) || hasProviderCredential(combinedEnv)))
  }
  if (provider === 'openai-api') return Boolean(combinedEnv.OPENAI_API_KEY)
  return hasProviderCredential(combinedEnv)
}

function hasProviderCredential(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.OPENROUTER_API_KEY
    || env.OPENAI_API_KEY
    || env.ANTHROPIC_API_KEY
    || env.NOUS_API_KEY
    || env.DEEPSEEK_API_KEY
    || env.GOOGLE_API_KEY
    || env.GEMINI_API_KEY
    || env.NVIDIA_API_KEY
    || env.HF_TOKEN,
  )
}

function isOAuthProvider(provider: string): boolean {
  return ['nous', 'openai-codex', 'qwen-oauth', 'minimax-oauth', 'xai-oauth', 'google-gemini-cli'].includes(provider)
}

function isLocalEndpoint(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[^/]*\.local)(?::|\/|$)/i.test(baseUrl)
}

function scalarValue(config: string, key: string): string | null {
  const match = config.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?\\s*(?:#.*)?$`, 'm'))
  return match?.[1]?.trim() ?? null
}

async function readDotEnv(filePath: string): Promise<NodeJS.ProcessEnv> {
  const raw = await readOptional(filePath)
  if (!raw) return {}
  const values: NodeJS.ProcessEnv = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    values[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
  return values
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function resolveHermesVersion(input: {
  hermesRoot: string | null
  execFile: (file: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>
}): Promise<string | null> {
  try {
    if (input.hermesRoot) {
      const { stdout } = await input.execFile('uv', ['run', '--python', '3.11', '--project', input.hermesRoot, 'hermes', '--version'])
      return stdout.trim() || null
    }
    const { stdout } = await input.execFile('hermes', ['--version'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate)
    return true
  } catch {
    return false
  }
}
