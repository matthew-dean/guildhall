#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

const homeDir = flag('--home') ?? homedir()
const installDir = flag('--install-dir') ?? join(homeDir, '.guildhall', 'app', 'current')
const binPath = flag('--bin-path') ?? join(homeDir, '.guildhall', 'bin', 'guildhall')
const port = Number(flag('--port') ?? '7777')
const label = 'io.guildhall.agent'
const serviceStatePath = join(homeDir, '.guildhall', 'service.json')
const logsDir = join(homeDir, '.guildhall', 'logs')
const launchAgentsDir = join(homeDir, 'Library', 'LaunchAgents')
const plistPath = join(launchAgentsDir, `${label}.plist`)
const templatePath = flag('--template') ?? join(ROOT, 'packaging', 'macos', 'io.guildhall.agent.plist.tmpl')
const uid = process.getuid?.()
const servicePath = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':')

mkdirSync(logsDir, { recursive: true })
mkdirSync(launchAgentsDir, { recursive: true })

const argsXml = [
  binPath,
  'serve-internal',
  '--port',
  String(port),
  '--service-state',
  serviceStatePath,
].map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n')

const plist = readFileSync(templatePath, 'utf8')
  .replace('{{LABEL}}', xmlEscape(label))
  .replace('{{PROGRAM_ARGUMENTS}}', argsXml)
  .replace('{{WORKING_DIRECTORY}}', xmlEscape(installDir))
  .replace('{{STDOUT_PATH}}', xmlEscape(join(logsDir, 'service.stdout.log')))
  .replace('{{STDERR_PATH}}', xmlEscape(join(logsDir, 'service.stderr.log')))
  .replace('{{SERVICE_PATH}}', xmlEscape(servicePath))

writeFileSync(plistPath, plist, 'utf8')

if (uid !== undefined) {
  runLaunchctl(['bootout', `gui/${uid}`, plistPath], true)
  runLaunchctl(['bootstrap', `gui/${uid}`, plistPath], false)
  runLaunchctl(['kickstart', '-k', `gui/${uid}/${label}`], false)
}

console.log(`[guildhall] Installed LaunchAgent: ${plistPath}`)

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

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
