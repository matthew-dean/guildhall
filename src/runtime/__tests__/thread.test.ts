import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildThread } from '../thread.js'
import { emptyWizardsState, type ProjectSnapshot } from '../wizards.js'

describe('buildThread', () => {
  it('surfaces active task work once setup is already complete', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Import workspace',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              message: 'Refining the import draft.',
            },
          },
        ],
      })

      expect(thread.activeTurnId).toBe('inflight:task-1')
      expect(thread.turns.some(t => t.kind === 'setup_step' && t.status === 'active')).toBe(false)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('advances past bootstrap setup when runtime bootstrap truth is already green', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: {},
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('setup:direction')
      const bootstrapStep = thread.turns.find(turn => turn.id === 'setup:bootstrap')
      if (!bootstrapStep || bootstrapStep.kind !== 'setup_step') throw new Error('expected bootstrap setup step')
      expect(bootstrapStep.status).toBe('done')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps project direction active ahead of a large imported-draft queue and collapses the queue to one turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-import-a',
              title: 'Version diff view (deferred)',
              status: 'import_draft',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
            {
              id: 'task-import-b',
              title: 'Shared component audit',
              status: 'import_draft',
              createdAt: new Date(Date.now() - 590_000).toISOString(),
              updatedAt: new Date(Date.now() - 290_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('setup:direction')
      const draftTurns = thread.turns.filter(
        (turn) => turn.kind === 'inflight' && turn.importedDraft,
      )
      expect(draftTurns).toHaveLength(1)
      const draftTurn = draftTurns[0]
      if (!draftTurn || draftTurn.kind !== 'inflight') throw new Error('expected draft inflight turn')
      expect(draftTurn.taskId).toBe('task-import-a')
      expect(draftTurn.status).toBe('pending')
      expect(draftTurn.summary).toMatch(/1 more drafts are queued behind it/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps a workspace-import question active ahead of later queued work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const earlier = new Date(Date.now() - 600_000).toISOString()
      const later = new Date(Date.now() - 60_000).toISOString()
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              status: 'spec_review',
              domain: '_workspace_import',
              createdAt: earlier,
              updatedAt: earlier,
              openQuestions: [
                {
                  id: 'q-workspace-import',
                  askedBy: 'spec-agent',
                  askedAt: earlier,
                  kind: 'choice',
                  prompt: 'Should auth be treated as partially done or not done?',
                  selectionMode: 'single',
                  choices: ['Partially done', 'Not done'],
                },
              ],
            },
            {
              id: 'task-003',
              title: 'Draft a first starter task',
              status: 'ready',
              createdAt: earlier,
              updatedAt: later,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('q:task-workspace-import:q-workspace-import')
      const workspaceQuestion = thread.turns.find((turn) => turn.id === 'q:task-workspace-import:q-workspace-import')
      if (!workspaceQuestion || workspaceQuestion.kind !== 'agent_question') throw new Error('expected workspace import question')
      expect(workspaceQuestion.status).toBe('active')
      expect(thread.turns.some((turn) => turn.id === 'spec:task-workspace-import')).toBe(false)
      const queuedTask = thread.turns.find((turn) => turn.id === 'inflight:task-003')
      if (!queuedTask || queuedTask.kind !== 'inflight') throw new Error('expected queued task turn')
      expect(queuedTask.status).toBe('pending')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('drafts project direction as editable brief copy instead of inference narration', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Fair Labor License Platform',
          '',
          'Modern licensing platform for open-source maintainers.',
        ].join('\n'),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.currentValue).toBe('Modern licensing platform for open-source maintainers.')
      expect(directionStep.currentValue).not.toMatch(/from the readme|guildhall should treat/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('replaces legacy generated project-direction boilerplate with the cleaner inferred brief', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Fair Labor License Platform',
          '',
          'Modern licensing platform for open-source maintainers.',
        ].join('\n'),
      )
      await writeFile(
        path.join(projectPath, 'memory', 'project-brief.md'),
        'Fair Labor License Platform is this project. From the README, the project appears to be about modern licensing platform for open-source maintainers. Guildhall should treat the main goal as helping maintainers understand, adopt, publish, and operate the Fair Labor License cleanly.',
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.currentValue).toBe('Modern licensing platform for open-source maintainers.')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('folds a lead-in line plus bullets into one readable inferred brief sentence', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Fair Labor License Platform',
          '',
          'Modern licensing platform for:',
          '- **Primary**: OSS projects using Fair Labor License (FLL) v1.2',
          '- **Also**: Independent developers and small software companies needing basic licensing',
        ].join('\n'),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.currentValue).toBe(
        'Modern licensing platform for OSS projects using Fair Labor License (FLL) v1.2; Independent developers and small software companies needing basic licensing.',
      )
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps provider setup active ahead of meta-intake when setup is still blocked', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          coordinators: [],
        },
        hasProvider: false,
        hasDirection: false,
        workspaceImportReviewed: false,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('setup:provider')
      const metaTurn = thread.turns.find(
        (turn) => turn.kind === 'inflight' && turn.taskId === 'task-meta-intake',
      )
      if (!metaTurn || metaTurn.kind !== 'inflight') throw new Error('expected meta-intake inflight turn')
      expect(metaTurn.status).toBe('pending')
      expect(metaTurn.phase).toBe('setup')
      expect(metaTurn.summary).toMatch(/provider configuration/i)
      expect(metaTurn.checklist).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('collapses duplicate unanswered questions with the same prompt into one visible card', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Starter task',
              status: 'spec_review',
              createdAt: new Date(Date.now() - 60_000).toISOString(),
              updatedAt: new Date(Date.now() - 10_000).toISOString(),
              openQuestions: [
                {
                  kind: 'choice',
                  id: 'q-1',
                  askedBy: 'spec-agent',
                  askedAt: new Date(Date.now() - 20_000).toISOString(),
                  prompt: 'Pick one',
                  choices: ['A', 'B'],
                  selectionMode: 'single',
                },
                {
                  kind: 'choice',
                  id: 'q-2',
                  askedBy: 'spec-agent',
                  askedAt: new Date(Date.now() - 10_000).toISOString(),
                  prompt: 'Pick one',
                  choices: ['A', 'B'],
                  selectionMode: 'single',
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const questionTurns = thread.turns.filter((turn) => turn.kind === 'agent_question')
      expect(questionTurns).toHaveLength(1)
      const questionTurn = questionTurns[0]
      if (!questionTurn || questionTurn.kind !== 'agent_question') throw new Error('expected question turn')
      expect(questionTurn.question.prompt).toBe('Pick one')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps an unanswered agent question active and demotes spec review until the question is answered', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              status: 'spec_review',
              spec: 'draft spec',
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Guildhall inferred the repo structure. Confirm?',
                  selectionMode: 'multiple',
                  choices: ['Frontend', 'Backend'],
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('q:task-meta-intake:q-1')
      const questionTurn = thread.turns.find(turn => turn.id === 'q:task-meta-intake:q-1')
      const specTurn = thread.turns.find(turn => turn.id === 'spec:task-meta-intake')
      expect(questionTurn?.status).toBe('active')
      expect(specTurn).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats an exploring task with a concrete spec draft and approved brief as queued spec revision work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-003',
              title: 'Draft a first starter task for Fair Labor License onboard...',
              status: 'exploring',
              spec: '## Summary\n\nWire up the existing auth page scaffolding to real Supabase authentication.\n\n## Acceptance Criteria\n\n1. Works.',
              acceptanceCriteria: [
                { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
              ],
              productBrief: {
                userJob: 'New users can sign up and sign in.',
                successMetric: 'A new user reaches the dashboard.',
                approvedAt: now,
              },
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Pick one',
                  choices: ['A', 'B'],
                  selectionMode: 'single',
                  answeredAt: now,
                  answer: 'A',
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('inflight:task-003')
      const inflight = thread.turns.find((turn) => turn.id === 'inflight:task-003')
      if (!inflight || inflight.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(inflight.phase).toBe('spec')
      expect(inflight.checklist).toBeUndefined()
      expect(inflight.taskTitle).toMatch(/^Starter task spec: Wire up the existing auth page scaffolding/)
      expect(inflight.summary).toMatch(/latest answers and a spec draft/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('ignores obsolete meta-intake routing questions when a valid routing draft already exists', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              status: 'spec_review',
              spec: `\`\`\`yaml
coordinators:
  - id: frontend
    domain: frontend
    mandate: Draft UI routing
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\``,
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Pick the project areas (review lanes) you want coordinators for.',
                  selectionMode: 'multiple',
                  choices: ['Frontend'],
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('spec:task-meta-intake')
      expect(thread.turns.find(turn => turn.id === 'q:task-meta-intake:q-1')).toBeUndefined()
      const specTurn = thread.turns.find(turn => turn.id === 'spec:task-meta-intake')
      expect(specTurn?.status).toBe('active')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('ignores a stale starter-task focus question once a concrete spec draft already exists', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const askedAt = '2026-05-11T20:24:31.428Z'
      const updatedAt = '2026-05-11T20:24:50.064Z'
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-003',
              title: 'Draft a first starter task',
              status: 'spec_review',
              spec: '## Summary\n\nDraft spec.\n\n## Acceptance Criteria\n\n1. Given...\n\n## Out of Scope\n\n- Nothing\n\n## Open Questions\n\n- None',
              acceptanceCriteria: [
                {
                  id: 'ac-1',
                  description: 'Given a user lands on /register, when they submit, then auth works.',
                  verifiedBy: 'review',
                  met: false,
                },
              ],
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt,
                  prompt: 'What should this first starter task focus on?',
                  selectionMode: 'single',
                  choices: ['Onboarding', 'Bootstrap'],
                },
              ],
              createdAt: askedAt,
              updatedAt,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: updatedAt },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('spec:task-003')
      expect(thread.turns.find(turn => turn.id === 'q:task-003:q-1')).toBeUndefined()
      const specTurn = thread.turns.find(turn => turn.id === 'spec:task-003')
      expect(specTurn?.status).toBe('active')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects last live-agent activity and stalled state onto in-flight turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Build the thing',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 180_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 240_000).toISOString(),
            event: {
              type: 'agent_started',
              task_id: 'task-1',
              agent_name: 'worker-agent',
            },
          },
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventAt).toBe(lastEventAt)
      expect(turn.liveAgent?.lastEventLabel).toBe('Finished file read')
      expect(turn.liveAgent?.stalled).toBe(true)
      expect(turn.liveAgent?.silentMs).toBeGreaterThanOrEqual(180_000)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('reconstructs a live in-flight agent from activity after the start event ages out', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 1_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.summary).toBe('Worker is working on this now.')
      expect(turn.liveAgent?.name).toBe('worker-agent')
      expect(turn.liveAgent?.lastEventAt).toBe(lastEventAt)
      expect(turn.liveAgent?.lastEventLabel).toBe('Finished file read')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not project stale task activity as live work once the coordinator is stopped', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Shape imported draft',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [{ role: 'shaping-request', content: 'shape this', timestamp: new Date().toISOString() }],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 60_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        runStatus: 'stopped',
        recentEvents: [
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent).toBeUndefined()
      expect(turn.summary).toBe('The spec author is shaping this task.')
      expect(turn.activity?.at(-1)?.label).toBe('Finished file read')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('labels failed live tools as failed instead of finished', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'edit-file',
              is_error: true,
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventLabel).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.label).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.tone).toBe('danger')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows recent failed activity on blocked escalation turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix conversion',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'human_judgment_required',
                  summary: 'Worker stopped after hitting its turn limit.',
                  details: 'Exceeded maximum turn limit (24)',
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'edit-file',
              is_error: true,
              output: 'Invalid input for edit-file: [{"code":"invalid_type","expected":"string","received":"undefined","path":["oldString"],"message":"Required"}]',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.activity?.at(-1)?.label).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.tone).toBe('danger')
      expect(turn.activity?.at(-1)?.detail).toContain('missing oldString')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('compresses oversized reviewer escalation details into a short task-card digest', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Generate TypeScript types from Supabase schema',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'max_revisions_exceeded',
                  summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
                  details: [
                    '**Aggregated revisions from 1 persona:**',
                    '',
                    '### From The Security Engineer',
                    '',
                    'The composable accepts a `slug` from the subdomain and uses it directly in a Supabase query without any boundary validation.',
                    '',
                    'What must change:',
                    '- Add schema validation for the `slug` value before it is used in the Supabase query.',
                    '',
                    '### Reviewer availability notes',
                    '- The Project Manager failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.',
                    '- The API Designer failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.',
                  ].join('\n'),
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.details).toBe(
        'Add schema validation for the slug value before it is used in the Supabase query. 2 reviewers timed out.',
      )
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows a rolling excerpt while an agent is writing', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'I am checking ',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'the failing tests before editing.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.at(-1)?.label).toBe('Writing')
      expect(turn.activity?.at(-1)?.detail).toContain('checking the failing tests')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats empty-model reply errors as warnings and retries as running activity', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Model returned an empty reply. Retrying (1/2) without changing task state.',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Model returned an empty assistant message. The turn was ignored to keep the session healthy.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.[0]?.tone).toBe('running')
      expect(turn.activity?.[1]?.tone).toBe('warn')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps recent failed tool output visible while later writing continues', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix tests',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const laterWriting = Array.from({ length: 8 }, (_, index) => ({
        at: new Date(Date.now() + index).toISOString(),
        event: {
          type: index % 2 === 0 ? 'assistant_delta' : 'assistant_complete',
          task_id: 'task-1',
          agent_name: 'worker-agent',
          message: `later note ${index}`,
        },
      }))

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'run-command',
              is_error: true,
              output: 'vitest failed with 3 tests',
            },
          },
          ...laterWriting,
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.map(item => item.label)).toContain('Failed command')
      expect(turn.activity?.find(item => item.label === 'Failed command')?.detail).toContain('vitest failed')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('hides stale live activity older than the task updatedAt when a task has been reset', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      const updatedAt = new Date().toISOString()
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Reset task',
              status: 'review',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 120_000).toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Old failure that should not survive reset',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity ?? []).toHaveLength(0)
      expect(turn.liveAgent).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects imported draft tasks as shaping work instead of generic paused intake', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Imported roadmap task',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'workspace-importer',
                  role: 'importer',
                  content: 'Imported from: looma/docs/component-roadmap.md',
                  timestamp: new Date(Date.now() - 300_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'looma', name: 'Looma' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.importedDraft).toBe(true)
      expect(turn.summary).toBe('Imported draft waiting for shaping.')
      expect(turn.checklist).toBeUndefined()
      expect(turn.phase).toBe('intake')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects reviewer feedback as its own lifecycle turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Revise the thing',
              status: 'in_progress',
              revisionCount: 1,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: [
                    '**Aggregated revisions from 3 personas:**',
                    '',
                    'What must change:',
                    '- Fix the failing converter tests.',
                    '- Add a checkpoint before review.',
                  ].join('\n'),
                  timestamp: new Date(Date.now() - 120_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'review_feedback')
      if (!turn || turn.kind !== 'review_feedback') throw new Error('expected review feedback turn')
      expect(turn.persona).toBe('reviewer')
      expect(turn.phase).toBe('inflight')
      expect(turn.status).toBe('done')
      expect(turn.revisionCount).toBe(1)
      expect(turn.summary).toBe('Fix the failing converter tests.')
      expect(turn.feedback).toContain('Aggregated revisions')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('numbers reviewer feedback by feedback turn instead of current task revision', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Revise twice',
              status: 'in_progress',
              revisionCount: 2,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'What must change:\n- First fix.',
                  timestamp: new Date(Date.now() - 180_000).toISOString(),
                },
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'What must change:\n- Second fix.',
                  timestamp: new Date(Date.now() - 120_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const feedbackTurns = thread.turns.filter(t => t.kind === 'review_feedback')
      expect(feedbackTurns.map(t => t.kind === 'review_feedback' ? t.revisionCount : null)).toEqual([1, 2])
      expect(feedbackTurns.map(t => t.kind === 'review_feedback' ? t.summary : '')).toEqual([
        'First fix.',
        'Second fix.',
      ])
      expect(feedbackTurns.map(t => t.phase)).toEqual(['done', 'inflight'])
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('lets a newer failed verifier event dominate the active view over stale review feedback', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const reviewAt = new Date(Date.now() - 180_000).toISOString()
      const failAt = new Date(Date.now() - 30_000).toISOString()
      await mkdir(path.join(projectPath, 'memory'), { recursive: true })
      await writeFile(
        path.join(projectPath, 'memory', 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix auth callback',
              status: 'in_progress',
              revisionCount: 1,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: failAt,
              notes: [
                {
                  agentId: 'reviewer-agent',
                  role: 'reviewer',
                  content: 'What must change:\n- Add an explicit return type.',
                  timestamp: reviewAt,
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: failAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'shell',
              is_error: true,
              output: 'pnpm typecheck\nserver/api/auth/callback.get.ts(30,1): error TS1434',
            },
          },
        ],
      })

      const reviewTurn = thread.turns.find(t => t.kind === 'review_feedback')
      if (!reviewTurn || reviewTurn.kind !== 'review_feedback') throw new Error('expected review feedback turn')
      expect(reviewTurn.phase).toBe('done')

      const inflight = thread.turns.find(t => t.kind === 'inflight')
      if (!inflight || inflight.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(inflight.activity?.[0]?.label).toBe('Failed shell')
      expect(inflight.activity?.[0]?.detail).toContain('error TS1434')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })
})
