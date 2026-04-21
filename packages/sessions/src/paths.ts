/**
 * Ported from openharness/src/openharness/config/paths.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Default base dir `.openharness` → `.guildhall`
 *   - Environment variables OPENHARNESS_* → GUILDHALL_*
 *   - `Path.home()` → `os.homedir()`
 *   - Directories are created eagerly (synchronously) same as upstream; they
 *     live under a user-scoped base so this is cheap.
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_BASE_DIR = '.guildhall'

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

export function getConfigDir(): string {
  const envDir = process.env.GUILDHALL_CONFIG_DIR
  const dir = envDir && envDir.length > 0 ? envDir : join(homedir(), DEFAULT_BASE_DIR)
  return ensureDir(dir)
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), 'settings.json')
}

export function getDataDir(): string {
  const envDir = process.env.GUILDHALL_DATA_DIR
  const dir = envDir && envDir.length > 0 ? envDir : join(getConfigDir(), 'data')
  return ensureDir(dir)
}

export function getLogsDir(): string {
  const envDir = process.env.GUILDHALL_LOGS_DIR
  const dir = envDir && envDir.length > 0 ? envDir : join(getConfigDir(), 'logs')
  return ensureDir(dir)
}

export function getSessionsDir(): string {
  return ensureDir(join(getDataDir(), 'sessions'))
}

export function getTasksDir(): string {
  return ensureDir(join(getDataDir(), 'tasks'))
}

export function getFeedbackDir(): string {
  return ensureDir(join(getDataDir(), 'feedback'))
}
