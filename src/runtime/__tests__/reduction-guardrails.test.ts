import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('reduction guardrails', () => {
  it('keeps generic runtime free of sample-product branches', () => {
    expect(() => {
      execFileSync(process.execPath, ['scripts/reduction-guardrails.mjs'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    }).not.toThrow()
  })
})
