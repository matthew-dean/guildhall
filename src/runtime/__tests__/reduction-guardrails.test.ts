import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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

  it('keeps proof fixture runtime modules out of shipping runtime paths', () => {
    expect(existsSync('src/runtime/app-spec-smoke.ts')).toBe(false)
    expect(existsSync('src/runtime/release-proof-matrix.ts')).toBe(false)
  })
})
