import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { WorkspaceImportDraft } from '../workspace-import/index.js'
import type { WorkspaceImportReview } from '../workspace-import/review.js'
import type { Task } from '@guildhall/core'
import {
  buildLearningSnapshot,
  collectReflectionTriggers,
  dismissSuggestedLearning,
  globalLearningPath,
  makeSuggestedLearningProjectWide,
  persistLearningCandidates,
  projectLearningPath,
  readGlobalLearning,
  readProjectLearning,
  recordStructuredUserPreference,
  recordTaskReflection,
  recordUserCorrection,
  recordWorkspaceImportApproval,
  recordWorkspaceImportDismissal,
  resetGlobalLearning,
  resetSuggestedLearnings,
  resetProjectLearning,
} from '../learning.js'
import type { LearningCandidate } from '../policy.js'

let tmpDir: string
let previousHome: string | undefined

function sampleReview(): WorkspaceImportReview {
  return {
    areaGroups: [
      {
        key: 'looma',
        label: 'Looma',
        taskCount: 2,
        milestoneCount: 0,
        goalCount: 0,
        contextCount: 0,
        sourceCount: 1,
        sourceKeys: ['component-roadmap'],
        summary: '2 candidate tasks',
      },
      {
        key: 'knit',
        label: 'Knit',
        taskCount: 2,
        milestoneCount: 0,
        goalCount: 0,
        contextCount: 0,
        sourceCount: 1,
        sourceKeys: ['feature-roadmap'],
        summary: '2 candidate tasks',
      },
    ],
    sourceGroups: [
      {
        key: 'component-roadmap',
        label: 'Component roadmap',
        path: '/tmp/project/looma/docs/component-roadmap.md',
        areaKey: 'looma',
        areaLabel: 'Looma',
        taskCount: 2,
        milestoneCount: 0,
        goalCount: 0,
        contextCount: 0,
        existingOverlapCount: 0,
        kind: 'tasks',
        summary: '2 candidate tasks',
        taskIds: ['task-1', 'task-2'],
      },
      {
        key: 'feature-roadmap',
        label: 'Feature roadmap',
        path: '/tmp/project/knit/docs/feature-roadmap.md',
        areaKey: 'knit',
        areaLabel: 'Knit',
        taskCount: 2,
        milestoneCount: 0,
        goalCount: 0,
        contextCount: 0,
        existingOverlapCount: 0,
        kind: 'tasks',
        summary: '2 candidate tasks',
        taskIds: ['task-3', 'task-4'],
      },
    ],
    totalTaskCandidates: 4,
    totalMilestones: 0,
    totalGoals: 0,
  }
}

function sampleDraft(): WorkspaceImportDraft {
  return {
    goals: [],
    milestones: [],
    context: [],
    stats: { inputSignals: 4, drafted: 4, deduped: 4 },
    tasks: [
      {
        suggestedId: 'task-1',
        title: 'Listbox',
        description: 'Build Listbox.',
        domain: 'looma',
        priority: 'high',
        source: 'planning-docs',
        references: ['/tmp/project/looma/docs/component-roadmap.md'],
        confidence: 'high',
      },
      {
        suggestedId: 'task-2',
        title: 'Combobox',
        description: 'Build Combobox.',
        domain: 'looma',
        priority: 'low',
        source: 'planning-docs',
        references: ['/tmp/project/looma/docs/component-roadmap.md'],
        confidence: 'low',
      },
      {
        suggestedId: 'task-3',
        title: 'Auth callback redirect',
        description: 'Fix redirect.',
        domain: 'knit',
        priority: 'normal',
        source: 'planning-docs',
        references: ['/tmp/project/knit/docs/feature-roadmap.md'],
        confidence: 'medium',
      },
      {
        suggestedId: 'task-4',
        title: 'Collections parity',
        description: 'Close parity gap.',
        domain: 'knit',
        priority: 'high',
        source: 'planning-docs',
        references: ['/tmp/project/knit/docs/feature-roadmap.md'],
        confidence: 'high',
      },
    ],
  }
}

beforeEach(async () => {
  previousHome = process.env.HOME
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-learning-'))
  process.env.HOME = tmpDir
  await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('learning loop for workspace import', () => {
  it('records project preferences and reuses them on later drafts', async () => {
    await recordWorkspaceImportApproval({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
      selectedAreaKeys: ['looma'],
      selectedSourceKeys: ['component-roadmap'],
      selectedTaskIds: ['task-1'],
    })

    const snapshot = buildLearningSnapshot({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
    })

    expect(snapshot.project.workspaceImport.preferredAreaKeys).toEqual(['looma'])
    expect(snapshot.project.workspaceImport.preferredSourceKeys).toEqual(['component-roadmap'])
    expect(snapshot.effective.defaults.selectedAreaKeys).toEqual(['looma'])
    expect(snapshot.effective.defaults.selectedSourceKeys).toEqual(['component-roadmap'])
    expect(snapshot.effective.defaults.note).toContain('approved last time')
  })

  it('switches to tighter task defaults when the user repeatedly trims broad imports', async () => {
    await recordWorkspaceImportApproval({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
      selectedAreaKeys: ['looma', 'knit'],
      selectedSourceKeys: ['component-roadmap', 'feature-roadmap'],
      selectedTaskIds: ['task-1'],
    })
    await recordWorkspaceImportApproval({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
      selectedAreaKeys: ['looma', 'knit'],
      selectedSourceKeys: ['component-roadmap', 'feature-roadmap'],
      selectedTaskIds: ['task-1'],
    })

    const snapshot = buildLearningSnapshot({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
    })

    expect(snapshot.project.workspaceImport.taskSelectionMode).toBe('tight')
    expect(snapshot.effective.defaults.selectedTaskIds).toEqual(['task-1', 'task-4'])
    expect(snapshot.effective.coordinatorSuggestions[0]?.id).toBe('workspace-import-clarity-check')
    expect(snapshot.effective.productSuggestions[0]?.id).toBe('workspace-import-tighten-defaults')
  })

  it('tracks dismissals in both project and user learning', async () => {
    await recordWorkspaceImportDismissal(path.join(tmpDir, 'memory'))

    const projectRaw = JSON.parse(await fs.readFile(projectLearningPath(path.join(tmpDir, 'memory')), 'utf8')) as {
      workspaceImport: { dismissedRuns: number }
    }
    const userRaw = JSON.parse(await fs.readFile(globalLearningPath(), 'utf8')) as {
      workspaceImport: { dismissedRuns: number }
    }

    expect(projectRaw.workspaceImport.dismissedRuns).toBe(1)
    expect(userRaw.workspaceImport.dismissedRuns).toBe(1)
  })

  it('supports resetting project and global learning', async () => {
    await recordWorkspaceImportApproval({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
      selectedAreaKeys: ['looma'],
      selectedSourceKeys: ['component-roadmap'],
      selectedTaskIds: ['task-1'],
    })

    await resetProjectLearning(path.join(tmpDir, 'memory'))
    await resetGlobalLearning()

    expect(readProjectLearning(path.join(tmpDir, 'memory')).workspaceImport.approvedRuns).toBe(0)
    expect(readGlobalLearning().workspaceImport.approvedRuns).toBe(0)

    const snapshot = buildLearningSnapshot({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
    })
    expect(snapshot.effective.defaults.selectedAreaKeys).toEqual(['looma', 'knit'])
  })
})

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-001',
    title: 'Fix invite flow',
    description: 'Repair invite flow.',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'done',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-18T20:00:00.000Z',
    updatedAt: '2026-05-18T20:10:00.000Z',
    ...overrides,
  }
}

function candidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: 'learn-project-paths',
    source: 'task',
    summary: 'For this project, invite work usually touches web/server/api/workspaces/[id]/invite.post.ts.',
    evidence: [
      {
        kind: 'task',
        summary: 'Task completed after editing web/server/api/workspaces/[id]/invite.post.ts.',
        ref: 'task-001',
      },
    ],
    proposedScope: 'project',
    proposedDestination: 'project_memory',
    confidence: 'medium',
    risk: 'low',
    requiresApproval: true,
    ...overrides,
  }
}

describe('reflection learning candidates', () => {
  it('detects reflection triggers for done, blocked, playbook, correction, and model-lane outcomes', () => {
    const triggers = collectReflectionTriggers(mkTask({
      status: 'blocked',
      notes: [
        {
          agentId: 'coordinator',
          role: 'recovery-playbook',
          content: JSON.stringify({ status: 'succeeded', playbook: 'repair_touched_file_failure' }),
          timestamp: '2026-05-18T20:04:00.000Z',
        },
        {
          agentId: 'user',
          role: 'user-correction',
          content: 'Prefer shorter public-doc summaries.',
          timestamp: '2026-05-18T20:05:00.000Z',
        },
      ],
      reviewVerdicts: [
        {
          verdict: 'revise',
          reviewerPath: 'llm',
          reason: 'Model lane failed before review.',
          llmError: 'provider timeout',
          failingSignals: [],
          recordedAt: '2026-05-18T20:06:00.000Z',
        },
      ],
    }))

    expect(triggers.map(trigger => trigger.source)).toEqual([
      'blocked',
      'playbook_success',
      'user_correction',
      'model_lane_failure',
    ])

    const doneTriggers = collectReflectionTriggers(mkTask({ status: 'done' }))
    expect(doneTriggers.map(trigger => trigger.source)).toEqual(['done'])
  })

  it('persists project-only path facts as project suggested learnings, not global preferences', async () => {
    await persistLearningCandidates({
      memoryDir: path.join(tmpDir, 'memory'),
      candidates: [
        candidate({
          id: 'project-invite-path',
          proposedScope: 'project',
          proposedDestination: 'project_memory',
          summary: 'This project keeps invite API work under web/server/api/workspaces.',
        }),
      ],
    })

    const project = readProjectLearning(path.join(tmpDir, 'memory'))
    const global = readGlobalLearning()
    expect(project.suggestedLearnings.map(item => item.id)).toEqual(['project-invite-path'])
    expect(project.suggestedLearnings[0]).toMatchObject({
      destination: 'project_memory',
      status: 'suggested',
      scope: 'project',
    })
    expect(global.suggestedLearnings).toEqual([])
  })

  it('records task reflection candidates after completed playbook-backed work', async () => {
    await recordTaskReflection({
      memoryDir: path.join(tmpDir, 'memory'),
      task: mkTask({
        status: 'done',
        notes: [
          {
            agentId: 'coordinator',
            role: 'recovery-playbook',
            content: JSON.stringify({
              status: 'succeeded',
              playbook: 'repair_touched_file_failure',
              summary: 'Focused repair succeeded after rerunning the invite typecheck.',
              allowedPaths: ['web/server/api/workspaces/[id]/invite.post.ts'],
            }),
            timestamp: '2026-05-18T20:04:00.000Z',
          },
        ],
      }),
    })

    const project = readProjectLearning(path.join(tmpDir, 'memory'))
    expect(project.suggestedLearnings[0]).toMatchObject({
      source: 'task',
      destination: 'project_memory',
      scope: 'project',
      status: 'suggested',
    })
    expect(project.suggestedLearnings[0]?.summary).toContain('Focused repair succeeded')
  })

  it('turns repeated user style corrections into a suggested global preference', async () => {
    await recordUserCorrection({
      memoryDir: path.join(tmpDir, 'memory'),
      correction: 'Please keep public docs concise and skip implementation trivia.',
      category: 'public_docs_style',
    })
    expect(readGlobalLearning().suggestedLearnings).toEqual([])

    await recordUserCorrection({
      memoryDir: path.join(tmpDir, 'memory'),
      correction: 'Again, keep public docs concise and skip implementation trivia.',
      category: 'public_docs_style',
    })

    const global = readGlobalLearning()
    expect(global.suggestedLearnings).toHaveLength(1)
    expect(global.suggestedLearnings[0]).toMatchObject({
      destination: 'user_preference',
      scope: 'user_global',
      status: 'suggested',
      confidence: 'medium',
    })
    expect(global.suggestedLearnings[0]?.summary).toContain('public docs')
  })

  it('persists structured global preferences with a dynamic subject taxonomy', async () => {
    await persistLearningCandidates({
      memoryDir: path.join(tmpDir, 'memory'),
      candidates: [
        candidate({
          id: 'global-game-engine-preference',
          source: 'user_correction',
          proposedScope: 'user_global',
          proposedDestination: 'user_preference',
          summary: 'Prefer lightweight game engines and avoid heavyweight editor-first engines.',
          preference: {
            kind: 'preference',
            subject: {
              domain: 'game-development',
              area: 'engine',
              item: 'runtime',
            },
            position: {
              prefer: [
                { item: 'Godot', strength: 'strong' },
                { item: 'Bevy', strength: 'medium' },
              ],
              avoid: [
                {
                  item: 'Unity',
                  strength: 'strong',
                  exceptions: ['existing Unity project', 'user explicitly asks for Unity'],
                },
                { item: 'Unreal Blueprints', strength: 'medium' },
              ],
              ranking: 'ordered',
            },
          },
        }),
      ],
    })

    const global = readGlobalLearning()
    expect(global.suggestedLearnings[0]?.preference).toEqual({
      kind: 'preference',
      subject: {
        domain: 'game-development',
        area: 'engine',
        item: 'runtime',
      },
      position: {
        prefer: [
          { item: 'Godot', strength: 'strong' },
          { item: 'Bevy', strength: 'medium' },
        ],
        avoid: [
          {
            item: 'Unity',
            strength: 'strong',
            exceptions: ['existing Unity project', 'user explicitly asks for Unity'],
          },
          { item: 'Unreal Blueprints', strength: 'medium' },
        ],
        ranking: 'ordered',
      },
    })
    expect(global.suggestedLearnings[0]).toMatchObject({
      destination: 'user_preference',
      scope: 'user_global',
      status: 'suggested',
      requiresApproval: true,
    })
  })

  it('records a structured user preference without activating it automatically', async () => {
    await recordStructuredUserPreference({
      memoryDir: path.join(tmpDir, 'memory'),
      id: 'prefer-pnpm-over-npm',
      summary: 'Prefer pnpm over npm when choosing a JavaScript package manager.',
      evidenceSummary: 'The user said they prefer PNPM over NPM.',
      subject: {
        domain: 'software',
        area: 'dependency-management',
        item: 'package-manager',
      },
      prefer: [{ item: 'pnpm', strength: 'strong' }],
      avoid: [{ item: 'npm', strength: 'medium' }],
      confidence: 'high',
    })

    const global = readGlobalLearning()
    expect(global.suggestedLearnings[0]).toMatchObject({
      id: 'prefer-pnpm-over-npm',
      status: 'suggested',
      scope: 'user_global',
      destination: 'user_preference',
      requiresApproval: true,
      preference: {
        kind: 'preference',
        subject: {
          domain: 'software',
          area: 'dependency-management',
          item: 'package-manager',
        },
        position: {
          prefer: [{ item: 'pnpm', strength: 'strong' }],
          avoid: [{ item: 'npm', strength: 'medium' }],
        },
      },
    })
  })

  it('keeps product suggestions inert until a human accepts them', async () => {
    const before = buildLearningSnapshot({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
    }).effective.defaults

    await persistLearningCandidates({
      memoryDir: path.join(tmpDir, 'memory'),
      candidates: [
        candidate({
          id: 'product-recovery-loop',
          proposedScope: 'guildhall_product',
          proposedDestination: 'product_suggestion',
          summary: 'Guildhall should make recovery playbook failures more visible.',
          requiresApproval: true,
        }),
      ],
    })

    const afterSnapshot = buildLearningSnapshot({
      memoryDir: path.join(tmpDir, 'memory'),
      review: sampleReview(),
      draft: sampleDraft(),
    })
    expect(afterSnapshot.effective.defaults).toEqual(before)
    expect(afterSnapshot.project.suggestedLearnings[0]).toMatchObject({
      id: 'product-recovery-loop',
      destination: 'product_suggestion',
      status: 'suggested',
      requiresApproval: true,
    })
  })

  it('supports dismissing and resetting suggested learnings', async () => {
    await persistLearningCandidates({
      memoryDir: path.join(tmpDir, 'memory'),
      candidates: [candidate({ id: 'project-invite-path' })],
    })

    await dismissSuggestedLearning({
      memoryDir: path.join(tmpDir, 'memory'),
      id: 'project-invite-path',
      scope: 'project',
    })

    expect(readProjectLearning(path.join(tmpDir, 'memory')).suggestedLearnings[0]?.status)
      .toBe('dismissed')

    await resetSuggestedLearnings({
      memoryDir: path.join(tmpDir, 'memory'),
      scope: 'project',
    })

    expect(readProjectLearning(path.join(tmpDir, 'memory')).suggestedLearnings).toEqual([])
  })

  it('forgets global correction counts when resetting user-global suggestions', async () => {
    const memoryDir = path.join(tmpDir, 'memory')
    await recordUserCorrection({
      memoryDir,
      correction: 'Keep public docs direct.',
      category: 'public_docs_style',
    })
    await recordUserCorrection({
      memoryDir,
      correction: 'Again, keep public docs direct.',
      category: 'public_docs_style',
    })
    expect(readGlobalLearning().suggestedLearnings).toHaveLength(1)
    expect(readGlobalLearning().userCorrectionCounts.public_docs_style).toBe(2)

    await resetSuggestedLearnings({
      memoryDir,
      scope: 'user_global',
    })
    expect(readGlobalLearning().suggestedLearnings).toEqual([])
    expect(readGlobalLearning().userCorrectionCounts).toEqual({})

    await recordUserCorrection({
      memoryDir,
      correction: 'Keep public docs direct.',
      category: 'public_docs_style',
    })
    expect(readGlobalLearning().suggestedLearnings).toEqual([])
    expect(readGlobalLearning().userCorrectionCounts.public_docs_style).toBe(1)
  })

  it('resolves a global suggestion when making it project-wide', async () => {
    const memoryDir = path.join(tmpDir, 'memory')
    await persistLearningCandidates({
      memoryDir,
      candidates: [
        candidate({
          id: 'global-compact-controls',
          proposedScope: 'user_global',
          proposedDestination: 'user_preference',
          summary: 'Prefer compact controls.',
          requiresApproval: true,
        }),
      ],
    })

    await makeSuggestedLearningProjectWide({ memoryDir, id: 'global-compact-controls' })

    expect(readProjectLearning(memoryDir).suggestedLearnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'project-global-compact-controls',
          scope: 'project',
          status: 'active',
        }),
      ]),
    )
    expect(readGlobalLearning().suggestedLearnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'global-compact-controls',
          status: 'dismissed',
        }),
      ]),
    )
  })
})
