import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { BACKEND_ENGINEER_RUBRIC } from './rubric.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'backend-engineer',
  relative: 'principles.md',
})

export const backendEngineerGuild: GuildDefinition = {
  slug: 'backend-engineer',
  name: 'The Backend Engineer',
  role: 'engineer',
  blurb:
    'Builds server code to spec: pure business logic, I/O at the edges, parameterized queries, observability, idempotency.',
  principles: PRINCIPLES,
  rubric: BACKEND_ENGINEER_RUBRIC,
  deterministicChecks: [],
  applicable,
}
