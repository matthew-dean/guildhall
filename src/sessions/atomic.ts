/**
 * Ported from openharness/src/openharness/utils/fs.py:atomic_write_text.
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `tempfile.mkstemp` → a random-suffixed sibling file created via writeFileSync + rename
 *   - `os.fsync` → `fs.fsyncSync(fd)` on the file descriptor before close
 *   - Mode preservation uses `fs.statSync(dst).mode` when the file exists; on
 *     new files we defer to the process umask (same as upstream).
 *   - All sync, matching upstream's blocking semantics. Session snapshots are
 *     small enough that async doesn't buy us anything.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  chmodSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export function atomicWriteBytes(path: string, data: Buffer, opts?: { mode?: number }): void {
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true })

  let targetMode: number | null = null
  if (opts?.mode != null) {
    targetMode = opts.mode
  } else if (existsSync(path)) {
    targetMode = statSync(path).mode & 0o777
  }

  const tmpName = `.${join(parent, '').split('/').pop() ?? ''}${randomBytes(6).toString('hex')}.tmp`
  const tmpPath = join(parent, tmpName)
  const fd = openSync(tmpPath, 'w')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
    closeSync(fd)
    if (targetMode != null) chmodSync(tmpPath, targetMode)
    renameSync(tmpPath, path)
  } catch (err) {
    try {
      closeSync(fd)
    } catch {
      // fd may already be closed
    }
    try {
      unlinkSync(tmpPath)
    } catch {
      // tmp may already be gone
    }
    throw err
  }
}

export function atomicWriteText(
  path: string,
  data: string,
  opts?: { encoding?: BufferEncoding; mode?: number },
): void {
  atomicWriteBytes(path, Buffer.from(data, opts?.encoding ?? 'utf8'), opts)
}
