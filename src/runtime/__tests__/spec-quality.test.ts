import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'
import {
  ownerSpecRevisionRequirements,
  validateProductBriefGrounding,
  validateSpecCompletionBoundary,
  validateSpecGrounding,
} from '../spec-quality.js'

const baseTask = {
  title: 'Build broad-genre drafting model proof',
  description: 'Evaluate DeepInfra-accessible candidates for voice and genre breadth.',
  references: ['docs/harness/headless-mvp-release-plan.md'],
  sourceClaims: [{
    source: 'workspace-importer',
    title: 'Build broad-genre drafting model proof',
    evidence: 'Evaluate DeepInfra-accessible candidates for voice and genre breadth.',
    references: ['docs/harness/headless-mvp-release-plan.md'],
    confidence: 'high' as const,
    linkedTaskHints: ['Build broad-genre drafting model proof'],
  }],
  request: undefined,
  requestIntake: undefined,
  productBrief: undefined,
}

const sourceCapabilityTask = {
  ...baseTask,
  capabilityBindings: [
    { capabilityId: 'cap:outline', relation: 'plans' as const },
    { capabilityId: 'cap:world-facts', relation: 'plans' as const },
  ] as NonNullable<Task['capabilityBindings']>,
}

describe('validateSpecGrounding', () => {
  it('uses only the active spec revision command while retaining earlier revision instructions', () => {
    const requirements = ownerSpecRevisionRequirements({
      notes: [{
        agentId: 'human',
        role: 'human',
        content: 'First run `pnpm test:old`.',
        timestamp: '2026-08-08T10:00:00.000Z',
        structured: {
          event: 'document_revision_requested',
          target: 'spec',
          requiredAcceptanceCommands: ['pnpm test:old'],
        },
      }, {
        agentId: 'human',
        role: 'human',
        content: 'Replace that proof with `pnpm test:new`.',
        timestamp: '2026-08-08T11:00:00.000Z',
        structured: {
          event: 'document_revision_requested',
          target: 'spec',
          requiredAcceptanceCommands: ['pnpm test:new'],
        },
      }],
    }, null)

    expect(requirements.instructions).toEqual([
      'First run `pnpm test:old`.',
      'Replace that proof with `pnpm test:new`.',
    ])
    expect(requirements.requiredAcceptanceCommands).toEqual(['pnpm test:new'])
  })

  it('rejects plausible commands, paths, and model choices that were not visible', () => {
    const result = validateSpecGrounding({
      ...baseTask,
      spec: 'Use mixtral and write scripts/proof-broad-genre-drafting.mjs. Run pnpm proof-broad-genre-drafting.',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('executable detail')
    expect(result.errors.join(' ')).toContain('model families')
  })

  it('allows facts and exact paths that are present in the visible packet', () => {
    const result = validateSpecGrounding({
      ...baseTask,
      spec: 'Review the DeepInfra-accessible candidates named by the task and cite docs/harness/headless-mvp-release-plan.md as the source.',
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('treats documented source references as grounding evidence even without source claims', () => {
    const result = validateSpecGrounding({
      ...baseTask,
      sourceClaims: [],
      spec: 'Run pnpm proof:evaluation and add src/reviewers/theme-proof.test.ts.',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('executable detail')
    expect(result.errors.join(' ')).toContain('project paths')
  })

  it('ignores model prose variation when the structured execution contract is unchanged', () => {
    const structuredSpec = {
      whatThisIs: 'A bounded contract.',
      problemContext: 'The visible task needs a proof boundary.',
      goals: ['Record the result.'],
      nonGoals: ['Do not expand scope.'],
      proposedDesign: 'Use the registered project surface.',
      keyDecisions: ['Keep the proof typed.'],
      acceptanceCriteria: [{
        scenario: 'Given the task, when the work is complete',
        expectation: 'Then the result is reviewable.',
        verificationMode: 'review' as const,
      }],
      verification: ['Review the recorded evidence.'],
      completionBoundary: {
        productOutcome: 'The result is reviewable.',
        whatGuildhallCanCompleteInCode: 'Record the result.',
        externalDependencies: 'None known.',
        ownerOnlySetup: 'None known.',
        verificationEnvironment: 'The registered project.',
        whatCountsAsDone: 'The result is recorded.',
        whatMustBeSplitOrBlocked: 'Split only for independent outcomes.',
      },
    }
    const terse = validateSpecGrounding({
      ...baseTask,
      spec: 'terse display text',
      structuredSpec,
    })
    const lyrical = validateSpecGrounding({
      ...baseTask,
      spec: 'lyrical display text with model-specific words, commands, and paths',
      structuredSpec: { ...structuredSpec, proposedDesign: 'A lyrical, ornate description with arbitrary vocabulary.' },
    })

    expect(lyrical).toEqual(terse)
    expect(lyrical).toEqual({ ok: true, errors: [] })
  })

  it('allows a new command only when a typed owner revision explicitly names it', () => {
    const structuredSpec = {
      whatThisIs: 'A bounded desktop proof contract.',
      problemContext: 'The owner requested a reproducible sidecar check.',
      goals: ['Prove the sidecar contract.'],
      nonGoals: ['Do not build the full desktop UI.'],
      proposedDesign: 'Add the focused proof entry requested by the owner.',
      keyDecisions: ['Keep the command typed.'],
      acceptanceCriteria: [{
        scenario: 'Given the desktop sidecar',
        expectation: 'Then its typed contract passes.',
        verificationMode: 'automated' as const,
        command: 'pnpm test:desktop-sidecar',
      }],
      verification: ['Run the typed acceptance command.'],
      completionBoundary: {
        productOutcome: 'The sidecar contract is proven.',
        whatGuildhallCanCompleteInCode: 'Add and run the focused proof.',
        externalDependencies: 'None known.',
        ownerOnlySetup: 'None known.',
        verificationEnvironment: 'The registered project.',
        whatCountsAsDone: 'The focused proof passes.',
        whatMustBeSplitOrBlocked: 'Split only independent outcomes.',
      },
    }

    const unsupported = validateSpecGrounding({ ...baseTask, structuredSpec })
    const ownerDirected = validateSpecGrounding(
      { ...baseTask, structuredSpec },
      {
        ownerRevisionInstructions: ['Add the exact command pnpm test:desktop-sidecar.'],
        requiredAcceptanceCommands: ['pnpm test:desktop-sidecar'],
      },
    )
    const omittedOwnerCommand = validateSpecGrounding(
      { ...baseTask, structuredSpec: {
        ...structuredSpec,
        acceptanceCriteria: structuredSpec.acceptanceCriteria.map(criterion => ({ ...criterion, command: undefined })),
      } },
      {
        ownerRevisionInstructions: ['Add the exact command pnpm test:desktop-sidecar.'],
        requiredAcceptanceCommands: ['pnpm test:desktop-sidecar'],
      },
    )

    expect(unsupported.ok).toBe(false)
    expect(unsupported.errors.join(' ')).toContain('not present in the visible task/source context')
    expect(ownerDirected).toEqual({ ok: true, errors: [] })
    expect(omittedOwnerCommand.errors).toContain(
      'Structured spec omits owner-required acceptance commands: pnpm test:desktop-sidecar.',
    )
  })
})

describe('validateProductBriefGrounding', () => {
  it('does not treat explanatory outcome prose as an executable contract', () => {
    const result = validateProductBriefGrounding(baseTask, {
      userJob: 'Evaluate broad-genre drafting behavior.',
      whyItMattersNow: 'The MVP needs a real drafting proof.',
      successMetric: 'scripts/proof-broad-genre-drafting.mjs runs successfully.',
      nonGoals: ['Do not build a UI.'],
      antiPatterns: ['Do not build a UI.'],
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('allows a source-grounded product outcome without executable guesses', () => {
    const result = validateProductBriefGrounding(baseTask, {
      userJob: 'Evaluate broad-genre drafting behavior.',
      whyItMattersNow: 'The MVP needs a real drafting proof.',
      successMetric: 'The visible evaluation boundary is shaped for provider-backed proof.',
      nonGoals: ['Do not build a UI.'],
      antiPatterns: ['Do not build a UI.'],
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('rejects a source-backed brief that silently omits a required capability ID', () => {
    const result = validateProductBriefGrounding(sourceCapabilityTask, {
      userJob: 'Expand the visible story input.',
      whyItMattersNow: 'The selected scope needs a complete source contract.',
      successMetric: 'The explicitly accepted source capabilities are planned.',
      nonGoals: ['Do not add an interface.'],
      sourceCapabilityIds: ['cap:outline'],
    })

    expect(result).toEqual({
      ok: false,
      errors: ['Product brief omits required source capability IDs: cap:world-facts.'],
    })
  })
})

describe('typed source capability coverage', () => {
  const structuredSpec = {
    whatThisIs: 'A bounded source-capability contract.',
    problemContext: 'The task has two explicit source capabilities.',
    goals: ['Preserve the declared source scope.'],
    nonGoals: ['Do not infer scope from prose.'],
    proposedDesign: 'Use typed capability links.',
    keyDecisions: ['Each capability has a structured acceptance anchor.'],
    sourceCapabilityIds: ['cap:outline', 'cap:world-facts'],
    acceptanceCriteria: [
      {
        scenario: 'Given a synopsis',
        expectation: 'Then an outline is recorded.',
        verificationMode: 'review' as const,
        sourceCapabilityIds: ['cap:outline'],
      },
      {
        scenario: 'Given a synopsis',
        expectation: 'Then world facts are recorded.',
        verificationMode: 'review' as const,
        sourceCapabilityIds: ['cap:world-facts'],
      },
    ],
    verification: ['Review typed acceptance evidence.'],
    completionBoundary: {
      productOutcome: 'Both declared source capabilities are available.',
      whatGuildhallCanCompleteInCode: 'Build the bounded source contract.',
      externalDependencies: 'None known.',
      ownerOnlySetup: 'None known.',
      verificationEnvironment: 'The registered project.',
      whatCountsAsDone: 'Both linked acceptance criteria are satisfied.',
      whatMustBeSplitOrBlocked: 'New independent outcomes remain separate.',
    },
  }

  it('rejects a structured spec whose acceptance links omit a required source capability', () => {
    const result = validateSpecGrounding({
      ...sourceCapabilityTask,
      structuredSpec: {
        ...structuredSpec,
        acceptanceCriteria: structuredSpec.acceptanceCriteria.slice(0, 1),
      },
    })

    expect(result).toEqual({
      ok: false,
      errors: ['Structured acceptance criteria omits required source capability IDs: cap:world-facts.'],
    })
  })

  it('uses typed links rather than spec prose to determine source coverage', () => {
    const terse = validateSpecGrounding({
      ...sourceCapabilityTask,
      structuredSpec,
    })
    const rewritten = validateSpecGrounding({
      ...sourceCapabilityTask,
      structuredSpec: {
        ...structuredSpec,
        proposedDesign: 'An entirely different narrative explanation with arbitrary wording.',
      },
    })

    expect(rewritten).toEqual(terse)
    expect(rewritten).toEqual({ ok: true, errors: [] })
  })
})

describe('validateSpecCompletionBoundary', () => {
  const structuredSpec = {
    whatThisIs: 'A bounded implementation contract.',
    problemContext: 'The current project needs one verifiable outcome.',
    goals: ['Implement the bounded outcome.'],
    nonGoals: ['Do not expand scope.'],
    proposedDesign: 'Use the existing project surface.',
    keyDecisions: ['Keep proof attached to the task.'],
    acceptanceCriteria: [{
      scenario: 'Given the task boundary, when the work is complete',
      expectation: 'The bounded outcome is available.',
      verificationMode: 'review' as const,
    }],
    verification: ['Review the changed surface and recorded evidence.'],
    completionBoundary: {
      productOutcome: 'The bounded outcome is available.',
      whatGuildhallCanCompleteInCode: 'Implement the bounded project work.',
      externalDependencies: 'None known.',
      ownerOnlySetup: 'None known.',
      verificationEnvironment: 'The registered local project.',
      whatCountsAsDone: 'The acceptance criterion is satisfied.',
      whatMustBeSplitOrBlocked: 'New product decisions remain separate.',
    },
  }

  it('requires the structured contract and ignores rendered Markdown wording', () => {
    const base = {
      ...baseTask,
      productBrief: {
        userJob: 'Complete the bounded project work.',
        successMetric: 'The structured acceptance contract is satisfied.',
      },
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'The bounded outcome is available.',
        verifiedBy: 'review' as const,
        met: false,
      }],
      structuredSpec,
      spec: 'A model may render this however it likes. No heading is authoritative.',
    }
    expect(validateSpecCompletionBoundary(base)).toEqual({ ok: true, errors: [] })
    expect(validateSpecCompletionBoundary({
      ...base,
      spec: 'Completely different prose, headings, ordering, and terminology.',
    })).toEqual({ ok: true, errors: [] })
  })

  it('fails closed when only a Markdown spec exists', () => {
    const result = validateSpecCompletionBoundary({
      ...baseTask,
      spec: '## Completion Boundary\n- Product outcome: Something works.',
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'Something works.',
        verifiedBy: 'review' as const,
        met: false,
      }],
      productBrief: {
        userJob: 'Complete the work.',
        successMetric: 'The work is verifiable.',
      },
      structuredSpec: undefined,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('structuredSpec')
  })
})
