import type { SoftGateRubricItem } from '@guildhall/core'

export const SECURITY_ENGINEER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'sec-no-hardcoded-secrets',
    question:
      'Does the diff contain no hardcoded secrets (API keys, tokens, private keys, connection strings with credentials)?',
    weight: 1.0,
  },
  {
    id: 'sec-input-validated-at-boundary',
    question:
      'Are new inputs from outside the system (HTTP, fs, env, user) validated with a schema at the boundary?',
    weight: 1.0,
  },
  {
    id: 'sec-parameterized-queries',
    question:
      'Are SQL / LDAP / shell / eval calls parameterized rather than string-concatenated from untrusted input?',
    weight: 1.0,
  },
  {
    id: 'sec-authn-authz-distinct',
    question:
      'Do new protected endpoints distinguish authentication (who are you?) from authorization (may you do this?)?',
    weight: 0.9,
  },
  {
    id: 'sec-least-privilege',
    question:
      'Do new service accounts / tokens / DB users follow least privilege — scoped only to what they need?',
    weight: 0.8,
  },
  {
    id: 'sec-browser-hardening',
    question:
      "For new browser-facing surfaces, are CSP / SRI / HSTS / X-Frame-Options configured, and are inline scripts/styles avoided?",
    weight: 0.8,
  },
  {
    id: 'sec-logging-redacted',
    question:
      'Does new logging capture security-relevant events while redacting sensitive data (passwords, tokens, PII)?',
    weight: 0.7,
  },
  {
    id: 'sec-deps-audited',
    question:
      'Are any newly-added dependencies checked against known-CVE advisories and minimized in transitive surface?',
    weight: 0.6,
  },
]
