import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { API_DESIGNER_RUBRIC } from './rubric.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'api-designer',
  relative: 'principles.md',
})

const SPEC_CONTRIBUTION = `
When the API Designer applies, the spec for this task must answer:
- **Endpoint(s)**: method + path, under which version prefix?
- **Request shape**: body / query / path params, validation schema.
- **Response shape** on success and on each failure mode.
- **Error codes**: which codes can this endpoint return, with what messages?
- **Auth**: public, bearer-token, cookie-session, service-to-service?
- **Pagination** (if list): cursor or offset, default + max limit.
- **Idempotency**: idempotent by shape, or requires Idempotency-Key?
- **Breaking vs. additive**: does this change break existing callers? If yes, what's the deprecation cycle?
Missing answers become engineer guesses, and I'll flag them at review.
`.trim()

export const apiDesignerGuild: GuildDefinition = {
  slug: 'api-designer',
  name: 'The API Designer',
  role: 'designer',
  blurb:
    'Authors endpoint contracts: naming, versioning, error envelopes, auth, idempotency, pagination.',
  principles: PRINCIPLES,
  specContribution: SPEC_CONTRIBUTION,
  rubric: API_DESIGNER_RUBRIC,
  deterministicChecks: [],
  applicable,
}
