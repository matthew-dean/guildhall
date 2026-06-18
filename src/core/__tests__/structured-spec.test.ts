import { describe, expect, it } from 'vitest'

import {
  StructuredSpec,
  renderStructuredSpecMarkdown,
} from '../structured-spec.js'

describe('StructuredSpec', () => {
  it('tolerates agent-written acceptance criterion ids without storing them in structured specs', () => {
    const structured = StructuredSpec.parse({
      whatThisIs: 'A block menu for selection actions inside the Looma editor.',
      problemContext: 'The roadmap and answered shaping questions define the block menu scope and exclusions.',
      goals: ['Give editors a focused block menu for the approved actions.'],
      nonGoals: ['Do not add drag-and-drop reordering in this task.'],
      proposedDesign: 'Extend the existing editor action surface instead of inventing a second menu system.',
      keyDecisions: ['Use the current selection model as the menu anchor.'],
      acceptanceCriteria: [
        {
          id: 'ac-context-menu-opens',
          scenario: 'Given a selected block, when the menu opens',
          expectation: 'Then the approved actions are available.',
          verificationMode: 'review',
        },
      ],
      verification: ['Review the menu behavior in the local editor shell.'],
      completionBoundary: {
        productOutcome: 'Editors can use the approved block menu locally.',
        whatGuildhallCanCompleteInCode: 'The repo-local menu UI, behavior, and tests.',
        externalDependencies: 'None.',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'Local editor shell plus repo tests.',
        whatCountsAsDone: 'The block menu is reviewable and behaves as specified.',
        whatMustBeSplitOrBlocked: 'Drag-handle work stays split into a follow-up task.',
      },
    })

    expect(structured.acceptanceCriteria[0]).toEqual({
      scenario: 'Given a selected block, when the menu opens',
      expectation: 'Then the approved actions are available.',
      verificationMode: 'review',
    })
  })

  it('renders a deterministic markdown spec from the structured payload', () => {
    const structured = StructuredSpec.parse({
      whatThisIs: 'A block menu for selection actions inside the Looma editor.',
      problemContext: 'The roadmap and answered shaping questions define the block menu scope and exclusions.',
      goals: [
        'Give editors a focused block menu for the approved actions.',
      ],
      nonGoals: [
        'Do not add drag-and-drop reordering in this task.',
      ],
      proposedDesign: 'Extend the existing editor action surface instead of inventing a second menu system.',
      keyDecisions: [
        'Use the current selection model as the menu anchor.',
      ],
      contractSurfaceDeltas: [
        {
          proposedSurfaceLabel: 'Editor action component API',
          relation: 'extends',
          summary: 'Extends the editor action surface with a block menu entry point.',
          proposedInvariants: [
            {
              label: 'Selection actions share one entry point',
              rule: 'Block selection actions use the existing editor action entry point.',
              reason: 'Avoid a second action menu contract.',
            },
          ],
          proofObligations: ['Review the editor action component contract.'],
        },
      ],
      acceptanceCriteria: [
        {
          scenario: 'Given a selected block, when the menu opens',
          expectation: 'Then the approved actions are available.',
          verificationMode: 'review',
          negativeCase: 'Drag-and-drop reordering is not present in this task.',
        },
      ],
      verification: [
        'Review the menu behavior in the local editor shell.',
      ],
      userFacingBehavior: 'The menu appears beside the selected block and shows only the approved actions.',
      componentApiShape: 'Expose the menu through the existing editor action entry point instead of a new standalone route.',
      risksOpenQuestions: [
        'Future drag-handle work may require a follow-up task.',
      ],
      completionBoundary: {
        productOutcome: 'Editors can use the approved block menu locally.',
        whatGuildhallCanCompleteInCode: 'The repo-local menu UI, behavior, and tests.',
        externalDependencies: 'None.',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'Local editor shell plus repo tests.',
        whatCountsAsDone: 'The block menu is reviewable and behaves as specified.',
        whatMustBeSplitOrBlocked: 'Drag-handle work stays split into a follow-up task.',
      },
    })

    const markdown = renderStructuredSpecMarkdown(structured)

    expect(markdown).toContain('## What this is')
    expect(markdown).toContain('## Problem / Context')
    expect(markdown).toContain('## Goals')
    expect(markdown).toContain('## User-facing behavior')
    expect(markdown).toContain('## Component / API Shape')
    expect(markdown).toContain('## Contract Surface Deltas')
    expect(markdown).toContain('- Surface: Editor action component API')
    expect(markdown).toContain('Relation: extends')
    expect(markdown).toContain('Proof obligations: Review the editor action component contract.')
    expect(markdown).toContain('## Risks / Open Questions')
    expect(markdown).toContain('## Completion Boundary')
    expect(markdown).toContain('1. Scenario: Given a selected block, when the menu opens')
    expect(markdown).toContain('Expectation: Then the approved actions are available.')
    expect(markdown).toContain('Negative case: Drag-and-drop reordering is not present in this task.')
  })

  it('normalizes object-shaped risks and mitigations from agent tool calls', () => {
    const structured = StructuredSpec.parse({
      whatThisIs: 'A type-only story memory schema slice for Narrative Harness.',
      problemContext: 'The MVP needs durable records before runtime behavior can consume them.',
      goals: ['Define the core record interfaces.'],
      nonGoals: ['Do not add persistence or runtime code in this slice.'],
      proposedDesign: 'Create a TypeScript schema module that exports the named interfaces.',
      keyDecisions: ['Keep this slice type-only.'],
      acceptanceCriteria: [
        {
          scenario: 'Given the schema module exists, when TypeScript checks it',
          expectation: 'Then the type definitions compile without errors.',
          verificationMode: 'automated',
          command: 'npx tsc --noEmit',
        },
      ],
      verification: ['Run npx tsc --noEmit.'],
      risksOpenQuestions: [
        {
          risk: 'Schema names may need refinement after the first consumer lands.',
          mitigation: 'Keep the MVP slice type-only and easy to adjust.',
        },
        {
          question: 'Should persistence be JSONL or SQLite in a later slice?',
        },
      ],
      completionBoundary: {
        productOutcome: 'Agents can target stable story memory record shapes.',
        whatGuildhallCanCompleteInCode: 'The TypeScript interface definitions.',
        externalDependencies: 'None.',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'Local TypeScript compiler.',
        whatCountsAsDone: 'The schema module compiles and exports the agreed interfaces.',
        whatMustBeSplitOrBlocked: 'Runtime persistence and consumers stay split out.',
      },
    })

    expect(structured.risksOpenQuestions).toEqual([
      'Schema names may need refinement after the first consumer lands. - Mitigation: Keep the MVP slice type-only and easy to adjust.',
      'Should persistence be JSONL or SQLite in a later slice?',
    ])
  })
})
