import path from 'node:path'
import { homedir } from 'node:os'

export function expandHomePath(input: string, homeDir = homedir()): string {
  const trimmed = input.trim()
  if (trimmed === '~') return homeDir
  if (trimmed.startsWith('~/')) return path.join(homeDir, trimmed.slice(2))
  return trimmed
}

export function resolveRuntimePath(input: string, homeDir = homedir()): string {
  return path.resolve(expandHomePath(input, homeDir))
}
