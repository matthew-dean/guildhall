import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildContext, resolveLikelyTaskFiles } from '../context-builder.js'
import type { Task } from '@guildhall/core'
import { writeCheckpoint } from '@guildhall/tools'
import { proposeProjectSkill, activateProjectSkillProposal } from '@guildhall/skills'
import { loadCodebaseMap, saveCodebaseMap, type CodebaseMap } from '@guildhall/corpus-map'
import { getProjectTaskLocalHistoryDir } from '@guildhall/sessions'

// ---------------------------------------------------------------------------
// Context builder tests (AC-04)
// Verifies JIT context assembly: keyword ranking, cap enforcement, and
// correct injection of task summary, memory, progress, and decisions.
// ---------------------------------------------------------------------------

const execFileP = promisify(execFile)

let tmpDir: string

const baseTask: Task = {
  id: 'task-001',
  title: 'Add ghost button variant',
  description: 'Add a ghost variant to ui-button in @looma/core for toolbar use',
  domain: 'looma',
  projectPath: '/projects/looma',
  status: 'in_progress',
  priority: 'normal',
  dependsOn: [],
  outOfScope: ['Knit-specific styling'],
  acceptanceCriteria: [
    { id: 'ac-1', description: 'Ghost variant renders correctly', verifiedBy: 'review', met: false },
    { id: 'ac-2', description: 'pnpm build passes', verifiedBy: 'automated', command: 'pnpm build', met: false },
  ],
  notes: [],
  gateResults: [],
  reviewVerdicts: [],
    adjudications: [],
  escalations: [],
  agentIssues: [],
  revisionCount: 0,
  remediationAttempts: 0,
  origination: 'human',
  createdAt: '2026-04-11T00:00:00Z',
  updatedAt: '2026-04-11T00:00:00Z',
  spec: '## Summary\nAdd ghost button variant.\n## Acceptance Criteria\n1. Ghost variant exists.',
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-ctx-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeMemory(content: string) {
  await fs.writeFile(path.join(tmpDir, 'MEMORY.md'), content, 'utf-8')
}
async function writeProgress(content: string) {
  await fs.writeFile(path.join(tmpDir, 'PROGRESS.md'), content, 'utf-8')
}
async function writeDecisions(content: string) {
  await fs.writeFile(path.join(tmpDir, 'DECISIONS.md'), content, 'utf-8')
}

function minimalCodebaseMap(input: { root: string; generatedAt: string }): CodebaseMap {
  return {
    version: 1,
    generatedAt: input.generatedAt,
    project: {
      root: input.root,
      summary: 'Local Svelte project with shared UI primitives.',
      languages: ['svelte', 'typescript'],
      packageManagers: ['pnpm'],
      primaryFrameworks: ['svelte'],
    },
    files: {
      'src/web/lib/Button.svelte': {
        path: 'src/web/lib/Button.svelte',
        mtimeMs: 1,
        size: 42,
        sha256: 'a'.repeat(64),
        language: 'svelte',
        kind: 'source',
        areaIds: ['web-ui'],
        symbols: ['Button'],
        imports: [],
        summary: 'Button.svelte: shared command button.',
      },
    },
    entrypoints: [],
    areas: [
      {
        id: 'web-ui',
        title: 'Web UI',
        summary: 'Web UI area with shared Svelte controls.',
        owns: ['src/web/**'],
        canonicalFiles: [
          {
            path: 'src/web/lib/Button.svelte',
            symbols: ['Button'],
            summary: 'Button.svelte: shared command button.',
          },
        ],
        conventions: ['Use shared Button before adding surface-local button styles.'],
        tests: [],
      },
    ],
    abstractions: [
      {
        id: 'button',
        title: 'Command buttons',
        kind: 'ui-component',
        canonicalPath: 'src/web/lib/Button.svelte',
        useWhen: ['A user triggers an action from a toolbar, form, panel, drawer, or wizard.'],
        avoid: ['Do not add local button padding, radius, neutral backgrounds, or one-off action styles.'],
        related: [],
      },
    ],
    verification: { commands: ['pnpm test'] },
  }
}

describe('buildContext — task summary', () => {
  it('includes task id and title in output', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('task-001')
    expect(ctx.taskSummary).toContain('Add ghost button variant')
  })

  it('includes spec when present', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('### Spec Overview')
    expect(ctx.taskSummary).toContain('ghost button variant')
  })

  it('includes env file key names for credential-shaped tasks without values', async () => {
    const project = path.join(tmpDir, 'project')
    const memoryDir = path.join(project, '.guildhall')
    await fs.mkdir(path.join(project, 'frontend'), { recursive: true })
    await fs.mkdir(memoryDir, { recursive: true })
    await fs.writeFile(
      path.join(project, 'frontend', '.env'),
      [
        'PUBLIC_SUPABASE_URL=https://example.supabase.co',
        'PUBLIC_SUPABASE_ANON_KEY=anon-secret',
        'SUPABASE_SERVICE_ROLE_KEY=service-secret',
      ].join('\n'),
      'utf-8',
    )

    const ctx = await buildContext({
      ...baseTask,
      title: 'Configure Supabase OAuth providers',
      description: 'Enable Google and Apple providers in Supabase.',
      projectPath: project,
    }, memoryDir)

    expect(ctx.taskSummary).toContain('### Environment Files (names only; values redacted)')
    expect(ctx.taskSummary).toContain('frontend/.env: PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
    expect(ctx.taskSummary).not.toContain('anon-secret')
    expect(ctx.taskSummary).not.toContain('service-secret')
  })

  it('keeps only the summary portion of long spec markdown in the task summary', async () => {
    const ctx = await buildContext({
      ...baseTask,
      spec: [
        '## Summary',
        'Keep this summary.',
        '## Acceptance Criteria',
        '1. This duplicated AC prose should not be echoed inside the spec section.',
        '## Out of Scope',
        '- This duplicated out-of-scope prose should not be echoed inside the spec section.',
      ].join('\n'),
    }, tmpDir)

    const specSection = ctx.taskSummary.split('### Acceptance Criteria')[0] ?? ctx.taskSummary
    expect(specSection).toContain('Keep this summary.')
    expect(specSection).not.toContain('This duplicated AC prose should not be echoed')
    expect(specSection).not.toContain('This duplicated out-of-scope prose should not be echoed')
  })

  it('includes acceptance criteria', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('Ghost variant renders correctly')
    expect(ctx.taskSummary).toContain('pnpm build passes')
  })

  it('includes the current blocker when the task is blocked', async () => {
    const ctx = await buildContext({
      ...baseTask,
      status: 'blocked',
      blockReason: 'worktree bootstrap failed on command `cd knit && pnpm install`',
    }, tmpDir)

    expect(ctx.taskSummary).toContain('**Current blocker:**')
    expect(ctx.taskSummary).toContain('worktree bootstrap failed on command `cd knit && pnpm install`')
  })

  it('includes construction mode responsibility in the task summary', async () => {
    const ctx = await buildContext(baseTask, tmpDir)

    expect(ctx.taskSummary).toContain('**Construction mode:** build')
    expect(ctx.taskSummary).toContain('Implement against the accepted blueprint')
  })

  it('injects generic worker role guidance when no engineer persona matches', async () => {
    const ctx = await buildContext({
      ...baseTask,
      domain: 'unmapped-domain',
      title: 'Wire a niche internal surface',
      description: 'No guild should match this on domain alone.',
    }, tmpDir)

    expect(ctx.personaPrompt).toContain('Worker role guidance')
    expect(ctx.personaPrompt).toContain('Before inventing a component')
  })

  it('includes out-of-scope list', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('Knit-specific styling')
  })

  it('includes agent notes (last 3 only)', async () => {
    const taskWithNotes: Task = {
      ...baseTask,
      notes: Array.from({ length: 7 }, (_, i) => ({
        agentId: 'worker-agent',
        role: 'worker',
        content: `Note number ${i + 1}`,
        timestamp: new Date().toISOString(),
      })),
    }
    const ctx = await buildContext(taskWithNotes, tmpDir)
    // Should include last 3 notes, not all 7
    expect(ctx.taskSummary).toContain('Note number 7')
    expect(ctx.taskSummary).toContain('Note number 5')
    expect(ctx.taskSummary).not.toContain('Note number 4')
    expect(ctx.taskSummary).not.toContain('Note number 1')
  })

  it('surfaces active recovery playbooks as focused worker instructions', async () => {
    const taskWithPlaybook: Task = {
      ...baseTask,
      notes: [
        {
          agentId: 'coordinator',
          role: 'recovery-playbook',
          content: JSON.stringify({
            status: 'started',
            playbook: 'repair_touched_file_failure',
            summary:
              'Trying focused repair in checkpoint-touched files before asking for a human decision.',
            allowedPaths: ['web/app/composables/use-presence.ts'],
            allowedTools: ['read-file', 'edit-file', 'run-shell-command', 'raise-escalation'],
            command: 'cd web && pnpm typecheck',
            maxTurns: 2,
          }),
          timestamp: '2026-05-18T20:31:00Z',
        },
      ],
    }

    const ctx = await buildContext(taskWithPlaybook, tmpDir)

    expect(ctx.taskSummary).toContain('### Active Recovery Playbook')
    expect(ctx.taskSummary).toContain('repair_touched_file_failure')
    expect(ctx.taskSummary).toContain('Trying focused repair')
    expect(ctx.taskSummary).toContain('web/app/composables/use-presence.ts')
    expect(ctx.taskSummary).toContain('Do not do broad repo research')
  })

  it('injects active matching project skills only when project skills are enabled', async () => {
    await proposeProjectSkill({
      memoryDir: tmpDir,
      proposal: {
        id: 'invite-route-skill',
        name: 'invite-route-skill',
        description: 'Repair invite routes',
        triggerKeywords: ['invite', 'workspace'],
        content: 'Use the existing workspace route helpers before adding new utilities.',
        risk: 'low',
        requiresApproval: false,
      },
    })
    await activateProjectSkillProposal({ memoryDir: tmpDir, id: 'invite-route-skill' })
    const task: Task = {
      ...baseTask,
      title: 'Fix invite route',
      description: 'Repair workspace invite handling.',
    }

    const disabled = await buildContext(task, tmpDir)
    expect(disabled.taskSummary).not.toContain('### Project Skills')

    const enabled = await buildContext(task, tmpDir, { projectSkillsEnabled: true })
    expect(enabled.taskSummary).toContain('### Project Skills')
    expect(enabled.taskSummary).toContain('invite-route-skill')
    expect(enabled.taskSummary).toContain('Use the existing workspace route helpers')

    const unrelated = await buildContext(
      { ...baseTask, title: 'Fix billing report', description: 'Repair invoice export.' },
      tmpDir,
      { projectSkillsEnabled: true },
    )
    expect(unrelated.taskSummary).not.toContain('### Project Skills')
  })


  it('surfaces likely target files from the spec and automated commands', async () => {
    const taskWithTargets: Task = {
      ...baseTask,
      projectPath: '/projects/knit',
      worktreePath: '/projects/knit/.guildhall/worktrees/task-001',
      spec: 'Edit `web/app/composables/use-presence.ts` and verify `tests/unit/composables/use-presence.test.ts`.',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'use-presence tests pass',
          verifiedBy: 'automated',
          command: 'pnpm --filter @knit-app test -- tests/unit/composables/use-presence.test.ts',
          met: false,
        },
      ],
    }

    const ctx = await buildContext(taskWithTargets, tmpDir)
    expect(ctx.taskSummary).toContain('### Likely Target Files')
    expect(ctx.taskSummary).toContain('/projects/knit/.guildhall/worktrees/task-001/web/app/composables/use-presence.ts')
    expect(ctx.taskSummary).toContain('/projects/knit/.guildhall/worktrees/task-001/web/tests/unit/composables/use-presence.test.ts')
  })

  it('injects compact corpus map guidance when a codebase map exists', async () => {
    await saveCodebaseMap(tmpDir, minimalCodebaseMap({
      root: '/projects/looma',
      generatedAt: '2026-05-21T12:00:00.000Z',
    }))

    const ctx = await buildContext(baseTask, tmpDir)

    expect(ctx.corpusMap).toContain('## Corpus Map')
    expect(ctx.formatted).toContain('## Corpus Map')
    expect(ctx.formatted).toContain('Reuse / Extend')
    expect(ctx.formatted).toContain('Command buttons')
    expect(ctx.formatted).toContain('Corpus fit required')
  })

  it('proves the corpus map changes worker context toward existing abstractions', async () => {
    const withoutMap = await buildContext(baseTask, tmpDir)
    expect(withoutMap.corpusMap).toBe('')
    expect(withoutMap.formatted).not.toContain('Command buttons')

    await saveCodebaseMap(tmpDir, minimalCodebaseMap({
      root: '/projects/looma',
      generatedAt: '2026-05-21T12:00:00.000Z',
    }))

    const withMap = await buildContext({
      ...baseTask,
      title: 'Add settings action button',
      description: 'Use the existing shared button treatment in Settings.',
    }, tmpDir)

    expect(withMap.corpusMap).toContain('Command buttons')
    expect(withMap.corpusMap).toContain('src/web/lib/Button.svelte')
    expect(withMap.formatted.indexOf('Command buttons')).toBeGreaterThan(-1)
    expect(withMap.formatted.indexOf('Command buttons')).toBeLessThan(withMap.formatted.indexOf('Corpus fit required'))
  })

  it('creates the corpus map lazily before building agent context when it is missing', async () => {
    const projectRoot = path.join(tmpDir, 'project')
    await fs.mkdir(path.join(projectRoot, 'src', 'web', 'lib'), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'ctx-project', dependencies: { svelte: '5.0.0' } }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(projectRoot, 'src', 'web', 'lib', 'Button.svelte'),
      '<button><slot /></button>\n',
      'utf8',
    )

    const ctx = await buildContext({ ...baseTask, projectPath: projectRoot }, tmpDir)
    const map = await loadCodebaseMap(tmpDir)

    expect(map?.project.root).toBe(projectRoot)
    expect(ctx.corpusMap).toContain('## Corpus Map')
    expect(ctx.formatted).toContain('Corpus fit required')
  })

  it('refreshes a stale corpus map when the active task root changes', async () => {
    const oldRoot = path.join(tmpDir, 'old-project')
    const projectRoot = path.join(tmpDir, 'new-project')
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'new-project' }), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1\n', 'utf8')
    await saveCodebaseMap(tmpDir, minimalCodebaseMap({
      root: oldRoot,
      generatedAt: '2026-05-21T12:00:00.000Z',
    }))

    await buildContext({ ...baseTask, projectPath: projectRoot }, tmpDir)

    const map = await loadCodebaseMap(tmpDir)
    expect(map?.project.root).toBe(projectRoot)
    expect(map?.files['src/feature.ts']?.summary).toContain('feature.ts')
  })

  it('does not duplicate the project folder when an imported source path is workspace-relative', async () => {
    const projectRoot = path.join(tmpDir, 'looma-knit', 'looma')
    await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'docs', 'editor-roadmap.md'), '# Roadmap\n', 'utf8')
    const taskWithImportedSource: Task = {
      ...baseTask,
      title: 'Emoji',
      description: 'looma/docs/editor-roadmap.md: - **Emoji**',
      projectPath: projectRoot,
      spec: '',
      notes: [
        {
          agentId: 'workspace-importer',
          role: 'importer',
          content: `Imported from: ${path.join(projectRoot, 'docs', 'editor-roadmap.md')}`,
          timestamp: '2026-05-19T00:00:00.000Z',
        },
      ],
    }

    const files = resolveLikelyTaskFiles(taskWithImportedSource)
    expect(files).toContain(path.join(projectRoot, 'docs', 'editor-roadmap.md'))
    expect(files).not.toContain(path.join(projectRoot, 'looma', 'docs', 'editor-roadmap.md'))
  })

  it('resolves Nuxt server hints under web/server when the task root is the app project', async () => {
    const worktree = path.join(tmpDir, '.guildhall', 'worktrees', 'task-invite')
    await fs.mkdir(path.join(worktree, 'web', 'server', 'api', 'workspaces'), { recursive: true })
    await fs.writeFile(
      path.join(worktree, 'web', 'server', 'api', 'workspaces', 'members.get.ts'),
      '// members route\n',
      'utf8',
    )
    const taskWithTargets: Task = {
      ...baseTask,
      projectPath: path.join(tmpDir, 'knit'),
      worktreePath: worktree,
      spec: 'Create `server/api/workspaces/[id]/invite.post.ts` using the pattern in `web/server/api/workspaces/members.get.ts`.',
    }

    const ctx = await buildContext(taskWithTargets, tmpDir)
    expect(ctx.taskSummary).toContain(path.join(worktree, 'web', 'server', 'api', 'workspaces', '[id]', 'invite.post.ts'))
    expect(ctx.taskSummary).not.toContain(path.join(worktree, 'server', 'api', 'workspaces', '[id]', 'invite.post.ts'))
  })

  it('keeps explicitly referenced test files while ignoring shell commands and wildcard globs when deriving likely target files', () => {
    const taskWithNoisyHints: Task = {
      ...baseTask,
      projectPath: '/projects/knit',
      worktreePath: '/projects/knit/.guildhall/worktrees/task-007',
      title: 'Add unit coverage for use-collections behavior',
      description:
        'Add unit tests beyond the existing auth-header checks in `web/tests/unit/composables/use-collections-auth.test.ts`.',
      spec: [
        '## Summary',
        'Add unit test coverage for `web/app/composables/use-collections.ts` beyond the existing auth-header checks in `web/tests/unit/composables/use-collections-auth.test.ts`.',
        '## Acceptance Criteria',
        '1. Given the unit suite runs, when `pnpm --filter @knit-app test -- tests/unit/composables/use-collections*.test.ts` executes in `knit/web`, then all targeted tests pass.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'ac-7',
          description: 'use-collections tests pass',
          verifiedBy: 'automated',
          command: 'pnpm --filter @knit-app test -- tests/unit/composables/use-collections*.test.ts',
          met: false,
        },
      ],
    }

    expect(resolveLikelyTaskFiles(taskWithNoisyHints)).toEqual([
      '/projects/knit/.guildhall/worktrees/task-007/web/app/composables/use-collections.ts',
      '/projects/knit/.guildhall/worktrees/task-007/web/tests/unit/composables/use-collections-auth.test.ts',
    ])
  })

  it('falls back to backticked spec file paths when no stronger likely-target hints exist', () => {
    const taskWithBacktickedSpec: Task = {
      ...baseTask,
      projectPath: '/projects/knit',
      worktreePath: '/projects/knit/.guildhall/worktrees/task-012',
      title: 'Generate TypeScript types from Supabase schema',
      description: 'Keep the change bounded and reviewable.',
      spec: [
        '## Summary',
        'The generated `Database` interface already exists at `web/app/types/supabase.ts` and is imported by `web/app/composables/use-workspace.ts`.',
        'This task is about verifying the generation flow works end-to-end and wiring types into the smallest useful consumer set.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'typecheck passes',
          verifiedBy: 'automated',
          command: 'pnpm -F web typecheck',
          met: false,
        },
      ],
    }

    expect(resolveLikelyTaskFiles(taskWithBacktickedSpec)).toEqual([
      '/projects/knit/.guildhall/worktrees/task-012/web/app/types/supabase.ts',
      '/projects/knit/.guildhall/worktrees/task-012/web/app/composables/use-workspace.ts',
    ])
  })

  it('uses recent reviewer feedback when deriving likely target files for revision work', () => {
    const taskWithReviewerFeedback: Task = {
      ...baseTask,
      projectPath: '/projects/fll/frontend',
      worktreePath: '/projects/fll/.guildhall/worktrees/task-003',
      spec: '## Summary\nWire auth pages.',
      notes: [
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          content:
            "Add `definePageMeta({ middleware: 'auth' })` to `frontend/app/pages/dashboard.vue` to enforce authentication.",
          timestamp: '2026-05-14T16:06:42.745Z',
        },
      ],
    }

    expect(resolveLikelyTaskFiles(taskWithReviewerFeedback)).toEqual([
      '/projects/fll/.guildhall/worktrees/task-003/frontend/app/pages/dashboard.vue',
    ])
  })

  it('resolves ambiguous spec paths against the real repo tree and includes success-metric test files', async () => {
    await fs.mkdir(path.join(tmpDir, 'packages', 'converter', 'src', 'features'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'packages', 'converter', 'test'), { recursive: true })
    await execFileP('git', ['init'], { cwd: tmpDir })
    await fs.writeFile(path.join(tmpDir, 'packages', 'converter', 'src', 'typescriptToJsdoc.ts'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'packages', 'converter', 'src', 'jsdocToTypescript.ts'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'packages', 'converter', 'src', 'features', 'functionDeclaration.ts'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'packages', 'converter', 'src', 'features', 'variableDeclaration.ts'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'packages', 'converter', 'test', 'ts-to-jsdoc.test.ts'), '', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'packages', 'converter', 'test', 'jsdoc-to-ts.test.ts'), '', 'utf-8')

    const task: Task = {
      ...baseTask,
      projectPath: tmpDir,
      spec: [
        '## Summary',
        'In `typescriptToJsdoc.ts` and `features/functionDeclaration.ts`, preserve non-type tags.',
        'In `jsdocToTypescript.ts` and `features/variableDeclaration.ts`, keep descriptions intact.',
      ].join('\n'),
      productBrief: {
        userJob: 'Complete the round-trip converter.',
        successMetric:
          'packages/converter/test/ts-to-jsdoc.test.ts and packages/converter/test/jsdoc-to-ts.test.ts all pass.',
        antiPatterns: [],
        authoredBy: 'spec-agent',
        authoredAt: '2026-05-12T00:00:00Z',
      },
    }

    expect(resolveLikelyTaskFiles(task)).toEqual([
      path.join(tmpDir, 'packages', 'converter', 'src', 'typescriptToJsdoc.ts'),
      path.join(tmpDir, 'packages', 'converter', 'src', 'features', 'functionDeclaration.ts'),
      path.join(tmpDir, 'packages', 'converter', 'src', 'jsdocToTypescript.ts'),
      path.join(tmpDir, 'packages', 'converter', 'src', 'features', 'variableDeclaration.ts'),
      path.join(tmpDir, 'packages', 'converter', 'test', 'ts-to-jsdoc.test.ts'),
      path.join(tmpDir, 'packages', 'converter', 'test', 'jsdoc-to-ts.test.ts'),
    ])
  })

  it('surfaces the active worktree and changed files for resumed worker tasks', async () => {
    const worktreePath = path.join(tmpDir, 'worktree')
    await fs.mkdir(path.join(worktreePath, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await execFileP('git', ['init'], { cwd: worktreePath })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts'),
      'export const changed = true\n',
      'utf-8',
    )

    const ctx = await buildContext({
      ...baseTask,
      worktreePath,
    }, tmpDir)

    expect(ctx.taskSummary).toContain('### Resume From Current Worktree')
    expect(ctx.taskSummary).toContain(worktreePath)
    expect(ctx.taskSummary).toContain('use-presence.test.ts')
  })

  it('surfaces the latest checkpoint and uses its touched files as likely targets for resumed tasks', async () => {
    const worktreePath = path.join(tmpDir, 'worktree')
    const memoryTasksDir = getProjectTaskLocalHistoryDir(tmpDir, 'task-001')
    await fs.mkdir(worktreePath, { recursive: true })
    await fs.mkdir(memoryTasksDir, { recursive: true })
    await fs.writeFile(
      path.join(memoryTasksDir, 'checkpoint.json'),
      JSON.stringify({
        taskId: 'task-001',
        agentId: 'worker-agent',
        step: 1,
        intent: 'Regenerated supabase types',
        filesTouched: ['web/app/types/supabase.ts', 'web/app/composables/use-workspace.ts'],
        nextPlannedAction: 'Resume from the active worktree diff, refresh focused verification, and keep the task in implementation until the focused checks are green.',
        resumeContext: {
          verification: [
            {
              command: 'pnpm -F web typecheck',
              passed: false,
              observedAt: '2026-05-07T18:24:00.000Z',
              summary: 'Cannot find name WorkspaceSummary',
            },
          ],
          companionFiles: ['web/tests/unit/composables/use-workspace.test.ts'],
          workingHypothesis: 'The generated type wiring is correct, but one consumer still expects the old WorkspaceSummary shape.',
          safeNextMutationSurface: ['web/app/types/supabase.ts', 'web/app/composables/use-workspace.ts'],
        },
        writtenAt: '2026-05-07T18:23:25.747Z',
      }, null, 2),
      'utf-8',
    )

    const ctx = await buildContext({
      ...baseTask,
      worktreePath,
    }, tmpDir)

    expect(ctx.taskSummary).toContain('### Latest Checkpoint')
    expect(ctx.taskSummary).toContain('Regenerated supabase types')
    expect(ctx.taskSummary).toContain('Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.')
    expect(ctx.taskSummary).toContain('Latest authoritative verification: pnpm -F web typecheck (failed)')
    expect(ctx.taskSummary).toContain('Cannot find name WorkspaceSummary')
    expect(ctx.taskSummary).toContain('Companion files: web/tests/unit/composables/use-workspace.test.ts')
    expect(ctx.taskSummary).toContain('Safe next mutation surface: web/app/types/supabase.ts, web/app/composables/use-workspace.ts')
    expect(ctx.taskSummary).toContain(path.join(worktreePath, 'web/app/types/supabase.ts'))
    expect(ctx.taskSummary).toContain(path.join(worktreePath, 'web/app/composables/use-workspace.ts'))
  })

  it('ignores stale checkpoints written before the task was updated', async () => {
    const worktreePath = path.join(tmpDir, 'worktree')
    const memoryTasksDir = getProjectTaskLocalHistoryDir(tmpDir, 'task-001')
    await fs.mkdir(worktreePath, { recursive: true })
    await fs.mkdir(memoryTasksDir, { recursive: true })
    await fs.writeFile(
      path.join(memoryTasksDir, 'checkpoint.json'),
      JSON.stringify({
        taskId: 'task-001',
        agentId: 'worker-agent',
        step: 1,
        intent: 'Old recovery lane',
        filesTouched: ['PROJECT_STATE.md'],
        nextPlannedAction: 'Only edit PROJECT_STATE.md.',
        resumeContext: {
          safeNextMutationSurface: ['PROJECT_STATE.md'],
        },
        writtenAt: '2026-05-07T18:23:25.747Z',
      }, null, 2),
      'utf-8',
    )

    const ctx = await buildContext({
      ...baseTask,
      worktreePath,
      updatedAt: '2026-05-07T19:00:00.000Z',
    }, tmpDir)

    expect(ctx.taskSummary).not.toContain('### Latest Checkpoint')
    expect(ctx.taskSummary).not.toContain('PROJECT_STATE.md')
    expect(ctx.taskSummary).not.toContain('Only edit PROJECT_STATE.md')
  })

  it('treats remove-style spec instructions as actionable file hints for likely target inference', () => {
    const task: Task = {
      ...baseTask,
      projectPath: tmpDir,
      spec: [
        '## Summary',
        '- Remove the unused `deleteTrashRes` binding in `web/server/api/pages/[id]/restore.post.ts`.',
        '- Keep restore behavior unchanged.',
      ].join('\n'),
    }

    const likely = resolveLikelyTaskFiles(task)

    expect(likely).toContain(path.resolve(tmpDir, 'web/server/api/pages/[id]/restore.post.ts'))
  })

  it('surfaces the latest reviewer revision note as dedicated required feedback', async () => {
    const taskWithReviewNote: Task = {
      ...baseTask,
      notes: [
        {
          agentId: 'worker-agent',
          role: 'worker',
          content: 'Initial implementation finished.',
          timestamp: '2026-04-11T00:00:00Z',
        },
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          content: 'What must change:\n- Add the missing login redirect tests.',
          timestamp: '2026-04-11T01:00:00Z',
        },
      ],
    }
    const ctx = await buildContext(taskWithReviewNote, tmpDir)
    expect(ctx.taskSummary).toContain('### Latest Required Revisions')
    expect(ctx.taskSummary).toContain('Add the missing login redirect tests')
  })

  it('adds concrete retry coaching when review loops repeat and the worker hits brittle edit failures', async () => {
    const taskWithBrittleRetry: Task = {
      ...baseTask,
      title: 'Set FLL overhead charge policy',
      description: 'Create the public fee policy page and author dashboard fee breakdown.',
      revisionCount: 6,
      notes: [
        {
          agentId: 'reviewer-agent',
          role: 'reviewer',
          content: [
            '**Required revisions:**',
            '1. In `frontend/app/pages/dashboard.vue`, define `fetchData` for the Retry button.',
            '2. Fix `<Card>` usage to match `frontend/app/components/ui/molecules/Card.vue` props.',
          ].join('\n'),
          timestamp: '2026-05-25T04:06:41.363Z',
        },
      ],
      escalations: [
        {
          id: 'esc-task-006-23',
          taskId: 'task-001',
          agentId: 'worker-agent',
          reason: 'spec_ambiguous',
          summary: 'Card component exists but template syntax mismatch prevents edit',
          details:
            'Multiple attempts to edit dashboard.vue failed because the exact string was not found, suggesting a whitespace or formatting mismatch. Need clarification on how to properly apply Card with props in the template.',
          raisedAt: '2026-05-25T04:08:27.700Z',
          resolvedAt: '2026-05-25T18:20:42.819Z',
          resolvedBy: 'system',
          resolution:
            'Resolved as Guildhall-owned implementation recovery: failed exact-string/template edits are not a product/spec decision for the owner.',
        },
      ],
    }

    const ctx = await buildContext(taskWithBrittleRetry, tmpDir)

    expect(ctx.taskSummary).toContain('### Retry Coaching')
    expect(ctx.taskSummary).toContain('Do not ask the owner about local implementation mechanics')
    expect(ctx.taskSummary).toContain('Re-read the current target file')
    expect(ctx.taskSummary).toContain('avoid exact-string replacement')
    expect(ctx.taskSummary).toContain('frontend/app/pages/dashboard.vue')
  })

  it('does not duplicate reviewer feedback inside the generic agent-notes section', async () => {
    const taskWithReviewNote: Task = {
      ...baseTask,
      notes: [
        {
          agentId: 'worker-agent',
          role: 'worker',
          content: 'Worker note.',
          timestamp: '2026-04-11T00:00:00Z',
        },
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          content: 'What must change:\n- Remove the placeholder files.\n- Re-run the targeted tests.',
          timestamp: '2026-04-11T01:00:00Z',
        },
      ],
    }

    const ctx = await buildContext(taskWithReviewNote, tmpDir)
    expect(ctx.taskSummary).toContain('### Latest Required Revisions')
    expect(ctx.taskSummary).toContain('Remove the placeholder files.')
    expect(ctx.taskSummary).toContain('### Agent Notes')
    expect(ctx.taskSummary).toContain('Worker note.')
    const afterAgentNotes = ctx.taskSummary.split('### Agent Notes')[1] ?? ''
    expect(afterAgentNotes).not.toContain('Remove the placeholder files.')
  })

  it('surfaces recent resolved escalation decisions as guidance for resumed work', async () => {
    const taskWithResolution: Task = {
      ...baseTask,
      escalations: [
        {
          id: 'esc-task-011-5',
          taskId: 'task-001',
          agentId: 'worker-agent',
          reason: 'decision_required',
          summary: 'Typecheck is failing in unrelated file outside the task target.',
          details: 'web/app/composables/use-presence.test.ts is already red.',
          raisedAt: '2026-05-05T18:00:00Z',
          resolvedAt: '2026-05-05T18:05:00Z',
          resolvedBy: 'human',
          resolution:
            'Treat AC13 as scoped to the task changed file for now and keep unrelated repo-red out of scope unless the same file set is touched.',
        },
      ],
    }

    const ctx = await buildContext(taskWithResolution, tmpDir)
    expect(ctx.taskSummary).toContain('### Resolved Human Decisions To Honor')
    expect(ctx.taskSummary).toContain('esc-task-011-5')
    expect(ctx.taskSummary).toContain('Treat AC13 as scoped to the task changed file')
    expect(ctx.taskSummary).toContain('Do not reopen these questions unless new evidence appears')
  })

  it('hides stale reviewer feedback after a max-revisions escalation was resolved for retry', async () => {
    const taskWithResolvedRetry: Task = {
      ...baseTask,
      status: 'in_progress',
      notes: [
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          content: 'Recommended task-local revisions:\n- Add broad platform ceremony.',
          timestamp: '2026-05-09T01:00:00.000Z',
        },
      ],
      escalations: [
        {
          id: 'esc-task-001-3',
          taskId: 'task-001',
          agentId: 'reviewer-fanout',
          reason: 'max_revisions_exceeded',
          summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
          raisedAt: '2026-05-09T01:02:00.000Z',
          resolvedAt: '2026-05-09T01:05:00.000Z',
          resolvedBy: 'human',
          resolution: 'Retry with narrower reviewer scope.',
        },
      ],
    }

    const ctx = await buildContext(taskWithResolvedRetry, tmpDir)
    expect(ctx.taskSummary).not.toContain('### Latest Required Revisions')
    expect(ctx.taskSummary).toContain('### Resolved Human Decisions To Honor')
  })

  it('upgrades stale checkpoint self-critique instructions when a worker persona-role note already contains the self-critique', async () => {
    const taskWithPersonaSelfCritique: Task = {
      ...baseTask,
      status: 'in_progress',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Backend Engineer',
          content: '**Self-critique:**\nFocused restore handler verification passed.',
          timestamp: '2026-05-09T01:36:13.216Z',
        },
      ],
    }

    await fs.mkdir(path.join(tmpDir, 'tasks'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'TASKS.json'),
      JSON.stringify({ version: 1, lastUpdated: 'now', tasks: [taskWithPersonaSelfCritique] }, null, 2),
      'utf-8',
    )
    await writeCheckpoint({
      tasksPath: path.join(tmpDir, 'TASKS.json'),
      memoryDir: tmpDir,
      taskId: taskWithPersonaSelfCritique.id,
      agentId: 'worker-agent',
      intent: 'Worker recovery checkpoint after verified progress.',
      nextPlannedAction: 'Resume from the recorded verification evidence, write or refresh the self-critique note, then hand off to review.',
      filesTouched: ['web/server/api/pages/[id]/restore.post.ts'],
    })

    const ctx = await buildContext(taskWithPersonaSelfCritique, tmpDir)
    expect(ctx.taskSummary).toContain('Resume from the latest self-critique and recorded verification evidence, then hand off to review.')
    expect(ctx.taskSummary).not.toContain('write or refresh the self-critique note')
  })
})

describe('buildContext — memory extraction', () => {
  it('returns empty string when MEMORY.md does not exist', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory).toBe('')
  })

  it('extracts sections relevant to the task domain', async () => {
    await writeMemory([
      '## Looma conventions',
      'Use data-variant for button styles.',
      '',
      '## Knit routing',
      'Knit uses Nuxt 4 file-based routing.',
      '',
      '## Unrelated section',
      'Nothing to do with this task.',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory).toContain('Looma conventions')
    expect(ctx.projectMemory).toContain('data-variant')
  })

  it('ranks sections by keyword relevance — domain keyword scores highest', async () => {
    await writeMemory([
      '## Unrelated topic',
      'Something about databases.',
      '',
      '## Looma button API',
      'Buttons use data-variant attribute.',
      '',
      '## Ghost rendering',
      'Ghost elements have transparent backgrounds.',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    // Looma + button + ghost should all score — unrelated should not appear or appear last
    expect(ctx.projectMemory).toContain('Looma button API')
    expect(ctx.projectMemory).toContain('Ghost rendering')
  })

  it('caps memory injection at 4000 chars', async () => {
    // Write a very large MEMORY.md
    const hugeSection = '## Looma section\n' + 'x'.repeat(10_000)
    await writeMemory(hugeSection)

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory.length).toBeLessThanOrEqual(4000)
  })

  it('excludes sections with no keyword overlap', async () => {
    await writeMemory([
      '## Completely unrelated topic',
      'This is about PostgreSQL indexing strategies.',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory).not.toContain('PostgreSQL')
  })
})

describe('buildContext — progress injection', () => {
  it('returns empty string when PROGRESS.md does not exist', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentProgress).toBe('')
  })

  it('returns the last 60 lines of PROGRESS.md', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
    await writeProgress(lines.join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    const resultLines = ctx.recentProgress.split('\n')
    expect(resultLines.length).toBeLessThanOrEqual(60)
    expect(ctx.recentProgress).toContain('Line 100')
    expect(ctx.recentProgress).not.toContain('Line 1\n') // early lines excluded
  })

  it('handles PROGRESS.md shorter than 60 lines', async () => {
    await writeProgress('Line 1\nLine 2\nLine 3')
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentProgress).toContain('Line 1')
    expect(ctx.recentProgress).toContain('Line 3')
  })
})

describe('buildContext — decisions injection', () => {
  it('returns empty string when DECISIONS.md does not exist', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentDecisions).toBe('')
  })

  it('includes decisions relevant to the task domain', async () => {
    await writeDecisions([
      '## ADR-001: Looma button API decision',
      'Use data-variant for all button styles.',
      '---',
      '## ADR-002: Knit routing decision',
      'Use file-based routing.',
      '---',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentDecisions).toContain('Looma')
  })

  it('caps decisions injection at 2000 chars', async () => {
    const hugeDomainDecision = '## looma decision\n' + 'y'.repeat(5_000) + '\n---\n'
    await writeDecisions(hugeDomainDecision.repeat(3))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentDecisions.length).toBeLessThanOrEqual(2000)
  })
})

describe('buildContext — formatted output', () => {
  it('produces a non-empty formatted string', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.formatted.length).toBeGreaterThan(0)
  })

  it('includes forge context markers', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.formatted).toContain('FORGE CONTEXT')
    expect(ctx.formatted).toContain('END FORGE CONTEXT')
  })

  it('total formatted context stays bounded even with full memory files', async () => {
    await writeMemory('## Looma\n' + 'x'.repeat(10_000))
    await writeProgress(Array.from({ length: 200 }, (_, i) => `Progress line ${i}`).join('\n'))
    await writeDecisions('## looma decision\n' + 'y'.repeat(5_000) + '\n---\n')

    const ctx = await buildContext(baseTask, tmpDir)
    // Budget: 4000 memory + 2000 decisions + task summary + progress (60 lines
    // ~= 1000 chars) + at most one persona's principles at `in_progress`
    // (~2–3 KB, or `exploring` spec-contribution block of similar size).
    // Multiple personas are never concatenated into a single prompt — the
    // reviewer fan-out attaches one persona per dispatch.
    expect(ctx.formatted.length).toBeLessThan(14_000)
  })
})

// ---------------------------------------------------------------------------
// FR-08 / FR-12: buildContext injects the exploring transcript tail for tasks
// in the exploring phase so the Spec Agent can resume intake.
// ---------------------------------------------------------------------------

describe('buildContext — exploring transcript', () => {
  async function writeTranscript(taskId: string, body: string): Promise<void> {
    const dir = path.join(tmpDir, 'exploring')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${taskId}.md`), body, 'utf-8')
  }

  it('injects the transcript when the task is in the exploring phase', async () => {
    const exploringTask: Task = { ...baseTask, status: 'exploring' }
    await writeTranscript(
      'task-001',
      '# Exploring transcript: task-001\n\n## [2026-04-01T00:00:00Z] user\n\nthe ghost button\n\n---\n',
    )
    const ctx = await buildContext(exploringTask, tmpDir)
    expect(ctx.exploringTranscript).toContain('ghost button')
    expect(ctx.formatted).toContain('Exploring Transcript')
    expect(ctx.formatted).toContain('ghost button')
  })

  it('does not inject the transcript when the task is not exploring', async () => {
    // baseTask is in_progress
    await writeTranscript('task-001', '# old transcript content\n')
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.exploringTranscript).toBe('')
    expect(ctx.formatted).not.toContain('Exploring Transcript')
  })

  it('leaves transcript empty when no file exists', async () => {
    const exploringTask: Task = { ...baseTask, status: 'exploring' }
    const ctx = await buildContext(exploringTask, tmpDir)
    expect(ctx.exploringTranscript).toBe('')
  })

  it('caps a long transcript to the tail', async () => {
    const exploringTask: Task = { ...baseTask, status: 'exploring' }
    const huge = 'A'.repeat(5_000) + '\nTAIL-MARKER\n' + 'B'.repeat(3_000)
    await writeTranscript('task-001', huge)
    const ctx = await buildContext(exploringTask, tmpDir)
    expect(ctx.exploringTranscript.length).toBeLessThanOrEqual(6_000)
    // The tail marker should survive the truncation (it's near the end).
    expect(ctx.exploringTranscript).toContain('TAIL-MARKER')
  })
})


describe('buildContext — FR-23 business envelope injection', () => {
  async function writeGoals(content: string) {
    await fs.writeFile(path.join(tmpDir, 'GOALS.json'), content, 'utf-8')
  }

  it('injects goal summary when task has a parentGoalId resolving to an active goal', async () => {
    const task: Task = { ...baseTask, parentGoalId: 'g-1' }
    await writeGoals(JSON.stringify({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [{
        id: 'g-1',
        title: 'Ship v1',
        description: '',
        successCondition: 'All hard gates pass on main',
        guardrails: [
          { id: 'r1', kind: 'exclude', description: 'No database migrations', tags: [] },
        ],
        status: 'active',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }],
    }))
    const ctx = await buildContext(task, tmpDir)
    expect(ctx.envelope).toContain('g-1')
    expect(ctx.envelope).toContain('Ship v1')
    expect(ctx.envelope).toContain('All hard gates pass on main')
    expect(ctx.envelope).toContain('No database migrations')
    expect(ctx.formatted).toContain('Business Envelope (FR-23)')
  })

  it('leaves envelope empty when task has no parentGoalId', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.envelope).toBe('')
    expect(ctx.formatted).not.toContain('Business Envelope')
  })

  it('leaves envelope empty when parentGoalId points at a missing goal', async () => {
    const task: Task = { ...baseTask, parentGoalId: 'g-missing' }
    await writeGoals(JSON.stringify({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [],
    }))
    const ctx = await buildContext(task, tmpDir)
    expect(ctx.envelope).toBe('')
  })

  it('renders goal with no guardrails (success condition only)', async () => {
    const task: Task = { ...baseTask, parentGoalId: 'g-1' }
    await writeGoals(JSON.stringify({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [{
        id: 'g-1',
        title: 'Minimal',
        description: '',
        successCondition: 'ship something',
        guardrails: [],
        status: 'active',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }],
    }))
    const ctx = await buildContext(task, tmpDir)
    expect(ctx.envelope).toContain('Minimal')
    expect(ctx.envelope).toContain('ship something')
    expect(ctx.envelope).not.toContain('Guardrails:')
  })
})
