export function isGitUnavailableMessage(message: unknown): boolean {
  if (typeof message !== 'string') return false
  return message.toLowerCase().includes('spawn git enoent')
}

export function friendlyRuntimeMessage(message: string): string {
  const withoutAbortNoise = message.replace(/\s*\((?:request aborted|aborted)\.?\)\s*$/i, '').trim()
  if (withoutAbortNoise && withoutAbortNoise !== message) return withoutAbortNoise
  const normalized = message.toLowerCase()
  if (normalized.includes('gate_hard_failure')) {
    return 'Verification is blocked. Open the task to choose the next recovery step.'
  }
  if (normalized.includes('authoritative verification') || normalized.includes('checkpoint-touched')) {
    return 'Verification is blocked by a project build or test issue outside this task.'
  }
  if (
    isGitUnavailableMessage(message) ||
    normalized.includes('git enoent')
  ) {
    return 'Guildhall could not find git while inspecting this project.'
  }
  if (normalized.includes('fatal: not a git repository')) {
    return 'Guildhall could not inspect git for this project path. If this project contains child repos, Guildhall should inspect those repos instead.'
  }
  return message
}
