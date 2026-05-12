import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { WorkspaceImportDraft } from '../workspace-import/index.js'
import type { WorkspaceImportReview } from '../workspace-import/review.js'
import {
  buildLearningSnapshot,
  globalLearningPath,
  projectLearningPath,
  readGlobalLearning,
  readProjectLearning,
  recordWorkspaceImportApproval,
  recordWorkspaceImportDismissal,
  resetGlobalLearning,
  resetProjectLearning,
} from '../learning.js'

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
