import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  detectPackageManager,
  detectGateCommands,
  runBootstrap,
  writeBootstrapResult,
  type Spawner,
} from '../bootstrap.js'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guildhall-bootstrap2-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writePkg(scripts: Record<string, string> = {}): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }))
}

describe('detectPackageManager', () => {
  it('returns pnpm when pnpm-lock.yaml is present', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    expect(detectPackageManager(dir)).toBe('pnpm')
  })
  it('returns npm when only package-lock.json is present', () => {
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    expect(detectPackageManager(dir)).toBe('npm')
  })
  it('returns yarn when only yarn.lock is present', () => {
    writeFileSync(join(dir, 'yarn.lock'), '')
    expect(detectPackageManager(dir)).toBe('yarn')
  })
  it('returns bun when only bun.lockb is present', () => {
    writeFileSync(join(dir, 'bun.lockb'), '')
    expect(detectPackageManager(dir)).toBe('bun')
  })
  it('returns none when no lockfile is present', () => {
    expect(detectPackageManager(dir)).toBe('none')
  })
  it('prefers pnpm over others when multiple lockfiles exist', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(dir, 'yarn.lock'), '')
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    expect(detectPackageManager(dir)).toBe('pnpm')
  })
})

describe('detectGateCommands', () => {
  it('marks every gate unavailable when there is no package.json', () => {
    const gates = detectGateCommands(dir, 'pnpm')
    for (const g of Object.values(gates)) {
      expect(g.available).toBe(false)
      expect(g.unavailableReason).toBe('no package.json')
    }
  })

  it('maps lint/build/test scripts and fills typecheck from tsconfig fallback', () => {
    writePkg({ lint: 'oxlint', build: 'tsc', test: 'vitest' })
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    const gates = detectGateCommands(dir, 'pnpm')
    expect(gates.lint).toEqual({ command: 'pnpm lint', available: true })
    expect(gates.build).toEqual({ command: 'pnpm build', available: true })
    expect(gates.test).toEqual({ command: 'pnpm test', available: true })
    // typecheck has no script but tsconfig.json exists → fallback
    expect(gates.typecheck.available).toBe(true)
    expect(gates.typecheck.command).toBe('pnpm tsc --noEmit')
  })

  it('accepts typecheck aliases (type-check, tsc)', () => {
    writePkg({ 'type-check': 'tsc --noEmit' })
    const gates = detectGateCommands(dir, 'npm')
    expect(gates.typecheck).toEqual({ command: 'npm type-check', available: true })
  })

  it('marks typecheck unavailable when there is no tsconfig.json and no script', () => {
    writePkg({ lint: 'oxlint' })
    const gates = detectGateCommands(dir, 'pnpm')
    expect(gates.typecheck.available).toBe(false)
    expect(gates.typecheck.unavailableReason).toBe(
      'no typecheck script and no tsconfig.json',
    )
  })

  it('marks other gates unavailable with a specific reason when the script is missing', () => {
    writePkg({})
    const gates = detectGateCommands(dir, 'pnpm')
    expect(gates.lint.unavailableReason).toMatch(/no `lint` script/)
    expect(gates.build.unavailableReason).toMatch(/no `build` script/)
    expect(gates.test.unavailableReason).toMatch(/no `test` script/)
  })
})

describe('runBootstrap', () => {
  function makeSpawner(overrides: Record<string, { exitCode?: number; stdout?: string; stderr?: string }> = {}): { spawner: Spawner; calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const spawner: Spawner = (command, args) => {
      calls.push({ cmd: command, args: [...args] })
      const key = `${command} ${args.join(' ')}`.trim()
      const match = Object.keys(overrides).find((k) => key.startsWith(k))
      const cfg = match ? overrides[match]! : { exitCode: 0 }
      const exitCode = cfg.exitCode ?? 0
      return {
        ok: exitCode === 0,
        exitCode,
        stdout: cfg.stdout ?? '',
        stderr: cfg.stderr ?? '',
      }
    }
    return { spawner, calls }
  }

  it('runs install then verifies each available gate via --help', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({ lint: 'oxlint', build: 'tsc', test: 'vitest' })
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    const { spawner, calls } = makeSpawner()
    const res = runBootstrap(dir, { spawner, nowIso: () => '2026-04-23T00:00:00Z' })
    expect(res.ok).toBe(true)
    expect(res.bootstrap.packageManager).toBe('pnpm')
    expect(res.bootstrap.install.command).toBe('pnpm install')
    expect(res.bootstrap.install.status).toBe('ok')
    expect(res.bootstrap.verifiedAt).toBe('2026-04-23T00:00:00Z')
    // install + 4 verify calls
    const verifyCalls = calls.filter((c) => c.args.includes('--help'))
    expect(verifyCalls).toHaveLength(4)
    // install was first
    expect(calls[0]).toEqual({ cmd: 'pnpm', args: ['install'] })
  })

  it('marks install failed when spawner returns non-zero', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({ lint: 'oxlint' })
    const { spawner } = makeSpawner({ 'pnpm install': { exitCode: 1, stderr: 'boom' } })
    const res = runBootstrap(dir, { spawner })
    expect(res.ok).toBe(false)
    expect(res.bootstrap.install.status).toBe('failed')
  })

  it('marks a gate unavailable when its --help probe fails', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({ lint: 'oxlint' })
    const { spawner } = makeSpawner({ 'pnpm lint': { exitCode: 127 } })
    const res = runBootstrap(dir, { spawner, skipInstall: true })
    expect(res.bootstrap.gates.lint.available).toBe(false)
    expect(res.bootstrap.gates.lint.unavailableReason).toMatch(/exited 127/)
  })

  it('skipInstall skips the install step entirely', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({})
    const { spawner, calls } = makeSpawner()
    runBootstrap(dir, { spawner, skipInstall: true })
    expect(calls.some((c) => c.cmd === 'pnpm' && c.args[0] === 'install')).toBe(false)
  })

  it('streams logs via onLog', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({})
    const lines: string[] = []
    const { spawner } = makeSpawner()
    runBootstrap(dir, { spawner, onLog: (l) => lines.push(l), skipInstall: true })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((l) => l.includes('package manager: pnpm'))).toBe(true)
  })
})

describe('writeBootstrapResult', () => {
  it('merges the bootstrap block into existing guildhall.yaml without clobbering other fields', () => {
    writeFileSync(
      join(dir, 'guildhall.yaml'),
      'name: My Project\nid: my-project\ncoordinators: []\n',
      'utf8',
    )
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({})
    mkdirSync(join(dir, 'memory'), { recursive: true })
    const { spawner } = ((): { spawner: Spawner } => {
      const s: Spawner = () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' })
      return { spawner: s }
    })()
    const res = runBootstrap(dir, { spawner, skipInstall: true })
    writeBootstrapResult(dir, res)
    const parsed = parseYaml(readFileSync(join(dir, 'guildhall.yaml'), 'utf8')) as {
      name: string
      id: string
      bootstrap: { verifiedAt: string; packageManager: string }
    }
    expect(parsed.name).toBe('My Project')
    expect(parsed.id).toBe('my-project')
    expect(parsed.bootstrap.packageManager).toBe('pnpm')
    expect(parsed.bootstrap.verifiedAt).toBeDefined()
    expect(existsSync(join(dir, 'guildhall.yaml'))).toBe(true)
  })

  it('round-trips ISO timestamps as strings, not Dates (guards the on-load schema)', () => {
    writeFileSync(
      join(dir, 'guildhall.yaml'),
      'name: Round Trip\nid: rt\ncoordinators: []\n',
      'utf8',
    )
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writePkg({ typecheck: 'tsc --noEmit' })
    const spawner: Spawner = () => ({ ok: true, exitCode: 0, stdout: '', stderr: '' })
    const res = runBootstrap(dir, { spawner, skipInstall: false })
    writeBootstrapResult(dir, res)
    // Reload and assert that YAML didn't auto-promote the ISO strings to
    // `Date` objects — the Zod schema demands z.string().
    const loaded = parseYaml(readFileSync(join(dir, 'guildhall.yaml'), 'utf8')) as {
      bootstrap: {
        verifiedAt: unknown
        install: { lastRunAt?: unknown }
      }
    }
    expect(typeof loaded.bootstrap.verifiedAt).toBe('string')
    if (loaded.bootstrap.install.lastRunAt !== undefined) {
      expect(typeof loaded.bootstrap.install.lastRunAt).toBe('string')
    }
  })
})
