import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

// Tests that create project roots must never allocate derived state in the
// developer's real Guildhall data directory. A per-worker root also keeps
// parallel Vitest workers from sharing project-state files.
const configuredDataDir = process.env.GUILDHALL_DATA_DIR
const defaultDataDir = path.join(os.homedir(), '.guildhall', 'data')
// A shell-level GUILDHALL_DATA_DIR must not silently turn a test run into a
// writer against the user's durable cache. Tests that need a data directory
// set it inside their own setup and restore it afterward.
const ownsDataDir = !configuredDataDir || path.resolve(configuredDataDir) === path.resolve(defaultDataDir)
const dataDir = ownsDataDir
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-vitest-data-'))
  : configuredDataDir

if (dataDir) process.env.GUILDHALL_DATA_DIR = dataDir

afterAll(() => {
  if (ownsDataDir && dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
})
