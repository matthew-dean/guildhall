import type { HardGate } from '@guildhall/core'

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function unwrapShellCommandForAuthority(command: string): string {
  let normalized = normalizeCommand(command)
  normalized = normalized.replace(/\s+(?:2>&1|1>\/dev\/null|2>\/dev\/null)\s*$/i, '')
  const cdPrefix = /^(?:cd\s+(?:"[^"]+"|'[^']+'|[^&;]+?)\s*&&\s*)+/i
  normalized = normalized.replace(cdPrefix, '')
  return normalized.trim()
}

function classifyPackageManagerCommand(tokens: string[]): 'typecheck' | 'build' | 'test' | 'lint' | null {
  if (tokens.length === 0) return null
  const packageManagers = new Set(['pnpm', 'npm', 'yarn', 'bun'])
  if (!packageManagers.has(tokens[0] ?? '')) return null

  let index = 1
  while (index < tokens.length && tokens[index]?.startsWith('-')) {
    index += 1
    if (index < tokens.length && !(tokens[index]?.startsWith('-'))) {
      index += 1
    }
  }

  if (tokens[index] === 'run' || tokens[index] === 'exec') index += 1
  const subcommand = tokens[index] ?? ''
  if (subcommand === 'test' || subcommand === 'vitest') return 'test'
  if (subcommand === 'lint') return 'lint'
  if (subcommand === 'build') return 'build'
  if (subcommand === 'typecheck' || subcommand === 'tsgo') return 'typecheck'
  return null
}

export function classifyGateCommand(command: string): 'typecheck' | 'build' | 'test' | 'lint' | 'other' {
  const normalized = unwrapShellCommandForAuthority(command).toLowerCase()
  const packageManagerKind = classifyPackageManagerCommand(normalized.split(' '))
  if (packageManagerKind) return packageManagerKind
  if (/^tsc(?:\s|$)/.test(normalized)) return 'typecheck'
  if (/^(?:turbo|vite|webpack|rollup|esbuild)(?:\s|$)/.test(normalized)) return 'build'
  if (/^(?:vitest|jest|playwright|pytest)(?:\s|$)/.test(normalized)) return 'test'
  if (/^(?:eslint|biome)(?:\s|$)/.test(normalized)) return 'lint'
  return 'other'
}

function defaultGateId(command: string, usedIds: Set<string>): string {
  const kind = classifyGateCommand(command)
  const preferred =
    kind === 'test' && /\bplaywright\b/i.test(command)
      ? 'playwright-e2e'
      : kind
  let id = preferred
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${preferred}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

function defaultGateLabel(command: string): string {
  const kind = classifyGateCommand(command)
  if (kind === 'typecheck') return 'TypeScript typecheck'
  if (kind === 'build') return 'Build'
  if (kind === 'lint') return 'Lint'
  if (kind === 'test' && /\bplaywright\b/i.test(command)) return 'Playwright E2E test'
  if (kind === 'test') return 'Test'
  return command
}

export function parseAuthoritativeCommands(metadata: Record<string, unknown>): string[] | null {
  const verificationRaw = metadata['current_task_verification_commands']
  if (Array.isArray(verificationRaw)) {
    const commands = verificationRaw
      .filter((entry): entry is string => typeof entry === 'string')
      .map(normalizeCommand)
      .filter((entry) => entry.length > 0)
    if (commands.length > 0) return commands
    return []
  }

  const raw = metadata['current_task_success_gates']
  if (!Array.isArray(raw)) return null
  const commands = raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeCommand)
    .filter((entry) => entry.length > 0)
  return commands.length > 0 ? commands : []
}

export function reconcileRequestedGatesWithAuthority(
  requested: readonly HardGate[],
  authoritativeCommands: readonly string[] | null,
): { gates: HardGate[]; usedAuthority: boolean } {
  if (authoritativeCommands == null) {
    return { gates: [...requested], usedAuthority: false }
  }
  if (authoritativeCommands.length === 0) {
    return { gates: [], usedAuthority: true }
  }

  const remaining = [...requested]
  const usedIds = new Set<string>()
  const gates = authoritativeCommands.map((command) => {
    const normalized = normalizeCommand(command)
    const exactIdx = remaining.findIndex((gate) => normalizeCommand(gate.command) === normalized)
    const kind = classifyGateCommand(normalized)
    const fallbackIdx =
      exactIdx >= 0
        ? -1
        : remaining.findIndex((gate) => classifyGateCommand(gate.command) === kind)
    const match = exactIdx >= 0
      ? remaining.splice(exactIdx, 1)[0]
      : fallbackIdx >= 0
        ? remaining.splice(fallbackIdx, 1)[0]
        : undefined
    const id = match?.id && match.id.trim().length > 0
      ? match.id
      : defaultGateId(normalized, usedIds)
    usedIds.add(id)
    return {
      id,
      label: match?.label?.trim() ? match.label : defaultGateLabel(normalized),
      command: normalized,
      timeoutMs: match?.timeoutMs ?? 120_000,
    } satisfies HardGate
  })

  return { gates, usedAuthority: true }
}

export function reconcileShellCommandWithAuthority(
  requestedCommand: string,
  authoritativeCommands: readonly string[] | null,
): { command: string; usedAuthority: boolean } {
  const normalizedRequested = normalizeCommand(requestedCommand)
  const unwrappedRequested = unwrapShellCommandForAuthority(requestedCommand)
  if (authoritativeCommands == null || authoritativeCommands.length === 0) {
    return { command: unwrappedRequested || normalizedRequested, usedAuthority: false }
  }

  const exact = authoritativeCommands.find((command) => {
    const normalized = normalizeCommand(command)
    const unwrapped = unwrapShellCommandForAuthority(command)
    return (
      normalized === normalizedRequested ||
      normalized === unwrappedRequested ||
      unwrapped === normalizedRequested ||
      unwrapped === unwrappedRequested
    )
  })
  if (exact) {
    return { command: normalizeCommand(exact), usedAuthority: true }
  }

  const requestedKind = classifyGateCommand(unwrappedRequested)
  if (requestedKind === 'other') {
    return { command: unwrappedRequested || normalizedRequested, usedAuthority: false }
  }
  const sameKind = authoritativeCommands.filter((command) => classifyGateCommand(command) === requestedKind)
  if (sameKind.length === 1) {
    return { command: normalizeCommand(sameKind[0]!), usedAuthority: true }
  }

  return { command: unwrappedRequested || normalizedRequested, usedAuthority: false }
}
