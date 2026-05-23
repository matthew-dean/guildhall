import type { LearningCandidate } from './policy.js'

export type BakeoffScenarioOrigin = '0.5.0-flow-audit' | 'context-indexer' | 'custom'
export type BakeoffOutcome = 'pass' | 'fail' | 'blocked'

export interface ReplayScenario {
  id: string
  title: string
  origin: BakeoffScenarioOrigin
  summary: string
  expectedSignals: string[]
  expectedPlaybook?: string
}

export interface ModelLaneConfig {
  id: string
  label: string
  kind: 'deterministic' | 'model'
  model?: string
  role?: 'spec' | 'coordinator' | 'worker' | 'reviewer' | 'gateChecker' | 'contextIndexer'
}

export interface EvaluationLadderTrack {
  id: string
  label: string
  repo: string
  corpusKind: 'documentation' | 'code' | 'design-system' | 'hard-architecture'
  pathHint: string
  purpose: string
  expectedSignals: string[]
}

export interface ReplayRunRecord {
  scenarioId: string
  laneId: string
  outcome: BakeoffOutcome
  toolCount: number
  wallTimeMs: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  falseEscalations: number
  falseApprovals: number
  playbookSuccesses: number
  playbookFailures: number
  packetQuality: number
}

export interface LaneReport {
  laneId: string
  label: string
  kind: ModelLaneConfig['kind']
  model?: string
  runCount: number
  completedTasks: number
  failedTasks: number
  blockedTasks: number
  totalToolCount: number
  totalWallTimeMs: number
  inputTokens: number
  outputTokens: number
  totalEstimatedCostUsd: number
  costPerCompletedTaskUsd: number | null
  falseEscalations: number
  falseApprovals: number
  recoveryLoops: number
  costPerRecoveryLoopUsd: number | null
  playbookSuccessRate: number | null
  averagePacketQuality: number | null
  scenarioOutcomes: Array<{
    scenarioId: string
    outcome: BakeoffOutcome
    estimatedCostUsd: number
    packetQuality: number
  }>
}

export interface BakeoffReport {
  generatedAt: string
  scenarioCount: number
  scenarios: ReplayScenario[]
  evaluationLadder?: EvaluationLadderTrack[]
  lanes: LaneReport[]
  runs: ReplayRunRecord[]
  recommendation: string
}

export const DETERMINISTIC_BASELINE_LANE: ModelLaneConfig = {
  id: 'deterministic-baseline',
  label: 'Deterministic fallback',
  kind: 'deterministic',
}

export const historicalFailureScenarios: ReplayScenario[] = [
  {
    id: 'imported-draft-shaping',
    title: 'Imported draft shaping into a runnable task',
    origin: '0.5.0-flow-audit',
    summary: 'The imported draft must become a runnable task instead of a placeholder.',
    expectedSignals: ['draft shaped', 'acceptance criteria present', 'runnable status'],
  },
  {
    id: 'dirty-checkout-before-worktree',
    title: 'Dirty checkout before worktree creation',
    origin: '0.5.0-flow-audit',
    summary: 'A dirty repository should produce a concrete commit/stash recovery path.',
    expectedSignals: ['dirty checkout classified', 'human recovery action named'],
    expectedPlaybook: 'prepare_dirty_checkout_for_worktree',
  },
  {
    id: 'failed-typecheck-in-touched-files',
    title: 'Failed typecheck in touched files',
    origin: '0.5.0-flow-audit',
    summary: 'Self-authored verification failures should route to focused repair.',
    expectedSignals: ['self-authored verification classified', 'touched files scoped'],
    expectedPlaybook: 'repair_touched_file_failure',
  },
  {
    id: 'stale-old-string',
    title: 'Stale oldString edit target',
    origin: '0.5.0-flow-audit',
    summary: 'Stale edit targets should trigger a narrow re-read and patch refresh.',
    expectedSignals: ['stale edit classified', 'target file reread'],
    expectedPlaybook: 'refresh_stale_edit_target',
  },
  {
    id: 'warning-only-exit-zero',
    title: 'Warning-only exit 0',
    origin: '0.5.0-flow-audit',
    summary: 'Warnings on successful commands must not be treated as failed gates.',
    expectedSignals: ['exit zero honored', 'warning summarized'],
  },
  {
    id: 'reviewer-infrastructure-noise',
    title: 'Reviewer fan-out infrastructure noise',
    origin: '0.5.0-flow-audit',
    summary: 'Infrastructure errors from reviewer lanes should not masquerade as product revisions.',
    expectedSignals: ['reviewer infra noise classified', 'decision packet compact'],
  },
  {
    id: 'no-tool-worker-after-checkpoint',
    title: 'No-tool worker turn after checkpoint',
    origin: '0.5.0-flow-audit',
    summary: 'A worker that stops using tools after a checkpoint should be redirected or stopped.',
    expectedSignals: ['checkpoint honored', 'no-tool turn detected'],
  },
  {
    id: 'draft-queue-awaiting-human',
    title: 'Draft queue awaiting human shaping',
    origin: '0.5.0-flow-audit',
    summary: 'Draft-only queues should report awaiting-human instead of pretending work is running.',
    expectedSignals: ['awaiting human', 'draft count surfaced'],
  },
  {
    id: 'false-source-file-escalation-after-test-progress',
    title: 'False source-file escalation after test-only progress',
    origin: '0.5.0-flow-audit',
    summary: 'Test-only progress should not create a false source-file blocker.',
    expectedSignals: ['test progress recognized', 'false escalation avoided'],
  },
  {
    id: 'post-handoff-empty-reviewer-turn',
    title: 'Post-handoff empty reviewer turn',
    origin: '0.5.0-flow-audit',
    summary: 'Empty reviewer turns should produce explicit lane failure evidence.',
    expectedSignals: ['empty turn detected', 'reviewer lane marked failed'],
  },
  {
    id: 'tool-call-missing-mutation-fields',
    title: 'Model tool call with missing mutation fields',
    origin: '0.5.0-flow-audit',
    summary: 'Malformed mutation calls should be repaired or rejected with schema evidence.',
    expectedSignals: ['schema failure captured', 'repair attempted'],
  },
  {
    id: 'repeated-read-only-turns-after-target-discovery',
    title: 'Repeated read-only turns after exact target discovery',
    origin: '0.5.0-flow-audit',
    summary: 'Read-only loops after exact target discovery should stop or force a bounded edit attempt.',
    expectedSignals: ['read-only loop detected', 'bounded next action'],
  },
]

export const contextIndexerScenarios: ReplayScenario[] = [
  {
    id: 'canonical-abstraction-purpose',
    title: 'Context indexer identifies the canonical abstraction and purpose',
    origin: 'context-indexer',
    summary: 'Given several similarly named UI controls, the context indexer should identify the canonical button/status primitive and explain when to reuse it.',
    expectedSignals: ['canonical abstraction named', 'purpose explained', 'avoid parallel primitive'],
  },
  {
    id: 'legacy-versus-current-path',
    title: 'Context indexer distinguishes legacy paths from current architecture',
    origin: 'context-indexer',
    summary: 'Given old docs, generated files, and current runtime code, the context indexer should mark the current source of truth and warn about stale scaffolding.',
    expectedSignals: ['current path named', 'legacy path flagged', 'read-next guidance'],
  },
  {
    id: 'design-system-drift-summary',
    title: 'Context indexer summarizes design-system drift and just-in-time abstraction need',
    origin: 'context-indexer',
    summary: 'Given repeated one-off UI styles, the context indexer should call out the repeated concept and recommend reuse or a small shared primitive.',
    expectedSignals: ['repetition detected', 'design-system gap summarized', 'just-in-time abstraction'],
  },
  {
    id: 'semantic-contract-summary',
    title: 'Context indexer captures module contracts without dumping source',
    origin: 'context-indexer',
    summary: 'Given a runtime module, tests, and adjacent docs, the context indexer should summarize what contract the module protects and which files verify it.',
    expectedSignals: ['contract summarized', 'verification path named', 'bounded source references'],
  },
]

export const deepInfraContextIndexerLanes: ModelLaneConfig[] = [
  {
    id: 'deepinfra-deepseek-v4-flash-context',
    label: 'Context indexer — DeepSeek V4 Flash',
    kind: 'model',
    role: 'contextIndexer',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
  },
  {
    id: 'deepinfra-qwen3-6-35b-context',
    label: 'Context indexer — Qwen 3.6 35B A3B',
    kind: 'model',
    role: 'contextIndexer',
    model: 'Qwen/Qwen3.6-35B-A3B',
  },
  {
    id: 'deepinfra-glm-4-6-context',
    label: 'Context indexer — GLM 4.6',
    kind: 'model',
    role: 'contextIndexer',
    model: 'zai-org/GLM-4.6',
  },
]

export const contextIndexerTestLadder: EvaluationLadderTrack[] = [
  {
    id: 'docs-intent-narrative-harness',
    label: 'Documentation and product-intent corpus',
    repo: 'narrative-harness',
    corpusKind: 'documentation',
    pathHint: '/Users/matthew/git/oss/narrative-harness',
    purpose:
      'Check whether the context indexer can summarize product theory, specs, decisions, and future architecture intent without inventing implementation details.',
    expectedSignals: [
      'documentation-first corpus classified',
      'implementation gaps named',
      'product intent summarized without code claims',
    ],
  },
  {
    id: 'code-corpus-linecraft',
    label: 'Small-to-medium real code corpus',
    repo: 'linecraft',
    corpusKind: 'code',
    pathHint: '/Users/matthew/git/oss/linecraft',
    purpose:
      'Check whether the context indexer can map a real code architecture, identify canonical modules, and give useful read-next guidance at modest cost.',
    expectedSignals: [
      'source areas mapped',
      'canonical abstractions identified',
      'verification entrypoints named',
    ],
  },
  {
    id: 'design-system-guildhall-ui',
    label: 'Design-system reuse stress slice',
    repo: 'guildhall',
    corpusKind: 'design-system',
    pathHint: '/Users/matthew/git/oss/guildhall/src/web + /Users/matthew/git/oss/guildhall/packages/ui',
    purpose:
      'Check whether the context indexer can steer workers toward existing UI primitives and flag one-off styling or component drift.',
    expectedSignals: [
      'shared UI primitives named',
      'design-system gaps summarized',
      'one-off duplication risks flagged',
    ],
  },
  {
    id: 'hard-architecture-jess',
    label: 'Hard compiler/parser architecture corpus',
    repo: 'jess',
    corpusKind: 'hard-architecture',
    pathHint: '/Users/matthew/git/oss/jess',
    purpose:
      'Check whether the context indexer still produces useful orientation when architecture is deeper, more coupled, and easier to summarize incorrectly.',
    expectedSignals: [
      'deep architecture boundaries preserved',
      'stale or misleading paths avoided',
      'read-next guidance stays bounded',
    ],
  },
]

function roundMoney(value: number): number {
  return Number(value.toFixed(6))
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function laneScore(lane: LaneReport): number {
  return (
    lane.completedTasks * 100 -
    lane.failedTasks * 50 -
    lane.blockedTasks * 25 -
    lane.falseEscalations * 20 -
    lane.falseApprovals * 30 -
    lane.totalEstimatedCostUsd
  )
}

export function aggregateBakeoffReport(input: {
  scenarios: readonly ReplayScenario[]
  lanes: readonly ModelLaneConfig[]
  runs: readonly ReplayRunRecord[]
  generatedAt?: string
}): BakeoffReport {
  const lanes = input.lanes.map((lane): LaneReport => {
    const laneRuns = input.runs.filter((run) => run.laneId === lane.id)
    const completedTasks = laneRuns.filter((run) => run.outcome === 'pass').length
    const failedTasks = laneRuns.filter((run) => run.outcome === 'fail').length
    const blockedTasks = laneRuns.filter((run) => run.outcome === 'blocked').length
    const totalEstimatedCostUsd = roundMoney(
      laneRuns.reduce((sum, run) => sum + run.estimatedCostUsd, 0),
    )
    const recoveryLoops = laneRuns.reduce(
      (sum, run) => sum + run.playbookSuccesses + run.playbookFailures,
      0,
    )
    const playbookSuccesses = laneRuns.reduce((sum, run) => sum + run.playbookSuccesses, 0)
    const packetQuality = average(laneRuns.map((run) => run.packetQuality))
    return {
      laneId: lane.id,
      label: lane.label,
      kind: lane.kind,
      ...(lane.model ? { model: lane.model } : {}),
      runCount: laneRuns.length,
      completedTasks,
      failedTasks,
      blockedTasks,
      totalToolCount: laneRuns.reduce((sum, run) => sum + run.toolCount, 0),
      totalWallTimeMs: laneRuns.reduce((sum, run) => sum + run.wallTimeMs, 0),
      inputTokens: laneRuns.reduce((sum, run) => sum + run.inputTokens, 0),
      outputTokens: laneRuns.reduce((sum, run) => sum + run.outputTokens, 0),
      totalEstimatedCostUsd,
      costPerCompletedTaskUsd:
        completedTasks > 0 ? roundMoney(totalEstimatedCostUsd / completedTasks) : null,
      falseEscalations: laneRuns.reduce((sum, run) => sum + run.falseEscalations, 0),
      falseApprovals: laneRuns.reduce((sum, run) => sum + run.falseApprovals, 0),
      recoveryLoops,
      costPerRecoveryLoopUsd:
        recoveryLoops > 0 ? roundMoney(totalEstimatedCostUsd / recoveryLoops) : null,
      playbookSuccessRate:
        recoveryLoops > 0 ? playbookSuccesses / recoveryLoops : null,
      averagePacketQuality: packetQuality === null ? null : Number(packetQuality.toFixed(2)),
      scenarioOutcomes: laneRuns.map((run) => ({
        scenarioId: run.scenarioId,
        outcome: run.outcome,
        estimatedCostUsd: run.estimatedCostUsd,
        packetQuality: run.packetQuality,
      })),
    }
  })
  const best = [...lanes].sort((a, b) => laneScore(b) - laneScore(a))[0]
  const recommendation = best
    ? `Recommend ${best.laneId}: ${best.completedTasks}/${input.scenarios.length} completed, ${best.falseEscalations} false escalation(s), ${best.falseApprovals} false approval(s), $${best.totalEstimatedCostUsd.toFixed(6)} estimated.`
    : 'No lane recommendation available: no lanes were evaluated.'
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scenarioCount: input.scenarios.length,
    scenarios: [...input.scenarios],
    lanes,
    runs: [...input.runs],
    recommendation,
  }
}

function simulatedRun(scenario: ReplayScenario, lane: ModelLaneConfig): ReplayRunRecord {
  if (lane.role === 'contextIndexer' || scenario.origin === 'context-indexer') {
    const model = `${lane.model ?? lane.id}`.toLowerCase()
    const isDeepSeek = model.includes('deepseek')
    const isQwen = model.includes('qwen')
    const isGlm = model.includes('glm')
    const pass = isDeepSeek || isQwen || (isGlm && scenario.id !== 'design-system-drift-summary')
    const quality = isDeepSeek ? 0.91 : isQwen ? 0.88 : isGlm ? 0.84 : 0.7
    const inputTokens = scenario.id === 'semantic-contract-summary' ? 6200 : 4200
    const outputTokens = isDeepSeek ? 520 : isQwen ? 640 : 760
    return {
      scenarioId: scenario.id,
      laneId: lane.id,
      outcome: pass ? 'pass' : 'fail',
      toolCount: pass ? 2 : 4,
      wallTimeMs: isDeepSeek ? 900 : isQwen ? 1250 : 1500,
      inputTokens,
      outputTokens,
      estimatedCostUsd: roundMoney(
        isDeepSeek
          ? (inputTokens * 0.14 + outputTokens * 0.28) / 1_000_000
          : isQwen
            ? (inputTokens * 0.15 + outputTokens * 0.8) / 1_000_000
            : (inputTokens * 0.8 + outputTokens * 2.4) / 1_000_000,
      ),
      falseEscalations: pass ? 0 : 1,
      falseApprovals: 0,
      playbookSuccesses: pass ? 1 : 0,
      playbookFailures: pass ? 0 : 1,
      packetQuality: pass ? quality : 0.45,
    }
  }
  const deterministicPass = [
    'dirty-checkout-before-worktree',
    'failed-typecheck-in-touched-files',
    'stale-old-string',
    'warning-only-exit-zero',
    'reviewer-infrastructure-noise',
    'draft-queue-awaiting-human',
  ].includes(scenario.id)
  const isStrong = /strong|large|sonnet|opus|gpt-5/i.test(`${lane.id} ${lane.model ?? ''}`)
  const pass = lane.kind === 'deterministic' ? deterministicPass : isStrong || scenario.id !== 'tool-call-missing-mutation-fields'
  const tokenScale = lane.kind === 'deterministic' ? 0 : isStrong ? 4 : 1
  const estimatedCostUsd = lane.kind === 'deterministic'
    ? 0
    : tokenScale * (pass ? 0.012 : 0.018)
  const hasPlaybook = Boolean(scenario.expectedPlaybook)
  return {
    scenarioId: scenario.id,
    laneId: lane.id,
    outcome: pass ? 'pass' : 'fail',
    toolCount: pass ? 3 + tokenScale : 5 + tokenScale,
    wallTimeMs: lane.kind === 'deterministic' ? 40 : 180 * tokenScale,
    inputTokens: 1200 * tokenScale,
    outputTokens: 420 * tokenScale,
    estimatedCostUsd,
    falseEscalations: pass ? 0 : 1,
    falseApprovals: pass ? 0 : scenario.id.includes('reviewer') ? 1 : 0,
    playbookSuccesses: hasPlaybook && pass ? 1 : 0,
    playbookFailures: hasPlaybook && !pass ? 1 : 0,
    packetQuality: pass ? (lane.kind === 'deterministic' ? 0.82 : 0.88) : 0.35,
  }
}

export function runModelBakeoff(input: {
  scenarios?: readonly ReplayScenario[]
  lanes?: readonly ModelLaneConfig[]
  generatedAt?: string
} = {}): BakeoffReport {
  const scenarios = [...(input.scenarios ?? historicalFailureScenarios)]
  const lanes = [...(input.lanes ?? [
    DETERMINISTIC_BASELINE_LANE,
    { id: 'cheap-model-lane', label: 'Cheap model lane', kind: 'model' as const, model: 'small-tool-user' },
    { id: 'strong-model-lane', label: 'Strong model lane', kind: 'model' as const, model: 'large-tool-user' },
  ])]
  const runs = lanes.flatMap((lane) => scenarios.map((scenario) => simulatedRun(scenario, lane)))
  return aggregateBakeoffReport({ scenarios, lanes, runs, generatedAt: input.generatedAt })
}

export function runContextIndexerBakeoff(input: {
  generatedAt?: string
} = {}): BakeoffReport {
  const report = runModelBakeoff({
    scenarios: contextIndexerScenarios,
    lanes: deepInfraContextIndexerLanes,
    generatedAt: input.generatedAt,
  })
  return {
    ...report,
    evaluationLadder: contextIndexerTestLadder,
  }
}

export function learningCandidatesFromBakeoffReport(report: BakeoffReport): LearningCandidate[] {
  const candidates: LearningCandidate[] = []
  for (const lane of report.lanes) {
    if (lane.failedTasks === 0 && lane.falseEscalations === 0 && lane.falseApprovals === 0) continue
    candidates.push({
      id: `bakeoff-${lane.laneId}-model-lane`,
      source: 'model_eval',
      summary:
        `Bakeoff lane ${lane.laneId} completed ${lane.completedTasks}/${report.scenarioCount} scenarios with ${lane.falseEscalations} false escalation(s) and ${lane.falseApprovals} false approval(s).`,
      evidence: lane.scenarioOutcomes
        .filter((outcome) => outcome.outcome !== 'pass')
        .map((outcome) => ({
          kind: 'review' as const,
          summary: `${outcome.scenarioId}: ${outcome.outcome}, packet quality ${outcome.packetQuality}`,
          ref: outcome.scenarioId,
        })),
      proposedScope: 'user_global',
      proposedDestination: 'model_lane_recommendation',
      confidence: lane.failedTasks > 1 ? 'medium' : 'low',
      risk: 'low',
      requiresApproval: true,
    })
    candidates.push({
      id: `bakeoff-${lane.laneId}-product`,
      source: 'model_eval',
      summary:
        `Bakeoff found policy/runtime gaps for ${lane.laneId}; failed or noisy scenarios should become product follow-up evidence.`,
      evidence: lane.scenarioOutcomes
        .filter((outcome) => outcome.outcome !== 'pass')
        .map((outcome) => ({
          kind: 'task' as const,
          summary: `${outcome.scenarioId}: ${outcome.outcome}`,
          ref: outcome.scenarioId,
        })),
      proposedScope: 'guildhall_product',
      proposedDestination: 'product_suggestion',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    })
  }
  return candidates
}

export function renderBakeoffMarkdown(report: BakeoffReport): string {
  const lines = [
    '# Guildhall Model Bakeoff',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Recommendation: ${report.recommendation}`,
    '',
    '| Lane | Completed | Failed | False escalations | False approvals | Cost | Cost/completed | Cost/recovery | Packet quality |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const lane of report.lanes) {
    const laneLabel = lane.label === lane.laneId ? lane.laneId : `${lane.label} (${lane.laneId})`
    lines.push(
      [
        laneLabel,
        `${lane.completedTasks}/${report.scenarioCount}`,
        String(lane.failedTasks),
        String(lane.falseEscalations),
        String(lane.falseApprovals),
        `$${lane.totalEstimatedCostUsd.toFixed(6)}`,
        lane.costPerCompletedTaskUsd === null ? 'n/a' : `$${lane.costPerCompletedTaskUsd.toFixed(6)}`,
        lane.costPerRecoveryLoopUsd === null ? 'n/a' : `$${lane.costPerRecoveryLoopUsd.toFixed(6)}`,
        lane.averagePacketQuality === null ? 'n/a' : lane.averagePacketQuality.toFixed(2),
      ].join(' | '),
    )
  }
  if (report.evaluationLadder?.length) {
    lines.push(
      '',
      '## Evaluation ladder',
      '',
      '| Track | Repo | Corpus | Purpose |',
      '|---|---|---|---|',
    )
    for (const track of report.evaluationLadder) {
      lines.push([
        track.label,
        track.repo,
        track.corpusKind,
        track.purpose,
      ].join(' | '))
    }
  }
  return `${lines.join('\n')}\n`
}
