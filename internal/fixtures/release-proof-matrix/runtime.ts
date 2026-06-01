export type ReleaseProofScenarioId =
  | 'component-consumer'
  | 'frontend-app'
  | 'backend-api'
  | 'cli-tool'
  | 'docs-only'
  | 'data-migration'
  | 'bugfix'
  | 'single-edit'

export interface ReleaseProofScenario {
  id: ReleaseProofScenarioId
  fixturePath: string
  request: string
  expectedGraph: string
  proofMode: string
  forbiddenVocabulary: string[]
}

export interface ReleaseProofValidation {
  errors: string[]
}

export interface ReleaseProofContract {
  requiredEvidence: string[]
  forbiddenEvidence: string[]
}

const WEB_OVERFIT = ['Looma', 'Knit', 'AlertDialog', 'Storybook-only', 'browser-only']

export const RELEASE_PROOF_MATRIX: ReleaseProofScenario[] = [
  {
    id: 'component-consumer',
    fixturePath: 'internal/fixtures/release-proof-matrix/component-consumer',
    request: 'Build a reusable AlertDialog-style primitive and use it in the demo app.',
    expectedGraph: 'library implementation task before consumer integration task',
    proofMode: 'component test/docs plus consumer browser or render proof',
    forbiddenVocabulary: ['Looma', 'Knit'],
  },
  {
    id: 'frontend-app',
    fixturePath: 'internal/fixtures/release-proof-matrix/frontend-app',
    request: 'Add a saved-filter drawer to the task board.',
    expectedGraph: 'one implementation task unless existing primitives require one dependency',
    proofMode: 'unit/component test plus browser proof',
    forbiddenVocabulary: ['Looma', 'Knit', 'AlertDialog'],
  },
  {
    id: 'backend-api',
    fixturePath: 'internal/fixtures/release-proof-matrix/backend-api',
    request: 'Add a comment endpoint and prove membership checks.',
    expectedGraph: 'API implementation plus integration test, no UI child unless requested',
    proofMode: 'API integration test',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'cli-tool',
    fixturePath: 'internal/fixtures/release-proof-matrix/cli-tool',
    request: 'Add --json output to the inspect command.',
    expectedGraph: 'one bounded CLI task',
    proofMode: 'command output fixture and regression test',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'docs-only',
    fixturePath: 'internal/fixtures/release-proof-matrix/docs-only',
    request: 'Clarify the install warning in the quick start.',
    expectedGraph: 'one docs task, no implementation split',
    proofMode: 'docs build/lint or deterministic content diff',
    forbiddenVocabulary: [...WEB_OVERFIT, 'implementation child', 'worker pressure to edit code'],
  },
  {
    id: 'data-migration',
    fixturePath: 'internal/fixtures/release-proof-matrix/data-migration',
    request: 'Add archived_at migration and rollback proof.',
    expectedGraph: 'migration task plus validation proof',
    proofMode: 'migration up/down validation',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'bugfix',
    fixturePath: 'internal/fixtures/release-proof-matrix/bugfix',
    request: 'Fix duplicate rows in the summary output.',
    expectedGraph: 'reproduce-then-fix task',
    proofMode: 'failing regression first, then green test',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'single-edit',
    fixturePath: 'internal/fixtures/release-proof-matrix/single-edit',
    request: 'Rename Host-run to Runs on host in settings footer.',
    expectedGraph: 'exactly one task',
    proofMode: 'focused diff/test',
    forbiddenVocabulary: ['component backlog', 'integration task', 'Looma', 'Knit'],
  },
]

export function validateReleaseProofScenario(scenario: ReleaseProofScenario): ReleaseProofValidation {
  const haystack = [scenario.request, scenario.expectedGraph, scenario.proofMode].join('\n')
  const errors = scenario.forbiddenVocabulary
    .filter(term => haystack.toLowerCase().includes(term.toLowerCase()))
    .map(term => `${scenario.id} leaks forbidden vocabulary: ${term}`)

  return { errors }
}

export function proofFor(id: ReleaseProofScenarioId): ReleaseProofContract {
  switch (id) {
    case 'frontend-app':
      return { requiredEvidence: ['test', 'rendered_ui'], forbiddenEvidence: [] }
    case 'component-consumer':
      return { requiredEvidence: ['component_contract', 'consumer_integration'], forbiddenEvidence: [] }
    case 'backend-api':
      return { requiredEvidence: ['api_integration_test'], forbiddenEvidence: ['browser_screenshot'] }
    case 'cli-tool':
      return { requiredEvidence: ['command_output', 'regression_test'], forbiddenEvidence: ['browser_screenshot'] }
    case 'docs-only':
      return { requiredEvidence: ['content_diff'], forbiddenEvidence: ['source_code_mutation'] }
    case 'data-migration':
      return { requiredEvidence: ['migration_up', 'rollback_or_validation'], forbiddenEvidence: ['browser_screenshot'] }
    case 'bugfix':
      return { requiredEvidence: ['failing_reproduction', 'green_regression'], forbiddenEvidence: [] }
    case 'single-edit':
      return { requiredEvidence: ['focused_diff'], forbiddenEvidence: ['task_split'] }
  }
}
