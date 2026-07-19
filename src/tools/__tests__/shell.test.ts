import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runShell, runShellSync, shellTool } from '../shell.js'
import { setProvider } from '../../config/global-providers.js'

// ---------------------------------------------------------------------------
// Shell tool tests (AC-06 — gate runner pass/fail logic)
// These are safety-critical: hard gates depend entirely on correct
// success/failure detection from shell command execution.
// ---------------------------------------------------------------------------

const ctx = { cwd: '/tmp', metadata: {} }

function makeTaskScopedDirs(): { projectPath: string; worktreePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-'))
  const projectPath = path.join(root, 'project')
  const worktreePath = path.join(root, '.guildhall', 'worktrees', 'task-012')
  fs.mkdirSync(path.join(projectPath, 'web'), { recursive: true })
  fs.mkdirSync(path.join(worktreePath, 'web'), { recursive: true })
  return { projectPath, worktreePath }
}

function makeNestedTaskScopedDirs(): {
  workspacePath: string
  projectPath: string
  worktreePath: string
  worktreeProjectPath: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-nested-'))
  const workspacePath = path.join(root, 'project')
  const projectPath = path.join(workspacePath, 'frontend')
  const worktreePath = path.join(root, '.guildhall', 'worktrees', 'task-frontend')
  const worktreeProjectPath = path.join(worktreePath, 'frontend')
  fs.mkdirSync(projectPath, { recursive: true })
  fs.mkdirSync(worktreeProjectPath, { recursive: true })
  return { workspacePath, projectPath, worktreePath, worktreeProjectPath }
}

function makeScriptPackage(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-scripts-'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'guildhall-shell-test-fixture',
        private: true,
        scripts: {
          test: "node -e \"console.log('test-corrected')\"",
          lint: "node -e \"console.log('lint-focused')\"",
        },
      },
      null,
      2,
    ),
  )
  return root
}

function makeWorkspaceScriptPackage(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-workspace-'))
  const frontend = path.join(root, 'frontend')
  fs.mkdirSync(frontend, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'frontend'\n",
  )
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ private: true, packageManager: 'pnpm@10.19.0' }, null, 2),
  )
  fs.writeFileSync(
    path.join(frontend, 'package.json'),
    JSON.stringify(
      {
        name: 'frontend',
        private: true,
        scripts: {
          test: "node -e \"console.log('frontend-test-ran')\"",
        },
      },
      null,
      2,
    ),
  )
  return root
}

function makeScopedWorkspaceScriptPackage(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-scoped-workspace-'))
  const core = path.join(root, 'packages', 'core')
  fs.mkdirSync(core, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n",
  )
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ private: true, packageManager: 'pnpm@10.19.0' }, null, 2),
  )
  fs.writeFileSync(
    path.join(core, 'package.json'),
    JSON.stringify(
      {
        name: '@looma/core',
        private: true,
        scripts: {
          test: "node -e \"console.log('core-test-ran')\"",
        },
      },
      null,
      2,
    ),
  )
  return root
}

describe('runShellSync — success cases', () => {
  it('returns success=true for a command that exits 0', () => {
    const result = runShellSync({ command: 'echo hello', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('hello')
  })

  it('captures stdout in output', () => {
    const result = runShellSync({ command: 'echo "forge test output"', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.output).toContain('forge test output')
  })

  it('runs commands in the specified working directory', () => {
    const result = runShellSync({ command: 'pwd', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toContain('/tmp')
  })
})

describe('runShellSync — failure cases', () => {
  it('returns success=false for a command that exits non-zero', () => {
    const result = runShellSync({ command: 'exit 1', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(false)
    expect(result.exitCode).not.toBe(0)
  })

  it('returns success=false for a command that does not exist', () => {
    const result = runShellSync({
      command: 'nonexistent-command-xyz-abc',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
  })

  it('captures stderr output on failure', () => {
    const result = runShellSync({
      command: 'ls /nonexistent-path-xyz',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.output.length).toBeGreaterThan(0)
  })

  it('returns success=false when working directory does not exist', () => {
    const result = runShellSync({
      command: 'echo hello',
      cwd: '/nonexistent-dir-xyz',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
  })

  it('returns success=false on timeout', () => {
    const result = runShellSync({ command: 'sleep 10', cwd: '/tmp', timeoutMs: 100 })
    expect(result.success).toBe(false)
  })
})

describe('runShellSync — gate-specific scenarios', () => {
  it('correctly detects a passing typecheck-like command', () => {
    const result = runShellSync({ command: 'node --version', cwd: '/tmp', timeoutMs: 10_000 })
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/^v\d+/)
  })

  it('correctly detects a failing gate — non-zero exit is always a hard failure', () => {
    const result = runShellSync({
      command: 'node -e "process.exit(2)"',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(2)
  })

  it('captures multi-line output for gate failure diagnosis', () => {
    const result = runShellSync({
      command: 'node -e "console.error(\'line1\\nline2\\nline3\'); process.exit(1)"',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain('line1')
    expect(result.output).toContain('line3')
  })
})

describe('shellTool — engine-tool interface', () => {
  it('wraps runShell and surfaces structured metadata', async () => {
    const result = await shellTool.execute(
      { command: 'echo engine', cwd: '/tmp', timeoutMs: 5000 },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Shell command succeeded (exit 0).')
    expect(result.output).toContain('Treat this command as PASSED')
    expect(result.output).toContain('engine')
    expect(result.metadata).toMatchObject({ success: true, exitCode: 0 })
  })

  it('sets is_error=true on command failure', async () => {
    const result = await shellTool.execute(
      { command: 'exit 3', cwd: '/tmp', timeoutMs: 5000 },
      ctx,
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('Shell command failed (exit 3).')
    expect(result.metadata).toMatchObject({ success: false, exitCode: 3 })
  })

  it('uses ctx.cwd when the model omits cwd', async () => {
    const result = await shellTool.execute(
      { command: 'pwd', timeoutMs: 5000 },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('/tmp')
    expect(result.metadata).toMatchObject({ success: true, exitCode: 0 })
  })

  it('keeps omitted shell cwd inside the current task worktree', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const result = await shellTool.execute(
      { command: 'pwd', timeoutMs: 5000 },
      {
        cwd: worktreePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain(worktreePath)
    expect(result.metadata).toMatchObject({
      success: true,
      requestedCwd: worktreePath,
      executedCwd: worktreePath,
    })
  })

  it('remaps explicit project-root shell cwd into the task worktree', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const result = await shellTool.execute(
      { command: 'pwd', cwd: path.join(projectPath, 'web'), timeoutMs: 5000 },
      {
        cwd: worktreePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain(path.join(worktreePath, 'web'))
    expect(result.metadata).toMatchObject({
      success: true,
      requestedCwd: path.join(projectPath, 'web'),
      executedCwd: path.join(worktreePath, 'web'),
    })
  })

  it('remaps nested task project cwd into the matching subdirectory of the worktree', async () => {
    const { workspacePath, projectPath, worktreePath, worktreeProjectPath } =
      makeNestedTaskScopedDirs()
    const result = await shellTool.execute(
      { command: 'pwd', cwd: projectPath, timeoutMs: 5000 },
      {
        cwd: workspacePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_workspace_project_path: workspacePath,
          current_task_worktree_path: worktreePath,
          current_task_worktree_project_path: worktreeProjectPath,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain(worktreeProjectPath)
    expect(result.metadata).toMatchObject({
      requestedCwd: projectPath,
      executedCwd: worktreeProjectPath,
    })
  })

  it('shows the executed working directory in shell output after cwd remapping', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const result = await shellTool.execute(
      { command: 'pwd', cwd: projectPath, timeoutMs: 5000 },
      {
        cwd: projectPath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain(`Working directory: ${worktreePath}`)
  })

  it('runs authoritative verification from the stored verification cwd when cwd is omitted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-verification-cwd-'))
    const frontend = path.join(root, 'frontend')
    fs.mkdirSync(frontend, { recursive: true })
    fs.writeFileSync(
      path.join(frontend, 'package.json'),
      JSON.stringify({
        name: 'frontend',
        scripts: { build: "node -e \"console.log('scoped-build-ran')\"" },
      }),
    )

    const result = await shellTool.execute(
      { command: 'pnpm build', timeoutMs: 5000 },
      {
        cwd: frontend,
        metadata: {
          current_task_verification_commands: ['pnpm --dir frontend build'],
          current_task_verification_cwd: root,
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain(`Working directory: ${root}`)
    expect(result.output).toContain('scoped-build-ran')
    expect(result.metadata).toMatchObject({
      requestedCwd: frontend,
      executedCwd: root,
      executedCommand: 'pnpm --dir frontend build',
      usedAuthoritativeCommand: true,
    })
  })

  it('remaps omitted workspace cwd into the isolated worktree root for scoped authoritative commands', async () => {
    const { workspacePath, projectPath, worktreePath, worktreeProjectPath } =
      makeNestedTaskScopedDirs()
    const result = await shellTool.execute(
      { command: 'pwd', timeoutMs: 5000 },
      {
        cwd: workspacePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_workspace_project_path: workspacePath,
          current_task_worktree_path: worktreePath,
          current_task_worktree_project_path: worktreeProjectPath,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain(worktreePath)
    expect(result.metadata).toMatchObject({
      requestedCwd: workspacePath,
      executedCwd: worktreePath,
    })
  })

  it('reconciles verification-shaped commands to authoritative task-scoped gates', async () => {
    const cwd = makeScriptPackage()
    const result = await shellTool.execute(
      { command: 'pnpm test -- --runInBand', cwd, timeoutMs: 5000 },
      {
        cwd,
        metadata: {
          current_task_success_gates: ['npm test'],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('test-corrected')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'pnpm test -- --runInBand',
      executedCommand: 'npm test',
      usedAuthoritativeCommand: true,
    })
  })

  it('prefers worker verification commands over broader hard gates when both are present', async () => {
    const cwd = makeScriptPackage()
    const result = await shellTool.execute(
      { command: 'pnpm lint packages/converter', cwd, timeoutMs: 5000 },
      {
        cwd,
        metadata: {
          current_task_success_gates: ['npm test'],
          current_task_verification_commands: ['npm run lint'],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('lint-focused')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'pnpm lint packages/converter',
      executedCommand: 'npm run lint',
      usedAuthoritativeCommand: true,
    })
  })

  it('reconciles authoritative verification commands even when the worker wraps them with cd and output redirection', async () => {
    const cwd = makeScriptPackage()
    const result = await shellTool.execute(
      {
        command: `cd ${cwd} && pnpm test 2>&1`,
        cwd,
        timeoutMs: 5000,
      },
      {
        cwd,
        metadata: {
          current_task_verification_commands: ['npm test'],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('test-corrected')
    expect(result.metadata).toMatchObject({
      requestedCommand: `cd ${cwd} && pnpm test 2>&1`,
      executedCommand: 'npm test',
      usedAuthoritativeCommand: true,
    })
  })

  it('preserves a relative cd working directory when reconciling authoritative verification commands', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-cd-'))
    const frontend = path.join(cwd, 'frontend')
    fs.mkdirSync(frontend, { recursive: true })
    fs.writeFileSync(
      path.join(frontend, 'package.json'),
      JSON.stringify(
        {
          name: 'frontend',
          private: true,
          scripts: {
            build: "node -e \"console.log('frontend-build-ran')\"",
          },
        },
        null,
        2,
      ),
    )

    const result = await shellTool.execute(
      {
        command: 'cd frontend && pnpm build',
        cwd,
        timeoutMs: 5000,
      },
      {
        cwd,
        metadata: {
          current_task_verification_commands: ['pnpm build'],
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain('frontend-build-ran')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'cd frontend && pnpm build',
      executedCommand: 'pnpm build',
      usedAuthoritativeCommand: true,
      cdAdjustedCwd: frontend,
      executedCwd: frontend,
    })
  })

  it('resolves authoritative cd commands from the task worktree root even when shell cwd is already nested', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-worktree-'))
    const schemas = path.join(worktree, 'packages', 'schemas')
    fs.mkdirSync(schemas, { recursive: true })
    fs.writeFileSync(
      path.join(schemas, 'package.json'),
      JSON.stringify(
        {
          name: '@fixture/schemas',
          private: true,
          scripts: {
            build: "node -e \"console.log('schema-build-ran')\"",
          },
        },
        null,
        2,
      ),
    )

    const result = await shellTool.execute(
      {
        command: 'cd packages/schemas && pnpm build',
        cwd: schemas,
        timeoutMs: 5000,
      },
      {
        cwd: schemas,
        metadata: {
          current_task_worktree_path: worktree,
          current_task_verification_commands: ['cd packages/schemas && pnpm build'],
        },
      },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toContain('schema-build-ran')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'cd packages/schemas && pnpm build',
      executedCommand: 'pnpm build',
      usedAuthoritativeCommand: true,
      cdAdjustedCwd: schemas,
      executedCwd: schemas,
    })
  })

  it('normalizes scoped pnpm test commands to the script form pnpm expects', async () => {
    const cwd = makeWorkspaceScriptPackage()
    const result = await shellTool.execute(
      { command: 'pnpm test', cwd, timeoutMs: 5000 },
      {
        cwd,
        metadata: {
          current_task_verification_commands: ['pnpm --dir frontend test'],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('frontend-test-ran')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'pnpm test',
      executedCommand: 'pnpm --dir frontend run test',
      usedAuthoritativeCommand: true,
    })
  })

  it('blocks verification-shaped shell commands that are outside the authoritative verification list', async () => {
    const result = await shellTool.execute(
      { command: 'pnpm -F web test', cwd: '/tmp', timeoutMs: 5000 },
      {
        cwd: '/tmp',
        metadata: {
          current_task_verification_commands: [
            'pnpm lint',
            'pnpm typecheck',
          ],
        },
      },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('authoritative verification commands')
    expect(result.output).toContain('pnpm lint')
    expect(result.output).toContain('pnpm typecheck')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'pnpm -F web test',
      usedAuthoritativeCommand: false,
      blockedUnauthorizedVerificationCommand: true,
    })
  })

  it('blocks package proof scripts that delegate back to Guildhall task orchestration', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-self-proof-'))
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({
        scripts: {
          proof: 'npx guildhall run --task=task-import-9s8tkc-split-define-fixture',
        },
      }),
    )

    const result = await shellTool.execute(
      { command: 'pnpm proof', cwd, timeoutMs: 5000 },
      { cwd, metadata: { current_task_project_path: cwd } },
    )

    expect(result.is_error).toBe(true)
    expect(result.output).toContain('delegates back to Guildhall orchestration')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'pnpm proof',
      blockedSelfReferentialGuildhallTaskProof: true,
    })
  })

  it('allows focused package test commands as supplemental verification', async () => {
    const cwd = makeScopedWorkspaceScriptPackage()
    const result = await shellTool.execute(
      { command: 'pnpm --filter @looma/core test', cwd, timeoutMs: 5000 },
      {
        cwd,
        metadata: {
          current_task_verification_commands: [
            'pnpm lint',
            'pnpm typecheck',
          ],
          current_task_likely_target_files: [
            path.join(cwd, 'packages/core/src/components/ui-context-menu/ui-context-menu.tsx'),
          ],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('core-test-ran')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'pnpm --filter @looma/core test',
    })
    expect((result.metadata as Record<string, unknown>).blockedUnauthorizedVerificationCommand).toBeUndefined()
  })

  it('does not rewrite non-verification shell commands from authoritative gates', async () => {
    const result = await shellTool.execute(
      { command: 'echo hello', cwd: '/tmp', timeoutMs: 5000 },
      {
        cwd: '/tmp',
        metadata: {
          current_task_success_gates: ['echo test-corrected'],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('hello')
    expect(result.metadata).toMatchObject({
      requestedCommand: 'echo hello',
      executedCommand: 'echo hello',
      usedAuthoritativeCommand: false,
    })
  })

  it('does not mistake file-inspection commands with .test.ts paths for verification commands', async () => {
    const result = await shellTool.execute(
      {
        command: 'cat packages/converter/test/ts-to-jsdoc.test.ts | head -5',
        cwd: '/tmp',
        timeoutMs: 5000,
      },
      {
        cwd: '/tmp',
        metadata: {
          current_task_success_gates: ['vitest run'],
        },
      },
    )
    expect(result.metadata).toMatchObject({
      requestedCommand: 'cat packages/converter/test/ts-to-jsdoc.test.ts | head -5',
      executedCommand: 'cat packages/converter/test/ts-to-jsdoc.test.ts | head -5',
      usedAuthoritativeCommand: false,
    })
  })

  it('blocks shell-based file writes when an active coding task already has file-tool context', async () => {
    const result = await shellTool.execute(
      {
        command: 'cat <<\'EOF\' > web/tests/unit/composables/use-collections.test.ts\nhello\nEOF',
        cwd: '/tmp',
        timeoutMs: 5000,
      },
      {
        cwd: '/tmp',
        metadata: {
          current_task_worktree_path: '/tmp/.guildhall/worktrees/task-007',
          current_task_likely_target_files: [
            '/tmp/.guildhall/worktrees/task-007/web/tests/unit/composables/use-collections.test.ts',
          ],
        },
      },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('Shell-based file writes are blocked')
    expect(result.output).toContain('write-file or edit-file')
    expect(result.metadata).toMatchObject({
      success: false,
      blockedDirectFileWrite: true,
      exitCode: 2,
    })
  })

  it('allows temporary shell-written verification fixtures outside the active task worktree', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const tempFile = path.join(os.tmpdir(), `guildhall-shell-temp-${Date.now()}.mjs`)
    const result = await shellTool.execute(
      {
        command: `printf 'console.log("ok")\\n' > ${tempFile} && node ${tempFile}`,
        cwd: worktreePath,
        timeoutMs: 5000,
      },
      {
        cwd: worktreePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
          current_task_likely_target_files: [
            path.join(worktreePath, 'web/tests/unit/composables/use-collections.test.ts'),
          ],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('ok')
    expect((result.metadata as Record<string, unknown>).blockedDirectFileWrite).toBeUndefined()
  })

  it('still allows shell verification commands for active coding tasks', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const result = await shellTool.execute(
      { command: 'echo verify', cwd: projectPath, timeoutMs: 5000 },
      {
        cwd: worktreePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
          current_task_likely_target_files: [
            path.join(worktreePath, 'web/tests/unit/composables/use-collections.test.ts'),
          ],
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('verify')
    expect(result.metadata).toMatchObject({ success: true })
    expect((result.metadata as Record<string, unknown>).blockedDirectFileWrite).toBeUndefined()
  })

  it('injects CI=true for task-scoped shell commands unless the caller overrides it', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const result = await shellTool.execute(
      { command: "node -e \"process.stdout.write(process.env.CI || '')\"", timeoutMs: 5000 },
      {
        cwd: worktreePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('true')
  })

  it('preserves explicit CI env overrides for task-scoped shell commands', async () => {
    const { projectPath, worktreePath } = makeTaskScopedDirs()
    const result = await shellTool.execute(
      {
        command: "node -e \"process.stdout.write(process.env.CI || '')\"",
        timeoutMs: 5000,
        env: { CI: 'false' },
      },
      {
        cwd: worktreePath,
        metadata: {
          current_task_project_path: projectPath,
          current_task_worktree_path: worktreePath,
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('false')
  })

  it('is not declared read-only (shell can mutate state)', () => {
    expect(shellTool.isReadOnly({ command: 'echo', cwd: '/tmp', timeoutMs: 1000 })).toBe(false)
  })
})

describe('runShellSync — interactive-scaffold preflight', () => {
  it('blocks `npm create vite` without a non-interactive flag', () => {
    const result = runShellSync({
      command: 'npm create vite my-app',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.interactiveRequired).toBe(true)
    expect(result.exitCode).toBe(-1)
    expect(result.output).toContain('non-interactive')
  })

  it('passes `npm create vite --yes` through to the shell', () => {
    const result = runShellSync({
      command: 'npm create vite --yes --help',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    // We don't care whether the fake command succeeds; we only care that
    // preflight didn't short-circuit it.
    expect(result.interactiveRequired).toBeUndefined()
  })

  it('does not flag unrelated commands', () => {
    const result = runShellSync({ command: 'echo hello', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.interactiveRequired).toBeUndefined()
  })
})

describe('runShellSync — output formatting', () => {
  it('normalizes CRLF to LF', () => {
    const result = runShellSync({
      command: "node -e \"process.stdout.write('a\\r\\nb\\r\\nc')\"",
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(true)
    expect(result.output).toBe('a\nb\nc')
  })

  it('truncates output over 12000 chars with a marker', () => {
    // Print 15000 x'es — well over the 12000-char cap.
    const result = runShellSync({
      command: "node -e \"process.stdout.write('x'.repeat(15000))\"",
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(true)
    expect(result.output.endsWith('...[truncated]...')).toBe(true)
    expect(result.output.length).toBeLessThan(15000)
    expect(result.output.length).toBeGreaterThan(12000)
  })

  it('returns the "(no output)" sentinel for successful silent commands', () => {
    const result = runShellSync({ command: 'true', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toBe('(no output)')
  })
})

describe('runShellSync — timeout with partial output', () => {
  it('marks timedOut and includes a timeout banner', () => {
    const result = runShellSync({
      command: "node -e \"console.log('before'); setTimeout(() => {}, 5000)\"",
      cwd: '/tmp',
      timeoutMs: 500,
    })
    expect(result.success).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain('timed out')
  })
})

describe('runShell — async tool path', () => {
  it('returns success=true for a command that exits 0 without blocking the tool contract', async () => {
    const result = await runShell({ command: 'echo hello', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello')
  })

  it('returns timeout metadata from the async execution path', async () => {
    const result = await runShell({
      command: "node -e \"console.log('before'); setTimeout(() => {}, 5000)\"",
      cwd: '/tmp',
      timeoutMs: 500,
    })
    expect(result.success).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain('timed out')
  })

  it('merges env overrides into the async execution path', async () => {
    const result = await runShell({
      command: "node -e \"process.stdout.write(process.env.GUILDHALL_SHELL_TEST || '')\"",
      cwd: '/tmp',
      timeoutMs: 5000,
      env: { GUILDHALL_SHELL_TEST: 'set' },
    })
    expect(result.success).toBe(true)
    expect(result.output).toBe('set')
  })

  it('makes configured OpenAI-compatible DeepInfra credentials available to proof commands', async () => {
    const previousHome = process.env.GUILDHALL_CONFIG_DIR
    const previousOpenAiKey = process.env.OPENAI_API_KEY
    const previousOpenAiBaseUrl = process.env.OPENAI_BASE_URL
    const previousDeepinfraToken = process.env.DEEPINFRA_API_TOKEN
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-shell-providers-'))
    process.env.GUILDHALL_CONFIG_DIR = home
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.DEEPINFRA_API_TOKEN
    try {
      setProvider('openai-api', {
        apiKey: 'fake-deepinfra-key',
        baseUrl: 'https://api.deepinfra.com/v1/openai',
      })
      const result = await runShell({
        command: "node -e \"process.stdout.write([process.env.OPENAI_API_KEY, process.env.OPENAI_BASE_URL, process.env.DEEPINFRA_API_TOKEN].join('|'))\"",
        cwd: '/tmp',
        timeoutMs: 5000,
      })
      expect(result.success).toBe(true)
      expect(result.output).toBe('fake-deepinfra-key|https://api.deepinfra.com/v1/openai|fake-deepinfra-key')
    } finally {
      if (previousHome === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousHome
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousOpenAiKey
      if (previousOpenAiBaseUrl === undefined) delete process.env.OPENAI_BASE_URL
      else process.env.OPENAI_BASE_URL = previousOpenAiBaseUrl
      if (previousDeepinfraToken === undefined) delete process.env.DEEPINFRA_API_TOKEN
      else process.env.DEEPINFRA_API_TOKEN = previousDeepinfraToken
    }
  })
})
