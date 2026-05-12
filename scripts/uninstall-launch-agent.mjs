#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const homeDir = flag('--home') ?? homedir()
const label = 'io.guildhall.agent'
const plistPath = flag('--plist') ?? join(homeDir, 'Library', 'LaunchAgents', `${label}.plist`)
const uid = process.getuid?.()

if (uid !== undefined) {
  runLaunchctl(['bootout', `gui/${uid}`, plistPath], true)
}

if (existsSync(plistPath)) rmSync(plistPath, { force: true })

console.log(`[guildhall] Removed LaunchAgent: ${plistPath}`)

function flag(name) {
  const idx = args.indexOf(name)
  return idx === -1 ? undefined : args[idx + 1]
}

function runLaunchctl(argv, allowFailure) {
  const result = spawnSync('launchctl', argv, { stdio: 'inherit' })
  if (!allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
