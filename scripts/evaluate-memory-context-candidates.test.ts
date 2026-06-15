import { describe, expect, it } from 'vitest'

import {
  analyzeTaskQueue,
  buildBaselineContextPacket,
  candidateProfiles,
  evaluateCandidate,
} from './evaluate-memory-context-candidates.mjs'

describe('memory/context evaluation harness', () => {
  it('detects FLL-shaped task bloat by field and task', () => {
    const queue = {
      version: 1,
      tasks: [
        {
          id: 'task-auth-complete',
          title: 'Complete auth flow',
          status: 'done',
          notes: Array.from({ length: 30 }, (_, index) => ({
            timestamp: `2026-05-24T00:${String(index).padStart(2, '0')}:00.000Z`,
            content: `note ${index} ${'x'.repeat(200)}`,
          })),
          reviewVerdicts: Array.from({ length: 70 }, (_, index) => ({
            recordedAt: `2026-05-24T01:${String(index % 60).padStart(2, '0')}:00.000Z`,
            verdict: index === 69 ? 'approve' : 'revise',
            reason: `review ${index} ${'y'.repeat(120)}`,
          })),
          escalations: [{
            id: 'esc-1',
            raisedAt: '2026-05-24T00:00:00.000Z',
            summary: 'blocked until auth provider configured',
          }],
        },
      ],
    }

    const analysis = analyzeTaskQueue(queue)

    expect(analysis.taskCount).toBe(1)
    expect(analysis.forbiddenFieldCounts.notes).toBe(1)
    expect(analysis.forbiddenFieldCounts.reviewVerdicts).toBe(1)
    expect(analysis.topFieldBytes[0]?.field).toBe('reviewVerdicts')
    expect(analysis.largestTasks[0]).toMatchObject({
      id: 'task-auth-complete',
      title: 'Complete auth flow',
    })
  })

  it('builds a compact context packet with provenance instead of raw history', () => {
    const fixture = {
      id: 'fair-labor-license',
      label: 'Fair Labor License task-state bloat',
      projectRoot: '/tmp/fair-labor-license',
      files: [{
        relativePath: '.guildhall/TASKS.json',
        bytes: 600_000,
        analysis: {
          kind: 'task-queue',
          taskCount: 17,
          forbiddenFieldCounts: { notes: 9, reviewVerdicts: 6 },
          topFieldBytes: [
            { field: 'notes', bytes: 214_747 },
            { field: 'reviewVerdicts', bytes: 120_085 },
          ],
          largestTasks: [
            { id: 'task-006', title: 'Set FLL overhead charge policy', bytes: 198_175 },
          ],
        },
      }],
    }

    const packet = buildBaselineContextPacket(fixture, 'What should enter the next worker context?')

    expect(packet.bytes).toBeLessThan(2500)
    expect(packet.sections.join('\n')).toContain('Fair Labor License task-state bloat')
    expect(packet.sections.join('\n')).toContain('notes')
    expect(packet.provenance).toEqual([
      {
        projectRoot: '/tmp/fair-labor-license',
        path: '.guildhall/TASKS.json',
        reason: 'fixture-summary',
      },
    ])
  })

  it('scores every candidate on the full rubric', () => {
    const expectedDimensions = [
      'contextAssembly',
      'compactionQuality',
      'temporalCorrectness',
      'provenance',
      'configurability',
      'localFirstFit',
      'repoLocalThinness',
      'integrationSurface',
      'costLatency',
      'failureBehavior',
    ]

    for (const candidate of candidateProfiles) {
      const result = evaluateCandidate(candidate)
      expect(Object.keys(result.scores)).toEqual(expectedDimensions)
      expect(result.total).toBeGreaterThan(0)
      expect(result.maxTotal).toBe(50)
      expect(result.average).toBeGreaterThan(0)
    }
  })
})
