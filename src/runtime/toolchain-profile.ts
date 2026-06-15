import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type ToolchainProfileId =
  | 'node'
  | 'python'
  | 'rust'
  | 'go'
  | 'java-gradle'
  | 'java-maven'
  | 'swift'
  | 'native'
  | 'terraform'
  | 'docs'

export type ToolchainPackageManager =
  | 'pnpm'
  | 'yarn'
  | 'npm'
  | 'bun'
  | 'uv'
  | 'pip'
  | 'poetry'
  | 'cargo'
  | 'go'
  | 'gradle'
  | 'maven'
  | 'swift'
  | 'make'
  | 'cmake'
  | 'terraform'

export type ToolchainProofKind = 'command' | 'cli' | 'http' | 'browser' | 'review'

export interface ToolchainGateCommands {
  typecheck?: string[]
  build?: string[]
  test?: string[]
  lint?: string[]
  validate?: string[]
}

export interface ToolchainProfile {
  id: ToolchainProfileId
  confidence: 'low' | 'medium' | 'high'
  files: string[]
  sourceExtensions: string[]
  testExtensions: string[]
  packageManager?: ToolchainPackageManager
  installCommands: string[]
  gateCommands: ToolchainGateCommands
  proofKinds: ToolchainProofKind[]
}

export interface ProfileBootstrapHypothesis {
  packageManager?: ToolchainPackageManager
  commands: string[]
  successGates: string[]
  proofKinds: ToolchainProofKind[]
}

function has(root: string, relative: string): boolean {
  return existsSync(path.join(root, relative))
}

type NodePackageJson = {
  packageManager?: string
  scripts?: Record<string, string>
}

function readPackageJson(root: string): NodePackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as NodePackageJson
  } catch {
    return undefined
  }
}

function detectNodePackageManager(root: string, pkg: NodePackageJson | undefined): 'pnpm' | 'yarn' | 'npm' | 'bun' {
  const pmField = pkg?.packageManager?.split('@')[0]
  if (pmField === 'pnpm' || pmField === 'yarn' || pmField === 'npm' || pmField === 'bun') {
    return pmField
  }
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm'
  if (has(root, 'yarn.lock')) return 'yarn'
  if (has(root, 'bun.lockb')) return 'bun'
  return 'npm'
}

function walkNames(root: string, max = 500): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    if (out.length >= max) return
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean }>
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= max) return
      if (
        entry.name === '.git' ||
        entry.name === '.guildhall' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'target' ||
        entry.name === '.venv'
      ) {
        continue
      }
      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full).replace(/\\/g, '/')
      out.push(relative)
      if (entry.isDirectory()) visit(full)
    }
  }
  visit(root)
  return out
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function profileFiles(names: readonly string[], predicate: (name: string) => boolean): string[] {
  return names.filter(predicate).slice(0, 20)
}

function hasAny(names: readonly string[], predicate: (name: string) => boolean): boolean {
  return names.some(predicate)
}

function gradleCommand(root: string, command: 'build' | 'test'): string {
  return has(root, 'gradlew') ? `./gradlew ${command}` : `gradle ${command}`
}

export function detectToolchainProfiles(root: string): ToolchainProfile[] {
  const names = walkNames(root)
  const profiles: ToolchainProfile[] = []

  if (has(root, 'package.json')) {
    const pkg = readPackageJson(root)
    const scripts = pkg?.scripts ?? {}
    const packageManager = detectNodePackageManager(root, pkg)
    profiles.push({
      id: 'node',
      confidence: 'high',
      files: profileFiles(names, (name) =>
        name === 'package.json' ||
        name === 'tsconfig.json' ||
        /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(name),
      ),
      sourceExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'],
      testExtensions: ['.test.ts', '.spec.ts', '.test.js', '.spec.js'],
      packageManager,
      installCommands: [`${packageManager} install`],
      gateCommands: {
        typecheck: scripts.typecheck
          ? [`${packageManager} typecheck`]
          : has(root, 'tsconfig.json')
            ? [`${packageManager} exec tsc --noEmit`]
            : [],
        build: scripts.build ? [`${packageManager} build`] : [],
        test: scripts.test ? [`${packageManager} test`] : [],
        lint: scripts.lint ? [`${packageManager} lint`] : [],
      },
      proofKinds: ['command'],
    })
  }

  if (has(root, 'pyproject.toml') || has(root, 'requirements.txt') || has(root, 'uv.lock') || has(root, 'poetry.lock')) {
    const packageManager = has(root, 'uv.lock') ? 'uv' : has(root, 'poetry.lock') ? 'poetry' : 'pip'
    const runner = packageManager === 'uv' ? 'uv run ' : packageManager === 'poetry' ? 'poetry run ' : ''
    const install =
      packageManager === 'uv'
        ? 'uv sync'
        : packageManager === 'poetry'
          ? 'poetry install'
          : has(root, 'requirements.txt')
            ? 'pip install -r requirements.txt'
            : 'pip install -e .'
    profiles.push({
      id: 'python',
      confidence: 'high',
      files: profileFiles(names, (name) =>
        name.endsWith('.py') ||
        name === 'pyproject.toml' ||
        name === 'requirements.txt' ||
        name === 'uv.lock' ||
        name === 'poetry.lock',
      ),
      sourceExtensions: ['.py'],
      testExtensions: ['test_*.py', '*_test.py'],
      packageManager,
      installCommands: [install],
      gateCommands: {
        test: hasAny(names, (name) => name.endsWith('.py') && /(^|\/)(test_|.*_test\.py$|tests\/)/.test(name))
          ? [`${runner}pytest`.trim()]
          : [],
        lint: has(root, 'ruff.toml') ? [`${runner}ruff check .`.trim()] : [],
      },
      proofKinds: ['command', 'cli'],
    })
  }

  if (has(root, 'Cargo.toml')) {
    profiles.push({
      id: 'rust',
      confidence: 'high',
      files: profileFiles(names, (name) => name === 'Cargo.toml' || name.endsWith('.rs')),
      sourceExtensions: ['.rs'],
      testExtensions: ['.rs'],
      packageManager: 'cargo',
      installCommands: [],
      gateCommands: {
        build: ['cargo build'],
        test: ['cargo test'],
        lint: ['cargo clippy --all-targets --all-features'],
      },
      proofKinds: ['command', 'cli'],
    })
  }

  if (has(root, 'go.mod')) {
    profiles.push({
      id: 'go',
      confidence: 'high',
      files: profileFiles(names, (name) => name === 'go.mod' || name.endsWith('.go')),
      sourceExtensions: ['.go'],
      testExtensions: ['_test.go'],
      packageManager: 'go',
      installCommands: [],
      gateCommands: { test: ['go test ./...'] },
      proofKinds: ['command', 'http', 'cli'],
    })
  }

  if (has(root, 'build.gradle') || has(root, 'build.gradle.kts') || has(root, 'settings.gradle') || has(root, 'settings.gradle.kts')) {
    profiles.push({
      id: 'java-gradle',
      confidence: 'high',
      files: profileFiles(names, (name) => /gradle|\.java$|\.kt$/.test(name)),
      sourceExtensions: ['.java', '.kt'],
      testExtensions: ['Test.java', 'Test.kt'],
      packageManager: 'gradle',
      installCommands: [],
      gateCommands: {
        build: [gradleCommand(root, 'build')],
        test: [gradleCommand(root, 'test')],
      },
      proofKinds: ['command', 'http'],
    })
  }

  if (has(root, 'pom.xml')) {
    profiles.push({
      id: 'java-maven',
      confidence: 'high',
      files: profileFiles(names, (name) => name === 'pom.xml' || name.endsWith('.java') || name.endsWith('.kt')),
      sourceExtensions: ['.java', '.kt'],
      testExtensions: ['Test.java', 'Test.kt'],
      packageManager: 'maven',
      installCommands: [],
      gateCommands: { build: ['mvn package'], test: ['mvn test'] },
      proofKinds: ['command', 'http'],
    })
  }

  if (has(root, 'Package.swift') || hasAny(names, (name) => name.endsWith('.xcodeproj'))) {
    profiles.push({
      id: 'swift',
      confidence: 'high',
      files: profileFiles(names, (name) => name === 'Package.swift' || name.endsWith('.swift') || name.endsWith('.xcodeproj')),
      sourceExtensions: ['.swift'],
      testExtensions: ['Tests.swift'],
      packageManager: 'swift',
      installCommands: [],
      gateCommands: { build: ['swift build'], test: ['swift test'] },
      proofKinds: ['command'],
    })
  }

  if (has(root, 'CMakeLists.txt') || has(root, 'Makefile')) {
    const isCMake = has(root, 'CMakeLists.txt')
    profiles.push({
      id: 'native',
      confidence: 'medium',
      files: profileFiles(names, (name) => /CMakeLists\.txt|Makefile|\.(?:c|cc|cpp|h|hpp)$/.test(name)),
      sourceExtensions: ['.c', '.cc', '.cpp', '.h', '.hpp'],
      testExtensions: ['_test.cpp', '_test.cc'],
      packageManager: isCMake ? 'cmake' : 'make',
      installCommands: [],
      gateCommands: isCMake
        ? { build: ['cmake -S . -B build', 'cmake --build build'], test: ['ctest --test-dir build'] }
        : { build: ['make'], test: ['make test'] },
      proofKinds: ['command', 'cli'],
    })
  }

  if (hasAny(names, (name) => name.endsWith('.tf'))) {
    profiles.push({
      id: 'terraform',
      confidence: 'high',
      files: profileFiles(names, (name) => name.endsWith('.tf') || name.endsWith('.tftest.hcl')),
      sourceExtensions: ['.tf'],
      testExtensions: ['.tftest.hcl'],
      packageManager: 'terraform',
      installCommands: [],
      gateCommands: { lint: ['terraform fmt -check'], validate: ['terraform validate'] },
      proofKinds: ['command', 'review'],
    })
  }

  if (profiles.length === 0 && hasAny(names, (name) => /\.(?:md|mdx|rst)$/.test(name))) {
    profiles.push({
      id: 'docs',
      confidence: 'medium',
      files: profileFiles(names, (name) => /\.(?:md|mdx|rst)$/.test(name)),
      sourceExtensions: ['.md', '.mdx', '.rst'],
      testExtensions: [],
      installCommands: [],
      gateCommands: {},
      proofKinds: ['review'],
    })
  }

  return profiles
}

export function profileGateCommands(profile: ToolchainProfile): string[] {
  return [
    ...(profile.gateCommands.typecheck ?? []),
    ...(profile.gateCommands.build ?? []),
    ...(profile.gateCommands.test ?? []),
    ...(profile.gateCommands.lint ?? []),
    ...(profile.gateCommands.validate ?? []),
  ]
}

export function deriveBootstrapHypothesisFromProfiles(
  profiles: readonly ToolchainProfile[],
): ProfileBootstrapHypothesis {
  return {
    packageManager: profiles.find((profile) => profile.packageManager)?.packageManager,
    commands: unique(profiles.flatMap((profile) => profile.installCommands)),
    successGates: unique(profiles.flatMap(profileGateCommands)),
    proofKinds: unique(profiles.flatMap((profile) => profile.proofKinds)),
  }
}
