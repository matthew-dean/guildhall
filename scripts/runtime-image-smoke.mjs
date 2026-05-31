#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const image = process.env.GUILDHALL_RUNTIME_IMAGE
  ?? 'ghcr.io/matthew-dean/guildhall-runtime-debian:0.9.0-trixie-node22-python313-playwright'
const projectRoot = process.cwd()
const explicitGuildhallHome = process.env.GUILDHALL_HOME?.trim()
const guildhallHome = explicitGuildhallHome
  ? resolve(explicitGuildhallHome)
  : resolve(tmpdir(), `guildhall-runtime-smoke-${process.pid}`)
const shouldCleanupGuildhallHome = !explicitGuildhallHome

if (!existsSync(guildhallHome)) {
  mkdirSync(guildhallHome, { recursive: true })
}

const result = spawnSync('podman', [
  'run',
  '--rm',
  '--entrypoint',
  'guildhall-healthcheck',
  '-e',
  'GUILDHALL_PROJECT_ID=smoke',
  '-e',
  'GUILDHALL_RUNTIME_ID=smoke-runtime',
  '-v',
  `${projectRoot}:/workspace/project`,
  '-v',
  `${guildhallHome}:/home/guildhall/.guildhall`,
  image,
], {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (shouldCleanupGuildhallHome) {
  rmSync(guildhallHome, { recursive: true, force: true })
}

process.exit(result.status ?? 1)
