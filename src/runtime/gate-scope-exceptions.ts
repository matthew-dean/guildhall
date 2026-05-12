import path from 'node:path'

export interface ScopedGateResultLike {
  gateId: string
  passed: boolean
  output?: string | undefined
}

export interface ScopedGateContext {
  projectPath: string
  likelyTargetFiles: readonly string[]
  resolvedDecisionTexts: readonly string[]
}

type ScopedGateKind = 'typecheck' | 'build' | 'test' | 'lint' | 'other'

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}

function inferGateWorkingDirectory(gate: ScopedGateResultLike): string | null {
  const firstLine = gate.output?.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''
  const match = /^>\s+.+\s+(\/.+)$/.exec(firstLine)
  return match?.[1] ? match[1] : null
}

export function extractGateFailurePaths(
  projectPath: string,
  gate: ScopedGateResultLike,
): string[] {
  const baseDir = inferGateWorkingDirectory(gate)
  const taskProjectPath = path.resolve(projectPath || '')
  const seen = new Set<string>()
  const out: string[] = []
  const push = (candidate: string) => {
    const trimmed = candidate.trim()
    if (!trimmed) return
    let normalized = normalizeRelativePath(trimmed)
    if (baseDir && !path.isAbsolute(trimmed) && taskProjectPath) {
      normalized = normalizeRelativePath(
        path.relative(taskProjectPath, path.resolve(baseDir, trimmed)),
      )
    } else if (path.isAbsolute(trimmed) && taskProjectPath) {
      normalized = normalizeRelativePath(path.relative(taskProjectPath, trimmed))
    }
    if (!normalized || normalized.startsWith('..')) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  for (const rawLine of gate.output?.split('\n') ?? []) {
    const line = rawLine.trim()
    const tsMatch = /^([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|vue|mjs|cjs|cts|mts))\(\d+[,:]\d+\):\s+error\b/i.exec(line)
    if (tsMatch?.[1]) {
      push(tsMatch[1])
      continue
    }
    const testFailureMatch = /^(?:FAIL|❯)\s+([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|vue|mjs|cjs|cts|mts))/i.exec(line)
    if (testFailureMatch?.[1]) {
      push(testFailureMatch[1])
      continue
    }
    const eslintMatch = /^[,`'"]*([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|vue|mjs|cjs|cts|mts)):\d+:\d+/i.exec(line)
    if (eslintMatch?.[1]) {
      push(eslintMatch[1])
    }
  }
  return out
}

function hasScopedVerificationException(decisionTexts: readonly string[]): boolean {
  return decisionTexts.some((text) =>
    /typecheck|repo-red|unrelated file/i.test(text) &&
    /out of scope|same file set|changed target|scoped to/i.test(text),
  )
}

function classifyGateKind(gate: ScopedGateResultLike): ScopedGateKind {
  const haystack = `${gate.gateId}\n${gate.output ?? ''}`.toLowerCase()
  if (/\b(typecheck|tsc(?:\s|$)|tsgo\b)/.test(haystack)) return 'typecheck'
  if (/\blint\b/.test(haystack)) return 'lint'
  if (/\b(test|vitest|jest|playwright|pytest)\b/.test(haystack)) return 'test'
  if (/\bbuild\b/.test(haystack)) return 'build'
  return 'other'
}

function canAutoExemptScopedRepoRed(gate: ScopedGateResultLike): boolean {
  const kind = classifyGateKind(gate)
  return kind === 'test' || kind === 'lint'
}

function failureTouchesLikelyTaskFiles(
  likelyTargetFiles: readonly string[],
  failures: readonly string[],
): boolean {
  const normalizedTargets = likelyTargetFiles.map((file) => normalizeRelativePath(file))
  if (normalizedTargets.length === 0) return true
  return failures.some((failure) =>
    normalizedTargets.some(
      (target) =>
        failure === target || failure.startsWith(`${target}/`) || target.startsWith(`${failure}/`),
    ),
  )
}

export function isScopedGateFailureExempt(
  context: ScopedGateContext,
  gate: ScopedGateResultLike,
): boolean {
  if (gate.passed) return false
  const failurePaths = extractGateFailurePaths(context.projectPath, gate)
  if (failurePaths.length === 0) return false
  const touchesTaskFiles = failureTouchesLikelyTaskFiles(context.likelyTargetFiles, failurePaths)
  if (touchesTaskFiles) return false
  if (classifyGateKind(gate) === 'typecheck') {
    return hasScopedVerificationException(context.resolvedDecisionTexts)
  }
  return canAutoExemptScopedRepoRed(gate)
}

export function summarizeScopedHardGateDisposition(
  context: ScopedGateContext,
  gates: readonly ScopedGateResultLike[],
): { shouldPass: boolean; exemptedFailures: ScopedGateResultLike[] } | null {
  if (gates.length === 0) return null
  const failing = gates.filter((gate) => !gate.passed)
  if (failing.length === 0) {
    return { shouldPass: true, exemptedFailures: [] }
  }
  const exemptedFailures = failing.filter((gate) => isScopedGateFailureExempt(context, gate))
  if (exemptedFailures.length === failing.length) {
    return { shouldPass: true, exemptedFailures }
  }
  return { shouldPass: false, exemptedFailures }
}
