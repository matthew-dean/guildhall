import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  RELEASE_PROOF_MATRIX,
  proofFor,
  validateReleaseProofScenario,
} from '../../../internal/fixtures/release-proof-matrix/runtime.js'

describe('release proof matrix', () => {
  it('covers the required 0.9 hardening project shapes', () => {
    expect(RELEASE_PROOF_MATRIX.map(scenario => scenario.id)).toEqual([
      'component-consumer',
      'frontend-app',
      'backend-api',
      'cli-tool',
      'docs-only',
      'data-migration',
      'bugfix',
      'single-edit',
    ])
  })

  it('forbids project-specific vocabulary from generic scenarios', () => {
    for (const scenario of RELEASE_PROOF_MATRIX) {
      const result = validateReleaseProofScenario(scenario)

      expect(result.errors).toEqual([])
    }
  })

  it('points every scenario at a checked-in fixture', () => {
    for (const scenario of RELEASE_PROOF_MATRIX) {
      expect(existsSync(path.resolve(scenario.fixturePath)), scenario.fixturePath).toBe(true)
    }
  })

  it('keeps each fixture tiny but recognizable', () => {
    const fixtureFiles = [
      'internal/fixtures/release-proof-matrix/component-consumer/packages/ui/package.json',
      'internal/fixtures/release-proof-matrix/component-consumer/apps/demo/package.json',
      'internal/fixtures/release-proof-matrix/frontend-app/package.json',
      'internal/fixtures/release-proof-matrix/backend-api/package.json',
      'internal/fixtures/release-proof-matrix/cli-tool/package.json',
      'internal/fixtures/release-proof-matrix/docs-only/docs/quick-start.md',
      'internal/fixtures/release-proof-matrix/data-migration/migrations/001_initial.sql',
      'internal/fixtures/release-proof-matrix/bugfix/package.json',
      'internal/fixtures/release-proof-matrix/single-edit/src/settings-footer.ts',
    ]

    for (const fixtureFile of fixtureFiles) {
      expect(existsSync(path.resolve(fixtureFile)), fixtureFile).toBe(true)
    }
  })

  it('requires proof evidence that matches each scenario shape', () => {
    expect(Object.fromEntries(RELEASE_PROOF_MATRIX.map(scenario => [scenario.id, proofFor(scenario.id)]))).toEqual({
      'component-consumer': {
        requiredEvidence: ['component_contract', 'consumer_integration'],
        forbiddenEvidence: [],
      },
      'frontend-app': {
        requiredEvidence: ['test', 'rendered_ui'],
        forbiddenEvidence: [],
      },
      'backend-api': {
        requiredEvidence: ['api_integration_test'],
        forbiddenEvidence: ['browser_screenshot'],
      },
      'cli-tool': {
        requiredEvidence: ['command_output', 'regression_test'],
        forbiddenEvidence: ['browser_screenshot'],
      },
      'docs-only': {
        requiredEvidence: ['content_diff'],
        forbiddenEvidence: ['source_code_mutation'],
      },
      'data-migration': {
        requiredEvidence: ['migration_up', 'rollback_or_validation'],
        forbiddenEvidence: ['browser_screenshot'],
      },
      bugfix: {
        requiredEvidence: ['failing_reproduction', 'green_regression'],
        forbiddenEvidence: [],
      },
      'single-edit': {
        requiredEvidence: ['focused_diff'],
        forbiddenEvidence: ['task_split'],
      },
    })
  })
})
