import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GuildDefinition } from '../types.js'
import { applicable } from './applicable.js'
import { TYPESCRIPT_ENGINEER_RUBRIC } from './rubric.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  MODULE_DIR,
  join(MODULE_DIR, 'guilds', 'typescript-engineer'),
]
function readPrinciples(): string {
  for (const dir of CANDIDATES) {
    const p = join(dir, 'principles.md')
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return ''
}

export const typescriptEngineerGuild: GuildDefinition = {
  slug: 'typescript-engineer',
  name: 'The TypeScript Engineer',
  role: 'engineer',
  blurb:
    'Builds typed code to spec: strict, schemas at boundaries, exhaustive switches, no unjustified any.',
  principles: readPrinciples(),
  rubric: TYPESCRIPT_ENGINEER_RUBRIC,
  // Deterministic floor is `pnpm typecheck`, which the project-level hard-gate
  // registry already runs. No per-guild check adds value above that today.
  deterministicChecks: [],
  applicable,
}
