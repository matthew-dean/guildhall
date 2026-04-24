import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GuildDefinition } from '../types.js'
import { applicable } from './applicable.js'
import { COLOR_THEORIST_RUBRIC } from './rubric.js'
import { COLOR_THEORIST_CHECKS } from './deterministic.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [MODULE_DIR, join(MODULE_DIR, 'guilds', 'color-theorist')]
function readPrinciples(): string {
  for (const dir of CANDIDATES) {
    const p = join(dir, 'principles.md')
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return ''
}

const COLOR_THEORIST_SPEC_CONTRIBUTION = `
When the Color Theorist applies, the spec for this task must answer:
- What **role** does any new color serve? (primary, accent, danger, info, success, warning, surface, text, on-surface, …)
- Is the role already covered by an existing token? If yes, reuse — don't invent.
- What are the **light and dark** variants of the role?
- Where is the role used on which **surfaces**? Those pairings will be checked for contrast.
- If a **scale** is being extended (50…900), what perceptual lightness steps?
Color belongs in tokens with semantic names. Hex values in component code are a spec defect, not an implementation choice.
`.trim()

export const colorTheoristGuild: GuildDefinition = {
  slug: 'color-theorist',
  name: 'The Color Theorist',
  role: 'designer',
  blurb:
    'Authors palette decisions in the spec. Flags perceptual duplicates in OKLab. Reviews builds.',
  principles: readPrinciples(),
  specContribution: COLOR_THEORIST_SPEC_CONTRIBUTION,
  rubric: COLOR_THEORIST_RUBRIC,
  deterministicChecks: COLOR_THEORIST_CHECKS,
  applicable,
}

export {
  rgbToOklab,
  rgbToOklch,
  oklabDistance,
  findNearDuplicates,
  colorStringToOklch,
  type OKLab,
  type OKLCH,
  type DuplicatePair,
} from './oklch.js'
