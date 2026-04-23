import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GuildDefinition } from '../types.js'
import { applicable } from './applicable.js'
import { ACCESSIBILITY_RUBRIC } from './rubric.js'
import {
  ACCESSIBILITY_CHECKS,
  runContrastMatrix,
  derivePairsFromDesignSystem,
} from './deterministic.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  MODULE_DIR,
  join(MODULE_DIR, 'guilds', 'accessibility-specialist'),
]
function readPrinciples(): string {
  for (const dir of CANDIDATES) {
    const p = join(dir, 'principles.md')
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return ''
}

const A11Y_SPEC_CONTRIBUTION = `
When the Accessibility Specialist applies, the spec for this task must answer:
- What is the **keyboard interaction model**? (Tab/Shift+Tab/Enter/Space/arrows/Escape.)
- How is **focus** moved and contained? (Focus on open, return on close for modals/menus.)
- What **landmarks / headings** does this surface contribute to?
- What **ARIA semantics** if any — role, labelling pattern, live-region announcements?
- What **error association** pattern? (aria-describedby linking inputs to messages, not color alone.)
- What **motion** happens, and how does it respect prefers-reduced-motion?
- Which **token pairs** (fg/bg) will be used? Contrast must clear 4.5:1 for text or 3:1 for large text / UI.
Answer these at spec time so the engineer builds them in, not retrofits them.
`.trim()

export const accessibilitySpecialistGuild: GuildDefinition = {
  slug: 'accessibility-specialist',
  name: 'The Accessibility Specialist',
  role: 'specialist',
  blurb:
    'Authors a11y requirements in the spec. Runs contrast math deterministically. Reviews builds.',
  principles: readPrinciples(),
  specContribution: A11Y_SPEC_CONTRIBUTION,
  rubric: ACCESSIBILITY_RUBRIC,
  deterministicChecks: ACCESSIBILITY_CHECKS,
  applicable,
}

export { runContrastMatrix, derivePairsFromDesignSystem }
