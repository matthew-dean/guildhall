import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GuildDefinition } from '../types.js'
import { applicable } from './applicable.js'
import { COMPONENT_DESIGNER_RUBRIC } from './rubric.js'
import {
  COMPONENT_DESIGNER_CHECKS,
  findExternalMargins,
  findHardcodedDesignValues,
} from './deterministic.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [MODULE_DIR, join(MODULE_DIR, 'guilds', 'component-designer')]
function readPrinciples(): string {
  for (const dir of CANDIDATES) {
    const p = join(dir, 'principles.md')
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return ''
}

const COMPONENT_DESIGNER_SPEC_CONTRIBUTION = `
When the Component Designer applies, the spec for this task must answer:
- What **variants** does this component have? (primary, secondary, ghost, destructive, …)
- What **sizes**? Draw from the catalog's shared scale (xs/sm/md/lg/xl) or justify a new one.
- Is it **controlled**, **uncontrolled**, or both? If both, name the controlled-vs-uncontrolled signature.
- What **slots** (children, leading/trailing icons, description, error, …) are exposed?
- Is rendering **polymorphic** (\`as\` / \`asChild\`)? If yes, state the allowed element set.
- What **a11y props** are required on the outer interactive element? (aria-label, aria-describedby, disabled semantics, focus management.)
- Does the component apply **external margin** to itself? It must not. Spacing is the caller's job via Stack/Row/Grid.
Any answer missing from the spec becomes the engineer's guess — and I'll catch it at review.
`.trim()

export const componentDesignerGuild: GuildDefinition = {
  slug: 'component-designer',
  name: 'The Component Designer',
  role: 'designer',
  blurb:
    'Authors component specs (API, variants, slots). Verifies builds match. Never writes code.',
  principles: readPrinciples(),
  specContribution: COMPONENT_DESIGNER_SPEC_CONTRIBUTION,
  rubric: COMPONENT_DESIGNER_RUBRIC,
  deterministicChecks: COMPONENT_DESIGNER_CHECKS,
  applicable,
}

export { findExternalMargins, findHardcodedDesignValues }
