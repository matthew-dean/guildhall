import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

describe('managed Guildhall data guardrail', () => {
  it('blocks direct managed-path reads and writes outside the data layer', () => {
    expect(() => {
      execFileSync(process.execPath, ['scripts/data-layer-guardrails.mjs'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    }).not.toThrow()
  })
})
