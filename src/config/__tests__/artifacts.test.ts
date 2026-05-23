import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  artifactRegistryPath,
  ensureArtifactRegistryTrackable,
  readArtifactRegistry,
  resolveArtifact,
  writeArtifactRegistry,
} from '../artifacts.js'

const TMP = join(tmpdir(), `guildhall-artifacts-test-${process.pid}`)

describe('project artifact registry', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('stores stable artifact IDs in project-relative .guildhall metadata', () => {
    const project = join(TMP, 'project')
    mkdirSync(project, { recursive: true })

    writeArtifactRegistry(project, {
      version: 1,
      artifacts: [
        {
          id: 'flow-audit',
          path: 'internal/audits/flow-audit.md',
          description: 'Live Guildhall UI/runtime hardening checklist.',
          aliases: ['ui-flow-audit'],
          deprecatedPaths: ['docs/web-ui/flow-audit.md'],
        },
      ],
    })

    expect(artifactRegistryPath(project)).toBe(join(project, '.guildhall', 'artifacts.yaml'))
    expect(readArtifactRegistry(project).artifacts[0]).toMatchObject({
      id: 'flow-audit',
      path: 'internal/audits/flow-audit.md',
    })
    expect(resolveArtifact(project, 'artifact:flow-audit')?.path).toBe('internal/audits/flow-audit.md')
    expect(resolveArtifact(project, 'ui-flow-audit')?.id).toBe('flow-audit')
  })

  it('allows artifacts.yaml to be tracked without making all .guildhall metadata private', () => {
    const project = join(TMP, 'ignored')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n', 'utf8')

    ensureArtifactRegistryTrackable(project)

    const entries = readFileSync(join(project, '.gitignore'), 'utf8').split(/\r?\n/).filter(Boolean)
    expect(entries).toContain('!.guildhall/')
    expect(entries).toContain('!.guildhall/*.yaml')
    expect(entries).toContain('.guildhall/config.yaml')
    expect(entries).not.toContain('.guildhall/*')
  })

  it('returns an empty registry when a project has not adopted artifact IDs yet', () => {
    const project = join(TMP, 'empty')
    mkdirSync(project, { recursive: true })

    expect(readArtifactRegistry(project)).toEqual({ version: 1, artifacts: [] })
    expect(resolveArtifact(project, 'artifact:missing')).toBeNull()
  })
})
