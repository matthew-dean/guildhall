import type { GuildDefinition } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { SECURITY_ENGINEER_RUBRIC } from './rubric.js'
import { SECURITY_ENGINEER_CHECKS, findSecrets } from './deterministic.js'

const PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'security-engineer',
  relative: 'principles.md',
})

const SPEC_CONTRIBUTION = `
When the Security Engineer applies, the spec for this task must answer:
- **Trust boundaries**: where does untrusted input enter, and where is it validated?
- **Authn/authz**: who can call this, and with what authorization check?
- **Secrets**: does this need new credentials? How are they stored and rotated? (Never committed, ever.)
- **Logging**: which events must be logged, and which fields must be redacted?
- **Browser surfaces** (if any): CSP additions, SRI requirements, cookie flags.
- **Dependencies**: any new packages? audited?
Missing security answers in a spec lead to security retrofits later, which are always more expensive.
`.trim()

export const securityEngineerGuild: GuildDefinition = {
  slug: 'security-engineer',
  name: 'The Security Engineer',
  role: 'specialist',
  blurb:
    'OWASP Top 10, defense in depth, least privilege, secrets hygiene, boundary validation.',
  principles: PRINCIPLES,
  specContribution: SPEC_CONTRIBUTION,
  rubric: SECURITY_ENGINEER_RUBRIC,
  deterministicChecks: SECURITY_ENGINEER_CHECKS,
  applicable,
}

export { findSecrets }
