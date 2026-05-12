import type { HardGate } from '@guildhall/core'

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

export function classifyGateCommand(command: string): 'typecheck' | 'build' | 'test' | 'lint' | 'other' {
  const normalized = normalizeCommand(command).toLowerCase()
  if (/\b(typecheck|tsc(?:\s|$)|tsgo\b)/.test(normalized)) return 'typecheck'
  if (/\bbuild\b/.test(normalized)) return 'build'
  if (/\b(test|vitest|jest|playwright|pytest)\b/.test(normalized)) return 'test'
  if (/\blint\b/.test(normalized)) return 'lint'
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
  if (authoritativeCommands == null || authoritativeCommands.length === 0) {
    return { command: normalizedRequested, usedAuthority: false }
  }

  const exact = authoritativeCommands.find((command) => normalizeCommand(command) === normalizedRequested)
  if (exact) {
    return { command: normalizeCommand(exact), usedAuthority: true }
  }

  const requestedKind = classifyGateCommand(normalizedRequested)
  if (requestedKind === 'other') {
    return { command: normalizedRequested, usedAuthority: false }
  }
  const sameKind = authoritativeCommands.filter((command) => classifyGateCommand(command) === requestedKind)
  if (sameKind.length === 1) {
    return { command: normalizeCommand(sameKind[0]!), usedAuthority: true }
  }

  return { command: normalizedRequested, usedAuthority: false }
}
