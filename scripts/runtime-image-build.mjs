#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'

const image = 'ghcr.io/matthew-dean/guildhall-runtime-debian'
const immutableTag = '0.11.0-trixie-node22-python313-playwright'
const minorTag = '0.11-trixie-node22-python313-playwright'
const timeoutMs = Number(process.env.GUILDHALL_CONTAINER_BUILD_TIMEOUT_MS ?? 20 * 60 * 1000)

function available(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  return result.status === 0
}

function chooseEngine() {
  if (available('docker', ['info'])) return 'docker'
  if (available('podman', ['info'])) return 'podman'
  throw new Error('Neither Docker nor Podman is running. Start Docker Desktop or Podman, then retry.')
}

const engine = process.env.GUILDHALL_CONTAINER_BUILD_ENGINE || chooseEngine()
if (engine !== 'docker' && engine !== 'podman') {
  throw new Error(`Unsupported container build engine: ${engine}`)
}

const args = [
  'build',
  '-f',
  'runtime/Containerfile',
  '-t',
  `${image}:${immutableTag}`,
  '-t',
  `${image}:${minorTag}`,
  '.',
]

console.log(`[guildhall runtime] building with ${engine}`)
const env = {
  ...process.env,
  ...(engine === 'docker' ? { DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT ?? '0' } : {}),
}
const child = spawn(engine, args, { stdio: 'inherit', env })
const timer = setTimeout(() => {
  console.error(`[guildhall runtime] ${engine} build timed out after ${timeoutMs}ms. Check container registry access or build with GUILDHALL_CONTAINER_BUILD_ENGINE=podman.`)
  child.kill('SIGTERM')
  setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
}, timeoutMs)

child.on('error', error => {
  clearTimeout(timer)
  console.error(`[guildhall runtime] ${engine} build failed: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  clearTimeout(timer)
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})
