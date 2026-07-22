import { describe, expect, it } from 'vitest'

import {
  extractGateFailurePaths,
  isScopedGateFailureExempt,
  summarizeScopedHardGateDisposition,
  type ScopedGateContext,
  type ScopedGateResultLike,
} from '../../tools/gate-scope-exceptions.js'

const projectPath = '/workspace/app'

function gate(overrides: Partial<ScopedGateResultLike>): ScopedGateResultLike {
  return {
    gateId: 'test',
    passed: false,
    output: '',
    ...overrides,
  }
}

function context(overrides: Partial<ScopedGateContext> = {}): ScopedGateContext {
  return {
    projectPath,
    likelyTargetFiles: ['src/features/editor/Menu.ts'],
    gateScopeExceptions: [],
    ...overrides,
  }
}

describe('extractGateFailurePaths', () => {
  it('normalizes TypeScript, test, and lint failure paths against the project root', () => {
    const result = extractGateFailurePaths(
      projectPath,
      gate({
        output: [
          '> app@1.0.0 test /workspace/app/packages/web',
          'src/Button.tsx(10,4): error TS2322: Type mismatch',
          'FAIL tests/Button.test.ts',
          '❯ tests/helpers/render.ts',
          'src/lint-target.ts:12:7  error  no-console',
          '/workspace/app/src/absolute.ts(1,1): error TS1005',
          '../../../outside.ts(1,1): error TS1005',
          'src/Button.tsx(10,4): error TS2322: duplicate',
        ].join('\n'),
      }),
    )

    expect(result).toEqual([
      'packages/web/src/Button.tsx',
      'packages/web/tests/Button.test.ts',
      'packages/web/tests/helpers/render.ts',
      'packages/web/src/lint-target.ts',
      'src/absolute.ts',
    ])
  })
})

describe('isScopedGateFailureExempt', () => {
  it('auto-exempts lint and test failures outside the likely target files', () => {
    const scoped = context({ likelyTargetFiles: ['src/changed.ts'] })

    expect(
      isScopedGateFailureExempt(
        scoped,
        gate({
          gateId: 'lint',
          output: 'src/legacy.ts:3:1 error Unexpected any',
        }),
      ),
    ).toBe(true)

    expect(
      isScopedGateFailureExempt(
        scoped,
        gate({
          gateId: 'vitest',
          output: 'FAIL tests/legacy.test.ts',
        }),
      ),
    ).toBe(true)
  })

  it('does not exempt failures that touch the worker target surface', () => {
    expect(
      isScopedGateFailureExempt(
        context({ likelyTargetFiles: ['src/features/editor'] }),
        gate({
          gateId: 'lint',
          output: 'src/features/editor/Menu.ts:3:1 error Unexpected any',
        }),
      ),
    ).toBe(false)
  })

  it('requires an explicit typed gate exception before exempting typecheck failures', () => {
    const typecheckFailure = gate({
      gateId: 'typecheck',
      output: 'src/legacy.ts(2,8): error TS2307: Cannot find module',
    })

    expect(isScopedGateFailureExempt(context(), typecheckFailure)).toBe(false)
    expect(
      isScopedGateFailureExempt(
        context({
          gateScopeExceptions: [{
            id: 'gate-exception-1',
            gateId: 'typecheck',
            disposition: 'exclude_unrelated_failure',
            createdAt: '2026-07-21T00:00:00.000Z',
            createdBy: 'human',
          }],
        }),
        typecheckFailure,
      ),
    ).toBe(true)

    expect(
      isScopedGateFailureExempt(
        context({
          gateScopeExceptions: [{
            id: 'gate-exception-2',
            gateId: 'typecheck',
            disposition: 'exclude_unrelated_failure',
            createdAt: '2026-07-21T00:00:00.000Z',
            createdBy: 'human',
          }],
        }),
        gate({ gateId: 'build', output: 'src/legacy.ts(2,8): error TS2307: Cannot find module' }),
      ),
    ).toBe(false)
  })

  it('does not exempt build failures or failures without parseable paths', () => {
    expect(
      isScopedGateFailureExempt(
        context(),
        gate({
          gateId: 'build',
          output: 'src/legacy.ts(2,8): error TS2307',
        }),
      ),
    ).toBe(false)

    expect(
      isScopedGateFailureExempt(
        context(),
        gate({
          gateId: 'lint',
          output: 'The command failed before reporting file paths.',
        }),
      ),
    ).toBe(false)
  })
})

describe('summarizeScopedHardGateDisposition', () => {
  it('summarizes empty, passing, fully exempted, and non-exempt gate sets', () => {
    expect(summarizeScopedHardGateDisposition(context(), [])).toBeNull()
    expect(
      summarizeScopedHardGateDisposition(context(), [
        gate({ gateId: 'test', passed: true }),
      ]),
    ).toEqual({ shouldPass: true, exemptedFailures: [] })

    const exempted = gate({ gateId: 'lint', output: 'src/legacy.ts:1:1 error Broken' })
    expect(summarizeScopedHardGateDisposition(context(), [exempted])).toEqual({
      shouldPass: true,
      exemptedFailures: [exempted],
    })

    const blocking = gate({ gateId: 'build', output: 'src/legacy.ts(1,1): error Broken' })
    expect(
      summarizeScopedHardGateDisposition(context(), [exempted, blocking]),
    ).toEqual({
      shouldPass: false,
      exemptedFailures: [exempted],
    })
  })
})
