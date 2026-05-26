import { describe, expect, it } from 'vitest'

import {
  buildDoneTaskSummaryBundle,
  recordDoneTaskSummaryBundle,
} from '../done-task-summary.js'

describe('done task summary bundle', () => {
  it('reduces a completed task into journey, decision, evidence, learning, and residue summaries', () => {
    const bundle = buildDoneTaskSummaryBundle({
      task: {
        id: 'task-link-editor',
        title: 'Add link editor controls',
        description: 'Add URL and display text controls to the selected text toolbar.',
        status: 'done',
        domain: 'frontend',
        projectPath: '/repo/product',
        priority: 'normal',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'URL and display text controls are available.',
            verifiedBy: 'review',
            met: true,
          },
        ],
        outOfScope: [],
        dependsOn: [],
        notes: [
          {
            agentId: 'worker-agent',
            role: 'worker',
            content: 'Implemented Toolbar.svelte and verified the editor path.',
            timestamp: '2026-05-25T12:20:00.000Z',
          },
        ],
        gateResults: [
          {
            gateId: 'typecheck',
            type: 'hard',
            passed: true,
            checkedAt: '2026-05-25T12:30:00.000Z',
          },
        ],
        reviewVerdicts: [
          {
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'UX reviewer approved the control placement.',
            recordedAt: '2026-05-25T12:28:00.000Z',
            failingSignals: [],
          },
        ],
        adjudications: [],
        escalations: [],
        agentIssues: [],
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: '2026-05-25T12:00:00.000Z',
        updatedAt: '2026-05-25T12:35:00.000Z',
        completedAt: '2026-05-25T12:35:00.000Z',
      },
      changedFiles: ['src/web/surfaces/editor/Toolbar.svelte'],
      transcriptRef: {
        scope: 'local_history',
        collection: 'transcripts',
        id: 'task-link-editor',
        path: '/history/transcripts/exploring/task-link-editor.md',
        contentType: 'text/markdown',
      },
      createdAt: '2026-05-25T12:36:00.000Z',
      createdBy: 'coordinator-agent',
    })

    expect(bundle).toMatchObject({
      taskId: 'task-link-editor',
      status: 'done',
      summary: {
        journey: expect.stringContaining('worker-agent'),
        decision: expect.stringContaining('Task finished as done'),
        evidence: expect.stringContaining('typecheck'),
        openResidue: 'No open residue recorded.',
      },
      retention: {
        transcriptPrimaryArtifact: false,
        compactedFullTranscript: false,
        fullEvidenceAvailable: true,
      },
    })
    expect(bundle.evidenceRefs).toHaveLength(1)
  })

  it('records the done summary through persistence with compaction metadata', async () => {
    const writes: unknown[] = []
    const bundle = buildDoneTaskSummaryBundle({
      task: {
        id: 'task-1',
        title: 'Ship the thing',
        description: 'Done.',
        status: 'done',
        domain: 'web',
        projectPath: '/repo/product',
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
        createdAt: '2026-05-25T12:00:00.000Z',
        updatedAt: '2026-05-25T12:10:00.000Z',
        completedAt: '2026-05-25T12:10:00.000Z',
      },
      transcriptRef: {
        scope: 'local_history',
        collection: 'transcripts',
        id: 'task-1',
        path: '/history/transcripts/exploring/task-1.md',
      },
      createdAt: '2026-05-25T12:11:00.000Z',
      createdBy: 'coordinator-agent',
    })

    await recordDoneTaskSummaryBundle({
      projectRoot: '/repo/product',
      bundle,
      persistence: {
        async writeRecord(input) {
          writes.push(input)
          return { payload: input.payload, ref: { path: '/x' } } as never
        },
      },
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      projectRoot: '/repo/product',
      collection: 'done-task-summaries',
      id: 'task-1',
      schemaName: 'done-task-summary-bundle',
      schemaVersion: 1,
      createdBy: 'coordinator-agent',
      compactedFrom: [bundle.evidenceRefs[0]],
      placement: {
        scope: 'shared_project',
        retention: 'archive',
        visibility: 'user_visible',
        commitPolicy: 'committed',
      },
    })
  })
})
