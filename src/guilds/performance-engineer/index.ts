import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { PERFORMANCE_ENGINEER_RUBRIC } from './rubric.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'performance-engineer',
  relative: 'principles.md',
})

const SPEC_CONTRIBUTION = `
When the Performance Engineer applies, the spec for this task must answer:
- **Bundle impact**: does this add code to the critical-path bundle? If yes, what's the budget delta?
- **Critical path**: what's on it, what's deferred, what lazy-loads?
- **Data scale**: what's the realistic N for lists/tables/queries this touches?
- **Network shape**: how many requests, which are parallel, what can be cached or preloaded?
- **Measurement**: which metric (LCP, INP, CLS, server p95, bundle KB) confirms this shipped well?
Ship the metric alongside the feature; retrofitting observability later is painful.
`.trim()

export const performanceEngineerGuild: GuildDefinition = {
  slug: 'performance-engineer',
  name: 'The Performance Engineer',
  role: 'specialist',
  blurb:
    'Bundle budgets, Core Web Vitals, render cost at realistic data, network waterfalls, DB-query hygiene.',
  principles: PRINCIPLES,
  specContribution: SPEC_CONTRIBUTION,
  rubric: PERFORMANCE_ENGINEER_RUBRIC,
  deterministicChecks: [],
  applicable,
}
