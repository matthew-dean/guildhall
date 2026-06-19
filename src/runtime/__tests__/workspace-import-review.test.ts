import { describe, expect, it } from 'vitest'
import { buildWorkspaceImportReview, filterWorkspaceImportDraft } from '../workspace-import/review.js'
import type { WorkspaceImportDraft } from '../workspace-import/index.js'

const projectPath = '/tmp/looma-knit'

function sampleDraft(): WorkspaceImportDraft {
  return {
    goals: [],
    tasks: [
      {
        suggestedId: 'task-1',
        title: 'Listbox',
        description: 'Build the Listbox primitive.',
        domain: 'looma',
        scope: 'current',
        priority: 'high',
        source: 'planning-docs',
        references: [`${projectPath}/looma/docs/component-roadmap.md`],
        confidence: 'high',
      },
      {
        suggestedId: 'task-2',
        title: 'Combobox',
        description: 'Build the Combobox primitive.',
        domain: 'looma',
        scope: 'current',
        priority: 'high',
        source: 'planning-docs',
        references: [`${projectPath}/looma/docs/component-roadmap.md`],
        confidence: 'high',
      },
      {
        suggestedId: 'task-3',
        title: 'Auth callback redirect',
        description: 'Complete the redirect flow.',
        domain: 'knit',
        scope: 'later',
        priority: 'normal',
        source: 'planning-docs',
        references: [`${projectPath}/knit/PROJECT_STATE.md`],
        confidence: 'medium',
      },
    ],
    milestones: [
      {
        title: 'Ship first editor pass',
        evidence: 'done',
        source: 'planning-docs',
        references: [`${projectPath}/knit/PROJECT_STATE.md`],
      },
    ],
    context: [
      {
        label: 'Editor roadmap context',
        excerpt: 'Reference notes only',
        source: 'planning-docs',
        references: [`${projectPath}/knit/specs/v1-editor.md`],
        role: 'capability',
        structure: 'record',
      },
      {
        label: 'Stage 1: Current MVP',
        excerpt: 'Current milestone context.',
        source: 'planning-docs',
        references: [`${projectPath}/knit/docs/roadmap.md`],
        scopeHint: 'current',
      },
      {
        label: 'Author intent and voice are defined before drafting.',
        excerpt: 'Brief framing.',
        source: 'planning-docs',
        references: [`${projectPath}/knit/docs/brief.md`],
        role: 'brief_input',
        structure: 'note',
      },
    ],
    stats: {
      inputSignals: 5,
      drafted: 5,
      deduped: 5,
    },
  }
}

describe('buildWorkspaceImportReview', () => {
  it('groups sources into project parts and sorts the busiest parts first', () => {
    const review = buildWorkspaceImportReview(sampleDraft(), [], projectPath)

    expect(review.areaGroups.map(area => area.label)).toEqual(['Looma', 'Knit'])
    expect(review.areaGroups[0]).toMatchObject({
      label: 'Looma',
      taskCount: 2,
      sourceCount: 1,
    })
    expect(review.areaGroups[1]).toMatchObject({
      label: 'Knit',
      taskCount: 1,
      sourceCount: 4,
    })

    expect(review.sourceGroups[0]).toMatchObject({
      label: 'Component Roadmap',
      areaLabel: 'Looma',
      taskCount: 2,
    })
    expect(review.sourceGroups[1]).toMatchObject({
      label: 'Knit project state',
      areaLabel: 'Knit',
      taskCount: 1,
      milestoneCount: 1,
    })
    expect(review.summary).toMatchObject({
      currentMilestoneLabel: 'Stage 1: Current MVP',
      briefInputCount: 1,
      briefRecordCount: 0,
      capabilityCount: 1,
      capabilityRecordCount: 1,
    })
    expect(review.summary.headline).toContain('Stage 1: Current MVP')
    expect(review.summary.currentScope).toContain('2 tasks')
    expect(review.summary.deferredScope).toContain('1 later/deferred task')
    expect(review.summary.structuralScope).toContain('0 brief records')
    expect(review.summary.structuralScope).toContain('1 capability record')
  })
})

describe('filterWorkspaceImportDraft', () => {
  it('keeps only selected tasks and sources', () => {
    const filtered = filterWorkspaceImportDraft(sampleDraft(), {
      sourceKeys: [`${projectPath}/looma/docs/component-roadmap.md`],
      taskIds: ['task-2'],
    })

    expect(filtered.tasks.map(task => task.suggestedId)).toEqual(['task-2'])
    expect(filtered.milestones).toHaveLength(0)
    expect(filtered.context).toHaveLength(0)
  })
})
