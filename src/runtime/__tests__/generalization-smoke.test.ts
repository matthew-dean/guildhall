import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectBootstrapHypothesis } from '../detect-bootstrap.js'
import { detectGateCommands } from '../bootstrap.js'
import { deriveBootstrapHypothesisFromProfiles, detectToolchainProfiles } from '../toolchain-profile.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const fixtureRoot = path.join(repoRoot, 'internal/fixtures/generalization-smoke')

const cases = [
  {
    name: 'node-web',
    profile: 'node',
    gates: ['pnpm typecheck', 'pnpm build', 'pnpm test', 'pnpm lint'],
    commands: ['pnpm install'],
    absent: /Looma|Knit|AlertDialog/i,
  },
  {
    name: 'python-cli',
    profile: 'python',
    gates: ['uv run pytest'],
    commands: ['uv sync'],
    proofKinds: ['command', 'cli'],
    absent: /browser proof|package\.json|pnpm/i,
  },
  {
    name: 'rust-lib',
    profile: 'rust',
    gates: ['cargo build', 'cargo test', 'cargo clippy --all-targets --all-features'],
    commands: [],
    proofKinds: ['command', 'cli'],
    absent: /browser proof|tsconfig|vitest|pnpm/i,
  },
  {
    name: 'go-service',
    profile: 'go',
    gates: ['go test ./...'],
    commands: [],
    proofKinds: ['command', 'http', 'cli'],
    absent: /package\.json|pnpm|Vue|Svelte/i,
  },
  {
    name: 'java-gradle-service',
    profile: 'java-gradle',
    gates: ['./gradlew build', './gradlew test'],
    commands: [],
    absent: /npm|tsconfig|browser proof/i,
  },
  {
    name: 'swift-package',
    profile: 'swift',
    gates: ['swift build', 'swift test'],
    commands: [],
    absent: /Node|browser proof|pnpm/i,
  },
  {
    name: 'native-cli',
    profile: 'native',
    gates: ['cmake -S . -B build', 'cmake --build build', 'ctest --test-dir build'],
    commands: [],
    absent: /package manager|pnpm|package\.json/i,
  },
  {
    name: 'terraform-module',
    profile: 'terraform',
    gates: ['terraform fmt -check', 'terraform validate'],
    commands: [],
    proofKinds: ['command', 'review'],
    absent: /typecheck|build|pnpm|package\.json/i,
  },
  {
    name: 'docs-only',
    profile: 'docs',
    gates: [],
    commands: [],
    proofKinds: ['review'],
    absent: /implementation-worker|pnpm|pytest|cargo|browser proof/i,
  },
] as const

describe('generalization smoke fixtures', () => {
  it.each(cases)('derives profile-backed bootstrap for $name', (entry) => {
    const root = path.join(fixtureRoot, entry.name)
    const profiles = detectToolchainProfiles(root)
    const profileSummary = deriveBootstrapHypothesisFromProfiles(profiles)
    const bootstrap = detectBootstrapHypothesis(root)

    expect(profiles.map((profile) => profile.id)).toContain(entry.profile)
    expect(bootstrap.commands).toEqual(entry.commands)
    expect(bootstrap.successGates).toEqual(entry.gates)
    const expectedProofKinds = 'proofKinds' in entry ? entry.proofKinds : ['command']
    expect(profileSummary.proofKinds).toEqual(expect.arrayContaining([...expectedProofKinds]))
    expect(JSON.stringify({ profiles, bootstrap })).not.toMatch(entry.absent)
  })

  it('feeds profile gates into bootstrap gate detection for non-Node fixtures', () => {
    const python = detectGateCommands(path.join(fixtureRoot, 'python-cli'), 'none')
    const rust = detectGateCommands(path.join(fixtureRoot, 'rust-lib'), 'none')
    const go = detectGateCommands(path.join(fixtureRoot, 'go-service'), 'none')

    expect(python.test).toEqual({ command: 'uv run pytest', available: true })
    expect(rust.build).toEqual({ command: 'cargo build', available: true })
    expect(rust.test).toEqual({ command: 'cargo test', available: true })
    expect(go.test).toEqual({ command: 'go test ./...', available: true })
  })

  it('keeps touched generic runtime modules free of project-specific product vocabulary', () => {
    const touchedGenericModules = [
      'src/runtime/toolchain-profile.ts',
      'src/runtime/detect-bootstrap.ts',
      'src/runtime/bootstrap.ts',
      'src/runtime/task-gates.ts',
    ]
    const contents = touchedGenericModules.map((relative) =>
      readFileSync(path.join(repoRoot, relative), 'utf8'),
    ).join('\n')

    expect(contents).not.toMatch(/\b(?:Looma|Knit|AlertDialog)\b/)
  })
})
