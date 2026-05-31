import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { bootstrapWorkspace } from '../workspace-config.js'
import { resolveConfig } from '../resolve.js'

const TMP = join(tmpdir(), `guildhall-resolve-test-${process.pid}`)

describe('resolveConfig', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('resolves relative projectPath entries from the workspace root instead of the process cwd', () => {
    const workspacePath = join(TMP, 'workspace')
    const projectPath = join(workspacePath, 'seed-project')
    mkdirSync(projectPath, { recursive: true })
    bootstrapWorkspace(workspacePath, {
      name: 'Benchmark Workspace',
      projectPath: '.',
    })

    const resolved = resolveConfig({ workspacePath })

    expect(resolved.workspacePath).toBe(workspacePath)
    expect(resolved.projectPath).toBe(workspacePath)
  })
})
