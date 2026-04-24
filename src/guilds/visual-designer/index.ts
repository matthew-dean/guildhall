import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { VISUAL_DESIGNER_RUBRIC } from './rubric.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'visual-designer',
  relative: 'principles.md',
})

const SPEC_CONTRIBUTION = `
When the Visual Designer applies, the spec for this task must answer:
- What **spacing scale** is in use, and which steps will this surface consume?
- What **typography scale** levels apply (display, heading.1..4, body, caption, mono)?
- What is the **primary / secondary / tertiary** hierarchy on this surface? Name the dominant element and what supports it.
- What **breakpoints** must this layout read correctly at? (smallest + largest + one mid)
- Does this view introduce **motion**? If yes, what does the motion confirm or reveal?
If these aren't specified, the engineer will guess and I'll catch the guess at review.
`.trim()

export const visualDesignerGuild: GuildDefinition = {
  slug: 'visual-designer',
  name: 'The Visual Designer',
  role: 'designer',
  blurb:
    'Rhythm, hierarchy, scale adherence, optical alignment. Surface composition is my lane.',
  principles: PRINCIPLES,
  specContribution: SPEC_CONTRIBUTION,
  rubric: VISUAL_DESIGNER_RUBRIC,
  deterministicChecks: [],
  applicable,
}
