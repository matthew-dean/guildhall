import type { DeterministicCheck, CheckInput, CheckResult } from '../types.js'

/**
 * Pure string-scanner: flag occurrences of any banned term from the design
 * system's `copyVoice.bannedTerms`. Case-insensitive, whole-word matches
 * only (so "user" doesn't match "superuser"). Returns the line number and
 * a snippet for each hit. Exported as a pure function so project-specific
 * wrappers can traverse their own source trees.
 */
export interface BannedTermFinding {
  line: number
  term: string
  snippet: string
}

export function findBannedTerms(
  source: string,
  bannedTerms: readonly string[],
): BannedTermFinding[] {
  if (bannedTerms.length === 0) return []
  const findings: BannedTermFinding[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    for (const term of bannedTerms) {
      if (!term) continue
      const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i')
      if (re.test(line)) {
        findings.push({
          line: i + 1,
          term,
          snippet: line.trim().slice(0, 160),
        })
      }
    }
  }
  return findings
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The registered deterministic check. Without a project-specific file
 * enumeration (copy-catalog traversal, i18n bundle path), the check
 * reports skipped. The pure function above is the value — project wiring
 * plugs it into the specific copy source.
 */
const BANNED_TERMS_CHECK: DeterministicCheck = {
  id: 'copy.banned-terms',
  description:
    "Flag occurrences of design-system copyVoice.bannedTerms in user-facing copy.",
  run(input: CheckInput): CheckResult {
    const banned = input.designSystem?.copyVoice.bannedTerms ?? []
    if (banned.length === 0) {
      return {
        checkId: 'copy.banned-terms',
        pass: true,
        summary:
          'skipped — no bannedTerms declared in design-system.yaml copyVoice',
      }
    }
    return {
      checkId: 'copy.banned-terms',
      pass: true,
      summary: `skipped — findBannedTerms(source, [${banned.length} terms]) exported for project-specific gate wrappers`,
    }
  },
}

export const COPYWRITER_CHECKS: DeterministicCheck[] = [BANNED_TERMS_CHECK]
