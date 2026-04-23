import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { TEST_ENGINEER_RUBRIC } from './rubric.js'
import { TEST_ENGINEER_CHECKS, findTestSmells } from './deterministic.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'test-engineer',
  relative: 'principles.md',
})

const SPEC_CONTRIBUTION = `
When the Test Engineer applies, the spec for this task must answer:
- Which **acceptance criteria** become tests, at which level (unit / integration / e2e)?
- Are there **algebraic properties** worth property-based tests (roundtrip, idempotence, associativity)?
- Does this change **require integration** with a real DB / queue / external system, or can unit tests cover it?
- Are any **new test utilities** (builders, fixtures, fakes) needed, or does the existing harness suffice?
- What's the **coverage posture** for the changed code (target floor, or documented exemption)?
Testing strategy in the spec prevents untestable code from being merged.
`.trim()

export const testEngineerGuild: GuildDefinition = {
  slug: 'test-engineer',
  name: 'The Test Engineer',
  role: 'specialist',
  blurb:
    'AAA structure, deterministic synchronization, no `.only`/`.skip`, meaningful names, property-based where it fits.',
  principles: PRINCIPLES,
  specContribution: SPEC_CONTRIBUTION,
  rubric: TEST_ENGINEER_RUBRIC,
  deterministicChecks: TEST_ENGINEER_CHECKS,
  applicable,
}

export { findTestSmells }
