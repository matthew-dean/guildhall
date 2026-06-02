import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyRunAutomationPolicy } from '../run-automation.js'

const VALID_SPEC = [
  '## Summary',
  '',
  'Implement the requested change.',
  '',
  '## Completion Boundary',
  '- Product outcome: The requested change works for the target user.',
  '- What Guildhall can complete in code: Update the relevant source and test files.',
  '- External dependencies: None.',
  '- Owner-only setup: None.',
  '- Verification environment: Local test environment.',
  '- What counts as done: The acceptance criterion is met and the task can be reviewed locally.',
  '- What must be split or blocked: Nothing.',
  '',
  '## Acceptance Criteria',
  '1. Thing is done.',
].join('\n')

describe('run automation policy', () => {
  it('fully automated runs approve scoped specs in runtime policy', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-automation-'))
    await fs.mkdir(path.join(memoryDir, 'transcripts', 'exploring'), { recursive: true })
    await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-root',
          status: 'exploring',
        }),
        task({
          id: 'task-child',
          status: 'spec_review',
          spec: VALID_SPEC,
          productBrief: {
            userJob: 'Use the finished change.',
            successMetric: 'The requested behavior is visible locally.',
            antiPatterns: [],
          },
          hierarchy: { parentId: 'task-root', childIds: [], order: 0 },
        }),
      ],
    }, null, 2), 'utf8')

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-root',
      ownerIntent: 'Create a tiny local app.',
    })

    expect(result.changed).toBe(true)
    expect(result.resolutions.map(resolution => resolution.kind)).toEqual([
      'approve_spec',
    ])
    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'))
    expect(queue.tasks.find((candidate: { id: string }) => candidate.id === 'task-child').status).toBe('ready')
  })

  it('fully automated runs repair an obvious product brief gap before approving a tiny deterministic task', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-automation-'))
    await fs.mkdir(path.join(memoryDir, 'transcripts', 'exploring'), { recursive: true })
    await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-smoke',
          status: 'spec_review',
          description: 'Create a file named guildhall_smoke.txt in the project root containing exactly GUILDHALL_SMOKE_OK.',
          spec: [
            '## Summary',
            '',
            'Create a single file `guildhall_smoke.txt` in the project root containing exactly `GUILDHALL_SMOKE_OK`.',
            '',
            '## Product Brief',
            '',
            '- **User job**: Verify the Guildhall pipeline can complete a deterministic marker-file task.',
            '- **Success metric**: `guildhall_smoke.txt` exists at the project root with exactly `GUILDHALL_SMOKE_OK`.',
            '- **Anti-patterns**: Do not create or modify any other files.',
            '- **Rollout plan**: None.',
            '',
            '## Completion Boundary',
            '- Product outcome: An automated check can read `guildhall_smoke.txt` and confirm the run completed.',
            '- What Guildhall can complete in code: Create the marker file with exact content.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local project root.',
            '- What counts as done: `guildhall_smoke.txt` exists with exactly `GUILDHALL_SMOKE_OK`.',
            '- What must be split or blocked: Nothing.',
            '',
            '## Acceptance Criteria',
            '1. File exists at the project root.',
            '2. File content is exactly `GUILDHALL_SMOKE_OK`.',
          ].join('\n'),
          acceptanceCriteria: [
            { id: 'AC-1', description: 'File exists at the project root.', verifiedBy: 'automated', met: false },
            { id: 'AC-2', description: 'File content is exactly GUILDHALL_SMOKE_OK.', verifiedBy: 'automated', met: false },
          ],
        }),
      ],
    }, null, 2), 'utf8')

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-smoke',
      ownerIntent: 'Create the marker file.',
    })

    expect(result.resolutions.map(resolution => resolution.kind)).toEqual([
      'repair_product_brief',
      'approve_spec',
    ])
    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'))
    const smoke = queue.tasks[0]
    expect(smoke.status).toBe('ready')
    expect(smoke.productBrief).toMatchObject({
      userJob: 'Verify the Guildhall pipeline can complete a deterministic marker-file task.',
      successMetric: '`guildhall_smoke.txt` exists at the project root with exactly `GUILDHALL_SMOKE_OK`.',
      authoredBy: 'run-automation',
    })
  })

  it('fully automated runs replace placeholder New request product briefs from the spec', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-automation-'))
    await fs.mkdir(path.join(memoryDir, 'transcripts', 'exploring'), { recursive: true })
    await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          id: 'task-pantry',
          title: 'Build Pantry Pulse web app',
          description: 'Build a dependency-free Pantry Pulse web app.',
          status: 'spec_review',
          spec: [
            '## Summary',
            'Build Pantry Pulse as a dependency-free single-page pantry tracker.',
            '',
            '## Product Brief',
            '- **User job**: Track pantry items and use expiring food first.',
            '- **Success metric**: The browser app shows seeded items, filters expiring items, and updates count when an item is marked used.',
            '',
            '## Completion Boundary',
            '- Product outcome: Someone can open index.html and manage pantry items locally.',
            '- What Guildhall can complete in code: Create the dependency-free index.html app.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local browser opened against index.html.',
            '- What counts as done: The app works locally and matches the acceptance criteria.',
            '- What must be split or blocked: Nothing.',
            '',
            '## Acceptance Criteria',
            '1. Pantry Pulse heading is visible.',
          ].join('\n'),
          productBrief: {
            userJob: 'I want to verify whether New request is already done and, if not, capture only the remaining delta.',
            successMetric: 'The remaining work for "New request" is described clearly enough to approve or narrow with one focused question.',
            antiPatterns: [],
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Pantry Pulse heading is visible.', verifiedBy: 'browser', met: false },
          ],
        }),
      ],
    }, null, 2), 'utf8')

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'fully_automated',
      rootTaskId: 'task-pantry',
      ownerIntent: 'Build the Pantry Pulse app.',
    })

    expect(result.resolutions.map(resolution => resolution.kind)).toEqual([
      'repair_product_brief',
      'record_design_lens_review',
      'approve_spec',
    ])
    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'))
    const pantry = queue.tasks[0]
    expect(pantry.status).toBe('ready')
    expect(pantry.productBrief).toMatchObject({
      userJob: 'Track pantry items and use expiring food first.',
      successMetric: 'The browser app shows seeded items, filters expiring items, and updates count when an item is marked used.',
      authoredBy: 'run-automation',
    })
  })

  it('supervised runs leave owner checkpoints untouched', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-run-automation-'))
    await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-29T10:00:00.000Z',
      tasks: [
        task({
          status: 'exploring',
          openQuestions: [{
            kind: 'text',
            id: 'q-1',
            askedBy: 'spec-agent',
            askedAt: '2026-05-29T10:00:00.000Z',
            prompt: 'What should this do?',
          }],
        }),
      ],
    }, null, 2), 'utf8')

    const result = await applyRunAutomationPolicy({
      memoryDir,
      policy: 'supervised',
      rootTaskId: 'task-root',
      ownerIntent: 'Create a tiny local app.',
    })

    expect(result.changed).toBe(false)
    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'))
    expect(queue.tasks[0].openQuestions[0].answeredAt).toBeUndefined()
  })
})

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-root',
    title: 'Run automation test',
    description: 'Test task.',
    domain: 'app',
    projectPath: '/tmp/project',
    status: 'exploring',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-29T10:00:00.000Z',
    updatedAt: '2026-05-29T10:00:00.000Z',
    ...overrides,
  }
}
