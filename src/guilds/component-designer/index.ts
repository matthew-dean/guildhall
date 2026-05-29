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
- What is the author's **intent** for the product, audience, taste direction, and scope? Which parts are constraints, and which parts are open to improvement?
- What **blind spots** did review find that would make this interface easier to use, navigate, understand, or enjoy?
- What **variants** does this component have? (primary, secondary, ghost, destructive, ...)
- What **sizes**? Draw from the catalog's shared scale (xs/sm/md/lg/xl) or justify a new one.
- Is it **controlled**, **uncontrolled**, or both? If both, name the controlled-vs-uncontrolled signature.
- What **interaction semantics** does each control represent? Name whether it is a one-shot command, navigation, mutually exclusive mode, independent boolean, persistent binary state, disclosure, or selection.
- If the UI switches between modes or filters, which component pattern owns that state? Prefer segmented control, tabs, or radio group over ambiguous action buttons.
- If the UI asks someone to choose from a **long, searchable, user-specific, or remote option set**, why is this a strict select instead of a combobox/typeahead/autocomplete? If combobox is chosen, state whether custom values are allowed and how loading, no-results, keyboard navigation, and screen-reader announcements work.
- What does the local catalog say about **when to use** this component, each variant, and important props? If the catalog is silent, name the design-system gap and the external control-pattern reference used to make the choice.
- What **slots** (children, leading/trailing icons, description, error, ...) are exposed?
- Is rendering **polymorphic** (\`as\` / \`asChild\`)? If yes, state the allowed element set.
- What **a11y props** are required on the outer interactive element? (aria-label, aria-describedby, disabled semantics, focus management.)
- Does the component apply **external margin** to itself? It must not. Spacing is the caller's job via Stack/Row/Grid or the project's equivalent layout primitives.
- Does the task extend the reusable design-system surface when the right primitive or guidance is missing, instead of adding wrapper CSS, local margins, or bespoke control styling in the consuming surface?
- Would a broader **architecture or dependency pivot** produce a stronger design, such as replacing a brittle bespoke control with a tested third-party primitive, or removing an unnecessary third-party package whose overhead exceeds the product need? If yes, route it as an owner-visible opportunity before changing scope.
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
