import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { COPYWRITER_RUBRIC } from './rubric.js'
import { COPYWRITER_CHECKS, findBannedTerms } from './deterministic.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'copywriter',
  relative: 'principles.md',
})

const SPEC_CONTRIBUTION = `
When the Copywriter applies, the spec for this task must answer:
- Exact **button labels** / **headings** / **helper text** (don't leave them as "TBD").
- **Error strings**: for each failure mode, the message shown and the recovery the user can take.
- **Empty-state copy**: what the user sees when the surface has no data yet — and what it teaches.
- Is there a **casing convention** for the affected surface type (title vs sentence)?
- Does any new string need to honor a bannedTerm / preferredTerm from the design system?
Do not ship with placeholder copy or generic "Something went wrong" strings.
`.trim()

export const copywriterGuild: GuildDefinition = {
  slug: 'copywriter',
  name: 'The Copywriter',
  role: 'designer',
  blurb:
    'Plain language, consistent voice, banned/preferred terms, actionable errors, teaching empty states.',
  principles: PRINCIPLES,
  specContribution: SPEC_CONTRIBUTION,
  rubric: COPYWRITER_RUBRIC,
  deterministicChecks: COPYWRITER_CHECKS,
  applicable,
}

export { findBannedTerms }
