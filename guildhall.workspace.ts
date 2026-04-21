import { defineWorkspace } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Default Forge workspace — Looma + Knit
//
// This is the built-in workspace for working on Looma and Knit together.
// It ships with the Forge repo so you can run `guildhall run` from the repo root.
//
// To create a workspace for a different project, run:
//   guildhall init ~/path/to/workspace --name my-project
// ---------------------------------------------------------------------------

export default defineWorkspace({
  name: 'looma-knit',

  // Model assignment — LM Studio by default.
  // All models are loaded from LM Studio (http://localhost:1234/v1).
  // Override individual roles to use cloud models if preferred.
  models: {
    spec:        'qwen2.5-coder-32b-instruct',  // reasoning + instruction-following
    coordinator: 'qwen2.5-coder-32b-instruct',  // planning + negotiation
    worker:      'qwen2.5-coder-32b-instruct',  // code generation
    reviewer:    'qwen2.5-coder-14b-instruct',  // rubric evaluation (faster is fine)
    gateChecker: 'qwen2.5-coder-7b-instruct',   // shell commands (minimal LLM needed)
  },

  coordinators: [
    {
      id: 'looma',
      name: 'Looma Coordinator',
      mandate: `
        Looma is a stack-agnostic UI library built on web standards. It must stay general-purpose:
        no Knit-specific vocabulary in component APIs, no app business logic, no tight coupling
        to any single consumer. Every component shipped in Looma must be usable in a context
        completely unrelated to Knit. Accessibility and progressive enhancement are non-negotiable.
      `.trim(),
      projectPaths: [process.env['LOOMA_PATH'] ?? '../looma'],
      concerns: [
        {
          id: 'api-genericity',
          description: 'Component APIs must be domain-neutral.',
          reviewQuestions: [
            'Does this component name or API surface reference any Knit-specific concepts?',
            'Could this component be used in an app completely unrelated to Knit?',
          ],
        },
        {
          id: 'accessibility',
          description: 'All components must meet WCAG 2.1 AA.',
          reviewQuestions: [
            'Is this component keyboard-navigable?',
            'Are appropriate ARIA roles and attributes present?',
          ],
        },
        {
          id: 'documentation',
          description: 'Every shipped component needs a contract README, generated API metadata, docs page, and Storybook story.',
          reviewQuestions: [
            'Is there a contract README?',
            'Has generate:api been run and does docs-sync pass?',
            'Is there a Storybook story?',
          ],
        },
      ],
      autonomousDecisions: [
        'Approve or reject component promotion candidates from Knit',
        'Decide API naming for new primitives',
      ],
      escalationTriggers: [
        'Any change to the @looma/tokens public API surface',
        'Any decision that would break existing Knit consumers',
        'Disagreement with Knit coordinator that cannot be resolved in one round',
      ],
    },
    {
      id: 'knit',
      name: 'Knit Coordinator',
      mandate: `
        Knit is a wiki app for small teams. It uses Looma as its design system and must
        migrate progressively toward Looma primitives. Its primary obligation is product
        quality for real users. The Knit coordinator advocates for features and UX quality,
        negotiates with the Looma coordinator for the primitives it needs, and ensures
        that migration work does not regress the product.
      `.trim(),
      projectPaths: [process.env['KNIT_PATH'] ?? '../knit'],
      concerns: [
        {
          id: 'product-quality',
          description: 'The app must work correctly for users. Regressions are unacceptable.',
          reviewQuestions: [
            'Does this change affect any user-facing flow?',
            'Are there any regressions vs the current V1 feature set?',
          ],
        },
        {
          id: 'looma-migration',
          description: 'Knit should progressively migrate to Looma primitives.',
          reviewQuestions: [
            'Does this task advance the Looma migration inventory?',
            'Are Looma primitives being used where available?',
          ],
        },
        {
          id: 'velocity',
          description: 'V1 polish scope only. Keep it tight.',
          reviewQuestions: [
            'Is this task in V1 polish scope or V2?',
            'Is the implementation the simplest thing that works correctly?',
          ],
        },
      ],
      autonomousDecisions: [
        'Prioritize tasks within the V1 polish scope',
        'Approve minor migration steps already in the migration inventory',
      ],
      escalationTriggers: [
        'Any new V2 feature request',
        'Any change to the Supabase schema',
        'Disagreement with Looma coordinator that cannot be resolved in one round',
      ],
    },
  ],
})
