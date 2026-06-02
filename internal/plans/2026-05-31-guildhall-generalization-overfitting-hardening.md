# Guildhall Generalization Overfitting Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Guildhall preserve its general-purpose software-development shape across web, backend, CLI, library, mobile, infrastructure, documentation, and multi-package projects instead of quietly overfitting to Node/web/Looma/Knit failures.

**Architecture:** Move technology-specific inference behind explicit profiles and adapters. Generic runtime paths should consume semantic structures (`ToolchainProfile`, `SourceProfile`, `StructuredRuntimeEvent`, `WorkGraphDomainAdapter`) rather than matching project names, exact incident strings, or JavaScript-only file shapes.

**Tech Stack:** TypeScript, Vitest, existing Guildhall runtime/config/core modules, internal benchmark fixtures, no new runtime dependency unless a task explicitly proves it is needed.

---

## File Structure

- Create `src/runtime/toolchain-profile.ts`
  - Owns static detection for project toolchains, command families, file extensions, test/build/lint/typecheck gates, install commands, and gate-output parsing hooks.
- Create `src/runtime/__tests__/toolchain-profile.test.ts`
  - Red-to-green coverage for Node, Python, Rust, Go, Java/Gradle, Swift/Xcode, Make/CMake, docs-only, and mixed workspaces.
- Modify `src/runtime/detect-bootstrap.ts`
  - Replace bespoke Node/Python-only detection with `detectToolchainProfiles`.
- Modify `src/runtime/bootstrap.ts`
  - Keep existing bootstrap shape, but derive install/gate candidates from profiles.
- Modify `src/runtime/task-gates.ts`
  - Replace pnpm-only normalization with command-family-aware normalization.
- Modify `src/runtime/gate-scope-exceptions.ts`
  - Parse scoped failures through profile output parsers instead of TS/Vitest/ESLint-only regexes.
- Modify `src/runtime/context-builder.ts`
  - Replace JS-only likely-file extraction and local-web starter inference with profile-aware source/file inference.
- Modify `src/engine/run-query.ts`
  - Replace JS import-only missing-local-import evidence with source-profile dependency checks.
- Create `src/runtime/runtime-event-reasons.ts`
  - Defines structured reason codes for timeout, read-budget pause, no-progress pause, provider issue, tool-malformed, and stale-run recovery.
- Modify `src/web/surfaces/drawer/CurrentTab.svelte`
  - Use structured event reason codes before falling back to text.
- Modify `src/runtime/thread.ts`
  - Label runtime activity from reason codes, with text matching only as compatibility fallback.
- Create `src/runtime/work-graph-domain-adapters.ts`
  - Contains generic domain adapters and project-configurable specialization for evidence-to-work graph intake.
- Modify `src/runtime/evidence-work-graph-intake.ts`
  - Remove Looma/Knit/AlertDialog special cases from generic flow; call adapters instead.
- Modify `src/runtime/design-feedback.ts`
  - Generalize Looma development hook into a configured design-system development hook.
- Modify `src/runtime/design-preview.ts`
  - Treat Storybook as one preview adapter, not the generic design-proof path.
- Modify `src/runtime/design-system-discovery.ts`
  - Keep web design-system detection, but label it as web-specific and allow non-web design/proof profiles.
- Modify `src/core/task-sizing.ts`
  - Replace SaaS-specific decomposition suggestions with calibrated examples selected by domain profile.
- Modify `src/tools/task-queue.ts`
  - Replace Looma/Knit imported-area labeling with workspace/project area metadata.
- Create `internal/fixtures/generalization-smoke/*`
  - Fixture projects for Python CLI, Rust library, Go HTTP service, Java Gradle service, Swift package/iOS-shaped repo, CMake/Make native CLI, Terraform module, docs-only package, and web app.
- Create `src/runtime/__tests__/generalization-smoke.test.ts`
  - Cross-fixture assertions for bootstrap, file inference, proof path, review lanes, and absence of leaked web/Node/Looma/Knit vocabulary.
- Modify `src/benchmarks/fixtures.ts`
  - Add a generalization benchmark family that runs the fixture matrix.
- Modify `internal/audits/flow-audit.md`
  - Track the generalization hardening checklist and verification evidence.

---

## Non-Negotiable Red-to-Green Matrix

Each row must fail before the matching task lands and pass after it lands.

| Shape | Fixture path | Expected gates/proof | Must not leak |
| --- | --- | --- | --- |
| Node web app | `internal/fixtures/generalization-smoke/node-web` | `pnpm install`, `pnpm test`, optional browser proof only when UI task asks for it | `Looma`, `Knit`, `AlertDialog` |
| Python CLI | `internal/fixtures/generalization-smoke/python-cli` | `uv sync` or `pip install -r requirements.txt`, `pytest`, CLI output proof | browser proof, package.json, pnpm |
| Rust library | `internal/fixtures/generalization-smoke/rust-lib` | `cargo test`, `cargo clippy` when configured | browser proof, tsconfig, vitest |
| Go service | `internal/fixtures/generalization-smoke/go-service` | `go test ./...`, optional HTTP smoke proof | pnpm, package.json, Vue/Svelte |
| Java Gradle service | `internal/fixtures/generalization-smoke/java-gradle-service` | `./gradlew test` or `gradle test` | npm, tsconfig, browser proof |
| Swift package | `internal/fixtures/generalization-smoke/swift-package` | `swift test`, optional `xcodebuild test` when Xcode project exists | Node/web-only labels |
| CMake/Make native CLI | `internal/fixtures/generalization-smoke/native-cli` | `cmake -S . -B build`, `cmake --build build`, `ctest --test-dir build` or `make test` | package manager assumptions |
| Terraform module | `internal/fixtures/generalization-smoke/terraform-module` | `terraform fmt -check`, `terraform validate` | build/test/typecheck as mandatory code gates |
| Docs-only package | `internal/fixtures/generalization-smoke/docs-only` | docs lint/build or deterministic content review proof | implementation-worker mutation pressure |

---

## Task 1: Introduce Toolchain Profiles

**Files:**
- Create: `src/runtime/toolchain-profile.ts`
- Create: `src/runtime/__tests__/toolchain-profile.test.ts`
- Modify: `src/runtime/detect-bootstrap.ts`

- [ ] **Step 1: Write failing profile tests**

Add `src/runtime/__tests__/toolchain-profile.test.ts` with tests that create tiny project roots and assert detected profiles:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectToolchainProfiles, deriveBootstrapHypothesisFromProfiles } from '../toolchain-profile.js'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'guildhall-toolchain-'))
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe('toolchain profiles', () => {
  it('detects Python CLI projects without Node leakage', () => {
    const root = project({
      'pyproject.toml': '[project]\nname = "demo-cli"\n',
      'uv.lock': '',
      'tests/test_cli.py': 'def test_cli(): assert True\n',
    })
    const profiles = detectToolchainProfiles(root)
    expect(profiles.map(p => p.id)).toContain('python')
    const hypothesis = deriveBootstrapHypothesisFromProfiles(profiles)
    expect(hypothesis.commands).toContain('uv sync')
    expect(hypothesis.successGates).toContain('uv run pytest')
    expect(JSON.stringify(hypothesis)).not.toMatch(/pnpm|package\.json|browser proof/i)
  })

  it('detects Rust libraries with cargo gates', () => {
    const root = project({
      'Cargo.toml': '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub fn add(a:i32,b:i32)->i32{a+b}\n',
    })
    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.commands).toEqual([])
    expect(hypothesis.successGates).toEqual(expect.arrayContaining(['cargo test']))
    expect(JSON.stringify(hypothesis)).not.toMatch(/pnpm|vitest|tsconfig/i)
  })

  it('detects Go services with go test gates', () => {
    const root = project({
      'go.mod': 'module example.com/demo\n\ngo 1.22\n',
      'server_test.go': 'package main\n',
    })
    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.successGates).toContain('go test ./...')
  })

  it('detects Java Gradle services', () => {
    const root = project({
      'build.gradle.kts': 'plugins { java }\n',
      'src/test/java/AppTest.java': 'class AppTest {}\n',
    })
    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.successGates).toContain('./gradlew test')
  })

  it('detects docs-only projects without inventing code gates', () => {
    const root = project({
      'README.md': '# Manual\n',
      'docs/install.md': 'Install the CLI.\n',
    })
    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.successGates).toEqual([])
    expect(hypothesis.proofKinds).toContain('review')
  })
})
```

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/toolchain-profile.test.ts --reporter=dot`

Expected: FAIL because `../toolchain-profile.js` does not exist.

- [ ] **Step 3: Implement profile detection**

Create `src/runtime/toolchain-profile.ts` with:

```ts
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

export interface ToolchainProfile {
  id: ToolchainProfileId
  confidence: 'low' | 'medium' | 'high'
  files: string[]
  sourceExtensions: string[]
  testExtensions: string[]
  installCommands: string[]
  gateCommands: {
    typecheck?: string[]
    build?: string[]
    test?: string[]
    lint?: string[]
    validate?: string[]
  }
  proofKinds: Array<'command' | 'cli' | 'http' | 'browser' | 'review'>
}

export interface ProfileBootstrapHypothesis {
  packageManager?: string
  commands: string[]
  successGates: string[]
  proofKinds: Array<'command' | 'cli' | 'http' | 'browser' | 'review'>
}

function has(root: string, relative: string): boolean {
  return existsSync(path.join(root, relative))
}

function packageScripts(root: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string>, packageManager?: string }
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

function walkNames(root: string, max = 500): string[] {
  const out: string[] = []
  const visit = (dir: string) => {
    if (out.length >= max) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', '.guildhall', 'node_modules', 'dist', 'build', 'target', '.venv'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full).replace(/\\/g, '/')
      out.push(relative)
      if (entry.isDirectory()) visit(full)
    }
  }
  try { visit(root) } catch {}
  return out
}

export function detectToolchainProfiles(root: string): ToolchainProfile[] {
  const names = walkNames(root)
  const profiles: ToolchainProfile[] = []
  const add = (profile: ToolchainProfile) => profiles.push(profile)

  if (has(root, 'package.json')) {
    const scripts = packageScripts(root)
    const pm = has(root, 'pnpm-lock.yaml') ? 'pnpm' : has(root, 'yarn.lock') ? 'yarn' : has(root, 'bun.lockb') ? 'bun' : 'npm'
    add({
      id: 'node',
      confidence: 'high',
      files: ['package.json'],
      sourceExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'],
      testExtensions: ['.test.ts', '.spec.ts', '.test.js', '.spec.js'],
      installCommands: [`${pm} install`],
      gateCommands: {
        typecheck: scripts.typecheck ? [`${pm} typecheck`] : has(root, 'tsconfig.json') ? [`${pm} exec tsc --noEmit`] : [],
        build: scripts.build ? [`${pm} build`] : [],
        test: scripts.test ? [`${pm} test`] : [],
        lint: scripts.lint ? [`${pm} lint`] : [],
      },
      proofKinds: ['command'],
    })
  }

  if (has(root, 'pyproject.toml') || has(root, 'requirements.txt') || has(root, 'uv.lock') || has(root, 'poetry.lock')) {
    const install = has(root, 'uv.lock') ? 'uv sync' : has(root, 'poetry.lock') ? 'poetry install' : 'pip install -r requirements.txt'
    const runner = has(root, 'uv.lock') ? 'uv run ' : has(root, 'poetry.lock') ? 'poetry run ' : ''
    add({
      id: 'python',
      confidence: 'high',
      files: names.filter(n => n.endsWith('.py') || ['pyproject.toml', 'requirements.txt', 'uv.lock', 'poetry.lock'].includes(n)).slice(0, 20),
      sourceExtensions: ['.py'],
      testExtensions: ['test_*.py', '*_test.py'],
      installCommands: [install],
      gateCommands: {
        test: names.some(n => n.includes('test') && n.endsWith('.py')) ? [`${runner}pytest`.trim()] : [],
        lint: has(root, 'ruff.toml') || has(root, 'pyproject.toml') ? [`${runner}ruff check .`.trim()] : [],
      },
      proofKinds: ['command', 'cli'],
    })
  }

  if (has(root, 'Cargo.toml')) add({
    id: 'rust',
    confidence: 'high',
    files: ['Cargo.toml'],
    sourceExtensions: ['.rs'],
    testExtensions: ['.rs'],
    installCommands: [],
    gateCommands: { build: ['cargo build'], test: ['cargo test'], lint: ['cargo clippy --all-targets --all-features'] },
    proofKinds: ['command', 'cli'],
  })

  if (has(root, 'go.mod')) add({
    id: 'go',
    confidence: 'high',
    files: ['go.mod'],
    sourceExtensions: ['.go'],
    testExtensions: ['_test.go'],
    installCommands: [],
    gateCommands: { test: ['go test ./...'], lint: [] },
    proofKinds: ['command', 'http', 'cli'],
  })

  if (has(root, 'build.gradle') || has(root, 'build.gradle.kts')) add({
    id: 'java-gradle',
    confidence: 'high',
    files: names.filter(n => /gradle|\.java$|\.kt$/.test(n)).slice(0, 20),
    sourceExtensions: ['.java', '.kt'],
    testExtensions: ['Test.java', 'Test.kt'],
    installCommands: [],
    gateCommands: { build: ['./gradlew build'], test: ['./gradlew test'] },
    proofKinds: ['command', 'http'],
  })

  if (has(root, 'pom.xml')) add({
    id: 'java-maven',
    confidence: 'high',
    files: ['pom.xml'],
    sourceExtensions: ['.java', '.kt'],
    testExtensions: ['Test.java', 'Test.kt'],
    installCommands: [],
    gateCommands: { build: ['mvn package'], test: ['mvn test'] },
    proofKinds: ['command', 'http'],
  })

  if (has(root, 'Package.swift') || names.some(n => n.endsWith('.xcodeproj'))) add({
    id: 'swift',
    confidence: 'high',
    files: names.filter(n => n.endsWith('.swift') || n.endsWith('.xcodeproj') || n === 'Package.swift').slice(0, 20),
    sourceExtensions: ['.swift'],
    testExtensions: ['Tests.swift'],
    installCommands: [],
    gateCommands: { build: ['swift build'], test: ['swift test'] },
    proofKinds: ['command'],
  })

  if (has(root, 'CMakeLists.txt') || has(root, 'Makefile')) add({
    id: 'native',
    confidence: 'medium',
    files: names.filter(n => /CMakeLists\.txt|Makefile|\.(c|cc|cpp|h|hpp)$/.test(n)).slice(0, 20),
    sourceExtensions: ['.c', '.cc', '.cpp', '.h', '.hpp'],
    testExtensions: ['_test.cpp', '_test.cc'],
    installCommands: [],
    gateCommands: has(root, 'CMakeLists.txt')
      ? { build: ['cmake -S . -B build', 'cmake --build build'], test: ['ctest --test-dir build'] }
      : { build: ['make'], test: ['make test'] },
    proofKinds: ['command', 'cli'],
  })

  if (names.some(n => n.endsWith('.tf'))) add({
    id: 'terraform',
    confidence: 'high',
    files: names.filter(n => n.endsWith('.tf')).slice(0, 20),
    sourceExtensions: ['.tf'],
    testExtensions: ['.tftest.hcl'],
    installCommands: [],
    gateCommands: { lint: ['terraform fmt -check'], validate: ['terraform validate'] },
    proofKinds: ['command', 'review'],
  })

  if (profiles.length === 0 && names.some(n => n.endsWith('.md') || n.endsWith('.mdx') || n.endsWith('.rst'))) {
    add({
      id: 'docs',
      confidence: 'medium',
      files: names.filter(n => n.endsWith('.md') || n.endsWith('.mdx') || n.endsWith('.rst')).slice(0, 20),
      sourceExtensions: ['.md', '.mdx', '.rst'],
      testExtensions: [],
      installCommands: [],
      gateCommands: {},
      proofKinds: ['review'],
    })
  }

  return profiles
}

export function deriveBootstrapHypothesisFromProfiles(profiles: readonly ToolchainProfile[]): ProfileBootstrapHypothesis {
  return {
    packageManager: profiles.find(p => p.installCommands.length > 0)?.id,
    commands: [...new Set(profiles.flatMap(p => p.installCommands))],
    successGates: [...new Set(profiles.flatMap(p => Object.values(p.gateCommands).flatMap(v => v ?? [])))],
    proofKinds: [...new Set(profiles.flatMap(p => p.proofKinds))],
  }
}
```

- [ ] **Step 4: Wire `detect-bootstrap.ts` to profiles**

Keep the exported `BootstrapHypothesis` shape stable. `detectBootstrapHypothesis(projectPath)` should call `detectToolchainProfiles(projectPath)` and map `deriveBootstrapHypothesisFromProfiles` into the old return type. Preserve `packageManager` as the first profile/package manager string where possible.

- [ ] **Step 5: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/toolchain-profile.test.ts src/runtime/__tests__/bootstrap.test.ts --reporter=dot`

Expected: PASS.

---

## Task 2: Make Gate Command Normalization Command-Family Aware

**Files:**
- Modify: `src/runtime/task-gates.ts`
- Test: `src/runtime/__tests__/task-gates.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests to `src/runtime/__tests__/task-gates.test.ts`:

```ts
it('keeps explicit Python pytest commands instead of rewriting through pnpm', async () => {
  const root = await makeProject({
    'pyproject.toml': '[project]\nname = "demo"\n',
    'tests/test_cli.py': 'def test_cli(): assert True\n',
  })
  const normalized = normalizeAutomatedAcceptanceCriterionCommands({
    workspaceProjectPath: root,
    task: taskWithCriteria(root, [
      { description: 'pytest passes for CLI behavior', verifiedBy: 'automated', command: 'pytest tests/test_cli.py' },
    ]),
  })
  expect(normalized[0]?.command).toBe('pytest tests/test_cli.py')
  expect(JSON.stringify(normalized)).not.toMatch(/pnpm/)
})

it('keeps cargo test commands for Rust libraries', async () => {
  const root = await makeProject({
    'Cargo.toml': '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/lib.rs': 'pub fn add(a:i32,b:i32)->i32{a+b}\n',
  })
  const normalized = normalizeAutomatedAcceptanceCriterionCommands({
    workspaceProjectPath: root,
    task: taskWithCriteria(root, [
      { description: 'cargo test passes', verifiedBy: 'automated', command: 'cargo test' },
    ]),
  })
  expect(normalized[0]?.command).toBe('cargo test')
})
```

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/task-gates.test.ts --reporter=dot`

Expected: FAIL because non-pnpm explicit commands are currently dropped or normalized through `validateOrNormalizePnpmCommand`.

- [ ] **Step 3: Implement command family normalization**

In `src/runtime/task-gates.ts`:

- Rename `validateOrNormalizePnpmCommand` to `validateOrNormalizeCommand`.
- Keep existing pnpm behavior in `validateOrNormalizePnpmCommandInternal`.
- Add pass-through validation for command families detected by `detectToolchainProfiles`: `pytest`, `uv run pytest`, `poetry run pytest`, `cargo`, `go`, `gradle`, `./gradlew`, `mvn`, `swift`, `xcodebuild`, `cmake`, `ctest`, `make`, `terraform`.
- Use profile gates as fallback by command kind before inventing `pnpm typecheck/build/test/lint`.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/task-gates.test.ts src/runtime/__tests__/toolchain-profile.test.ts --reporter=dot`

Expected: PASS.

---

## Task 3: Generalize Source/File Inference and Gate Error Parsing

**Files:**
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/gate-scope-exceptions.ts`
- Modify: `src/engine/run-query.ts`
- Test: `src/runtime/__tests__/context-builder.test.ts`
- Test: `src/runtime/__tests__/gate-scope-exceptions.test.ts`
- Test: `src/engine/__tests__/run-query.test.ts`

- [ ] **Step 1: Add failing likely-file tests**

Add context-builder tests proving non-web files are inferred:

```ts
it('extracts Python target files from specs and commands', async () => {
  const ctx = await buildContextForTask({
    title: 'Fix CLI parsing',
    spec: 'Update `src/demo_cli/parser.py` and verify `tests/test_parser.py`.',
    acceptanceCriteria: [{ description: 'pytest passes', verifiedBy: 'automated', command: 'pytest tests/test_parser.py' }],
  })
  expect(ctx.taskSummary).toContain('src/demo_cli/parser.py')
  expect(ctx.taskSummary).toContain('tests/test_parser.py')
  expect(ctx.taskSummary).not.toMatch(/index\.html|src\/main\.js/)
})

it('extracts Rust and Go target files from specs', async () => {
  const rust = await buildContextForTask({ title: 'Fix parser', spec: 'Update `src/parser.rs` and `tests/parser_test.rs`.' })
  expect(rust.taskSummary).toContain('src/parser.rs')
  const go = await buildContextForTask({ title: 'Fix handler', spec: 'Update `internal/server/handler.go` and `server_test.go`.' })
  expect(go.taskSummary).toContain('internal/server/handler.go')
})
```

- [ ] **Step 2: Add failing gate-output parser tests**

Add gate-scope tests:

```ts
it('extracts Python pytest failure files', () => {
  expect(filesFromGateOutput({
    gateId: 'pytest',
    output: 'FAILED tests/test_cli.py::test_main - AssertionError\nsrc/demo_cli/main.py:42: AssertionError',
  })).toEqual(expect.arrayContaining(['tests/test_cli.py', 'src/demo_cli/main.py']))
})

it('extracts Rust compiler and test failure files', () => {
  expect(filesFromGateOutput({
    gateId: 'cargo test',
    output: 'error[E0425]: cannot find value `x` in this scope\n --> src/lib.rs:7:9\nfailures:\n    tests::adds_numbers',
  })).toContain('src/lib.rs')
})

it('extracts Go failure files', () => {
  expect(filesFromGateOutput({
    gateId: 'go test ./...',
    output: './server_test.go:18: expected 200 got 500',
  })).toContain('server_test.go')
})
```

- [ ] **Step 3: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/context-builder.test.ts src/runtime/__tests__/gate-scope-exceptions.test.ts --reporter=dot`

Expected: FAIL on missing non-JS inference.

- [ ] **Step 4: Implement profile-aware file matching**

Use `detectToolchainProfiles` to build:

- allowed source extensions
- test-file suffixes
- command-shaped token filtering per command family
- starter-file inference only for web profiles and only when the task asks for a local web/browser app

Extend `filesFromGateOutput` with parsers for:

- Python: `path.py:line`, `FAILED path.py::test`
- Rust: `--> path.rs:line:col`
- Go: `path.go:line`
- Java/Kotlin: `path.java:line`, `path.kt:line`
- Swift: `path.swift:line:col`
- Terraform: `on path.tf line N`
- Native: compiler paths ending in `.c`, `.cc`, `.cpp`, `.h`, `.hpp`

- [ ] **Step 5: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/context-builder.test.ts src/runtime/__tests__/gate-scope-exceptions.test.ts src/engine/__tests__/run-query.test.ts --reporter=dot`

Expected: PASS.

---

## Task 4: Replace Exact Incident Strings with Structured Runtime Reasons

**Files:**
- Create: `src/runtime/runtime-event-reasons.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/web/surfaces/drawer/CurrentTab.svelte`
- Test: `src/runtime/__tests__/thread.test.ts`
- Test: `src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts`

- [ ] **Step 1: Add failing structured-reason tests**

Add a thread test:

```ts
it('labels shaping timeout from structured reason without matching exact text', () => {
  const event = activityEvent({
    type: 'agent_issue',
    reason: 'agent_timeout',
    message: 'worker stopped after idle budget',
    agentId: 'spec-agent',
  })
  expect(friendlyActivityLabel(event)).toBe('Shaping timed out.')
})
```

Add a drawer test with activity detail text that does not contain `spec-agent timed out` but does include `reason: 'agent_timeout'`. Assert the drawer shows the retry state.

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/thread.test.ts src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts --reporter=dot`

Expected: FAIL because UI currently matches exact text.

- [ ] **Step 3: Implement reason codes**

Create `src/runtime/runtime-event-reasons.ts`:

```ts
export const RuntimeEventReason = {
  AgentTimeout: 'agent_timeout',
  ReadBudgetExhausted: 'read_budget_exhausted',
  DurableProgressPause: 'durable_progress_pause',
  MalformedToolCall: 'malformed_tool_call',
  ProviderCapacity: 'provider_capacity',
  StaleRunState: 'stale_run_state',
  NoProgress: 'no_progress',
} as const

export type RuntimeEventReason = typeof RuntimeEventReason[keyof typeof RuntimeEventReason]

export function runtimeReason(value: unknown): RuntimeEventReason | null {
  return Object.values(RuntimeEventReason).includes(value as RuntimeEventReason)
    ? value as RuntimeEventReason
    : null
}
```

Thread and drawer code should prefer `runtimeReason(item.reason)` and keep existing string matching only for old persisted activity.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/thread.test.ts src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts --reporter=dot`

Expected: PASS.

---

## Task 5: Remove Project-Specific Work-Graph Special Cases

**Files:**
- Create: `src/runtime/work-graph-domain-adapters.ts`
- Modify: `src/runtime/evidence-work-graph-intake.ts`
- Test: `src/runtime/__tests__/evidence-work-graph-intake.test.ts`

- [ ] **Step 1: Add failing non-Looma work-graph tests**

Add tests:

```ts
it('builds work graphs for backend retention evidence without UI component assumptions', () => {
  const plan = intakeEvidenceWorkGraph({
    sources: [{
      path: 'docs/retention-audit.md',
      content: [
        '| Deliverable | Status | Builds on | Consumer |',
        '| Retention policy schema | missing | database migrations | admin API |',
        '| Retention worker | missing | Retention policy schema | scheduled cleanup job |',
        '| Audit export API | missing | Retention policy schema | compliance dashboard |',
      ].join('\n'),
    }],
    existingTasks: [],
  })
  expect(plan.tasks.map(t => t.deliverableName)).toEqual([
    'Retention policy schema',
    'Retention worker',
    'Audit export API',
  ])
  expect(JSON.stringify(plan)).not.toMatch(/Knit|Looma|AlertDialog|ui-/)
})

it('uses project evidence names without hardcoded AlertDialog normalization', () => {
  const plan = intakeEvidenceWorkGraph({
    sources: [{ path: 'docs/cli-audit.md', content: '| Deliverable | Status |\n| ConfigDoctor | missing |' }],
    existingTasks: [],
  })
  expect(plan.tasks[0]?.deliverableName).toBe('ConfigDoctor')
  expect(plan.tasks[0]?.title).toContain('ConfigDoctor')
})
```

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/evidence-work-graph-intake.test.ts --reporter=dot`

Expected: FAIL because generic intake still contains Looma/Knit-specific paths.

- [ ] **Step 3: Implement adapters**

Create adapters with this shape:

```ts
export interface WorkGraphDomainAdapter {
  id: string
  matches(input: { sourcePath: string; content: string; projectConfig?: unknown }): boolean
  normalizeDeliverableName?(name: string): string
  implementationCommand?(unit: { targetArea: string; name: string }): string | null
  integrationLabel?(consumer: string): string
  targetAreaForConsumer?(consumer: string): string | null
}
```

Default adapter:

- preserves deliverable names
- derives produced artifact only from source evidence or slug
- uses profile-derived commands when possible
- never emits `Knit`, `Looma`, `AlertDialog`, or `ui-*` unless source evidence contains those exact terms

Project adapters:

- loaded from project config or fixture input
- can express Looma/Knit behavior without contaminating generic code

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/evidence-work-graph-intake.test.ts --reporter=dot`

Expected: PASS.

---

## Task 6: Remove Local Design-System Development Hooks; Keep Design Feedback General

**Files:**
- Modify: `src/runtime/design-feedback.ts`
- Modify: `src/runtime/design-preview.ts`
- Modify: `src/runtime/design-system-discovery.ts`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Test: `src/runtime/__tests__/serve-design-feedback.test.ts`
- Test: `src/runtime/__tests__/design-preview.test.ts`
- Test: `src/runtime/__tests__/serve-design-system-discovery.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests asserting:

- design-feedback API responses do not expose machine-local design-system
  development target status
- reusable design findings still become portable `DesignSystemCandidate` and
  `DesignSystemImprovement` records without requiring a checkout path
- legacy global config under `experimental.designSystemDevelopment` is not
  preserved as parsed product state
- Storybook discovery returns adapter id `storybook` under `previewAdapters`, not as the generic design proof
- a Swift/Xcode fixture with no Storybook returns no web preview and suggests command/review proof instead

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/serve-design-feedback.test.ts src/runtime/__tests__/design-preview.test.ts src/runtime/__tests__/serve-design-system-discovery.test.ts --reporter=dot`

Expected: FAIL because Looma is still first-class in generic surfaces.

- [ ] **Step 3: Delete local development-target plumbing**

Remove `discoverDesignSystemDevelopmentTargets`,
`DesignSystemDevelopmentTargetStatus`, the
`experimental.designSystemDevelopment` global config schema, and the
`designSystemDevelopmentTargets` API payload. Do not replace this with a more
generic local checkout hook. Design feedback's durable output is the portable
finding/candidate/improvement store; when another project owns the reusable
capability, Guildhall should route follow-up through project graph/domain
authority and the provider coordinator exchange.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/serve-design-feedback.test.ts src/runtime/__tests__/design-preview.test.ts src/runtime/__tests__/serve-design-system-discovery.test.ts --reporter=dot`

Expected: PASS.

---

## Task 7: Replace SaaS-Specific Task Sizing Suggestions with Domain Fixtures

**Files:**
- Modify: `src/core/task-sizing.ts`
- Modify: `src/tools/task-queue.ts`
- Test: `src/core/__tests__/task-sizing.test.ts`
- Test: `src/tools/__tests__/task-queue.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests:

```ts
it('does not recommend billing/invite child tasks for unrelated broad work', () => {
  const plan = buildTaskSizePlan({
    task: {
      title: 'Build cross-platform config validation',
      description: 'Add CLI validation, parser library updates, docs, and release notes.',
      acceptanceCriteria: [],
    },
    changedFiles: ['src/cli/config.rs', 'docs/config.md'],
  })
  expect(JSON.stringify(plan.recommendations)).not.toMatch(/billing|subscription|invite|workspace/i)
})

it('labels imported areas from workspace metadata rather than Looma/Knit path names', () => {
  const label = importedAreaLabel(taskWithImporterNote('Imported from: packages/sdk/README.md'))
  expect(label).toBeNull()
})
```

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/core/__tests__/task-sizing.test.ts src/tools/__tests__/task-queue.test.ts --reporter=dot`

Expected: FAIL where generic broad work receives SaaS-flavored child recommendations or path labels.

- [ ] **Step 3: Implement semantic recommendation catalog**

Replace hardcoded billing/invite recommendations with a small catalog keyed by detected lanes:

- API contract: "Define and prove the public API contract"
- Data migration: "Migrate and verify persisted data safely"
- Worker/job: "Implement background processing and retry behavior"
- CLI: "Implement command behavior and terminal proof"
- Docs: "Update reader-facing docs and examples"
- Release: "Record rollout and compatibility evidence"
- UI: "Implement user-facing workflow and interaction proof"

Only use domain nouns from task text when constructing titles.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run src/core/__tests__/task-sizing.test.ts src/tools/__tests__/task-queue.test.ts --reporter=dot`

Expected: PASS.

---

## Task 8: Build the Generalization Smoke Fixture Matrix

**Files:**
- Create fixture directories under `internal/fixtures/generalization-smoke/`
- Create: `src/runtime/__tests__/generalization-smoke.test.ts`
- Modify: `src/benchmarks/fixtures.ts`

- [ ] **Step 1: Add fixture files**

Create minimal fixtures:

- `python-cli/pyproject.toml`, `python-cli/src/demo_cli/main.py`, `python-cli/tests/test_main.py`
- `rust-lib/Cargo.toml`, `rust-lib/src/lib.rs`
- `go-service/go.mod`, `go-service/main.go`, `go-service/main_test.go`
- `java-gradle-service/build.gradle.kts`, `java-gradle-service/src/test/java/AppTest.java`
- `swift-package/Package.swift`, `swift-package/Sources/Demo/Demo.swift`, `swift-package/Tests/DemoTests/DemoTests.swift`
- `native-cli/CMakeLists.txt`, `native-cli/src/main.c`, `native-cli/tests/smoke.sh`
- `terraform-module/main.tf`, `terraform-module/variables.tf`
- `docs-only/README.md`, `docs-only/docs/install.md`
- `node-web/package.json`, `node-web/src/main.ts`, `node-web/index.html`

- [ ] **Step 2: Add failing matrix test**

Create `src/runtime/__tests__/generalization-smoke.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectToolchainProfiles, deriveBootstrapHypothesisFromProfiles } from '../toolchain-profile.js'

const root = path.resolve('internal/fixtures/generalization-smoke')
const cases = [
  ['python-cli', /pytest/, /pnpm|browser proof|package\.json/i],
  ['rust-lib', /cargo test/, /pnpm|vitest|browser proof/i],
  ['go-service', /go test \.\/\.\.\./, /pnpm|Vue|Svelte/i],
  ['java-gradle-service', /gradlew test/, /npm|tsconfig/i],
  ['swift-package', /swift test/, /Node|browser proof/i],
  ['native-cli', /cmake|make test/, /package\.json|pnpm/i],
  ['terraform-module', /terraform validate/, /typecheck|browser proof/i],
  ['docs-only', /review/, /worker must mutate|pnpm|browser proof/i],
] as const

describe('generalization smoke fixtures', () => {
  it.each(cases)('%s has shape-appropriate gates without leaked vocabulary', (fixture, expected, forbidden) => {
    const profiles = detectToolchainProfiles(path.join(root, fixture))
    const hypothesis = deriveBootstrapHypothesisFromProfiles(profiles)
    const text = JSON.stringify(hypothesis)
    expect(text).toMatch(expected)
    expect(text).not.toMatch(forbidden)
  })
})
```

- [ ] **Step 3: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/generalization-smoke.test.ts --reporter=dot`

Expected: FAIL until fixtures and profile support are complete.

- [ ] **Step 4: Wire benchmark family**

Add a `generalization` fixture family in `src/benchmarks/fixtures.ts` that enumerates the same cases and records expected gate/proof kinds.

- [ ] **Step 5: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/generalization-smoke.test.ts src/benchmarks/__tests__/benchmarks.test.ts --reporter=dot`

Expected: PASS.

---

## Task 9: Add Negative Vocabulary Guardrails for Generic Runtime Code

**Files:**
- Create: `src/runtime/__tests__/generic-vocabulary.test.ts`

- [ ] **Step 1: Add failing guardrail test**

Create `src/runtime/__tests__/generic-vocabulary.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const genericFiles = [
  'src/runtime/evidence-work-graph-intake.ts',
  'src/runtime/task-gates.ts',
  'src/runtime/context-builder.ts',
  'src/runtime/detect-bootstrap.ts',
  'src/runtime/bootstrap.ts',
  'src/core/task-sizing.ts',
  'src/tools/task-queue.ts',
]

describe('generic runtime vocabulary', () => {
  it.each(genericFiles)('%s does not embed project-specific product names', (relative) => {
    const text = readFileSync(path.resolve(relative), 'utf8')
    expect(text).not.toMatch(/\b(Looma|Knit|AlertDialog|Pantry Pulse)\b/)
  })

  it.each(genericFiles)('%s does not force pnpm as the only command family', (relative) => {
    const text = readFileSync(path.resolve(relative), 'utf8')
    const pnpmMentions = [...text.matchAll(/\bpnpm\b/g)].length
    expect(pnpmMentions).toBeLessThanOrEqual(relative.endsWith('task-gates.ts') ? 8 : 3)
  })
})
```

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm vitest run src/runtime/__tests__/generic-vocabulary.test.ts --reporter=dot`

Expected: FAIL until project-specific names are moved into fixtures/config/adapters.

- [ ] **Step 3: Move allowed examples**

Move product-specific examples into:

- tests
- `internal/fixtures`
- project config fixtures
- explicit adapter fixtures

Generic runtime code can mention `pnpm` only inside Node command-family handling.

- [ ] **Step 4: Run green tests**

Run: `pnpm vitest run src/runtime/__tests__/generic-vocabulary.test.ts --reporter=dot`

Expected: PASS.

---

## Task 10: Full Regression and Flow-Audit Evidence

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [ ] **Step 1: Run focused regression suite**

Run:

```sh
pnpm vitest run \
  src/runtime/__tests__/toolchain-profile.test.ts \
  src/runtime/__tests__/generalization-smoke.test.ts \
  src/runtime/__tests__/generic-vocabulary.test.ts \
  src/runtime/__tests__/task-gates.test.ts \
  src/runtime/__tests__/context-builder.test.ts \
  src/runtime/__tests__/gate-scope-exceptions.test.ts \
  src/runtime/__tests__/evidence-work-graph-intake.test.ts \
  src/runtime/__tests__/design-preview.test.ts \
  src/runtime/__tests__/serve-design-system-discovery.test.ts \
  src/core/__tests__/task-sizing.test.ts \
  src/tools/__tests__/task-queue.test.ts \
  --reporter=dot
```

Expected: PASS.

- [ ] **Step 2: Run broad regression**

Run:

```sh
pnpm typecheck
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Record evidence**

Append to `internal/audits/flow-audit.md`:

```md
- [x] Harden Guildhall against web/Node/Looma/Knit overfitting. Generic runtime
  inference now goes through toolchain/source/work-graph profiles; generalization
  smoke fixtures cover Node web, Python CLI, Rust library, Go service, Java
  Gradle service, Swift package, native CLI, Terraform module, and docs-only
  work; negative vocabulary guardrails keep project-specific product names out
  of generic runtime code. Verification: <commands and pass summary>.
```

- [ ] **Step 4: Optional MCP evidence**

If a concrete Guildhall task id exists for this work, call `guildhall.append_task_evidence` with the focused and broad verification summary.

---

## Rollout Order

1. Toolchain profiles.
2. Command normalization and gate parsing.
3. Likely-file/source inference.
4. Structured event reasons.
5. Work-graph adapter cleanup.
6. Design-system hook generalization.
7. Task sizing vocabulary cleanup.
8. Generalization smoke fixtures.
9. Negative vocabulary guardrails.
10. Full regression and audit evidence.

This order keeps the deepest runtime abstraction first, then migrates each overfit surface onto it, then locks the behavior down with fixture and vocabulary tests.

## Self-Review

- Covers every audit finding: Node/pnpm gates, JS-only file inference, exact incident strings, Looma/Knit work-graph special cases, web-only smoke proof, design-system/Looma hooks, SaaS task sizing residue, and regression guardrails.
- Public docs are not modified; this remains internal planning material.
- Each task has a red test, expected failure, implementation target, and green verification command.
- The plan intentionally keeps project-specific Looma/Knit behavior available through adapters/config instead of deleting useful domain knowledge.
