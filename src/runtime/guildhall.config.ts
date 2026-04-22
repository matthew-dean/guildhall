import type { CoordinatorDomain, ModelAssignmentConfig } from '@guildhall/core'
import { STANDARD_TS_GATES, STANDARD_CODE_REVIEW_RUBRIC, DEFAULT_LOCAL_MODEL_ASSIGNMENT } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Forge config for the Looma + Knit project
//
// Copy this file per project and adjust the coordinator domains, gate sets,
// and project paths. The rest of the runtime uses this config.
// ---------------------------------------------------------------------------

export interface ForgeConfig {
  // Absolute path to the memory/ directory
  memoryDir: string
  // Which model to use for each agent role
  models: ModelAssignmentConfig
  // Coordinator domain definitions
  coordinators: CoordinatorDomain[]
  // Max revision cycles before a task is escalated as blocked
  maxRevisions: number
  // How often (in task transitions) to write a heartbeat progress entry
  heartbeatInterval: number
}

export const forgeConfig: ForgeConfig = {
  memoryDir: process.env['FORGE_MEMORY_DIR'] ?? './memory',

  // ---------------------------------------------------------------------------
  // Model assignment
  //
  // Defaults to local LM Studio models. Override individual roles by replacing
  // model IDs — see MODEL_CATALOG in @guildhall/core for the full list with notes.
  //
  // All model IDs listed here are loaded from LM Studio (localhost:1234).
  // To use cloud models for specific roles, change the ID to a cloud model ID
  // and set the corresponding API key env var (ANTHROPIC_API_KEY, OPENAI_API_KEY).
  //
  // Recommended starting setup (single powerful model + fast reviewer):
  //   spec/coordinator/worker → qwen2.5-coder-32b-instruct  (load in LM Studio)
  //   reviewer/gateChecker   → qwen2.5-coder-7b-instruct   (load as second model)
  //
  // If you only want to load one model, set all roles to the same ID.
  // ---------------------------------------------------------------------------
  models: {
    ...DEFAULT_LOCAL_MODEL_ASSIGNMENT,
    // Uncomment to override individual roles:
    // spec: 'deepseek-r1-distill-qwen-32b',        // better reasoning for specs
    // coordinator: 'deepseek-r1-distill-qwen-32b', // better reasoning for planning
    // worker: 'qwen2.5-coder-32b-instruct',        // best local coder
    // reviewer: 'qwen2.5-coder-14b-instruct',      // faster reviewer
    // gateChecker: 'qwen2.5-coder-7b-instruct',    // minimal, just runs commands
  },

  maxRevisions: 3,
  heartbeatInterval: 5,

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
          description: 'Component APIs must be domain-neutral — no workspace, page, or collection vocabulary.',
          reviewQuestions: [
            'Does this component name or API surface reference any Knit-specific concepts?',
            'Could this component be used in an app completely unrelated to Knit?',
            'Are prop/event names generic enough to be meaningful outside this context?',
          ],
        },
        {
          id: 'accessibility',
          description: 'All components must meet WCAG 2.1 AA. Keyboard navigation and ARIA are mandatory.',
          reviewQuestions: [
            'Is this component keyboard-navigable?',
            'Are appropriate ARIA roles and attributes present?',
            'Has focus management been considered for overlay components?',
          ],
        },
        {
          id: 'ssr-first',
          description: 'Components must render correctly server-side without JS.',
          reviewQuestions: [
            'Does this component produce meaningful HTML before JS hydrates?',
            'Are there any document/window references outside hydration guards?',
          ],
        },
        {
          id: 'documentation',
          description: 'Every shipped component needs a contract README, generated API metadata, a docs page, and a Storybook story.',
          reviewQuestions: [
            'Is there a contract README in the component directory?',
            'Has generate:api been run and does docs-sync pass?',
            'Is there a Storybook story?',
          ],
        },
      ],
      autonomousDecisions: [
        'Approve or reject component promotion candidates from Knit',
        'Decide API naming for new primitives',
        'Approve minor spec revisions that do not change scope',
      ],
      escalationTriggers: [
        'Any change to the @looma/tokens public API surface',
        'Adding a new package to the monorepo',
        'Any decision that would break existing Knit consumers',
        'Disagreement with Knit coordinator that cannot be resolved in one round',
      ],
    },
    {
      id: 'knit',
      name: 'Knit Coordinator',
      mandate: `
        Knit is a wiki app for small teams. It uses Looma as its design system and must
        migrate progressively toward Looma primitives, but its primary obligation is
        product quality for real users. The Knit coordinator advocates for features and
        UX quality, negotiates with the Looma coordinator for the primitives it needs,
        and ensures that migration work does not regress the product.
      `.trim(),
      projectPaths: [process.env['KNIT_PATH'] ?? '../knit'],
      concerns: [
        {
          id: 'product-quality',
          description: 'The app must work correctly for users. Regressions are unacceptable.',
          reviewQuestions: [
            'Does this change affect any user-facing flow?',
            'Has the relevant user flow been manually or automatically verified?',
            'Are there any regressions vs the current V1 feature set?',
          ],
        },
        {
          id: 'looma-migration',
          description: 'Knit should progressively migrate to Looma primitives per the migration inventory.',
          reviewQuestions: [
            'Does this task advance or at least not regress the Looma migration inventory?',
            'Are Looma primitives being used where they are available and appropriate?',
          ],
        },
        {
          id: 'velocity',
          description: 'Knit is V1 polishing toward launch. Scope should stay tight.',
          reviewQuestions: [
            'Is this task in the V1 polish scope or V2?',
            'Is the implementation the simplest thing that works correctly?',
          ],
        },
      ],
      autonomousDecisions: [
        'Prioritize tasks within the V1 polish scope',
        'Approve minor migration steps that are already in the migration inventory',
        'Approve spec revisions that do not change scope',
      ],
      escalationTriggers: [
        'Any new V2 feature request (must be explicitly deferred or approved)',
        'Any change to the Supabase schema',
        'Any change that would require a Looma API that does not yet exist',
        'Disagreement with Looma coordinator that cannot be resolved in one round',
      ],
    },
  ],
}
