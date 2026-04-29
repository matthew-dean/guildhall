import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// FR-28: cooperative-shutdown marker + process registry.
//
// A long-running `guildhall serve` process must honor three shutdown paths:
//   1. SIGINT / SIGTERM from the terminal or supervisor.
//   2. An external tool writing `memory/stop-requested` (no signal delivery
//      available — e.g. a systemd reload, a remote operator over SSH into
//      a container that doesn't expose signals).
//   3. The dashboard clicking "Stop" (handled via the supervisor's in-memory
//      stopSignal flag).
//
// All three converge on the same flow: flip the in-memory `stopSignal`
// (which the orchestrator polls between ticks), wait for in-flight ticks
// to drain, then cleanly kill child processes owned by this orchestrator,
// then exit 0.
//
// The marker file is a plain text file. Presence = stop requested; content
// is optional metadata (who requested, at what time) for forensics.
// ---------------------------------------------------------------------------

export const STOP_REQUESTED_FILENAME = 'stop-requested'

export function stopRequestedPath(memoryDir: string): string {
  return path.join(memoryDir, STOP_REQUESTED_FILENAME)
}

/**
 * True if `memory/stop-requested` exists. The orchestrator polls this
 * between ticks as a secondary signal alongside the in-memory stopSignal.
 *
 * Sync on purpose — called inside the hot tick loop, ENOENT is the common
 * case, and the open+stat roundtrip is cheap.
 */
export function isStopRequested(memoryDir: string): boolean {
  return existsSync(stopRequestedPath(memoryDir))
}

export interface StopMarkerDetail {
  requestedAt: string
  requestedBy?: string
  reason?: string
}

/**
 * Write the stop marker atomically (tmp → rename). Safe to call from a
 * signal handler; the write is best-effort and swallows errors so we
 * don't mask the underlying shutdown intent.
 */
export async function writeStopRequested(
  memoryDir: string,
  detail: StopMarkerDetail,
): Promise<void> {
  const target = stopRequestedPath(memoryDir)
  const tmp = target + '.tmp'
  const payload = JSON.stringify(detail, null, 2) + '\n'
  try {
    await fs.writeFile(tmp, payload, 'utf-8')
    await fs.rename(tmp, target)
  } catch {
    // Best-effort: if we can't write the marker (read-only FS, missing
    // dir), the in-memory stopSignal is still flipped by the caller.
  }
}

/** Remove the stop marker. Called after a clean shutdown completes or when
 *  the orchestrator starts and has to reclaim ownership. */
export async function clearStopRequested(memoryDir: string): Promise<void> {
  try {
    await fs.unlink(stopRequestedPath(memoryDir))
  } catch {
    // ENOENT is fine — marker might not exist.
  }
}

// ---------------------------------------------------------------------------
// Process registry (FR-28).
//
// When Guildhall spawns a child — a dev server, a subprocess worker (future
// FR-24 out-of-process dispatch), an MCP server, a container — the owning
// code must register it here so cooperative shutdown can kill it cleanly.
//
// We keep the registry deliberately minimal. Registrations are in-memory
// only; they do not survive an orchestrator crash because we can't track
// grandchild PIDs reliably across restarts. For crash-recovered state,
// rely on the OS cleanup + checkpoint-driven resume (FR-33).
// ---------------------------------------------------------------------------

export interface RegisteredProcess {
  pid: number
  kind: 'dev-server' | 'subprocess-worker' | 'mcp' | 'hook' | 'other'
  label: string
  /** Task the child belongs to, if any. Used for selective kill on task abort. */
  owningTaskId?: string
  /** Called on shutdown; defaults to `process.kill(pid, signal)`. */
  kill?: (signal: NodeJS.Signals) => void | Promise<void>
}

export class ProcessRegistry {
  private readonly entries = new Map<number, RegisteredProcess>()

  register(entry: RegisteredProcess): void {
    this.entries.set(entry.pid, entry)
  }

  unregister(pid: number): void {
    this.entries.delete(pid)
  }

  list(): readonly RegisteredProcess[] {
    return Array.from(this.entries.values())
  }

  /**
   * Kill every registered child. First SIGTERM with a grace period, then
   * SIGKILL if anything is still alive. Errors are logged but swallowed —
   * a stubborn child must not block the host shutdown.
   */
  async shutdownAll(opts: { graceMs?: number } = {}): Promise<void> {
    const graceMs = opts.graceMs ?? 2000
    const entries = Array.from(this.entries.values())
    if (entries.length === 0) return
    await Promise.all(
      entries.map(async (e) => {
        try {
          if (e.kill) {
            await e.kill('SIGTERM')
          } else {
            try { process.kill(e.pid, 'SIGTERM') } catch {}
          }
        } catch {}
      }),
    )

    await sleep(graceMs)

    for (const e of entries) {
      if (!isAlive(e.pid)) continue
      try {
        if (e.kill) {
          await e.kill('SIGKILL')
        } else {
          try { process.kill(e.pid, 'SIGKILL') } catch {}
        }
      } catch {}
    }

    this.entries.clear()
  }
}

function isAlive(pid: number): boolean {
  try {
    // signal 0 is a liveness probe — throws ESRCH if the process is gone.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
