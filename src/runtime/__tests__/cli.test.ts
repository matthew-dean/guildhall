import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProjectSystemStatePath } from '@guildhall/sessions'
import {
  semanticCompletionBudget,
  semanticRepairCompletionBudget,
  clearServiceRuntimeState,
  clearServiceRuntimeStateIfOwnedByPid,
  completeOpenAiCompatibleJson,
  discoverServiceRuntimeState,
  isPidAlive,
  launchRouteForProject,
  parseArgs,
  parseRunOptions,
  persistServiceRuntimeState,
  probeLiveService,
  readServiceRuntimeState,
  renderHelpText,
  buildWorkspaceImportDraftReport,
  runAgentMemoryBridgeCommand,
  resolveServiceLifecycleIntent,
  serviceStatePath,
  serviceUrlForPort,
  SHIPPED_CLI_COMMANDS,
  draftEscapedMissCalibrationCase,
  recordEscapedReviewMiss,
  validateReviewCalibrationCorpus,
  validateReviewPlanningCorpus,
  validateTaskSizingCorpus,
  writeModelBakeoffReport,
} from '../cli.js'

const tmpHomes: string[] = []

function tmpHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'guildhall-cli-test-'))
  tmpHomes.push(home)
  return home
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const home of tmpHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true })
  }
})

describe('resolveServiceLifecycleIntent', () => {
  it('treats serve as a friendly open-and-start path with a cwd launch hint', () => {
    const intent = resolveServiceLifecycleIntent('serve', [], {
      cwd: '/tmp/example-project',
    })

    expect(intent).toMatchObject({
      kind: 'serve',
      port: 7777,
      openBrowser: true,
      launchProjectPath: '/tmp/example-project',
    })
  })

  it('treats start as a fleet-level background service command', () => {
    const intent = resolveServiceLifecycleIntent('start', [], {
      cwd: '/tmp/not-a-project',
    })

    expect(intent).toMatchObject({
      kind: 'start',
      port: 7777,
      launchProjectPath: null,
      openBrowser: false,
    })
  })

  it('lets serve preserve an explicit project launch hint without rebinding service identity', () => {
    const intent = resolveServiceLifecycleIntent('serve', ['~/work/demo', '--port', '9001'], {
      cwd: '/tmp/elsewhere',
      homeDir: '/Users/tester',
    })

    expect(intent).toMatchObject({
      kind: 'serve',
      port: 7777,
      launchProjectPath: '/Users/tester/work/demo',
      openBrowser: true,
    })
  })

  it('recognizes open and stop as service lifecycle helpers', () => {
    expect(resolveServiceLifecycleIntent('open', [], { cwd: '/tmp/x' })?.kind).toBe('open')
    expect(resolveServiceLifecycleIntent('stop', [], { cwd: '/tmp/x' })?.kind).toBe('stop')
  })
})

describe('CLI service lifecycle helpers', () => {
  it('parses flags and positionals without letting boolean flags consume paths', () => {
    const parsed = parseArgs(['--no-open', '/tmp/project', '--port', '9001', '--verbose'])

    expect(parsed.positionals).toEqual(['/tmp/project'])
    expect(parsed.getFlag('--port')).toBe('9001')
    expect(parsed.getFlag('--missing')).toBeUndefined()
  })

  it('persists, reads, clears, and owner-clears service runtime state', () => {
    const home = tmpHome()
    const state = {
      pid: process.pid,
      port: 7777,
      url: serviceUrlForPort(7777),
      startedAt: '2026-05-19T16:00:00.000Z',
    }

    expect(serviceStatePath(home)).toBe(join(home, '.guildhall', 'service.json'))
    expect(readServiceRuntimeState(home)).toBeNull()

    persistServiceRuntimeState(state, home)
    expect(readServiceRuntimeState(home)).toEqual(state)

    clearServiceRuntimeStateIfOwnedByPid(process.pid + 100_000, home)
    expect(readServiceRuntimeState(home)).toEqual(state)

    clearServiceRuntimeStateIfOwnedByPid(process.pid, home)
    expect(readServiceRuntimeState(home)).toBeNull()

    persistServiceRuntimeState(state, home)
    clearServiceRuntimeState(home)
    expect(readServiceRuntimeState(home)).toBeNull()
  })

  it('ignores malformed service state files and drops stale recorded processes', async () => {
    const home = tmpHome()
    mkdirSync(join(home, '.guildhall'), { recursive: true })
    writeFileSync(serviceStatePath(home), JSON.stringify({ pid: 'bad', port: 7777, url: 'x', startedAt: 'now' }))
    expect(readServiceRuntimeState(home)).toBeNull()

    writeFileSync(serviceStatePath(home), '{not json')
    expect(readServiceRuntimeState(home)).toBeNull()

    persistServiceRuntimeState({
      pid: process.pid + 100_000,
      port: 7777,
      url: serviceUrlForPort(7777),
      startedAt: '2026-05-19T16:00:00.000Z',
    }, home)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))

    expect(await discoverServiceRuntimeState(7777, home)).toBeNull()
    expect(readServiceRuntimeState(home)).toBeNull()
  })

  it('discovers a live service over HTTP and caches it for later calls', async () => {
    const home = tmpHome()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      pid: process.pid,
      startedAt: '2026-05-19T16:00:00.000Z',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(probeLiveService(7788)).resolves.toEqual({
      pid: process.pid,
      port: 7788,
      url: 'http://localhost:7788',
      startedAt: '2026-05-19T16:00:00.000Z',
    })

    await expect(discoverServiceRuntimeState(7788, home)).resolves.toEqual({
      pid: process.pid,
      port: 7788,
      url: 'http://localhost:7788',
      startedAt: '2026-05-19T16:00:00.000Z',
    })
    expect(readServiceRuntimeState(home)?.pid).toBe(process.pid)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7788/api/service')
  })

  it('handles failed probes and exposes pid liveness checks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(process.pid + 100_000)).toBe(false)
    await expect(probeLiveService(7799)).resolves.toBeNull()
  })

  it('chooses setup or project routes from the launch path instead of ambient project state', () => {
    const initialized = tmpHome()
    writeFileSync(join(initialized, 'guildhall.yaml'), 'name: Initialized\nid: initialized\ncoordinators: []\n')
    const uninitialized = tmpHome()

    expect(launchRouteForProject(null)).toBe('/projects')
    expect(launchRouteForProject(initialized)).toBe('/project')
    const uninitializedId = uninitialized.split('/').pop()?.toLowerCase() ?? 'project'
    expect(launchRouteForProject(uninitialized)).toBe(`/projects/${uninitializedId}/setup`)
  })
})

describe('CLI run options', () => {
  it('forwards a named task into the orchestrator preferred-task scope', () => {
    expect(parseRunOptions([
      'narrative-harness',
      '--task',
      'task-theme-and-meaning-review',
      '--domain',
      'docs',
      '--max-ticks',
      '1',
      '--one-task',
    ])).toEqual({
      maxTicks: 1,
      stopAfterOneTask: true,
      domainFilter: 'docs',
      preferredTaskId: 'task-theme-and-meaning-review',
    })
  })

  it('documents named-task execution in the shipped help text', () => {
    expect(renderHelpText()).toContain('--task <id>                  Run one named task and its bounded child closure')
  })
})

describe('Guildhall CLI surface', () => {
  it('can request strict JSON-schema output from OpenAI-compatible JSON completions', async () => {
    let captured: Record<string, unknown> | undefined
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"items\\":[]}"},"finish_reason":"stop"}]}\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { status: 200 })
    }))

    const responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'guildhall_json_response',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
          required: ['items'],
          additionalProperties: false,
        },
      },
    }

    const text = await completeOpenAiCompatibleJson({
      baseUrl: 'https://api.deepinfra.com/v1/openai',
      apiKey: 'test-key',
      modelId: 'Qwen/Qwen3.5-35B-A3B',
      systemPrompt: 'Return JSON.',
      prompt: 'List items.',
      maxTokens: 64,
      responseFormat,
    })

    expect(text).toBe('{"items":[]}')
    expect(captured?.response_format).toEqual(responseFormat)
    expect(captured).not.toHaveProperty('service_tier')
  })

  it('derives semantic context-indexer budgets from prompt size instead of fixed magic caps', () => {
    const small = semanticCompletionBudget('short prompt')
    const large = semanticCompletionBudget('x'.repeat(16_000))

    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
    expect(large).toBeGreaterThanOrEqual(4_000)
  })

  it('gives semantic repair its own budget because repair includes raw output plus map context', () => {
    const prompt = 'x'.repeat(16_000)
    const raw = 'y'.repeat(6_000)

    expect(semanticRepairCompletionBudget(prompt, raw)).toBeGreaterThan(semanticCompletionBudget(prompt))
  })

  it('keeps the shipped command list focused on service, project registry, and debug run controls', () => {
    expect(SHIPPED_CLI_COMMANDS).toEqual([
      'init',
      'register',
      'unregister',
      'list',
      'run',
      'task',
      'serve',
      'start',
      'stop',
      'open',
      'config',
      'corpus-map',
      'memory',
      'migrate',
      'workspace-import',
      'review-calibration',
      'model-bakeoff',
      'benchmarks',
      'graph',
      'agent',
      'mcp',
      'bridge',
    ])
  })

  it('does not expose task mutation commands in help', () => {
    const help = renderHelpText()

    for (const command of SHIPPED_CLI_COMMANDS) {
      expect(help).toContain(`guildhall ${command}`)
    }

    expect(help).not.toContain('guildhall intake')
    expect(help).not.toContain('guildhall approve-spec')
    expect(help).not.toContain('guildhall resume')
    expect(help).not.toContain('guildhall meta-intake')
    expect(help).not.toContain('guildhall approve-meta-intake')
    expect(help).toContain('guildhall task run-once')
    expect(help).toContain('guildhall memory migrate-0.8.0')
    expect(help).toContain('guildhall memory mastra-audit')
    expect(help).toContain('guildhall migrate status')
    expect(help).toContain('guildhall migrate plan')
    expect(help).toContain('guildhall migrate apply')
    expect(help).toContain('guildhall workspace-import draft')
    expect(help).toContain('guildhall review-calibration escaped-miss')
    expect(help).toContain('guildhall review-calibration draft-case')
    expect(help).toContain('guildhall review-calibration validate-planning')
    expect(help).toContain('guildhall review-calibration validate-sizing')
    expect(help).toContain('guildhall graph request publish')
    expect(help).toContain('guildhall graph request import')
    expect(help).toContain('guildhall graph deliver')
    expect(help).toContain('guildhall graph delivery accept')
    expect(help).toContain('guildhall graph delivery return')
    expect(help).toContain('guildhall agent memory import')
    expect(help).toContain('guildhall agent memory review')
    expect(help).toContain('guildhall agent memory reject')
  })

  it('builds a read-only workspace-import draft report from one planning document', async () => {
    const project = tmpHome()
    const doc = join(project, 'old-plan.md')
    writeFileSync(doc, [
      '# Historical planning doc',
      '',
      '## Goal',
      '',
      '- Give owners a CLI-visible way to inspect decomposition before approving imports.',
      '',
      '## Current focus',
      '',
      '- Define fixture, expected-record, prototype-run, and evaluation schemas.',
      '- Add a regression fixture for historical Guildhall planning docs.',
      '',
      'Contracts: PrototypeRun, RunEvaluation, SchemaFieldUsage, PacketQualityScore.',
      'Verification: the fixture directory shape includes at least one small story fixture and expected records.',
      '',
      '## Later',
      '',
      '- Add dashboard comparison views after the CLI report is trustworthy.',
      '',
      '## Done',
      '',
      '- Existing CLI help lists shipped commands.',
      '',
    ].join('\n'))

    const before = existsSync(join(project, '.guildhall'))
    const report = await buildWorkspaceImportDraftReport({
      projectPath: project,
      fromFile: doc,
    })

    expect(before).toBe(false)
    expect(existsSync(join(project, '.guildhall'))).toBe(false)
    expect(report.sourceDocument).toBe(doc)
    expect(report.review.totalCurrentTaskCandidates).toBeGreaterThan(0)
    expect(report.review.totalLaterTaskCandidates).toBeGreaterThan(0)
    expect(report.draft.tasks.map(task => task.scope)).toContain('current')
    expect(report.draft.tasks.map(task => task.scope)).toContain('later')
    expect(report.warnings.some(warning => warning.code === 'read_only_report')).toBe(true)
    expect(report.warnings.some(warning => warning.code === 'generic_task_title')).toBe(false)
  })

  it('includes materialized proof expectations in full-project workspace-import draft reports', async () => {
    const project = tmpHome()
    mkdirSync(join(project, 'docs', 'harness'), { recursive: true })
    writeFileSync(join(project, 'docs', 'harness', 'implementation-roadmap.md'), [
      '# Implementation Roadmap',
      '',
      '## Stage 1: Headless Drafting And Evaluation MVP',
      '',
      'Deliverables:',
      '',
      '- Define fixture, expected-record, prototype-run, and evaluation schemas.',
      '',
      'Contracts: PrototypeRun, RunEvaluation, SchemaFieldUsage, PacketQualityScore.',
      'Verification: the fixture directory shape includes at least one small story fixture and expected records.',
      '',
      '## Current Next Milestone',
      '',
      'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
      '',
      '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
    ].join('\n'))

    const before = existsSync(join(project, '.guildhall'))
    const report = await buildWorkspaceImportDraftReport({ projectPath: project })

    expect(before).toBe(false)
    expect(existsSync(join(project, '.guildhall'))).toBe(false)
    expect(report.draft.tasks.some(task => (task.proofPaths?.length ?? 0) > 0)).toBe(true)
    expect(report.draft.tasks.find(task =>
      task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
    )?.proofPaths?.[0]?.expectedEvidence?.length).toBeGreaterThan(0)
  })

  it('exposes external-agent memory bridge import, review, and reject through explicit JSON CLI flows', async () => {
    const project = tmpHome()
    const recordFile = join(tmpHome(), 'bridge-record.json')
    mkdirSync(join(project, '.guildhall'), { recursive: true })
    writeFileSync(recordFile, JSON.stringify({
      id: 'cli-bridge-record',
      provider: 'codex',
      exchange: 'import',
      scope: 'project',
      type: 'codebase_knowledge',
      summary: 'CLI bridge records stay reviewable before execution.',
      content: 'Imported external memory should not enter execution context until review.',
      confidence: 'high',
      risk: 'low',
      freshness: 'fresh',
      evidenceRefs: [{
        kind: 'external-summary',
        ref: 'codex://session-cli#summary',
        summary: 'External session summary, not raw transcript.',
      }],
    }), 'utf8')

    const imported = JSON.parse(await runAgentMemoryBridgeCommand([
      'memory',
      'import',
      '--from-file',
      recordFile,
      '--project',
      project,
      '--json',
    ], { now: '2026-06-03T12:00:00.000Z' })) as { id: string; reviewStatus: string }
    expect(imported).toMatchObject({ id: 'cli-bridge-record', reviewStatus: 'imported' })
    expect(existsSync(join(project, '.guildhall', 'memory-store.json'))).toBe(false)

    const listed = JSON.parse(await runAgentMemoryBridgeCommand([
      'memory',
      'list',
      '--status',
      'imported',
      '--project',
      project,
      '--json',
    ])) as { records: Array<{ id: string }> }
    expect(listed.records.map(record => record.id)).toEqual(['cli-bridge-record'])

    const reviewed = JSON.parse(await runAgentMemoryBridgeCommand([
      'memory',
      'review',
      '--id',
      'cli-bridge-record',
      '--reviewer',
      'owner',
      '--project',
      project,
      '--json',
    ], { now: '2026-06-03T12:05:00.000Z' })) as { reviewStatus: string; reviewer: string }
    expect(reviewed).toMatchObject({ reviewStatus: 'reviewed', reviewer: 'owner' })
    expect(readFileSync(getProjectSystemStatePath(project, 'memory-store.json'), 'utf8')).toContain('external-cli-bridge-record')

    const rejectedFile = join(tmpHome(), 'bridge-rejected-record.json')
    writeFileSync(rejectedFile, JSON.stringify({
      id: 'cli-rejected-record',
      provider: 'claude-code',
      exchange: 'link',
      sourceRef: 'claude://session-rejected#summary',
      scope: 'project',
      type: 'project_fact',
      summary: 'Rejected records stay out of effective memory.',
      confidence: 'medium',
      risk: 'medium',
      freshness: 'recent',
      evidenceRefs: [{
        kind: 'external-link',
        ref: 'claude://session-rejected#summary',
        summary: 'External session link.',
      }],
    }), 'utf8')
    await runAgentMemoryBridgeCommand(['memory', 'import', '--from-file', rejectedFile, '--project', project])

    const rejected = JSON.parse(await runAgentMemoryBridgeCommand([
      'memory',
      'reject',
      '--id',
      'cli-rejected-record',
      '--reviewer',
      'owner',
      '--reason',
      'Outdated source summary.',
      '--project',
      project,
      '--json',
    ], { now: '2026-06-03T12:10:00.000Z' })) as { reviewStatus: string; rejectionReason: string }
    expect(rejected).toMatchObject({
      reviewStatus: 'rejected',
      rejectionReason: 'Outdated source summary.',
    })
    expect(readFileSync(getProjectSystemStatePath(project, 'memory-store.json'), 'utf8')).not.toContain('external-cli-rejected-record')
  })

  it('validates and records the review calibration corpus through persistence', async () => {
    const project = tmpHome()
    const priorDataDir = process.env.GUILDHALL_DATA_DIR
    const dataDir = join(tmpHome(), 'guildhall-data')
    process.env.GUILDHALL_DATA_DIR = dataDir
    try {
      const result = await validateReviewCalibrationCorpus({
        projectPath: project,
        recordedBy: 'calibration:test',
        now: () => new Date('2026-05-25T12:00:00.000Z'),
      })

      expect(result.summary.missingCaseIds).toEqual([])
      expect(result.summary.caseCount).toBeGreaterThanOrEqual(8)
      expect(result.summary.laneCoverage.security).toBeGreaterThan(0)
      expect(result.record.ref.path).toContain(join(dataDir, 'projects'))
      expect(result.record.payload.variantSet).toBe('review-calibration-corpus')
    } finally {
      if (priorDataDir === undefined) {
        delete process.env.GUILDHALL_DATA_DIR
      } else {
        process.env.GUILDHALL_DATA_DIR = priorDataDir
      }
    }
  })

  it('records escaped review misses through persistence for calibration follow-up', async () => {
    const project = tmpHome()
    const priorDataDir = process.env.GUILDHALL_DATA_DIR
    const dataDir = join(tmpHome(), 'guildhall-data')
    process.env.GUILDHALL_DATA_DIR = dataDir
    try {
      const result = await recordEscapedReviewMiss({
        projectPath: project,
        taskId: 'task-1',
        missedLane: 'ux_comprehension',
        humanFinding: 'The reviewer missed that the primary setup action was ambiguous.',
        nextCalibrationAction: 'create_case',
        missedByRecipe: 'product-ux-zero-context',
        recordedBy: 'calibration:test',
        recordedAt: '2026-05-25T12:05:00.000Z',
      })

      expect(result.ref.path).toContain(getProjectSystemStatePath(project, 'persistence/events/escaped-misses'))
      expect(result.payload).toMatchObject({
        taskId: 'task-1',
        missedLane: 'ux_comprehension',
        missedByRecipe: 'product-ux-zero-context',
        humanFinding: 'The reviewer missed that the primary setup action was ambiguous.',
        nextCalibrationAction: 'create_case',
        recordedAt: '2026-05-25T12:05:00.000Z',
        recordedBy: 'calibration:test',
      })
    } finally {
      if (priorDataDir === undefined) {
        delete process.env.GUILDHALL_DATA_DIR
      } else {
        process.env.GUILDHALL_DATA_DIR = priorDataDir
      }
    }
  })

  it('drafts a calibration case from an escaped review miss without writing ad hoc files', () => {
    const draft = draftEscapedMissCalibrationCase({
      taskId: 'task-1',
      missedLane: 'ux_comprehension',
      humanFinding: 'The reviewer missed that the primary setup action was ambiguous.',
      title: 'Ambiguous setup primary action escaped review',
      scenario: 'A setup card made the safe next action unclear.',
      recordedBy: 'calibration:test',
      recordedAt: '2026-05-25T12:05:00.000Z',
      labeledBy: 'calibration:test',
      labeledAt: '2026-05-25T12:10:00.000Z',
      reviewAfter: '2026-11-25',
    })

    expect(draft).toMatchObject({
      id: 'escaped-task-1-ux-comprehension',
      reviewLanes: ['ux_comprehension'],
      source: { kind: 'production_miss' },
      knownFindings: [{
        summary: 'The reviewer missed that the primary setup action was ambiguous.',
      }],
    })
  })

  it('validates and records the review planning corpus through persistence', async () => {
    const project = tmpHome()
    const priorDataDir = process.env.GUILDHALL_DATA_DIR
    const dataDir = join(tmpHome(), 'guildhall-data')
    process.env.GUILDHALL_DATA_DIR = dataDir
    try {
      const result = await validateReviewPlanningCorpus({
        projectPath: project,
        recordedBy: 'planning-calibration:test',
        now: () => new Date('2026-05-25T12:00:00.000Z'),
      })

      expect(result.summary.recommendedVariantId).toBeTruthy()
      expect(result.record.ref.path).toContain(join(dataDir, 'projects'))
      expect(result.record.payload.variantSet).toBe('review-planning-frontier')
      expect(result.record.payload.variants).toEqual([
        'lean',
        'balanced',
        'thorough',
        'balanced_split_ux_copy',
      ])
    } finally {
      if (priorDataDir === undefined) {
        delete process.env.GUILDHALL_DATA_DIR
      } else {
        process.env.GUILDHALL_DATA_DIR = priorDataDir
      }
    }
  })

  it('validates and records the task sizing corpus through persistence', async () => {
    const project = tmpHome()
    const priorDataDir = process.env.GUILDHALL_DATA_DIR
    const dataDir = join(tmpHome(), 'guildhall-data')
    process.env.GUILDHALL_DATA_DIR = dataDir
    try {
      const result = await validateTaskSizingCorpus({
        projectPath: project,
        recordedBy: 'task-sizing:test',
        now: () => new Date('2026-05-25T12:00:00.000Z'),
      })

      expect(result.summary.recommendedVariantId).toBe('split_sensitive')
      expect(result.record.ref.path).toContain(join(dataDir, 'projects'))
      expect(result.record.payload.variantSet).toBe('task-sizing-frontier')
      expect(result.record.payload.variants).toEqual(['balanced', 'split_sensitive'])
    } finally {
      if (priorDataDir === undefined) {
        delete process.env.GUILDHALL_DATA_DIR
      } else {
        process.env.GUILDHALL_DATA_DIR = priorDataDir
      }
    }
  })

  it('writes a model bakeoff report as json plus markdown', () => {
    const dir = tmpHome()
    const jsonPath = join(dir, 'reports', 'bakeoff.json')

    const result = writeModelBakeoffReport(jsonPath)

    expect(result.jsonPath).toBe(jsonPath)
    expect(result.markdownPath).toBe(join(dir, 'reports', 'bakeoff.md'))
    expect(existsSync(result.jsonPath)).toBe(true)
    expect(existsSync(result.markdownPath)).toBe(true)
    expect(JSON.parse(readFileSync(result.jsonPath, 'utf8'))).toMatchObject({
      scenarioCount: expect.any(Number),
      recommendation: expect.stringContaining('Recommend'),
    })
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('# Guildhall Model Bakeoff')
  })

  it('writes the context-indexer bakeoff report when requested', () => {
    const dir = tmpHome()
    const jsonPath = join(dir, 'reports', 'context-indexer.json')

    const result = writeModelBakeoffReport(jsonPath, { contextIndexer: true })
    const report = JSON.parse(readFileSync(result.jsonPath, 'utf8'))

    expect(report.scenarioCount).toBe(4)
    expect(report.recommendation).toContain('deepinfra-deepseek-v4-flash-context')
    expect(report.scenarios.every((scenario: { origin: string }) => scenario.origin === 'context-indexer')).toBe(true)
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('Context indexer')
  })
})
