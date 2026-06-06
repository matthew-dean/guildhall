import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveCodebaseMap } from '@guildhall/corpus-map'
import {
  createCapabilityRequest,
  defaultProjectRuntimeState,
  recordMemoryObservation,
  writeProjectDeliveryModel,
  writeProjectRuntimeState,
} from '@guildhall/runtime'
import { getProjectContextDebugLedgerPath, getProjectLocalHistoryDir } from '@guildhall/sessions'

import {
  artifactUri,
  buildGuildhallResourceIndex,
  parseGuildhallUri,
  projectUri,
  readGuildhallResource,
  taskUri,
  type GuildhallMcpContext,
} from '../index.js'

describe('Guildhall MCP URI helpers', () => {
  it('renders stable resource URIs', () => {
    expect(projectUri()).toBe('guildhall://project')
    expect(taskUri('task-001')).toBe('guildhall://project/tasks/task-001')
    expect(artifactUri('flow-audit')).toBe('guildhall://project/artifacts/flow-audit')
  })

  it('parses known resource URIs', () => {
    expect(parseGuildhallUri('guildhall://project')).toEqual({ kind: 'project' })
    expect(parseGuildhallUri('guildhall://project/tasks')).toEqual({ kind: 'tasks' })
    expect(parseGuildhallUri('guildhall://project/tasks/task-001')).toEqual({
      kind: 'task',
      taskId: 'task-001',
    })
    expect(parseGuildhallUri('guildhall://project/artifacts/flow-audit')).toEqual({
      kind: 'artifact',
      artifactId: 'flow-audit',
    })
    expect(parseGuildhallUri('guildhall://project/design')).toEqual({ kind: 'design' })
    expect(parseGuildhallUri('guildhall://project/learning')).toEqual({ kind: 'learning' })
    expect(parseGuildhallUri('guildhall://project/context')).toEqual({ kind: 'context' })
    expect(parseGuildhallUri('guildhall://project/local-history')).toEqual({ kind: 'localHistory' })
    expect(parseGuildhallUri('guildhall://project/codebase-knowledge')).toEqual({ kind: 'codebaseKnowledge' })
    expect(parseGuildhallUri('guildhall://project/runtime')).toEqual({ kind: 'runtime' })
    expect(parseGuildhallUri('guildhall://project/drivers')).toEqual({ kind: 'drivers' })
    expect(parseGuildhallUri('guildhall://project/primitives')).toEqual({ kind: 'primitives' })
    expect(parseGuildhallUri('guildhall://project/task-context/task-001')).toEqual({
      kind: 'taskContext',
      taskId: 'task-001',
    })
    expect(parseGuildhallUri('guildhall://project/task-relationships/task-001')).toEqual({
      kind: 'taskRelationships',
      taskId: 'task-001',
    })
  })

  it('rejects non-Guildhall URIs and path traversal segments', () => {
    expect(() => parseGuildhallUri('file:///etc/passwd')).toThrow(/unsupported/i)
    expect(() => parseGuildhallUri('guildhall://project/tasks/../x')).toThrow(/invalid/i)
  })

  it('keeps the context runtime-agnostic', () => {
    const context: GuildhallMcpContext = {
      projectRoot: '/tmp/example',
      projectStateDir: '/tmp/example/.guildhall',
      localHistoryDir: '/tmp/home/.guildhall/data/projects/hash',
      runtime: { kind: 'host' },
    }
    expect(context.runtime.kind).toBe('host')
  })
})

describe('Guildhall MCP project reader', () => {
  it('lists project, task, artifact, decision, memory, and capability resources', async () => {
    const root = mkdtempRoot('guildhall-mcp-reader-')
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      writeFileSync(join(root, 'guildhall.yaml'), 'name: Example\nid: example\n', 'utf8')
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        dependencies: { svelte: '^5.0.0' },
      }), 'utf8')
      writeFileSync(join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
        tasks: [{
          id: 'task-001',
          title: 'Wire bridge',
          description: 'Expose src/mcp-server state to external agents.',
          domain: 'runtime',
          projectPath: root,
          status: 'ready',
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          delivery: {
            driver: 'knit',
            provider: 'looma',
            usesPrimitives: ['menu-item'],
          },
          revisionCount: 0,
          remediationAttempts: 0,
          escalations: [],
          agentIssues: [],
        }],
      }), 'utf8')
      await writeProjectDeliveryModel(root, {
        version: 1,
        updatedAt: '2026-06-05T12:00:00.000Z',
        drivers: [
          { id: 'knit', label: 'Knit', role: 'primary', paths: ['./apps/knit'], domains: ['looma'] },
          { id: 'looma', label: 'Looma', role: 'provider', paths: ['./packages/looma'], domains: ['looma'] },
        ],
        primitives: [
          {
            id: 'menu-item',
            label: 'MenuItem',
            kind: 'ui_primitive',
            provider: 'looma',
            paths: ['./packages/looma/src/menu'],
            dependsOn: [],
            invariants: ['Can render as button or link.'],
            proof: ['storybook'],
            status: 'needs_proof',
            evidence: [],
            aliases: [],
          },
        ],
        validationEvidence: [],
        rejectedCandidates: [],
      })
      writeFileSync(join(root, '.guildhall', 'DECISIONS.md'), '# Decisions\n\n- Use MCP.\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'MEMORY.md'), '# Memory\n\n## Runtime\n\nProject fact. token: ghp_123456789012345678901234567890123456\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'design-system.yaml'), [
        'version: 1',
        'revision: 3',
        'approvedAt: "2026-05-28T00:00:00.000Z"',
        'tokens:',
        '  color:',
        '    - name: action.primary',
        '      value: "#7357ff"',
        '  spacing: []',
        '  typography: []',
        '  radius: []',
        '  shadow: []',
        'primitives:',
        '  - name: Segmented filter',
        '    usage: Mutually exclusive mode choices.',
        'copyVoice:',
        '  tone: warm',
        'a11y:',
        '  minContrastRatio: 4.5',
        '  focusOutlineRequired: true',
        '  keyboardRules: []',
        '  reducedMotionRespected: true',
        '',
      ].join('\n'), 'utf8')
      writeFileSync(join(root, '.guildhall', 'design-taste.yaml'), [
        'version: 1',
        'opinions:',
        '  visualDirection:',
        '    default: warm-functional-polish',
        '  interactionSemantics:',
        '    mutuallyExclusiveModes: segmented-control-or-tabs',
        '  paletteStrategy:',
        '    defaultMode: semantic-oklch-roles',
        '    saturationBudget: controlled',
        '',
      ].join('\n'), 'utf8')
      writeFileSync(join(root, '.guildhall', 'design-stories.yaml'), [
        'version: 1',
        'stories:',
        '  - id: pantry-filter.default',
        '    componentIntent: segmented-filter',
        '    title: Pantry filter / Default',
        '    states: [default, selected]',
        '',
      ].join('\n'), 'utf8')
      writeFileSync(join(root, '.guildhall', 'learning.json'), JSON.stringify({
        version: 1,
        suggestedLearnings: [{
          id: 'prefer-mcp-audit',
          source: 'user_correction',
          summary: 'External agents should audit through MCP before shell fallback.',
          evidence: [],
          scope: 'project',
          destination: 'project_memory',
          confidence: 'high',
          risk: 'low',
          requiresApproval: true,
          status: 'suggested',
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        }],
      }), 'utf8')
      writeFileSync(join(root, '.guildhall', 'artifacts.yaml'), [
        'version: 1',
        'artifacts:',
        '  - id: flow-audit',
        '    path: internal/audits/flow-audit.md',
        '    description: Live audit',
        '',
      ].join('\n'), 'utf8')
      mkdirSync(join(root, 'internal/audits'), { recursive: true })
      writeFileSync(join(root, 'internal/audits/flow-audit.md'), '# Audit\n\n- [ ] Bridge\n', 'utf8')
      await recordMemoryObservation({
        memoryDir: join(root, '.guildhall'),
        record: {
          id: 'mcp-bridge-pref',
          scope: 'project',
          type: 'project_habit',
          status: 'active',
          summary: 'Use MCP bridge before shell fallback.',
          content: 'External agents should use Guildhall MCP resources for project memory, runtime, context, and codebase knowledge first.',
          tags: ['mcp', 'bridge'],
          domains: ['runtime'],
          taskKinds: ['api'],
          fileAreas: ['src/mcp-server'],
          confidence: 'high',
          risk: 'low',
          freshness: 'fresh',
          evidenceRefs: [{ kind: 'task', summary: 'Milestone 12 MCP audit', ref: 'task-001' }],
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
          source: 'test',
        },
      })
      await writeProjectRuntimeState(root, {
        ...defaultProjectRuntimeState(root),
        status: 'running',
        health: {
          status: 'healthy',
          checkedAt: '2026-05-28T00:00:00.000Z',
          checks: [{ name: 'podman ps', ok: true, message: 'runtime reachable' }],
        },
        lastActivityAt: '2026-05-28T00:00:00.000Z',
        backendSetup: {
          status: 'ready',
          selectedMode: 'podman',
          lastAction: 'start-machine',
          lastResult: 'completed',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
        migration: {
          ...defaultProjectRuntimeState(root).migration,
          mode: 'runtime-backed',
          lastResult: 'completed',
          acceptedAt: '2026-05-28T00:00:00.000Z',
          health: {
            status: 'healthy',
            checkedAt: '2026-05-28T00:00:00.000Z',
            checks: [{ name: 'runtime command', ok: true }],
          },
        },
      })
      await saveCodebaseMap(join(root, '.guildhall'), {
        version: 1,
        generatedAt: '2026-05-28T00:00:00.000Z',
        project: {
          root,
          summary: 'Guildhall fixture.',
          languages: ['TypeScript'],
          packageManagers: ['pnpm'],
          primaryFrameworks: ['MCP'],
        },
        files: {
          'src/mcp-server/project-reader.ts': {
            path: 'src/mcp-server/project-reader.ts',
            mtimeMs: 1,
            size: 1,
            sha256: 'abc',
            language: 'TypeScript',
            kind: 'source',
            areaIds: ['mcp'],
            symbols: [],
            imports: [],
            summary: 'MCP project reader.',
          },
        },
        entrypoints: [],
        areas: [{
          id: 'mcp',
          title: 'MCP',
          summary: 'MCP bridge surfaces Guildhall state.',
          owns: ['src/mcp-server'],
          canonicalFiles: [],
          conventions: [],
          tests: [],
        }],
        abstractions: [],
        verification: { commands: ['pnpm vitest run src/mcp-server'] },
      })
      mkdirSync(join(getProjectLocalHistoryDir(root), 'context-debug'), { recursive: true })
      writeFileSync(getProjectContextDebugLedgerPath(root), `${JSON.stringify({
        id: 'ctx-1',
        at: '2026-05-28T00:00:00.000Z',
        taskId: 'task-001',
        taskTitle: 'Wire bridge',
        taskStatus: 'ready',
        domain: 'runtime',
        agentName: 'worker-agent',
        agentRole: 'worker',
        modelId: 'test-model',
        workspacePath: root,
        taskProjectPath: root,
        promptChars: 100,
        contextChars: 200,
        promptPreview: 'secret: sk-123456789012345678901234',
        snapshotPath: '/tmp/snapshot',
        sections: [],
        health: [{ code: 'thin_project_context', severity: 'info', message: 'Thin.' }],
        reasons: ['Effective memory packet was injected.'],
        applicableGuildSlugs: [],
        reviewerSlugs: [],
        primaryEngineerSlug: null,
        openQuestionCount: 0,
        acceptanceCriteriaCount: 0,
        memoryPacket: {
          included: [{ id: 'mcp-bridge-pref', type: 'project_habit', scope: 'project' }],
          withheld: [],
          evidenceRefs: 1,
        },
      })}\n`, 'utf8')

      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      const resources = await buildGuildhallResourceIndex(ctx)
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/tasks/task-001')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/artifacts/flow-audit')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/runtime')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/memory')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/learning')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/feedback')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/design')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/context')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/local-history')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/codebase-knowledge')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/drivers')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/primitives')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/task-context/task-001')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/task-relationships/task-001')

      const project = await readGuildhallResource(ctx, 'guildhall://project')
      expect(project).toContain('## Runtime Health')
      expect(project).toContain('Health: healthy')
      expect(project).toContain('## Memory Health')
      expect(project).toContain('Active: 2')
      expect(project).toContain('## Codebase Knowledge')
      expect(project).toContain('1 files, 1 areas')
      expect(project).toContain('Latest: 2026-05-28T00:00:00.000Z for task-001')

      const artifact = await readGuildhallResource(ctx, 'guildhall://project/artifacts/flow-audit')
      expect(artifact).toContain('# Audit')
      expect(artifact).toContain('Bridge')

      const memory = await readGuildhallResource(ctx, 'guildhall://project/memory')
      expect(memory).toContain('mcp-bridge-pref')
      expect(memory).toContain('External agents should audit through MCP')
      expect(memory).not.toContain('ghp_123456789012345678901234567890123456')
      expect(memory).toContain('[redacted-secret]')

      const learning = await readGuildhallResource(ctx, 'guildhall://project/learning')
      expect(learning).toContain('prefer-mcp-audit')

      writeFileSync(join(root, '.guildhall', 'design-feedback.json'), JSON.stringify({
        version: 1,
        ownerFeedback: [{
          id: 'owner-show-all',
          summary: 'Show all should be a segmented filter choice.',
          sentiment: 'revise',
          status: 'accepted',
          target: { componentName: 'PantryFilter', viewport: 'desktop-1280' },
          rationaleTags: ['better-controls'],
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        }],
        decisionPackets: [{
          id: 'design-decision-packet-2026-05-28T00-00-00-000Z',
          feedbackIds: ['owner-show-all'],
          decisionIds: [],
          summary: 'Accepted owner design feedback.',
          constraints: ['Show all should be a segmented filter choice.'],
          reviewChecklist: ['Verify better control semantics.'],
          workerContext: 'Accepted design feedback: Show all should be a segmented filter choice.',
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        }],
      }, null, 2), 'utf8')
      const feedback = await readGuildhallResource(ctx, 'guildhall://project/feedback')
      expect(feedback).toContain('owner-show-all')
      expect(feedback).toContain('Show all should be a segmented filter choice.')
      expect(feedback).toContain('Worker Context')

      const design = await readGuildhallResource(ctx, 'guildhall://project/design')
      expect(design).toContain('# Design Context')
      expect(design).toContain('Revision: 3')
      expect(design).toContain('Segmented filter')
      expect(design).toContain('warm-functional-polish')
      expect(design).toContain('segmented-control-or-tabs')
      expect(design).toContain('guildhall-portable')
      expect(design).toContain('pantry-filter.default')
      expect(design).toContain('real-web-preview')
      expect(design).toContain('Accepted feedback: 1')
      expect(design).toContain('Decision packets: 1')

      const runtime = await readGuildhallResource(ctx, 'guildhall://project/runtime')
      expect(runtime).toContain('Status: running')
      expect(runtime).toContain('Migration: runtime-backed')
      expect(runtime).toContain('Project:')
      expect(runtime).toContain('Guildhall home:')

      const context = await readGuildhallResource(ctx, 'guildhall://project/context')
      expect(context).toContain('task-001 / worker-agent')
      expect(context).toContain('Memory packet: 1 included')
      expect(context).not.toContain('sk-123456789012345678901234')

      const primitives = await readGuildhallResource(ctx, 'guildhall://project/primitives')
      expect(primitives).toContain('MenuItem')
      expect(primitives).toContain('Used by tasks: task-001')

      const taskContext = await readGuildhallResource(ctx, 'guildhall://project/task-context/task-001')
      expect(taskContext).toContain('Knit is driving this work')
      expect(taskContext).toContain('MenuItem')

      const localHistory = await readGuildhallResource(ctx, 'guildhall://project/local-history')
      expect(localHistory).toContain('Local history is summarized only')
      expect(localHistory).not.toContain('Full Prompt')

      const codebaseKnowledge = await readGuildhallResource(ctx, 'guildhall://project/codebase-knowledge')
      expect(codebaseKnowledge).toContain('Guildhall fixture.')
      expect(codebaseKnowledge).toContain('mcp: MCP bridge surfaces Guildhall state.')

      await createCapabilityRequest({
        memoryDir: join(root, '.guildhall'),
        taskId: 'task-001',
        kind: 'mount_directory',
        requestedBy: 'external-agent',
        reason: 'Need sibling docs.',
        fallback: 'Use published package docs.',
        mount: {
          hostPath: '/tmp/sibling',
          containerPath: '/mnt/guildhall-grants/sibling',
          access: 'read-only',
        },
      })
      const capabilityRequests = await readGuildhallResource(ctx, 'guildhall://project/capability-requests')
      expect(capabilityRequests).toContain('Need sibling docs.')
      expect(capabilityRequests).toContain('Fallback: Use published package docs.')
    } finally {
      rmSync(getProjectLocalHistoryDir(root), { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function mkdtempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}
