import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { logProgress } from '@guildhall/tools'

// ---------------------------------------------------------------------------
// FR-29 / AC-20: local-only mode.
//
// When a remote-propagation action fails (git push, PR creation, webhook
// delivery, MCP server call), the project switches to `local_only` mode:
// state mutations continue on disk, but remote calls are suspended until
// the next successful reconnect attempt.
//
// Mode is tracked by a small JSON file at `memory/local-only.json`:
//   - Presence = local-only
//   - `enteredAt` — when we flipped into local-only
//   - `lastError` — the error message from the triggering failure
//   - `lastAttemptAt` — most recent re-attempt timestamp (for observability)
//
// Entry and exit are logged to PROGRESS.md as `blocked` / `milestone` entries
// respectively, so the human auditing PROGRESS.md always sees the transition.
// ---------------------------------------------------------------------------

export const LOCAL_ONLY_FILENAME = 'local-only.json'

export function localOnlyPath(memoryDir: string): string {
  return path.join(memoryDir, LOCAL_ONLY_FILENAME)
}

export interface LocalOnlyState {
  enteredAt: string
  lastError: string
  lastAttemptAt?: string
}

/** Sync presence probe — hot on every push attempt, so stat over open. */
export function isLocalOnly(memoryDir: string): boolean {
  return existsSync(localOnlyPath(memoryDir))
}

export async function readLocalOnlyState(
  memoryDir: string,
): Promise<LocalOnlyState | undefined> {
  try {
    const raw = await fs.readFile(localOnlyPath(memoryDir), 'utf-8')
    return JSON.parse(raw) as LocalOnlyState
  } catch {
    return undefined
  }
}

async function writeLocalOnlyState(
  memoryDir: string,
  state: LocalOnlyState,
): Promise<void> {
  const target = localOnlyPath(memoryDir)
  const tmp = target + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8')
  await fs.rename(tmp, target)
}

/**
 * Enter local-only mode. Idempotent — if already in local-only, the state
 * file is updated with the new lastError + lastAttemptAt but no duplicate
 * PROGRESS entry is logged.
 */
export async function enterLocalOnlyMode(
  memoryDir: string,
  opts: { reason: string; agentId?: string; domain?: string },
): Promise<{ alreadyLocal: boolean }> {
  const existing = await readLocalOnlyState(memoryDir)
  const now = new Date().toISOString()
  const nextState: LocalOnlyState = {
    enteredAt: existing?.enteredAt ?? now,
    lastError: opts.reason,
    lastAttemptAt: now,
  }
  await writeLocalOnlyState(memoryDir, nextState)
  if (existing) return { alreadyLocal: true }

  await logProgress({
    progressPath: path.join(memoryDir, 'PROGRESS.md'),
    entry: {
      type: 'blocked',
      agentId: opts.agentId ?? 'runtime',
      domain: opts.domain ?? 'system',
      summary: `Entered local-only mode: ${opts.reason}`,
      timestamp: now,
    },
  })
  return { alreadyLocal: false }
}

/**
 * Exit local-only mode and log the restoration. No-op if not currently in
 * local-only, so callers can always call this after a successful remote
 * action without branching.
 */
export async function exitLocalOnlyMode(
  memoryDir: string,
  opts: { note?: string; agentId?: string; domain?: string } = {},
): Promise<{ wasLocal: boolean }> {
  if (!isLocalOnly(memoryDir)) return { wasLocal: false }
  try {
    await fs.unlink(localOnlyPath(memoryDir))
  } catch {
    // ENOENT race — already gone
  }
  await logProgress({
    progressPath: path.join(memoryDir, 'PROGRESS.md'),
    entry: {
      type: 'milestone',
      agentId: opts.agentId ?? 'runtime',
      domain: opts.domain ?? 'system',
      summary: opts.note ?? 'Exited local-only mode — remote reachable again',
      timestamp: new Date().toISOString(),
    },
  })
  return { wasLocal: true }
}

export type RemoteSyncResult =
  | { ok: true; wasLocal: boolean }
  | { ok: false; entered: boolean; error: string }

/**
 * Attempt a remote-propagation action through the local-only gate.
 *
 *   - On success: if we were in local-only mode, exit it.
 *   - On failure: enter (or refresh) local-only mode.
 *
 * The caller supplies the actual push/PR/webhook function as `action`.
 * This helper is the single funnel every remote call should flow through,
 * so the mode state stays consistent.
 */
export async function attemptRemoteSync(
  memoryDir: string,
  action: () => Promise<void>,
  opts: { label: string; agentId?: string; domain?: string } = { label: 'remote-sync' },
): Promise<RemoteSyncResult> {
  try {
    await action()
    const { wasLocal } = await exitLocalOnlyMode(memoryDir, {
      note: `Remote sync succeeded (${opts.label}); exiting local-only mode`,
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
      ...(opts.domain ? { domain: opts.domain } : {}),
    })
    return { ok: true, wasLocal }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const { alreadyLocal } = await enterLocalOnlyMode(memoryDir, {
      reason: `${opts.label} failed: ${reason}`,
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
      ...(opts.domain ? { domain: opts.domain } : {}),
    })
    return { ok: false, entered: !alreadyLocal, error: reason }
  }
}
