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
- Exact **nav, tab, status, badge, and menu labels** for any affected UI.
- **Capitalization style** for each surface class: buttons, headings, nav,
  chips, settings controls, and page titles.
- **Error strings**: for each failure mode, the message shown and the recovery the user can take.
- **Empty-state copy**: what the user sees when the surface has no data yet — and what it teaches.
- **Public docs tone** when documentation is touched: who is the reader, what
  are they trying to do, and what phrases would sound like internal agent
  instructions instead of product-facing guidance?
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
