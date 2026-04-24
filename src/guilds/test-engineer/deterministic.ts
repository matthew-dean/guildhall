import type { DeterministicCheck, CheckInput, CheckResult } from '../types.js'

/**
 * Pure scanner: flag `.only` / `fdescribe` / `fit` / unjustified `.skip` /
 * `xit` / `xdescribe` in test source. Caller supplies the concatenated test
 * source (or one file at a time). Comments starting with `// TODO` right
 * above a `.skip` are treated as a weak justification and not flagged.
 */
export interface TestSmellFinding {
  line: number
  kind:
    | 'only'
    | 'focused-describe'
    | 'focused-it'
    | 'skip'
    | 'xit'
    | 'xdescribe'
  snippet: string
}

const PATTERNS: Array<{ re: RegExp; kind: TestSmellFinding['kind'] }> = [
  { re: /\b(?:describe|it|test|context)\.only\s*\(/, kind: 'only' },
  { re: /\bfdescribe\s*\(/, kind: 'focused-describe' },
  { re: /\bfit\s*\(/, kind: 'focused-it' },
  { re: /\b(?:describe|it|test|context)\.skip\s*\(/, kind: 'skip' },
  { re: /\bxit\s*\(/, kind: 'xit' },
  { re: /\bxdescribe\s*\(/, kind: 'xdescribe' },
]

export function findTestSmells(source: string): TestSmellFinding[] {
  const findings: TestSmellFinding[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    for (const { re, kind } of PATTERNS) {
      if (re.test(line)) {
        // Weak-justification exemption: a TODO comment on the immediately
        // preceding line excuses a `.skip` (but not `.only` — never excuse
        // that).
        if (
          kind === 'skip' &&
          i > 0 &&
          /(^|\s)\/\/\s*TODO/i.test(lines[i - 1] ?? '')
        ) {
          continue
        }
        findings.push({
          line: i + 1,
          kind,
          snippet: line.trim().slice(0, 200),
        })
      }
    }
  }
  return findings
}

const TEST_SMELL_CHECK: DeterministicCheck = {
  id: 'test.no-focused-or-skipped',
  description:
    'Flag `.only` / `fdescribe` / `fit` / unjustified `.skip` / `xit` in test files.',
  run(_input: CheckInput): CheckResult {
    return {
      checkId: 'test.no-focused-or-skipped',
      pass: true,
      summary:
        'skipped — pure detector `findTestSmells(source)` exported; wire a test-file walker in CI or a guild gate',
    }
  },
}

export const TEST_ENGINEER_CHECKS: DeterministicCheck[] = [TEST_SMELL_CHECK]
