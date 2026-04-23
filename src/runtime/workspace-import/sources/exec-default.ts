import { spawn } from 'node:child_process'
import type { TaskSourceContext } from '../types.js'

type Exec = NonNullable<TaskSourceContext['exec']>

/**
 * Default `exec` used by sources that shell out. Tests inject their own to
 * avoid hitting ripgrep / git on the host.
 */
export const execDefault: Exec = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, [...args], {
      cwd: opts?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    const timer = opts?.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
      : undefined
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? 1 })
    })
    child.on('error', () => {
      if (timer) clearTimeout(timer)
      resolve({ stdout, stderr, code: 127 })
    })
  })
