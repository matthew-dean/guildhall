import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  bootstrapWorkspace,
  findWorkspaceRoot,
  resolveMemoryDir,
  FORGE_YAML_FILENAME,
  readAgentSettings,
  writeAgentSettings,
  updateAgentSettings,
} from '../workspace-config.js'

const TMP = join(tmpdir(), `forge-ws-test-${process.pid}`)

describe('workspace-config', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) {
      rmSync(TMP, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------
  // findWorkspaceRoot
  // -------------------------------------------------------------------------
  describe('findWorkspaceRoot', () => {
    it('returns the directory containing guildhall.yaml', () => {
      const wsDir = join(TMP, 'ws')
      mkdirSync(wsDir)
      bootstrapWorkspace(wsDir, { name: 'Test WS' })
      expect(findWorkspaceRoot(wsDir)).toBe(wsDir)
    })

    it('walks up to find guildhall.yaml in parent', () => {
      const wsDir = join(TMP, 'ws')
      const subDir = join(wsDir, 'src', 'components')
      mkdirSync(subDir, { recursive: true })
      bootstrapWorkspace(wsDir, { name: 'Test WS' })
      expect(findWorkspaceRoot(subDir)).toBe(wsDir)
    })

    it('returns null when no guildhall.yaml found', () => {
      const isolated = join(TMP, 'isolated')
      mkdirSync(isolated)
      // Don't create guildhall.yaml — but we need to stop at /tmp boundary
      // findWorkspaceRoot walks up, so use a deep path that definitely won't have guildhall.yaml
      expect(findWorkspaceRoot(isolated)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // bootstrapWorkspace
  // -------------------------------------------------------------------------
  describe('bootstrapWorkspace', () => {
    it('creates guildhall.yaml without project-local Guildhall state', () => {
      const wsDir = join(TMP, 'bootstrap-test')
      const config = bootstrapWorkspace(wsDir, { name: 'Bootstrap Test' })

      expect(config.name).toBe('Bootstrap Test')
      expect(config.id).toBe('bootstrap-test')
      expect(existsSync(join(wsDir, FORGE_YAML_FILENAME))).toBe(true)
      expect(existsSync(join(wsDir, '.guildhall'))).toBe(false)
      expect(existsSync(join(wsDir, '.gitignore'))).toBe(false)
      expect(existsSync(join(wsDir, 'memory'))).toBe(false)
    })

    it('does not overwrite existing guildhall.yaml', () => {
      const wsDir = join(TMP, 'no-overwrite')
      bootstrapWorkspace(wsDir, { name: 'Original' })
      const config = bootstrapWorkspace(wsDir, { name: 'Should Not Overwrite' })
      expect(config.name).toBe('Original')
    })

    it('does not seed project-local TASKS.json', () => {
      const wsDir = join(TMP, 'tasks-seed')
      bootstrapWorkspace(wsDir, { name: 'Tasks Seed' })
      expect(existsSync(join(wsDir, '.guildhall', 'TASKS.json'))).toBe(false)
    })

    it('does not seed local transcript history into project memory', () => {
      const wsDir = join(TMP, 'exploring-seed')
      bootstrapWorkspace(wsDir, { name: 'Exploring Seed' })
      expect(existsSync(join(wsDir, '.guildhall'))).toBe(false)
      expect(existsSync(join(wsDir, '.guildhall', 'exploring'))).toBe(false)
      expect(existsSync(join(wsDir, 'memory'))).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // readWorkspaceConfig / writeWorkspaceConfig
  // -------------------------------------------------------------------------
  describe('read/write round-trip', () => {
    it('round-trips a full config', () => {
      const wsDir = join(TMP, 'round-trip')
      mkdirSync(wsDir)

      const original = {
        name: 'Round Trip',
        id: 'round-trip',
        coordinators: [{ id: 'looma', name: 'UI Lead', domain: 'looma' }],
        maxRevisions: 5,
        heartbeatInterval: 10,
        ignore: ['node_modules', 'dist'],
        tags: ['ui', 'ts'],
      }

      writeWorkspaceConfig(wsDir, original as any)
      const parsed = readWorkspaceConfig(wsDir)

      expect(parsed.name).toBe('Round Trip')
      expect(parsed.id).toBe('round-trip')
      expect(parsed.maxRevisions).toBe(5)
      expect(parsed.coordinators[0]?.domain).toBe('looma')
      expect(parsed.tags).toContain('ui')
    })

    it('throws when guildhall.yaml is missing', () => {
      const wsDir = join(TMP, 'no-config')
      mkdirSync(wsDir)
      expect(() => readWorkspaceConfig(wsDir)).toThrow(/guildhall.yaml not found/)
    })

    it('keeps project-shaped settings on child projects in a workspace', () => {
      const wsDir = join(TMP, 'workspace-child-settings')
      mkdirSync(wsDir)

      writeWorkspaceConfig(wsDir, {
        name: 'Workspace Child Settings',
        id: 'workspace-child-settings',
        kind: 'workspace',
        projects: [
          {
            id: 'looma',
            path: 'looma',
            bootstrap: {
              commands: ['pnpm install'],
              successGates: ['pnpm lint'],
            },
            worktree: {
              include: ['.env'],
            },
            gitStory: {
              completionTarget: 'open_pr',
              commit: 'ask',
              push: 'auto',
              pullRequest: 'ask',
            },
          },
          {
            id: 'knit',
            path: 'knit',
          },
        ],
      } as any)

      const parsed = readWorkspaceConfig(wsDir)
      expect(parsed.kind).toBe('workspace')
      expect(parsed.bootstrap).toBeUndefined()
      expect(parsed.worktree).toBeUndefined()
      expect(parsed.gitStory).toBeUndefined()
      expect(parsed.projects[0]?.bootstrap?.successGates).toEqual(['pnpm lint'])
      expect(parsed.projects[0]?.worktree?.include).toEqual(['.env'])
      expect(parsed.projects[0]?.gitStory?.push).toBe('auto')
      expect(parsed.projects[1]?.bootstrap).toBeUndefined()
      expect(parsed.projects[1]?.worktree).toBeUndefined()
      expect(parsed.projects[1]?.gitStory).toBeUndefined()
    })

    it('explains YAML parse and schema validation failures', () => {
      const parseDir = join(TMP, 'bad-yaml')
      mkdirSync(parseDir)
      writeFileSync(join(parseDir, FORGE_YAML_FILENAME), 'name: [unterminated\n')
      expect(() => readWorkspaceConfig(parseDir)).toThrow(/Failed to parse/)

      const schemaDir = join(TMP, 'bad-schema')
      mkdirSync(schemaDir)
      writeFileSync(join(schemaDir, FORGE_YAML_FILENAME), 'name: 123\ncoordinators: []\n')
      expect(() => readWorkspaceConfig(schemaDir)).toThrow(/Invalid guildhall.yaml/)
    })
  })

  // -------------------------------------------------------------------------
  // resolveMemoryDir
  // -------------------------------------------------------------------------
  describe('resolveMemoryDir', () => {
    it('returns <workspacePath>/.guildhall', () => {
      expect(resolveMemoryDir('/home/user/project')).toBe('/home/user/project/.guildhall')
    })
  })

  describe('agent settings', () => {
    it('returns defaults when no overrides file exists and round-trips explicit settings', () => {
      const wsDir = join(TMP, 'agent-settings')
      bootstrapWorkspace(wsDir, { name: 'Agent Settings' })

      expect(readAgentSettings(wsDir)).toMatchObject({
        version: 1,
        addIgnore: [],
        history: [],
      })

      writeAgentSettings(wsDir, {
        version: 1,
        models: { worker: 'qwen-worker' },
        coordinators: {},
        addIgnore: ['dist'],
        history: [],
      })

      expect(readAgentSettings(wsDir)).toMatchObject({
        models: { worker: 'qwen-worker' },
        addIgnore: ['dist'],
      })
    })

    it('reports malformed and schema-invalid agent override files', () => {
      const wsDir = join(TMP, 'bad-agent-settings')
      bootstrapWorkspace(wsDir, { name: 'Bad Agent Settings' })
      const overridesPath = join(wsDir, '.guildhall', 'agent-overrides.yaml')
      mkdirSync(join(wsDir, '.guildhall'), { recursive: true })

      writeFileSync(overridesPath, 'version: [unterminated\n')
      expect(() => readAgentSettings(wsDir)).toThrow(/Failed to parse \.guildhall\/agent-overrides.yaml/)

      writeFileSync(overridesPath, 'version: nope\n')
      expect(() => readAgentSettings(wsDir)).toThrow(/Invalid \.guildhall\/agent-overrides.yaml/)
    })

    it('merges coordinator settings append-only while deduplicating repeated facts', () => {
      const wsDir = join(TMP, 'merge-agent-settings')
      bootstrapWorkspace(wsDir, { name: 'Merge Agent Settings' })

      const first = updateAgentSettings(
        wsDir,
        {
          models: { worker: 'worker-a' },
          coordinators: {
            knit: {
              addConcerns: [
                {
                  id: 'mobile',
                  description: 'Real mobile verification matters.',
                  reviewQuestions: ['Was the mobile path verified?'],
                },
              ],
              removeConcerns: ['old-concern'],
              addAutonomousDecisions: ['Choose routine copy edits'],
              addEscalationTriggers: ['Schema change'],
              history: [],
            },
          },
          addIgnore: ['dist'],
        },
        { agentRole: 'coordinator', rationale: 'Initial tuning' },
      )

      expect(first.coordinators.knit?.history).toHaveLength(1)

      const second = updateAgentSettings(
        wsDir,
        {
          models: { reviewer: 'reviewer-a' },
          coordinators: {
            knit: {
              addConcerns: [
                {
                  id: 'mobile',
                  description: 'Duplicate should collapse.',
                  reviewQuestions: ['Was the mobile path verified?'],
                },
                {
                  id: 'a11y',
                  description: 'Keyboard checks matter.',
                  reviewQuestions: ['Was keyboard access verified?'],
                },
              ],
              removeConcerns: ['old-concern', 'stale-concern'],
              addAutonomousDecisions: ['Choose routine copy edits'],
              addEscalationTriggers: ['Schema change', 'Auth change'],
              mandateAddendum: 'Prefer scoped mobile proof.',
              history: [],
            },
          },
          addIgnore: ['dist', 'coverage'],
          heartbeatInterval: 9,
        },
        { agentRole: 'reviewer', rationale: 'Tighten review loop' },
      )

      expect(second.models).toMatchObject({ worker: 'worker-a', reviewer: 'reviewer-a' })
      expect(second.addIgnore).toEqual(['dist', 'coverage'])
      expect(second.heartbeatInterval).toBe(9)
      expect(second.coordinators.knit?.addConcerns.map(concern => concern.id)).toEqual(['mobile', 'a11y'])
      expect(second.coordinators.knit?.removeConcerns).toEqual(['old-concern', 'stale-concern'])
      expect(second.coordinators.knit?.addAutonomousDecisions).toEqual(['Choose routine copy edits'])
      expect(second.coordinators.knit?.addEscalationTriggers).toEqual(['Schema change', 'Auth change'])
      expect(second.coordinators.knit?.mandateAddendum).toBe('Prefer scoped mobile proof.')
      expect(second.coordinators.knit?.history).toHaveLength(2)
      expect(second.history).toHaveLength(2)
    })
  })
})
