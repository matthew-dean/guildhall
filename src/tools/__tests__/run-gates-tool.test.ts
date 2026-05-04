import { describe, expect, it } from 'vitest'
import type { HardGate } from '@guildhall/core'
import { reconcileRequestedGatesWithAuthority } from '../run-gates-tool.js'

const gate = (overrides: Partial<HardGate> = {}): HardGate => ({
  id: 'gate',
  label: 'Gate',
  command: 'true',
  timeoutMs: 120_000,
  ...overrides,
})

describe('reconcileRequestedGatesWithAuthority', () => {
  it('uses authoritative task-scoped commands when the request carries stale equivalents', () => {
    const requested = [
      gate({
        id: 'typecheck',
        label: 'TypeScript typecheck',
        command: 'pnpm --filter @knit-app typecheck',
      }),
      gate({
        id: 'build',
        label: 'Build',
        command: 'pnpm --filter @knit-app build',
      }),
      gate({
        id: 'playwright-e2e',
        label: 'Playwright E2E test',
        command: 'pnpm exec playwright test tests/e2e/authoring-flow.spec.ts',
      }),
      gate({
        id: 'lint',
        label: 'Lint',
        command: 'pnpm lint',
      }),
    ]

    const authoritative = [
      'pnpm --dir web typecheck',
      'pnpm --dir web build',
      'pnpm --dir web exec playwright test tests/e2e/authoring-flow.spec.ts',
      'pnpm lint',
    ]

    const out = reconcileRequestedGatesWithAuthority(requested, authoritative)

    expect(out.usedAuthority).toBe(true)
    expect(out.gates).toEqual([
      expect.objectContaining({
        id: 'typecheck',
        command: 'pnpm --dir web typecheck',
      }),
      expect.objectContaining({
        id: 'build',
        command: 'pnpm --dir web build',
      }),
      expect.objectContaining({
        id: 'playwright-e2e',
        command: 'pnpm --dir web exec playwright test tests/e2e/authoring-flow.spec.ts',
      }),
      expect.objectContaining({
        id: 'lint',
        command: 'pnpm lint',
      }),
    ])
  })

  it('passes requested gates through unchanged when no authoritative list exists', () => {
    const requested = [gate({ id: 'typecheck', command: 'pnpm typecheck' })]
    const out = reconcileRequestedGatesWithAuthority(requested, null)
    expect(out.usedAuthority).toBe(false)
    expect(out.gates).toEqual(requested)
  })
})
