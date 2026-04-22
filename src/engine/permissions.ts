/**
 * Ported from openharness/src/openharness/permissions/checker.py
 * and openharness/src/openharness/permissions/modes.py.
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `fnmatch` → a local micromatch-lite helper (only `*` and `?` needed for these patterns)
 *   - `dataclass` rules → plain TS types
 *   - "OpenHarness own credential stores" sensitive paths renamed to Guildhall's
 */

export enum PermissionMode {
  DEFAULT = 'default',
  PLAN = 'plan',
  FULL_AUTO = 'full_auto',
}

export interface PermissionSettings {
  mode: PermissionMode
  allowed_tools: string[]
  denied_tools: string[]
  denied_commands: string[]
  path_rules: PathRule[]
}

export interface PathRule {
  pattern: string
  allow: boolean
}

export interface PermissionDecision {
  allowed: boolean
  requiresConfirmation: boolean
  reason: string
}

export const SENSITIVE_PATH_PATTERNS: readonly string[] = [
  '*/.ssh/*',
  '*/.aws/credentials',
  '*/.aws/config',
  '*/.config/gcloud/*',
  '*/.azure/*',
  '*/.gnupg/*',
  '*/.docker/config.json',
  '*/.kube/config',
  '*/.guildhall/credentials.json',
  '*/.guildhall/copilot_auth.json',
]

export function defaultPermissionSettings(mode = PermissionMode.DEFAULT): PermissionSettings {
  return { mode, allowed_tools: [], denied_tools: [], denied_commands: [], path_rules: [] }
}

export class PermissionChecker {
  constructor(private readonly settings: PermissionSettings) {}

  evaluate(
    toolName: string,
    opts: { isReadOnly: boolean; filePath?: string | null; command?: string | null },
  ): PermissionDecision {
    const { isReadOnly, filePath, command } = opts

    if (filePath) {
      for (const candidate of policyMatchPaths(filePath)) {
        for (const pattern of SENSITIVE_PATH_PATTERNS) {
          if (fnmatch(candidate, pattern)) {
            return {
              allowed: false,
              requiresConfirmation: false,
              reason: `Access denied: ${filePath} is a sensitive credential path (matched built-in pattern '${pattern}')`,
            }
          }
        }
      }
    }

    if (this.settings.denied_tools.includes(toolName)) {
      return { allowed: false, requiresConfirmation: false, reason: `${toolName} is explicitly denied` }
    }

    if (this.settings.allowed_tools.includes(toolName)) {
      return { allowed: true, requiresConfirmation: false, reason: `${toolName} is explicitly allowed` }
    }

    if (filePath && this.settings.path_rules.length > 0) {
      for (const candidate of policyMatchPaths(filePath)) {
        for (const rule of this.settings.path_rules) {
          if (fnmatch(candidate, rule.pattern)) {
            if (!rule.allow) {
              return {
                allowed: false,
                requiresConfirmation: false,
                reason: `Path ${filePath} matches deny rule: ${rule.pattern}`,
              }
            }
          }
        }
      }
    }

    if (command) {
      for (const pattern of this.settings.denied_commands) {
        if (fnmatch(command, pattern)) {
          return {
            allowed: false,
            requiresConfirmation: false,
            reason: `Command matches deny pattern: ${pattern}`,
          }
        }
      }
    }

    if (this.settings.mode === PermissionMode.FULL_AUTO) {
      return { allowed: true, requiresConfirmation: false, reason: 'Auto mode allows all tools' }
    }

    if (isReadOnly) {
      return { allowed: true, requiresConfirmation: false, reason: 'read-only tools are allowed' }
    }

    if (this.settings.mode === PermissionMode.PLAN) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: 'Plan mode blocks mutating tools until the user exits plan mode',
      }
    }

    return {
      allowed: false,
      requiresConfirmation: true,
      reason:
        'Mutating tools require user confirmation in default mode. Approve the prompt when asked, or switch to full_auto if you want to allow them for this session.',
    }
  }
}

function policyMatchPaths(filePath: string): string[] {
  const normalized = filePath.replace(/\/+$/, '')
  if (!normalized) return [filePath]
  return [normalized, normalized + '/']
}

// Glob-style match for `*` (any run of chars) and `?` (any single char).
// Kept faithful to Python's fnmatch behavior used in the upstream checker:
// both `*` and `?` match across path separators, so patterns like
// `\*\/.ssh/\*` work. Upstream's fnmatch does not special-case `/`.
function fnmatch(input: string, pattern: string): boolean {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else if ('\\^$.|+()[]{}'.includes(ch)) re += `\\${ch}`
    else re += ch
  }
  return new RegExp(`^${re}$`).test(input)
}
