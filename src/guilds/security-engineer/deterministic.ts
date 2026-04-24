import type { DeterministicCheck, CheckInput, CheckResult } from '../types.js'

/**
 * Pure secret-pattern scanner. Flags strings that look like API keys,
 * private keys, GitHub / AWS / GCP tokens. Conservative: we'd rather have
 * a false positive a reviewer dismisses than miss a real secret. Runs as
 * a pure function; project-specific wrappers walk the changed-file set.
 */
export interface SecretFinding {
  line: number
  kind: string
  snippet: string
}

interface SecretPattern {
  kind: string
  /** Regex that must match. Case-sensitive unless flagged inside the literal. */
  re: RegExp
}

const SECRET_PATTERNS: SecretPattern[] = [
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bghp_[A-Za-z0-9]{36,}\b/ },
  { kind: 'github-token-fine-grained', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { kind: 'slack-token', re: /\bxox[abpsr]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'openai-api-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: 'anthropic-api-key', re: /\bsk-ant-[A-Za-z0-9-_]{20,}\b/ },
  { kind: 'stripe-live-key', re: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { kind: 'pem-private-key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    kind: 'connection-string-with-password',
    re: /\b(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s:/@]+:[^\s@]+@/i,
  },
]

export function findSecrets(source: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    for (const pat of SECRET_PATTERNS) {
      if (pat.re.test(line)) {
        findings.push({
          line: i + 1,
          kind: pat.kind,
          snippet: redact(line.trim().slice(0, 200)),
        })
      }
    }
  }
  return findings
}

/**
 * Replace most of the matched-looking token with asterisks so the secret
 * itself doesn't leak into the audit trail or the reviewer's prompt.
 */
function redact(line: string): string {
  return line.replace(/[A-Za-z0-9]{10,}/g, (m) =>
    m.length <= 6 ? m : `${m.slice(0, 3)}…${m.slice(-2)}`,
  )
}

const SECRETS_CHECK: DeterministicCheck = {
  id: 'sec.no-hardcoded-secrets',
  description:
    'Scan for common API-key / token / private-key patterns that suggest a secret has been committed.',
  run(_input: CheckInput): CheckResult {
    // Without a diff-file plumbing convention, we can't scan the changed
    // files automatically yet. The pure `findSecrets` function is exported
    // for project-specific gate wrappers.
    return {
      checkId: 'sec.no-hardcoded-secrets',
      pass: true,
      summary:
        'skipped — pure detector `findSecrets(source)` exported; wire a changed-file walker in CI or a guild gate',
    }
  },
}

export const SECURITY_ENGINEER_CHECKS: DeterministicCheck[] = [SECRETS_CHECK]
