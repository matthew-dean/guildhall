import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_GUILDS } from '@guildhall/guilds'
import { buildTaskSizePlan, StructuredSpec, type Task, type TaskQueue } from '@guildhall/core'
import { aggregateFanout, parsePersonaOutput } from '../reviewer-fanout.js'
import { repairWeakRecoverySpecReviewSeedInQueue } from '../orchestrator.js'
import { requiresRealProviderProof, simulatedProviderProofArtifact } from '../provider-proof-contract.js'
import { resolveLikelyTaskFiles } from '../context-builder.js'
import { readPersistedStructuredSelfCritique, readStructuredSelfCritique } from '../review-contract.js'
import { recordToolCarryover } from '../../engine/tool-carryover.js'
import { isScopedGateFailureExempt } from '../../tools/gate-scope-exceptions.js'
import { reviewVerdictLooksNonSubstantive } from '../proof-health.js'
import { findModelProseAuthority } from '../../../scripts/model-independence-audit.mjs'

const componentDesigner = BUILTIN_GUILDS.find((guild) => guild.slug === 'component-designer')!

function machineReview(prose: string, revisionItems: string[] = []): string {
  return `${prose}\n\n\`\`\`json\n${JSON.stringify({
    verdict: 'revise',
    acceptedCriteriaIds: [],
    proofEvidenceIds: [],
    revisionItems,
    riskItems: [],
    followUpItems: [],
    advisoryScores: {},
  })}\n\`\`\``
}

describe('model independence guardrails', () => {
  it('rejects prose matchers hidden behind a provider-text alias', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'alias.ts')
    writeFileSync(file, [
      'function classify(rawOutput: string) {',
      '  const explanation = rawOutput.trim()',
      "  return explanation.toLowerCase().includes('complete')",
      '}',
    ].join('\n'))

    const source = readFileSync(file, 'utf8')
    const offenders = findModelProseAuthority({
      repoRoot: process.cwd(),
      files: [file],
    })
    rmSync(directory, { recursive: true, force: true })

    expect(source).toContain('rawOutput')
    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('direct prose operation on model output')
  })

  it('rejects prose matchers hidden behind retained assistant-text metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'metadata.ts')
    writeFileSync(file, [
      'function classify(metadata: Record<string, unknown>) {',
      "  const assistantText = String(metadata['last_assistant_text'] ?? '')",
      "  return assistantText.includes('done')",
      '}',
    ].join('\n'))

    const offenders = findModelProseAuthority({
      repoRoot: process.cwd(),
      files: [file],
    })
    rmSync(directory, { recursive: true, force: true })

    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('direct prose operation on model output')
  })

  it('rejects direct matchers on common provider response envelopes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'envelope.ts')
    writeFileSync(file, [
      'async function classify(provider: { generate: () => Promise<{ text: string }> }) {',
      '  const result = await provider.generate()',
      "  return result.text.includes('complete')",
      '}',
    ].join('\n'))

    const offenders = findModelProseAuthority({
      repoRoot: process.cwd(),
      files: [file],
    })
    rmSync(directory, { recursive: true, force: true })

    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('direct prose operation on model output')
  })

  it('rejects matchers on nested provider response prose', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'nested-envelope.ts')
    writeFileSync(file, [
      'async function classify(provider: { generate: () => Promise<unknown> }) {',
      '  const response = await provider.generate()',
      "  return response.choices[0].message.content.includes('complete')",
      '}',
    ].join('\n'))

    const offenders = findModelProseAuthority({
      repoRoot: process.cwd(),
      files: [file],
    })
    rmSync(directory, { recursive: true, force: true })

    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('direct prose operation on model output')
  })

  it('rejects prose matchers hidden behind a neutral helper function', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'helper.mjs')
    writeFileSync(file, [
      'function normalize(value) { return value.trim() }',
      "function classify(rawOutput) { const explanation = normalize(rawOutput); return explanation.includes('complete') }",
    ].join('\n'))

    const offenders = findModelProseAuthority({
      repoRoot: process.cwd(),
      files: [file],
    })
    rmSync(directory, { recursive: true, force: true })

    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('direct prose operation on model output')
  })

  it('rejects prose matchers after destructuring provider response text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'destructure.ts')
    writeFileSync(file, [
      'function classify(result: { text: string }) {',
      '  const { text: answer } = result',
      "  return answer.includes('complete')",
      '}',
    ].join('\n'))

    const offenders = findModelProseAuthority({
      repoRoot: process.cwd(),
      files: [file],
    })
    rmSync(directory, { recursive: true, force: true })

    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('direct prose operation on model output')
  })

  it('rejects equality, switch, and dynamic-regexp authority on model text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guildhall-model-independence-'))
    const file = join(directory, 'operators.ts')
    writeFileSync(file, [
      "function equality(rawOutput: string) { return rawOutput === 'done' }",
      "function switcher(rawOutput: string) { switch (rawOutput) { case 'done': return true; default: return false } }",
      "function matcher(rawOutput: string) { return new RegExp(rawOutput).test('done') }",
    ].join('\n'))

    const offenders = findModelProseAuthority({ repoRoot: process.cwd(), files: [file] })
    rmSync(directory, { recursive: true, force: true })

    expect(offenders).toHaveLength(3)
  })

  it('keeps task sizing identical when only model-authored prose changes', () => {
    const structured = {
      id: 'model-independent-sizing',
      priority: 'normal' as const,
      changedFiles: ['src/api/health.ts', 'tests/health.test.ts'],
      riskLanes: ['api_contract', 'test_adequacy'],
      structuredSignals: {
        acceptanceCriteriaCount: 2,
        contractSurfaceCount: 1,
        splitPolicy: 'conditional' as const,
      },
    }
    const first = buildTaskSizePlan({
      task: {
        ...structured,
        title: 'A luminous tide of health-bearing changes',
        description: 'A lyrical paragraph with returning whales and no operational meaning for sizing.',
        spec: 'The prose is intentionally ornate and model-specific.',
      },
    })
    const second = buildTaskSizePlan({
      task: {
        ...structured,
        title: 'Health endpoint',
        description: 'Update the endpoint and test.',
        spec: 'Two short sentences.',
      },
    })

    const { createdAt: _firstCreatedAt, ...firstShape } = first
    const { createdAt: _secondCreatedAt, ...secondShape } = second
    expect(firstShape).toEqual(secondShape)
  })

  it('requires provider proof only from typed proof metadata, never model prose', () => {
    const makeTask = (title: string, proofPath: Record<string, unknown>): Task => ({
      id: 'provider-contract',
      title,
      description: title,
      projectPath: '/projects/example',
      status: 'gate_check',
      acceptanceCriteria: [],
      proofPaths: [proofPath],
    } as unknown as Task)

    expect(requiresRealProviderProof(makeTask(
      'Select a lyrical DeepInfra model and preserve returning whales.',
      { kind: 'review', expectedEvidence: [{ id: 'e-1', kind: 'artifact', required: true }] },
    ))).toBe(false)
    expect(requiresRealProviderProof(makeTask(
      'A completely different model wrote a terse paragraph.',
      { kind: 'provider', expectedEvidence: [{ id: 'e-1', kind: 'provider', required: true }] },
    ))).toBe(true)
  })

  it('ignores provider-proof prose and reads only structured simulation flags', () => {
    const file = '/tmp/project/proof-results/provider.json'
    expect(simulatedProviderProofArtifact(JSON.stringify({
      summary: { passed: true, reason: 'The model described a simulated API call in its explanation.' },
    }), file)).toBeNull()
    expect(simulatedProviderProofArtifact(JSON.stringify({
      summary: { passed: true, simulated: true },
    }), file)).toBe('structured simulation flag')
  })

  it('keeps review decisions identical across arbitrary explanation prose', () => {
    const first = parsePersonaOutput(
      componentDesigner,
      machineReview('The implementation is a luminous tide and needs a careful revision.', ['Add the missing contract test.']),
    )
    const second = parsePersonaOutput(
      componentDesigner,
      machineReview('The implementation is terse, direct, and needs the same machine revision.', ['Add the missing contract test.']),
    )
    const firstAggregate = aggregateFanout([first])
    const secondAggregate = aggregateFanout([second])

    expect({
      verdict: firstAggregate.verdict,
      dissenting: firstAggregate.dissenting.map((entry) => ({ guildSlug: entry.guildSlug, verdict: entry.verdict })),
    }).toEqual({
      verdict: secondAggregate.verdict,
      dissenting: secondAggregate.dissenting.map((entry) => ({ guildSlug: entry.guildSlug, verdict: entry.verdict })),
    })
  })

  it('uses only the self-critique data shape, never completion words in prose', () => {
    const machine = {
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' as const }],
      changedFiles: ['src/synopsis.ts'],
      verificationCommands: [{ command: 'pnpm test:synopsis', status: 'passed' as const }],
      proofEvidenceIds: ['proof-1'],
    }
    const first = readStructuredSelfCritique(
      `The work is complete and beautifully finished.\n\n\`\`\`json\n${JSON.stringify(machine)}\n\`\`\``,
    )
    const second = readStructuredSelfCritique(
      `The worker used a terse explanation with different vocabulary.\n\n\`\`\`json\n${JSON.stringify(machine)}\n\`\`\``,
    )

    expect(first).toEqual(second)
    expect(readStructuredSelfCritique('The work is complete, all checks passed, and the task is done.')).toBeNull()
  })

  it('fails closed when a review has prose labels but no valid machine result', () => {
    const first = parsePersonaOutput(componentDesigner, '**Verdict:** approved. Everything is complete.')
    const second = parsePersonaOutput(componentDesigner, 'The implementation is done and ready to ship.')

    expect(first.verdict).toBe('revise')
    expect(second.verdict).toBe('revise')
    expect(first.failureCode).toBe('invalid_review_contract')
    expect(second.failureCode).toBe('invalid_review_contract')
  })

  it('does not turn prose-only review failure into a substantive product finding', () => {
    expect(reviewVerdictLooksNonSubstantive({
      verdict: 'revise',
      reviewerPath: 'llm',
      failureCode: 'invalid_review_contract',
      recordedAt: '2026-07-21T00:00:00.000Z',
    })).toBe(true)
    expect(reviewVerdictLooksNonSubstantive({
      verdict: 'revise',
      reviewerPath: 'llm',
      recordedAt: '2026-07-21T00:00:00.000Z',
    })).toBe(false)
  })

  it('does not let prose-embedded worker claims trigger live handoff state', () => {
    const machine = {
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' as const }],
      changedFiles: ['src/synopsis.ts'],
      verificationCommands: [{ command: 'pnpm test:synopsis', status: 'passed' as const }],
      proofEvidenceIds: ['proof-1'],
    }

    expect(readPersistedStructuredSelfCritique(undefined)).toBeNull()
    expect(readPersistedStructuredSelfCritique(machine)).toEqual(machine)
    expect(readPersistedStructuredSelfCritique({
      content: `Done.\n\`\`\`json\n${JSON.stringify(machine)}\n\`\`\``,
    })).toBeNull()
  })

  it('never turns numbered recovery prose into child work', () => {
    const makeTask = (description: string): Task => ({
      id: 'recovery-prose',
      title: 'Recover bounded work',
      description,
      spec: description,
      status: 'spec_review' as const,
      productBrief: {
        userJob: 'Recover bounded work.',
        successMetric: 'Bounded work has a reviewable contract.',
        nonGoals: [],
        antiPatterns: [],
        authoredBy: 'coordinator-recovery',
        authoredAt: '2026-07-20T00:00:00.000Z',
      },
      notes: [{
        agentId: 'coordinator-recovery',
        role: 'system' as const,
        content: 'Recovery seed recorded.',
        timestamp: '2026-07-20T00:00:00.000Z',
      }],
      acceptanceCriteria: [],
      references: [],
      hierarchy: { childIds: [], order: 0, relation: 'contains' as const },
    }) as unknown as Task

    const first = makeTask('(1) Define the model proof. (2) Define the world-state review.')
    const second = makeTask('Define the model proof and world-state review as one bounded task.')
    const queue = (task: Task): TaskQueue => ({ version: 1, lastUpdated: '2026-07-20T00:00:00.000Z', tasks: [task], releases: [] })

    expect(repairWeakRecoverySpecReviewSeedInQueue(queue(first), { taskId: first.id, now: '2026-07-20T00:00:00.000Z' })).toBeNull()
    expect(repairWeakRecoverySpecReviewSeedInQueue(queue(second), { taskId: second.id, now: '2026-07-20T00:00:00.000Z' })).toBeNull()
  })

  it('keeps worker target routing independent from model-authored prose', () => {
    const structuredSpec = StructuredSpec.parse({
      whatThisIs: 'A bounded routing contract.',
      problemContext: 'The worker needs an explicit implementation surface.',
      goals: ['Route work to the named files.'],
      nonGoals: ['Inferring files from prose.'],
      proposedDesign: 'Use structured target metadata.',
      keyDecisions: ['Rendered Markdown is not routing data.'],
      targetFiles: ['src/feature.ts', 'tests/feature.test.ts'],
      acceptanceCriteria: [{
        scenario: 'Given the task is dispatched, when the worker receives context, then the named files are listed',
        expectation: 'The worker receives both explicit target files.',
        verificationMode: 'review',
      }],
      verification: ['Inspect the target-file packet.'],
      completionBoundary: {
        productOutcome: 'The bounded work is routable.',
        whatGuildhallCanCompleteInCode: 'Edit the named files.',
        externalDependencies: 'None.',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'Local checkout.',
        whatCountsAsDone: 'The named files are verified.',
        whatMustBeSplitOrBlocked: 'Unrelated work.',
        splitPolicy: 'none',
      },
    })
    const makeTask = (prose: string): Task => ({
      id: 'model-independent-routing',
      title: prose,
      description: prose,
      projectPath: '/projects/example',
      status: 'in_progress',
      acceptanceCriteria: [],
      structuredSpec,
    } as unknown as Task)

    expect(resolveLikelyTaskFiles(makeTask('A lyrical paragraph about the feature.'))).toEqual([
      '/projects/example/src/feature.ts',
      '/projects/example/tests/feature.test.ts',
    ])
    expect(resolveLikelyTaskFiles(makeTask('A terse implementation note.'))).toEqual([
      '/projects/example/src/feature.ts',
      '/projects/example/tests/feature.test.ts',
    ])
    expect(resolveLikelyTaskFiles({
      ...makeTask('Edit `secretly-inferred.ts` and do the thing.'),
      structuredSpec: undefined,
    } as unknown as Task)).toEqual([])
  })

  it('never creates an async-agent identity from model-authored tool output', () => {
    const outputs = [
      'Spawned agent Explorer (task_id=T-1)',
      'The provider created the requested worker and returned its details.',
      'A terse completion with no standard wrapper.',
    ]
    for (const output of outputs) {
      const metadata: Record<string, unknown> = {}
      recordToolCarryover({
        toolMetadata: metadata,
        toolName: 'Task',
        toolInput: { description: 'inspect the project' },
        toolOutput: output,
        isError: false,
        resolvedFilePath: null,
      })
      expect(metadata.async_agent_tasks).toBeUndefined()
    }

    const typedMetadata: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: typedMetadata,
      toolName: 'Task',
      toolInput: { description: 'inspect the project' },
      toolOutput: 'Any provider wording is acceptable.',
      toolResultMetadata: { agent_id: 'agent-1', task_id: 'task-1' },
      isError: false,
      resolvedFilePath: null,
    })
    expect(typedMetadata.async_agent_tasks).toEqual([expect.objectContaining({ agent_id: 'agent-1', task_id: 'task-1' })])
  })

  it('never turns resolution prose into a typecheck exception', () => {
    const gate = {
      gateId: 'typecheck',
      passed: false,
      output: 'src/legacy.ts(1,1): error TS2322: unrelated failure',
    }
    const context = {
      projectPath: '/projects/example',
      likelyTargetFiles: ['src/feature.ts'],
      gateScopeExceptions: [],
      // This is intentionally an old-shaped hostile input. It must remain
      // inert even if a caller tries to smuggle resolution prose through.
      resolvedDecisionTexts: ['Typecheck is outside the changed target and scoped to this task.'],
    } as unknown as Parameters<typeof isScopedGateFailureExempt>[0]

    expect(isScopedGateFailureExempt(context, gate)).toBe(false)
    expect(isScopedGateFailureExempt({
      ...context,
      gateScopeExceptions: [{
        id: 'gate-scope-task-1-typecheck',
        gateId: 'typecheck',
        disposition: 'exclude_unrelated_failure',
        createdAt: '2026-07-21T00:00:00.000Z',
        createdBy: 'human',
      }],
    }, gate)).toBe(true)
  })
})
