import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('coverage threshold policy', () => {
  it('keeps the default coverage command on the current honest regression floor', () => {
    const config = readFileSync('vitest.config.ts', 'utf8')

    expect(config).toContain('thresholds: { statements: 83, lines: 83, functions: 83, branches: 75 }')
  })

  it('keeps the future release floor at 90 percent across all coverage dimensions', () => {
    const config = readFileSync('vitest.coverage-90.config.ts', 'utf8')
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(pkg.scripts?.['test:coverage']).toBe('vitest run --coverage')
    expect(pkg.scripts?.['test:coverage:90']).toBe(
      'vitest run --coverage --config vitest.coverage-90.config.ts',
    )
    expect(config).toContain('statements: 90')
    expect(config).toContain('lines: 90')
    expect(config).toContain('functions: 90')
    expect(config).toContain('branches: 90')
  })
})
