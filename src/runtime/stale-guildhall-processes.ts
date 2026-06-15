import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GuildhallProcessMode = 'mcp' | 'serve' | 'other'

export interface GuildhallProcessInfo {
  pid: number
  startedAtMs: number
  command: string
  mode: GuildhallProcessMode
  stale: boolean
}

export interface StaleGuildhallProcessOptions {
  currentPid?: number
  currentBuildMtimeMs: number
}

export interface StopStaleGuildhallProcessOptions extends StaleGuildhallProcessOptions {
  listProcesses?: () => Promise<GuildhallProcessInfo[]>
  killProcess?: (pid: number, signal?: NodeJS.Signals) => void
  isProcessAlive?: (pid: number) => boolean
  forceAfterMs?: number
}

function parsePsLine(line: string): GuildhallProcessInfo | null {
  const match = line.match(/^\s*(\d+)\s+(.{24})\s+(.+)$/)
  if (!match) return null
  const [, pidText, startedText, commandText] = match
  const pid = Number(pidText)
  const startedAtMs = Date.parse((startedText ?? '').trim())
  const command = commandText?.trim() ?? ''
  if (!Number.isFinite(pid) || !Number.isFinite(startedAtMs)) return null
  if (!command.includes('dist/cli.js')) return null
  if (!command.includes('/.guildhall/app/')) return null
  const mode: GuildhallProcessMode = command.includes(' mcp serve')
    ? 'mcp'
    : command.includes(' serve-internal')
      ? 'serve'
      : 'other'
  return { pid, startedAtMs, command, mode, stale: false }
}

export function parseGuildhallProcessList(output: string): GuildhallProcessInfo[] {
  return output
    .split(/\r?\n/)
    .map(parsePsLine)
    .filter((process): process is GuildhallProcessInfo => process !== null)
}

export async function listGuildhallProcesses(): Promise<GuildhallProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid,lstart,command'], { maxBuffer: 1024 * 1024 })
    return parseGuildhallProcessList(stdout)
  } catch {
    return []
  }
}

export function findStaleGuildhallProcesses(
  processes: GuildhallProcessInfo[],
  options: StaleGuildhallProcessOptions,
): GuildhallProcessInfo[] {
  const currentPid = options.currentPid ?? process.pid
  return processes
    .filter(candidate => candidate.pid !== currentPid)
    .filter(candidate => candidate.startedAtMs < options.currentBuildMtimeMs)
    .map(candidate => ({ ...candidate, stale: true }))
}

export async function stopStaleGuildhallProcesses(
  options: StopStaleGuildhallProcessOptions,
): Promise<{ stopped: GuildhallProcessInfo[] }> {
  const listProcesses = options.listProcesses ?? listGuildhallProcesses
  const killProcess = options.killProcess ?? ((pid: number, signal: NodeJS.Signals = 'SIGTERM') => process.kill(pid, signal))
  const isProcessAlive = options.isProcessAlive ?? ((pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  const stale = findStaleGuildhallProcesses(await listProcesses(), options)
  for (const candidate of stale) {
    try {
      killProcess(candidate.pid, 'SIGTERM')
    } catch {
      // Best-effort guardrail. Reporting still includes the stale process.
    }
  }
  if (stale.length > 0) {
    await delay(options.forceAfterMs ?? 150)
    for (const candidate of stale) {
      try {
        if (isProcessAlive(candidate.pid)) {
          killProcess(candidate.pid, 'SIGKILL')
        }
      } catch {
        // Best-effort guardrail. Reporting still includes the stale process.
      }
    }
  }
  return { stopped: stale }
}
