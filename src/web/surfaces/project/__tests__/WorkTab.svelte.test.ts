// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import WorkTab from '../WorkTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import type { ProjectDetail, Task } from '../../../lib/types.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 'task-a',
    title: overrides.title ?? 'Alpha task',
    status: overrides.status ?? 'ready',
    priority: overrides.priority ?? 'normal',
    domain: overrides.domain ?? 'knit',
    updatedAt: overrides.updatedAt ?? '2026-05-19T10:00:00.000Z',
    revisionCount: overrides.revisionCount ?? 0,
    ...overrides,
  } as Task
}

function detail(tasks: Task[], overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    run: { status: 'stopped', mode: 'continuous' },
    availability: { status: 'active', pausedAt: null, resumedAt: null },
    tasks,
    config: { coordinators: [{ id: 'knit', domain: 'knit' }] },
    ...overrides,
  } as ProjectDetail
}

function pausedDetail(tasks: Task[]): ProjectDetail {
  return {
    ...detail(tasks),
    availability: { status: 'paused', pausedAt: '2026-05-19T10:00:00.000Z', resumedAt: null },
  } as ProjectDetail
}

function runningDetail(tasks: Task[]): ProjectDetail {
  return {
    ...detail(tasks),
    run: { status: 'running', mode: 'continuous' },
  } as ProjectDetail
}

function installBrowserFakes(progress = 'Recent worker progress.') {
  window.history.replaceState({}, '', '/projects/looma-knit/work')
  path.value = '/projects/looma-knit/work'
  vi.stubGlobal('fetch', vi.fn(async () => json({ progress })))
}

describe('WorkTab', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('sorts tasks by user-selected columns and opens tasks from mouse and keyboard', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-beta',
            title: 'Beta task',
            status: 'blocked',
            priority: 'critical',
            domain: 'looma',
            updatedAt: '2026-05-19T11:00:00.000Z',
            blockReason: 'Blocked on missing credentials.',
            revisionCount: 2,
          }),
          task({
            id: 'task-alpha',
            title: 'Alpha task',
            status: 'done',
            priority: 'low',
            domain: 'knit',
            updatedAt: '2026-05-19T09:00:00.000Z',
            terminalSummary: { headline: 'Completed cleanly.' },
            revisionCount: 0,
          }),
          task({
            id: 'task-gamma',
            title: 'Gamma task',
            status: 'in_progress',
            priority: 'high',
            domain: 'project',
            updatedAt: 'not-a-date',
            latestCheckpoint: { nextPlannedAction: 'Rerun focused typecheck.' },
            revisionCount: 1,
          }),
        ]),
      },
    })

    await screen.findByText('1 shown · 3 total')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'all')
    await userEvent.click(screen.getByRole('button', { name: /^work$/i }))
    expect(screen.getAllByRole('button', { name: /inspect work/i })[0]?.textContent).toContain('Alpha task')

    await userEvent.click(screen.getByRole('button', { name: /priority/i }))
    expect(screen.getAllByRole('button', { name: /inspect work/i })[0]?.textContent).toContain('Alpha task')

    await userEvent.click(screen.getByRole('button', { name: /priority/i }))
    expect(screen.getAllByRole('button', { name: /inspect work/i })[0]?.textContent).toContain('Beta task')

    expect(screen.getByText('Blocked on missing credentials.')).toBeTruthy()
    expect(screen.getByText('Completed cleanly.')).toBeTruthy()
    expect(screen.getByText('Rerun focused typecheck.')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /inspect work beta task/i }))
    expect(screen.getByLabelText('Selected work inspector')).toHaveTextContent('Beta task')
    await userEvent.click(screen.getByRole('button', { name: /open drawer/i }))
    expect(path.value).toBe('/projects/looma-knit/task/task-beta')

    path.value = '/projects/looma-knit/work'
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    const gammaRow = screen.getByRole('button', { name: /inspect work gamma task/i })
    await fireEvent.keyDown(gammaRow, { key: 'Enter' })
    expect(screen.getByLabelText('Selected work inspector')).toHaveTextContent('Gamma task')
  })

  it('opens the routed work item from the task query and shows the matching work slice', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?task=task-smoke-test')
    path.value = '/projects/looma-knit/work?task=task-smoke-test'
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-smoke-test',
            title: 'What commands should I run to smoke test this project without changin...',
            description: 'What commands should I run to smoke test this project without changing files?',
            status: 'ready',
            productBrief: { approvedAt: '2026-06-15T18:48:51.097Z', userJob: '' },
            spec: '',
            acceptanceCriteria: [],
          }),
          task({
            id: 'task-done',
            title: 'Already completed work',
            status: 'done',
          }),
        ]),
      },
    })

    await screen.findByText('1 shown · 2 total')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toHaveValue('planning')
    expect(screen.getByLabelText('Selected work inspector')).toHaveTextContent('What commands should I run')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }))
  })

  it('opens an owner-review focus into the exact selected-release review set', async () => {
    window.history.replaceState({}, '', '/projects/narrative-harness/work?task=review-one')
    path.value = '/projects/narrative-harness/work?task=review-one'

    render(WorkTab, {
      props: {
        detail: detail([
          task({ id: 'review-one', title: 'Review the context packet proof', status: 'spec_review' }),
          task({ id: 'review-two', title: 'Review the world-state proof', status: 'spec_review' }),
          task({
            id: 'unrelated-question',
            title: 'Answer an unrelated project question',
            status: 'exploring',
            openQuestions: [{ id: 'question-1', prompt: 'Which branch should this use?' }],
          }),
        ], {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          startReadiness: {
            canStart: false,
            code: 'owner_review_required',
            focusTaskId: 'review-one',
            count: 2,
            reviewTaskIds: ['review-one', 'review-two'],
            message: '2 specs are ready for your review before work can continue.',
          },
        }),
      },
    })

    await screen.findByText('2 shown · 3 total')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toHaveValue('review')
    expect(screen.getByRole('button', { name: /inspect work review the context packet proof/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /inspect work review the world-state proof/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /inspect work answer an unrelated project question/i })).not.toBeInTheDocument()
  })

  it('shows question-shaped runnable work with an action-shaped label and keeps the source question visible', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?task=task-smoke-test')
    path.value = '/projects/looma-knit/work?task=task-smoke-test'

    render(WorkTab, {
      props: {
        detail: runningDetail([
          task({
            id: 'task-smoke-test',
            title: 'What commands should I run to smoke test this project without changing files?',
            description: 'What commands should I run to smoke test this project without changing files?',
            status: 'in_progress',
          }),
        ]),
      },
    })

    const row = await screen.findByRole('button', { name: /inspect work define safe smoke-test commands/i })
    expect(row).toHaveTextContent('Define safe smoke-test commands')
    expect(row).toHaveTextContent('What commands should I run to smoke test this project without changing files?')
    const inspector = screen.getByLabelText('Selected work inspector')
    expect(inspector).toHaveTextContent('Define safe smoke-test commands')
    expect(inspector).toHaveTextContent('What commands should I run to smoke test this project without changing files?')
    expect(within(inspector).getByRole('button', { name: /running/i })).toBeDisabled()
  })

  it('shows source-grounded task detail in the row subcopy and selected inspector', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?task=task-source')
    path.value = '/projects/looma-knit/work?task=task-source'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-source',
            title: 'Define safe smoke-test commands',
            status: 'ready',
            sourceRefs: ['docs/harness/smoke-test-commands.md'],
          }),
        ]),
      },
    })

    const row = await screen.findByRole('button', { name: /inspect work define safe smoke-test commands/i })
    expect(row).toHaveTextContent('Source: smoke-test-commands.md')
    const inspector = screen.getByLabelText('Selected work inspector')
    expect(inspector).toHaveTextContent('Source')
    expect(inspector).toHaveTextContent('smoke-test-commands.md')
  })

  it('explains why an imported source-recovery task is not runnable in the selected work inspector', async () => {
    window.history.replaceState({}, '', '/projects/narrative-harness/work?task=task-import-contract')
    path.value = '/projects/narrative-harness/work?task=task-import-contract'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-import-contract',
            title: 'Recover source-backed contract surface',
            status: 'import_draft',
            domain: 'harness',
            taskReadiness: {
              recommendation: 'needs_research_spike',
              summary: 'Needs concrete contract names before worker handoff.',
            },
          }),
        ], {
          id: 'narrative-harness',
          name: 'Narrative Harness',
        }),
      },
    })

    const inspector = await screen.findByLabelText('Selected work inspector')
    expect(inspector).toHaveTextContent('Not runnable yet')
    expect(inspector).toHaveTextContent('Imported current work needs a real brief before Guildhall can build unattended.')
    expect(inspector).toHaveTextContent('Needs concrete contract names before worker handoff.')
    expect(within(inspector).getByRole('button', { name: /draft task brief/i })).toBeInTheDocument()
    expect(within(inspector).queryByRole('button', { name: /draft and run/i })).not.toBeInTheDocument()
  })

  it('shows delivery-step progress on visible work rows', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([
            task({
              id: 'task-import-review',
              title: 'Import review flow',
              status: 'in_progress',
            }),
          ]),
          workProgress: {
            counts: {
              visibleTotal: 1,
              visibleActive: 1,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 0,
              deliveryTotal: 1,
              deliveryRequired: 1,
              deliveryDone: 0,
              deliveryBlocked: 1,
            },
            byTaskId: {
              'task-import-review': {
                rollup: {
                  primaryState: 'blocked',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 1,
                  requiredStepCount: 1,
                  doneStepCount: 0,
                  blockedStepCount: 1,
                },
              },
            },
          },
        },
      },
    })

    await screen.findByText('1 delivery step blocked')
    expect(screen.getByText('Import review flow')).toBeInTheDocument()
  })

  it('summarizes scoped current work instead of raw internal delivery blockers', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-runner',
            title: 'Implement a no-UI runner that builds a packet from fixture records.',
            status: 'ready',
            domain: 'harness',
          }),
        ], {
          actionModel: {
            primaryAction: {
              source: 'task',
              label: 'Implement a no-UI runner that builds a packet from fixture records.',
              detail: 'Needs brief: finish the handoff before a worker can start.',
              buttonLabel: 'Open Work',
              href: '/work?task=task-runner',
              tone: 'warn',
              taskId: 'task-runner',
            },
            secondaryActions: [],
            runControl: { label: 'Resume', startEnabled: true },
            ownerInput: { active: false },
            setup: { state: 'ready', freshIntakeNeeded: false },
          },
          workProgress: {
            counts: {
              visibleTotal: 18,
              visibleActive: 6,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 12,
              deliveryTotal: 60,
              deliveryRequired: 60,
              deliveryDone: 0,
              deliveryBlocked: 0,
            },
            byTaskId: {},
          },
          orientationSpine: {
            scope: { label: 'Current task scope' },
            summary: {
              headline: 'Current task scope is being shaped.',
              purpose: 'Build the headless Narrative Harness MVP.',
              selectedScopeLabel: 'Current task scope',
              includedWorkCount: 6,
              deferredWorkCount: 12,
            },
            roots: [],
            nodes: {},
          },
          deliverySpine: {
            queue: {
              runnable: [],
              firstRunnable: null,
              blocked: Array.from({ length: 26 }, (_, index) => ({
                task: { id: `internal-${index}`, title: `Internal step ${index}`, status: 'blocked' },
                structuralBlockers: [],
              })),
            },
          },
        }),
      },
    })

    const queue = await screen.findByRole('region', { name: 'Delivery queue' })
    expect(queue).toHaveTextContent('Current task scope')
    expect(queue).toHaveTextContent('Implement a no-UI runner that builds a packet from fixture records.')
    expect(queue).toHaveTextContent('Needs brief: finish the handoff before a worker can start.')
    expect(queue).toHaveTextContent('6 current tasks')
    expect(queue).toHaveTextContent('0 blocked')
    expect(queue).toHaveTextContent('12 deferred')
    expect(queue).not.toHaveTextContent('0 ready to resume')
    expect(queue).not.toHaveTextContent('26 blocked')
    expect(queue).not.toHaveTextContent('No runnable task')
  })

  it('keeps selected-scope source and proof context visible when work is runnable', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-runner',
            title: 'Unit tests: use-collections, use-presence, subdomain utils',
            status: 'ready',
            domain: 'knit',
          }),
        ], {
          orientationSpine: {
            scope: { label: 'Stage 1: V1 Release Hardening' },
            summary: {
              headline: 'Stage 1: V1 Release Hardening is being shaped.',
              selectedScopeLabel: 'Stage 1: V1 Release Hardening',
              includedWorkCount: 5,
              deferredWorkCount: 30,
              progress: { blocked: 5 },
            },
            scopeRows: [
              {
                taskId: 'task-runner',
                nodeId: 'work:task-runner',
                title: 'Unit tests: use-collections, use-presence, subdomain utils',
                scope: 'included',
                sourceRefs: [
                  '/Users/matthew/git/oss/looma-knit/docs/PROJECT_STATE.md',
                  '/Users/matthew/git/oss/looma-knit/docs/release-plan.md',
                ],
              },
            ],
            proofContracts: Array.from({ length: 5 }, (_, index) => ({
              nodeId: `work:proof-${index + 1}`,
              title: `Proof ${index + 1}`,
              state: 'missing',
              missing: [`proof-${index + 1}`],
            })),
            roots: [],
            nodes: {},
          },
          deliverySpine: {
            queue: {
              runnable: [
                {
                  task: task({
                    id: 'task-runner',
                    title: 'Unit tests: use-collections, use-presence, subdomain utils',
                    status: 'ready',
                  }),
                  why: 'Ready when resumed.',
                  structuralBlockers: [],
                },
              ],
              firstRunnable: {
                task: task({
                  id: 'task-runner',
                  title: 'Unit tests: use-collections, use-presence, subdomain utils',
                  status: 'ready',
                }),
                why: 'Ready when resumed.',
                structuralBlockers: [],
              },
              blocked: [],
            },
          },
        }),
      },
    })

    const queue = await screen.findByRole('region', { name: 'Delivery queue' })
    expect(queue).toHaveTextContent('Unit tests: use-collections, use-presence, subdomain utils')
    expect(queue).toHaveTextContent('Sources: PROJECT_STATE.md, release-plan.md')
    expect(queue).toHaveTextContent('Proof: 0 proven items · 5 missing proof')
  })

  it('keeps proof-missing completed work visible from the focused Work route', async () => {
    window.history.replaceState({}, '', '/projects/narrative-harness/work?task=proof-task')
    path.value = '/projects/narrative-harness/work?task=proof-task'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'proof-task',
            title: 'Generate a CLI-first story synopsis and chapter draft',
            status: 'done',
            terminalSummary: { headline: 'Completed, but proof evidence is missing.' },
          }),
          task({
            id: 'later-task',
            title: 'Later polish task',
            status: 'shelved',
          }),
        ], {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          startReadiness: {
            canStart: false,
            code: 'proof_evidence_missing',
            message: 'Stage 1 is waiting on proof evidence for "Generate a CLI-first story synopsis and chapter draft".',
            actionHref: '/work?task=proof-task',
            focusTaskId: 'proof-task',
            focusKind: 'proof',
            proofTaskIds: ['proof-task'],
            count: 1,
          },
          workProgress: {
            counts: {
              visibleTotal: 2,
              visibleActive: 0,
              visibleBlocked: 0,
              visibleDone: 1,
              visibleShelved: 1,
              deliveryTotal: 2,
              deliveryRequired: 2,
              deliveryDone: 1,
              deliveryBlocked: 0,
            },
            byTaskId: {},
          },
          orientationSpine: {
            scope: { label: 'Stage 1' },
            summary: {
              selectedScopeLabel: 'Stage 1',
              nextAction: 'Attach proof for the completed scoped work.',
              includedWorkCount: 1,
              deferredWorkCount: 1,
            },
            roots: [],
            nodes: {},
          },
          deliverySpine: {
            queue: {
              runnable: [],
              firstRunnable: null,
              blocked: [],
            },
          },
        }),
      },
    })

    const queue = await screen.findByRole('region', { name: 'Delivery queue' })
    expect(queue).toHaveTextContent('1 need proof')
    expect(queue).not.toHaveTextContent('0 current tasks')
    expect(queue).not.toHaveTextContent('0 blocked')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toHaveValue('needs-proof')
    expect(await screen.findByText('1 shown · 2 total')).toBeTruthy()
    expect(screen.getByRole('button', { name: /inspect work generate a cli-first story synopsis/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^run proof$/i })).toBeTruthy()
  })

  it('keeps completed selected-scope counts visible when no work is ready to run', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'current-done',
            title: 'Generate a CLI-first story synopsis and chapter draft',
            status: 'done',
          }),
          task({
            id: 'later-shelved',
            title: 'Later reviewer lane',
            status: 'shelved',
          }),
        ], {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          startReadiness: {
            canStart: false,
            code: 'all_terminal',
            message: 'Stage 1: Headless Drafting And Evaluation MVP is complete.',
          },
          orientationSpine: {
            scope: { label: 'Stage 1 Headless Drafting And Evaluation MVP' },
            summary: {
              headline: 'Stage 1 Headless Drafting And Evaluation MVP is complete.',
              selectedScopeLabel: 'Stage 1 Headless Drafting And Evaluation MVP',
              nextAction: 'Review completed scope.',
              includedWorkCount: 11,
              deferredWorkCount: 31,
              progress: { blocked: 0 },
            },
            scopeRows: [
              {
                taskId: 'current-done',
                nodeId: 'work:current-done',
                title: 'Generate a CLI-first story synopsis and chapter draft',
                scope: 'included',
                sourceRefs: [
                  '/Users/matthew/git/oss/narrative-harness/docs/harness/implementation-roadmap.md',
                  '/Users/matthew/git/oss/narrative-harness/docs/harness/architecture-notes.md',
                  '/Users/matthew/git/oss/narrative-harness/docs/product/deepinfra-drafting-model-selection.md',
                  'task:current-done',
                ],
              },
              {
                taskId: 'later-shelved',
                nodeId: 'work:later-shelved',
                title: 'Later reviewer lane',
                scope: 'deferred',
                sourceRefs: ['task:later-shelved'],
              },
            ],
            proofContracts: Array.from({ length: 11 }, (_, index) => ({
              nodeId: `work:proof-${index + 1}`,
              title: `Proof ${index + 1}`,
              state: 'proven',
              missing: [],
            })),
            roots: [],
            nodes: {},
          },
          deliverySpine: {
            queue: {
              runnable: [],
              firstRunnable: null,
              blocked: [],
            },
          },
        }),
      },
    })

    const queue = await screen.findByRole('region', { name: 'Delivery queue' })
    expect(queue).toHaveTextContent('Stage 1 Headless Drafting And Evaluation MVP is complete.')
    expect(queue).toHaveTextContent('Review completed scope.')
    expect(queue).toHaveTextContent('11 current tasks')
    expect(queue).toHaveTextContent('0 blocked')
    expect(queue).toHaveTextContent('31 deferred')
    expect(queue).toHaveTextContent('Sources: implementation-roadmap.md, architecture-notes.md, deepinfra-drafting-model-selection.md')
    expect(queue).toHaveTextContent('Proof: 11 proven items · 0 missing proof')
    expect(queue).not.toHaveTextContent('0 current tasks')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toHaveValue('scope')
    expect(await screen.findByText('1 current item · 1 deferred item · 2 total')).toBeTruthy()
    expect(screen.queryByText('No work is ready to run yet.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inspect work generate a cli-first story synopsis/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /inspect work later reviewer lane/i })).toBeTruthy()
  })

  it('defaults to the selected scope before unrelated global blocked work', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'old-global-blocker',
            title: 'Block menu / block side menu',
            status: 'blocked',
            updatedAt: '2026-05-19T12:00:00.000Z',
            blockReason: 'Old backlog row outside the current release.',
          }),
          task({
            id: 'scope-blocker',
            title: 'E2E tests: complete current-scope proof',
            status: 'import_draft',
            updatedAt: '2026-05-19T08:00:00.000Z',
          }),
          task({
            id: 'scope-blocker-two',
            title: 'TypeScript: generate proper types from Supabase',
            status: 'import_draft',
            updatedAt: '2026-05-19T13:00:00.000Z',
          }),
          task({
            id: 'scope-done',
            title: 'TypeScript tests: verified',
            status: 'done',
            updatedAt: '2026-05-19T11:00:00.000Z',
          }),
          task({
            id: 'scope-later',
            title: 'Later release polish',
            status: 'shelved',
            updatedAt: '2026-05-19T13:00:00.000Z',
          }),
        ], {
          orientationSpine: {
            scope: { label: 'Stage 1: V1 Release Hardening' },
            summary: {
              selectedScopeLabel: 'Stage 1: V1 Release Hardening',
              includedWorkCount: 3,
              deferredWorkCount: 1,
              progress: { blocked: 2 },
            },
            scopeRows: [
              {
                taskId: 'scope-done',
                nodeId: 'work:scope-done',
                title: 'TypeScript tests: verified',
                scope: 'included',
                status: 'done',
              },
              {
                taskId: 'scope-blocker',
                nodeId: 'work:scope-blocker',
                title: 'E2E tests: complete current-scope proof',
                scope: 'included',
                status: 'ready',
                blocksStart: true,
                blocksRelease: true,
              },
              {
                taskId: 'scope-blocker-two',
                nodeId: 'work:scope-blocker-two',
                title: 'TypeScript: generate proper types from Supabase',
                scope: 'included',
                status: 'ready',
                blocksStart: true,
                blocksRelease: true,
              },
              {
                taskId: 'scope-later',
                nodeId: 'work:scope-later',
                title: 'Later release polish',
                scope: 'deferred',
                status: 'shelved',
              },
            ],
            roots: [],
            nodes: {},
          },
          startReadiness: {
            canStart: false,
            code: 'imported_scope_needs_shaping',
            message: 'Start with E2E tests: complete current-scope proof.',
            focusTaskId: 'scope-blocker',
          },
          releaseReadiness: {
            ready: false,
            releaseBlockers: [
              { id: 'scope-blocker', title: 'E2E tests: complete current-scope proof' },
              { id: 'scope-blocker-two', title: 'TypeScript: generate proper types from Supabase' },
            ],
          },
        }),
      },
    })

    await screen.findByText('3 current items · 1 deferred item · 5 total')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toHaveValue('scope')
    const rows = screen.getAllByRole('button', { name: /inspect work/i })
    expect(rows[0]).toHaveTextContent('E2E tests: complete current-scope proof')
    expect(rows[1]).toHaveTextContent('TypeScript: generate proper types from Supabase')
    expect(rows[2]).toHaveTextContent('TypeScript tests: verified')
    expect(rows[3]).toHaveTextContent('Later release polish')
    expect(screen.queryByRole('button', { name: /inspect work block menu/i })).not.toBeInTheDocument()
  })

  it('reopens proof-missing completed work before starting the selected item', async () => {
    const fetchSpy = vi.mocked(fetch)
    window.history.replaceState({}, '', '/projects/narrative-harness/work?task=proof-task')
    path.value = '/projects/narrative-harness/work?task=proof-task'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'proof-task',
            title: 'Select and prove a DeepInfra drafting model',
            status: 'done',
            terminalSummary: { headline: 'Completed, but proof evidence is missing.' },
          }),
        ], {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          startReadiness: {
            canStart: false,
            code: 'proof_evidence_missing',
            message: 'Stage 1 is waiting on proof evidence.',
            actionHref: '/work?task=proof-task',
            focusTaskId: 'proof-task',
            focusKind: 'proof',
            proofTaskIds: ['proof-task'],
            count: 1,
          },
        }),
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: /^run proof$/i }))

    await waitFor(() => {
      const urls = fetchSpy.mock.calls.map(call => String(call[0]))
      expect(urls.some(url => url.includes('/api/project/task/proof-task/retry-work'))).toBe(true)
      expect(urls.some(url => url.includes('/api/project/task/proof-task/start'))).toBe(true)
    })
    const retryCall = fetchSpy.mock.calls.find(call => String(call[0]).includes('/api/project/task/proof-task/retry-work'))
    expect(String(retryCall?.[1]?.body)).toContain('missing release proof')
  })

  it('labels dependency-waiting delivery work separately from blocked tasks', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-schema',
            title: 'Define fixture schemas',
            status: 'ready',
          }),
          task({
            id: 'task-fixture',
            title: 'Add the first fiction fixture',
            status: 'ready',
          }),
        ], {
          workProgress: {
            counts: {
              visibleTotal: 2,
              visibleActive: 1,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 0,
              deliveryTotal: 2,
              deliveryRequired: 2,
              deliveryDone: 0,
              deliveryBlocked: 0,
            },
            byTaskId: {},
          },
          deliverySpine: {
            queue: {
              runnable: [{
                task: task({ id: 'task-schema', title: 'Define fixture schemas', status: 'ready' }),
                executionBlockers: [],
                structuralBlockers: [],
                why: 'Runnable project work.',
              }],
              firstRunnable: {
                task: task({ id: 'task-schema', title: 'Define fixture schemas', status: 'ready' }),
                executionBlockers: [],
                structuralBlockers: [],
                why: 'Runnable project work.',
              },
              blocked: [{
                task: task({ id: 'task-fixture', title: 'Add the first fiction fixture', status: 'ready' }),
                executionBlockers: [{ id: 'task-schema', title: 'Define fixture schemas', status: 'ready' }],
                structuralBlockers: [],
                why: 'Blocked by Define fixture schemas.',
              }],
            },
          },
        }),
      },
    })

    const queue = await screen.findByRole('region', { name: 'Delivery queue' })
    expect(queue).toHaveTextContent('1 ready to resume')
    expect(queue).toHaveTextContent('1 waiting on dependencies')
    expect(queue).not.toHaveTextContent('1 blocked')
  })

  it('prefers shaped work units over proof-step badges for planning work and names blockers by task title', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-fixture',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            status: 'spec_review',
            domain: 'harness',
          }),
          task({
            id: 'task-runner',
            title: 'Implement a no-UI runner that builds a packet from fixture records.',
            status: 'spec_review',
            domain: 'harness',
            dependsOn: ['task-fixture'],
            workUnitAnalysis: {
              units: [
                { id: 'unit-1', title: 'Load fixture inputs and shared records' },
                { id: 'unit-2', title: 'Execute the packet run without UI help' },
                { id: 'unit-3', title: 'Prove the runner over a bounded fixture' },
              ],
            },
          }),
        ], {
          workProgress: {
            counts: {
              visibleTotal: 2,
              visibleActive: 2,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 0,
              deliveryTotal: 2,
              deliveryRequired: 2,
              deliveryDone: 0,
              deliveryBlocked: 0,
            },
            byTaskId: {
              'task-runner': {
                id: 'task-runner',
                title: 'Implement a no-UI runner that builds a packet from fixture records.',
                status: 'spec_review',
                visibility: { kind: 'primary', countInProjectTotals: true },
                deliverySteps: [
                  { id: 'proof:1', title: 'Proof 1', status: 'todo', required: true, blocksCompletion: true },
                  { id: 'proof:2', title: 'Proof 2', status: 'todo', required: true, blocksCompletion: true },
                ],
                rollup: {
                  primaryState: 'active',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 0,
                  requiredStepCount: 2,
                  doneStepCount: 0,
                  blockedStepCount: 0,
                },
              },
            },
          },
        }),
      },
    })

    await screen.findByText('3 planned units')
    const runnerRow = screen.getByRole('button', { name: /inspect work implement a no-ui runner that builds a packet from fixture records/i })
    expect(runnerRow).toHaveTextContent('Waiting on Define fixture, expected-record, prototype-run, and evaluation schemas.')
    expect(runnerRow).not.toHaveTextContent('Blocked')
    expect(runnerRow).toHaveTextContent('Awaiting approval')
    expect(runnerRow).not.toHaveTextContent('0/2 delivery steps')

    await userEvent.click(runnerRow)
    const inspector = screen.getByLabelText('Selected work inspector')
    expect(within(inspector).getAllByText('3 planned work units are already shaped for this item.')).toHaveLength(2)
  })

  it('shows the orientation spine path on work rows', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([
            task({
              id: 'task-finding-taxonomy',
              title: 'Finding taxonomy',
              status: 'ready',
              description: 'Document the weighted finding taxonomy.',
            }),
          ]),
          orientationSpine: {
            scope: { label: 'Current MVP' },
            summary: {
              headline: 'Current MVP is being shaped.',
              purpose: 'Build a fiction-first evaluation and reasoning harness.',
              selectedScopeLabel: 'Current MVP',
              includedWorkCount: 1,
              deferredWorkCount: 0,
            },
            roots: [{
              id: 'work:task-anti-sameness',
              title: 'Anti-sameness safeguards',
              children: [{
                id: 'work:task-finding-taxonomy',
                title: 'Finding taxonomy',
                children: [],
              }],
            }],
            nodes: {},
          },
        },
      },
    })

    await screen.findByText('Finding taxonomy')
    expect(screen.getByText('Anti-sameness safeguards / Finding taxonomy')).toBeInTheDocument()
  })

  it('can filter the mixed Looma and Knit work list by source part', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-knit',
            title: 'Knit pages task',
            status: 'ready',
            domain: 'looma',
            description: 'knit/specs/v1-pages.md: - [ ] Create a page',
            productBrief: {
              userJob: 'Ship page creation.',
              whyItMattersNow: 'Knit needs pages.',
              successMetric: 'Page creation works.',
              nonGoals: [],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            spec: 'Implement page creation.',
            acceptanceCriteria: [{ description: 'Creates pages.' }],
          }),
          task({
            id: 'task-looma',
            title: 'Looma component task',
            status: 'ready',
            domain: 'looma',
            description: 'looma/docs/component-roadmap.md: - [ ] Component',
            productBrief: {
              userJob: 'Ship the component.',
              whyItMattersNow: 'Looma needs components.',
              successMetric: 'Component works.',
              nonGoals: [],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            spec: 'Implement component.',
            acceptanceCriteria: [{ description: 'Renders component.' }],
          }),
        ], {
          structuralMapReview: {
            state: 'accepted',
            domains: [
              { id: 'domain:knit', label: 'Knit', path: 'knit' },
              { id: 'domain:looma', label: 'Looma', path: 'looma' },
            ],
          },
        }),
      },
    })

    await screen.findByText('2 shown · 2 total')
    expect(screen.getByRole('button', { name: /inspect work knit pages task/i })).toHaveTextContent('Knit')
    expect(screen.getByRole('button', { name: /inspect work looma component task/i })).toHaveTextContent('Looma')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^part$/i }), 'domain:knit')

    expect(screen.getByText('1 shown · 2 total')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inspect work knit pages task/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /inspect work looma component task/i })).not.toBeInTheDocument()
  })

  it('can filter mixed Looma ready work and Knit import drafts by source part', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-looma-ready',
            title: 'Looma ready task',
            status: 'ready',
            domain: 'looma',
            description: 'looma/docs/component-roadmap.md: - [ ] Component',
            productBrief: {
              userJob: 'Ship Looma work.',
              whyItMattersNow: 'Looma needs this component.',
              successMetric: 'The component works.',
              nonGoals: [],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            spec: 'Implement component.',
            acceptanceCriteria: [{ description: 'Component works.' }],
          }),
          task({
            id: 'task-knit-draft',
            title: 'Knit draft task',
            status: 'import_draft',
            domain: 'knit',
            description: 'knit/PROJECT_STATE.md: - [ ] Version diff view',
          }),
          task({
            id: 'task-looma-draft',
            title: 'Looma draft task',
            status: 'import_draft',
            domain: 'looma',
            description: 'looma/PROJECT_STATE.md: - [ ] Toast guidance',
          }),
        ]),
      },
    })

    await screen.findByText('3 shown · 3 total')
    expect(screen.getByRole('combobox', { name: /^part$/i })).toHaveTextContent('Knit')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'all')
    await screen.findByText('3 shown · 3 total')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^part$/i }), 'task-domain:knit')

    expect(screen.getByText('1 shown · 3 total')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inspect work knit draft task/i })).toHaveTextContent('Knit')
    expect(screen.queryByRole('button', { name: /inspect work looma ready task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /inspect work looma draft task/i })).not.toBeInTheDocument()
  })

  it('starts a selected work item directly from the list inspector', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/project/task/task-knit-draft/shape-draft')) {
        expect(init?.method).toBe('POST')
        expect(String(init.body)).toContain('"projectId":"looma-knit"')
        return json({ ok: true })
      }
      if (url.includes('/api/project/task/task-knit-draft/start')) {
        return json({ status: 'running', mode: 'one_task', scope: { type: 'work_item', taskId: 'task-knit-draft' } })
      }
      if (url.includes('/api/project?')) {
        return json({ id: 'looma-knit', name: 'Looma + Knit', run: { status: 'running', mode: 'one_task' }, tasks: [] })
      }
      return json({ progress: 'Recent worker progress.' })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-knit-draft',
            title: 'Knit draft task',
            status: 'import_draft',
            domain: 'knit',
            description: 'knit/PROJECT_STATE.md: - [ ] Version diff view',
          }),
        ]),
      },
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')
    await userEvent.click(await screen.findByRole('button', { name: /inspect work knit draft task/i }))
    await userEvent.click(within(screen.getByLabelText('Selected work inspector')).getByRole('button', { name: /draft task brief/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/project/task/task-knit-draft/shape-draft?projectId=looma-knit'),
      )).toBe(true)
      expect(fetchMock.mock.calls.some(([input, init]) =>
        String(input).includes('/api/project/task/task-knit-draft/start?projectId=looma-knit') &&
        init?.method === 'POST' &&
        String(init.body).includes('"mode":"one_task"') &&
        String(init.body).includes('"scope":"work_item"'),
      )).toBe(true)
    })
    const runningButton = await screen.findByRole('button', { name: /running/i })
    expect(runningButton).toBeDisabled()
  })

  it('continues source-recovery shaping before starting a selected work item', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/project/task/task-source-recovery/shape-draft')) {
        expect(init?.method).toBe('POST')
        expect(String(init.body)).toContain('"projectId":"looma-knit"')
        return json({ ok: true, status: 'exploring' })
      }
      if (url.includes('/api/project/task/task-source-recovery/start')) {
        return json({ status: 'running', mode: 'one_task', scope: { type: 'work_item', taskId: 'task-source-recovery' } })
      }
      if (url.includes('/api/project?')) {
        return json({ id: 'looma-knit', name: 'Looma + Knit', run: { status: 'running', mode: 'one_task' }, tasks: [] })
      }
      return json({ progress: 'Recent worker progress.' })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-source-recovery',
            title: 'Recover source-backed contract surface',
            status: 'exploring',
            domain: 'harness',
            taskReadiness: {
              recommendation: 'needs_research_spike',
              summary: 'Needs concrete source-backed contract names before worker handoff.',
            },
            notes: [
              {
                agentId: 'workspace-importer',
                role: 'importer',
                content: 'Imported from docs/specs/author-involvement-modes.md',
                timestamp: '2026-05-19T10:00:00.000Z',
              },
            ],
          }),
        ]),
      },
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')
    await userEvent.click(await screen.findByRole('button', { name: /inspect work recover source-backed contract surface/i }))
    await userEvent.click(within(screen.getByLabelText('Selected work inspector')).getByRole('button', { name: /continue shaping brief/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/project/task/task-source-recovery/shape-draft?projectId=looma-knit'),
      )).toBe(true)
      expect(fetchMock.mock.calls.some(([input, init]) =>
        String(input).includes('/api/project/task/task-source-recovery/start?projectId=looma-knit') &&
        init?.method === 'POST' &&
        String(init.body).includes('"mode":"one_task"') &&
        String(init.body).includes('"scope":"work_item"'),
      )).toBe(true)
    })
  })

  it('does not show an empty new-request prompt when a zero-task project is blocked by migration', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([]),
          startReadiness: {
            canStart: false,
            code: 'required_migration_pending',
            message: 'Run the required Guildhall migration before Guildhall can update this project.',
            actionHref: '/migrations',
          },
          inbox: {
            items: [
              {
                kind: 'required_migration',
                severity: 'high',
                title: 'Required migration: Project state layout',
                detail: 'Move project state into the new layout before Guildhall can update it.',
                actionHref: '/migrations',
                status: 'open',
                id: 'migration:project-state-layout',
                createdAt: '2026-05-19T10:00:00.000Z',
                updatedAt: '2026-05-19T10:00:00.000Z',
              },
            ],
            history: [],
            blockers: { bootstrap: false, workspaceImport: false },
          },
        },
      },
    })

    expect(screen.getByText('Move project state into the new layout before Guildhall can update it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /migrate project/i })).toBeInTheDocument()
    expect(screen.queryByText(/No tasks yet.*New request/i)).not.toBeInTheDocument()
  })

  it('does not show an empty new-request prompt when a zero-task project has setup work', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([]),
          startReadiness: {
            canStart: false,
            code: 'setup_pending',
            message: 'Finish project setup first.',
            actionHref: '/setup',
          },
          inbox: {
            items: [
              {
                kind: 'setup_pending',
                severity: 'medium',
                stepId: 'direction',
                title: 'Add project direction',
                detail: 'Finish project setup first.',
                actionHref: '/setup',
                status: 'open',
                id: 'setup:direction',
                createdAt: '2026-05-19T10:00:00.000Z',
                updatedAt: '2026-05-19T10:00:00.000Z',
              },
            ],
            history: [],
            blockers: { bootstrap: false, workspaceImport: false },
          },
        },
      },
    })

    expect(screen.getByText('Finish project setup first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open setup/i })).toBeInTheDocument()
    expect(screen.queryByText(/No tasks yet.*New request/i)).not.toBeInTheDocument()
  })

  it('uses the list as the default legacy tree-preview route and opens an inspector on selection', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'feature-root',
            title: 'Interface design system',
            status: 'in_progress',
            description: 'Build the interface design system.',
            hierarchy: { childIds: ['task-button'], order: 0 },
          }),
          task({
            id: 'task-button',
            title: 'Button primitive',
            status: 'in_progress',
            description: 'Ship the reusable button primitive.',
            hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
          }),
        ]),
      },
    })

    await screen.findByRole('heading', { name: 'Work list' })
    const toolbar = screen.getByRole('toolbar', { name: /work view controls/i })
    expect(within(toolbar).queryByRole('button', { name: /^columns$/i })).toBeNull()
    expect(within(toolbar).getByRole('button', { name: /^list$/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByLabelText('Selected work inspector')).toBeNull()
    expect(screen.queryByLabelText('Work hierarchy columns')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /inspect work interface design system/i }))

    const inspector = screen.getByLabelText('Selected work inspector')
    expect(inspector).toHaveTextContent('Build the interface design system')
    expect(within(inspector).getByText('Button primitive')).toBeTruthy()

    await userEvent.click(within(inspector).getByRole('button', { name: /button primitive/i }))

    expect(screen.getByLabelText('Selected work inspector')).toHaveTextContent('Ship the reusable button primitive')
  })

  it('does not echo the selected title outside the selected work inspector', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'feature-root',
            title: 'Interface design system',
            status: 'in_progress',
            description: 'Build the interface design system.',
            hierarchy: { childIds: ['task-button'], order: 0 },
          }),
          task({
            id: 'task-button',
            title: 'Button primitive',
            status: 'in_progress',
            description: 'Ship the reusable button primitive.',
            hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
          }),
        ]),
      },
    })

    await screen.findByRole('heading', { name: 'Work list' })
    await userEvent.click(screen.getByRole('button', { name: /inspect work interface design system/i }))
    await userEvent.click(within(screen.getByLabelText('Selected work inspector')).getByRole('button', { name: /button primitive/i }))

    const inspector = screen.getByLabelText('Selected work inspector')
    expect((inspector.textContent?.match(/Button primitive/g) ?? []).length).toBe(1)
    expect(within(inspector).getByText('Contained work')).toBeTruthy()
    expect(within(inspector).getByText('Inspector')).toBeTruthy()
  })

  it('shows internal delivery steps as selected-work detail instead of child work in the list inspector', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: {
          ...detail([
            task({
              id: 'feature-root',
              title: 'Import review flow',
              status: 'in_progress',
              description: 'Build the import review flow.',
              hierarchy: { childIds: ['runtime-proof'], order: 0 },
            }),
            task({
              id: 'runtime-proof',
              title: 'Runtime proof for import review flow',
              status: 'blocked',
              workKind: 'test',
              workVisibility: { kind: 'internal_step', countInProjectTotals: false },
              hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
            }),
          ]),
          workProgress: {
            counts: {
              visibleTotal: 1,
              visibleActive: 1,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 0,
              deliveryTotal: 1,
              deliveryRequired: 1,
              deliveryDone: 0,
              deliveryBlocked: 1,
            },
            byTaskId: {
              'feature-root': {
                id: 'feature-root',
                title: 'Import review flow',
                status: 'in_progress',
                visibility: { kind: 'primary', countInProjectTotals: true },
                deliverySteps: [
                  {
                    id: 'task:runtime-proof',
                    title: 'Runtime proof for import review flow',
                    kind: 'verify',
                    status: 'blocked',
                    required: true,
                    blocksCompletion: true,
                    sourceTaskId: 'runtime-proof',
                  },
                ],
                rollup: {
                  primaryState: 'blocked',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 1,
                  requiredStepCount: 1,
                  doneStepCount: 0,
                  blockedStepCount: 1,
                },
              },
            },
          },
        },
      },
    })

    await screen.findByRole('heading', { name: 'Work list' })
    await userEvent.click(screen.getByRole('button', { name: /inspect work import review flow/i }))

    expect(screen.queryByRole('button', { name: /runtime proof for import review flow/i })).toBeNull()
    const inspector = screen.getByLabelText('Selected work inspector')
    expect(within(inspector).getByText('Contained work')).toBeTruthy()
    expect(within(inspector).getByText('This item has tracked delivery steps and no contained work.')).toBeTruthy()
    expect(within(inspector).getByText('Delivery checklist')).toBeTruthy()
    expect(within(inspector).getAllByText('Runtime proof for import review flow').length).toBeGreaterThan(0)
    expect(within(inspector).getByText('Blocked')).toBeTruthy()
  })

  it('keeps list and board as the only Work view controls', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({ id: 'task-ready', title: 'Ready task', status: 'ready' }),
        ]),
      },
    })

    const toolbar = await screen.findByRole('toolbar', { name: /work view controls/i })
    expect(within(toolbar).getByText('Work view')).toBeTruthy()
    expect(within(toolbar).queryByRole('button', { name: /^columns$/i })).toBeNull()
    expect(within(toolbar).getByRole('button', { name: /^list$/i }).getAttribute('aria-pressed')).toBe('true')
    expect(within(toolbar).getByRole('button', { name: /^board$/i }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('combobox', { name: /^show$/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Work list' })).toBeTruthy()

    expect(screen.queryByLabelText('Work hierarchy columns')).toBeNull()

    cleanup()
    path.value = '/projects/looma-knit/work?tree=preview'
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    render(WorkTab, {
      props: {
        detail: detail([
          task({ id: 'task-ready', title: 'Ready task', status: 'ready' }),
        ]),
      },
    })
    const nextToolbar = await screen.findByRole('toolbar', { name: /work view controls/i })
    await userEvent.click(within(nextToolbar).getByRole('button', { name: /^board$/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=board')
  })

  it('flags broad flat ready work as needing breakdown review in the list inspector', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work?tree=preview')
    path.value = '/projects/looma-knit/work?tree=preview'

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'broad-ready',
            title: 'Build end-to-end interface system',
            status: 'ready',
            description: 'Deliver the whole interface system.',
            acceptanceCriteria: Array.from({ length: 7 }, (_, index) => ({
              description: `Requirement ${index + 1}`,
            })),
            hierarchy: { childIds: [], order: 0 },
          }),
        ]),
      },
    })

    await screen.findByRole('heading', { name: 'Work list' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')
    expect(screen.getByText('Review breakdown')).toBeTruthy()
    expect(screen.queryByText('Ready')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /inspect work build end-to-end interface system/i }))

    const inspector = screen.getByLabelText('Selected work inspector')
    expect(within(inspector).getByText(/No contained work or decomposition proposal exists yet/i)).toBeTruthy()
    expect(within(inspector).getByText('Review breakdown')).toBeTruthy()
    expect(within(inspector).getByText(/7 requirements; no contained work or decomposition proposal yet/i)).toBeTruthy()
  })

  it('hides done and shelved work by default and reveals it on request', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-ready',
            title: 'Ready feature work',
            status: 'ready',
            spec: '## Summary\n\nBuild the ready feature work.',
            productBrief: {
              userJob: 'Use the ready feature.',
              whyItMattersNow: 'It is next in the execution queue.',
              successMetric: 'Ready feature works.',
              nonGoals: ['Do not change adjacent features.'],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            acceptanceCriteria: [{ description: 'Ready feature works.' }],
          }),
          task({ id: 'task-done', title: 'Completed feature proof', status: 'done' }),
          task({ id: 'task-shelved', title: 'Shelved idea', status: 'shelved' }),
        ]),
      },
    })

    await screen.findByText('1 shown · 3 total')
    expect(screen.getByText('Ready feature work')).toBeTruthy()
    expect(screen.queryByText('Completed feature proof')).toBeNull()
    expect(screen.queryByText('Shelved idea')).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'all')

    expect(screen.getByText('3 shown · 3 total')).toBeTruthy()
    expect(screen.getByText('Completed feature proof')).toBeTruthy()
    expect(screen.getByText('Shelved idea')).toBeTruthy()
  })

  it('shows flexible work hierarchy breadcrumbs and child rollups without parent-task wording', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'app-spec',
            title: 'Pantry Pulse app spec',
            status: 'ready',
            workKind: 'app_spec',
            hierarchy: { childIds: ['feature-inventory'], order: 0 },
          }),
          task({
            id: 'feature-inventory',
            title: 'Inventory tracking feature',
            status: 'ready',
            workKind: 'feature_spec',
            hierarchy: { parentId: 'app-spec', childIds: ['task-build-inventory'], order: 0 },
          }),
          task({
            id: 'task-build-inventory',
            title: 'Build inventory list',
            status: 'ready',
            workKind: 'implementation',
            hierarchy: { parentId: 'feature-inventory', childIds: [], order: 0 },
          }),
        ]),
      },
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'open')

    await screen.findByText('Pantry Pulse app spec')
    expect(screen.getAllByText('1 nested work item').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Pantry Pulse app spec / Inventory tracking feature')).toBeTruthy()
    expect(screen.getByText('Pantry Pulse app spec / Inventory tracking feature / Build inventory list')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/parent task/i)
  })

  it('uses explicit work summary labels instead of overloaded active/draft terms', async () => {
    render(WorkTab, {
      props: {
        detail: runningDetail([
          task({ id: 'task-brief', title: 'Shape brief', status: 'exploring' }),
          task({ id: 'task-build', title: 'Build contracts', status: 'in_progress' }),
          task({
            id: 'task-ready',
            title: 'Ready work',
            status: 'ready',
            spec: '## Summary\n\nBuild the ready work.',
            productBrief: {
              userJob: 'Use the ready work.',
              whyItMattersNow: 'Ready work is queued for the current run.',
              successMetric: 'Ready work functions.',
              nonGoals: ['Do not change adjacent contracts.'],
              approvedAt: '2026-05-23T12:00:00.000Z',
            },
            acceptanceCriteria: [{ description: 'Ready work functions.' }],
          }),
          task({ id: 'task-import', title: 'Imported note', status: 'import_draft' }),
        ]),
      },
    })

    expect(await screen.findByText('1 Working')).toBeTruthy()
    expect(screen.getByText('1 Ready')).toBeTruthy()
    expect(screen.queryByText('1 being shaped')).toBeNull()
    expect(screen.queryByText('1 import draft')).toBeNull()
    expect(document.body.textContent).not.toContain('agent-active')
    expect(document.body.textContent).not.toContain('ready for worker')
    expect(document.body.textContent).not.toContain('2 active')
    expect(document.body.textContent).not.toContain('1 imported drafts')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')

    expect(screen.getByText('Queued')).toBeTruthy()
    expect(screen.getByText('1 import draft')).toBeTruthy()
  })

  it('defaults to Planning when a project has shaping work but no execution-ready work', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-import-1y7kmp6',
            title: 'Block menu / block side menu',
            status: 'exploring',
            spec: '## Summary\n\nBuild the block menu.',
            acceptanceCriteria: [{ description: 'The block menu can be opened.' }],
            openQuestions: [],
          }),
          task({
            id: 'task-import-1aessks',
            title: 'Floating toolbar',
            status: 'exploring',
          }),
        ]),
      },
    })

    expect(await screen.findByText('2 shown · 2 total')).toBeTruthy()
    expect(screen.getByRole('option', { name: /^ready to run$/i })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: /^show$/i }) as HTMLSelectElement).value).toBe('planning')
    expect(screen.queryByText('No work is ready to run yet.')).toBeNull()
    expect(screen.queryByText('No queued work yet.')).toBeNull()
    expect(screen.getByRole('option', { name: /^planning$/i })).toBeTruthy()
    expect(screen.getByText('Block menu / block side menu')).toBeTruthy()
    expect(screen.getAllByText('Paused').length).toBeGreaterThanOrEqual(2)
    expect(document.body.textContent).not.toContain('Intake')
  })

  it('labels inactive in-progress work as paused when no project run is active', async () => {
    render(WorkTab, {
      props: {
        detail: pausedDetail([
          task({ id: 'task-build', title: 'Build contracts', status: 'in_progress' }),
        ]),
      },
    })

    expect(await screen.findByText('1 paused task')).toBeTruthy()
    expect(screen.queryByText('1 agent-active')).toBeNull()
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.queryByText('In progress')).toBeNull()
  })

  it('keeps active internal steps visible while Guildhall is working on them', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...runningDetail([
            task({
              id: 'feature-root',
              title: 'Define fixture schemas',
              status: 'ready',
              hierarchy: { childIds: ['fixture-ground-truth'], order: 0 },
            }),
            task({
              id: 'fixture-ground-truth',
              title: 'Shape fixture and expected-record ground truth',
              status: 'in_progress',
              hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
            }),
          ]),
          workProgress: {
            counts: {
              visibleTotal: 1,
              visibleActive: 1,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 0,
              deliveryTotal: 2,
              deliveryRequired: 2,
              deliveryDone: 0,
              deliveryBlocked: 0,
            },
            byTaskId: {
              'feature-root': {
                id: 'feature-root',
                title: 'Define fixture schemas',
                status: 'ready',
                visibility: { kind: 'primary', countInProjectTotals: true },
                deliverySteps: [],
                rollup: {
                  primaryState: 'ready',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 1,
                  requiredStepCount: 1,
                  doneStepCount: 0,
                  blockedStepCount: 0,
                },
              },
              'fixture-ground-truth': {
                id: 'fixture-ground-truth',
                title: 'Shape fixture and expected-record ground truth',
                status: 'in_progress',
                visibility: { kind: 'internal_step', countInProjectTotals: false },
                deliverySteps: [],
                rollup: {
                  primaryState: 'active',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 0,
                  requiredStepCount: 0,
                  doneStepCount: 0,
                  blockedStepCount: 0,
                },
              },
            },
          },
        },
      },
    })

    expect(await screen.findByText('Shape fixture and expected-record ground truth')).toBeTruthy()
    expect(screen.getByText('1 shown · 2 total')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: /^show$/i }) as HTMLSelectElement).value).toBe('queued')
    expect(screen.getByText('1 Working')).toBeTruthy()
  })

  it('keeps the primary-action internal shaping task visible in Work', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([
            task({
              id: 'feature-root',
              title: 'Define fixture schemas',
              status: 'ready',
              hierarchy: { childIds: ['fixture-ground-truth'], order: 0 },
            }),
            task({
              id: 'fixture-ground-truth',
              title: 'Shape fixture and expected-record ground truth',
              status: 'exploring',
              hierarchy: { parentId: 'feature-root', childIds: [], order: 0 },
            }),
          ], {
            actionModel: {
              primaryAction: {
                source: 'task',
                label: 'Shape fixture and expected-record ground truth',
                buttonLabel: 'Open Work',
                href: '/work?task=fixture-ground-truth',
                tone: 'accent',
                taskId: 'fixture-ground-truth',
              },
              secondaryActions: [],
              runControl: { label: 'Resume', startEnabled: true },
              ownerInput: { active: false },
              setup: { state: 'ready', freshIntakeNeeded: false },
            },
          }),
          workProgress: {
            counts: {
              visibleTotal: 1,
              visibleActive: 1,
              visibleBlocked: 0,
              visibleDone: 0,
              visibleShelved: 0,
              deliveryTotal: 2,
              deliveryRequired: 2,
              deliveryDone: 0,
              deliveryBlocked: 0,
            },
            byTaskId: {
              'feature-root': {
                id: 'feature-root',
                title: 'Define fixture schemas',
                status: 'ready',
                visibility: { kind: 'primary', countInProjectTotals: true },
                deliverySteps: [],
                rollup: {
                  primaryState: 'ready',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 1,
                  requiredStepCount: 1,
                  doneStepCount: 0,
                  blockedStepCount: 0,
                },
              },
              'fixture-ground-truth': {
                id: 'fixture-ground-truth',
                title: 'Shape fixture and expected-record ground truth',
                status: 'exploring',
                visibility: { kind: 'internal_step', countInProjectTotals: false },
                deliverySteps: [],
                rollup: {
                  primaryState: 'active',
                  visibleChildCount: 0,
                  visibleChildDoneCount: 0,
                  internalStepCount: 0,
                  requiredStepCount: 0,
                  doneStepCount: 0,
                  blockedStepCount: 0,
                },
              },
            },
          },
        },
      },
    })

    expect(await screen.findByText('Shape fixture and expected-record ground truth')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: /^show$/i }) as HTMLSelectElement).value).toBe('planning')
    expect(screen.getByText('2 shown · 2 total')).toBeTruthy()
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('keeps stopped gate checks labeled as gate work instead of paused work', async () => {
    render(WorkTab, {
      props: {
        detail: pausedDetail([
          task({ id: 'task-gates', title: 'Implement minimal harness orchestration skeleton', status: 'gate_check' }),
        ]),
      },
    })

    expect(await screen.findByText('Gates')).toBeTruthy()
    expect(screen.queryByText('Paused')).toBeNull()
  })

  it('separates spec-thin ready tasks from worker-ready tasks', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-worker-ready',
            title: 'Approved worker task',
            status: 'ready',
            description: 'Implement the approved path.',
            spec: '## Summary\n\nImplement the approved path.',
            productBrief: {
              userJob: 'Use the approved flow.',
              whyItMattersNow: 'The flow is release-blocking.',
              successMetric: 'Flow works.',
              nonGoals: ['Do not redesign adjacent flows.'],
              approvedAt: '2026-05-23T12:00:00.000Z',
            },
            acceptanceCriteria: [{ description: 'The approved flow works.' }],
          }),
          task({
            id: 'task-needs-brief',
            title: 'Needs brief cleanup',
            status: 'ready',
            description: 'Still needs acceptance criteria.',
            productBrief: { userJob: 'Use the incomplete flow.', successMetric: 'Flow works.' },
          }),
          task({
            id: 'task-needs-acceptance',
            title: 'Needs acceptance cleanup',
            status: 'ready',
            description: 'Brief is approved, but acceptance criteria are missing.',
            spec: '## Summary\n\nImplement the partially approved path.',
            productBrief: { userJob: 'Use the partial flow.', successMetric: 'Flow works.', approvedAt: '2026-05-23T12:00:00.000Z' },
            acceptanceCriteria: [],
          }),
        ]),
      },
    })

    expect(await screen.findByText('1 Ready')).toBeTruthy()
    expect(screen.queryByText('2 Needs brief')).toBeNull()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')

    expect(screen.getByText('2 Needs brief')).toBeTruthy()
    expect(screen.queryByText('3 ready for worker')).toBeNull()
  })

  it('puts the wide work-list grid inside a named horizontal scroll region', () => {
    const source = readFileSync('src/web/surfaces/project/WorkTab.svelte', 'utf8')
    const scrollBlock = source.match(/\.work-list-scroll\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const stackBlock = source.match(/:global\(\.work-list-stack\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(source).toContain('class="work-list-scroll"')
    expect(source).toContain('aria-label="Scrollable work list columns"')
    expect(scrollBlock).toContain('overflow-x: auto')
    expect(stackBlock).toContain('minmax(280px, 1fr)')
    expect(stackBlock).toContain('inline-size: max(100%, 860px)')
    expect(source).toContain('@media (max-width: 860px)')
    expect(source).toContain('--work-list-columns: minmax(0, 1fr)')
  })

  it('routes imported-draft review and view-mode controls through project-scoped links', async () => {
    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-import-first',
            title: 'First imported note',
            status: 'import_draft',
            updatedAt: '2026-05-19T12:00:00.000Z',
          }),
          task({
            id: 'task-import-second',
            title: 'Second imported note',
            status: 'import_draft',
            updatedAt: '2026-05-19T11:00:00.000Z',
          }),
        ]),
      },
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^show$/i }), 'planning')
    await screen.findByText('Imported draft queue')
    expect(screen.getByText(/1 more drafts are queued behind it/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /draft task brief/i }))
    expect(path.value).toBe('/projects/looma-knit/task/task-import-first')

    path.value = '/projects/looma-knit/work'
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    await userEvent.click(screen.getByRole('button', { name: /board/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=board')
  })

  it('switches board mode back to the work list without depending on the details pane', async () => {
    render(WorkTab, {
      props: {
        mode: 'board',
        detail: detail([
          task({
            id: 'task-board',
            title: 'Board task',
            status: 'ready',
            productBrief: {
              userJob: 'Use the board task.',
              whyItMattersNow: 'The board task is the next runnable item.',
              successMetric: 'It appears as the next focus.',
              nonGoals: ['Do not change board layout.'],
              approvedAt: '2026-05-19T10:00:00.000Z',
            },
            spec: 'Build the board task.',
            acceptanceCriteria: [{ description: 'Shows on the board.' }],
          }),
        ]),
      },
    })

    await screen.findByText('Next focus')
    expect(within(screen.getByText('Next focus').closest('.focus-strip') as HTMLElement).getByText('Board task')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^board$/i }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: /list/i }))
    expect(path.value).toBe('/projects/looma-knit/work')
    expect(path.href).toBe('/projects/looma-knit/work?view=list')
  })

  it('renders progress metadata with friendly labels instead of raw identifiers', async () => {
    cleanup()
    installBrowserFakes(`# Looma + Knit Progress

### 🏁 MILESTONE — 2026-05-21T18:30:00.000Z
**Agent:** spec-agent | **Domain:** _meta
**Task:** task-alpha

Drafted full blueprint spec and moved task to spec_review.

---`)

    render(WorkTab, {
      props: {
        detail: detail([
          task({
            id: 'task-alpha',
            title: 'Shape merchant platform spec',
            description: 'Turn the commerce idea into a buildable spec.',
            status: 'spec_review',
            domain: '_meta',
          }),
        ]),
      },
    })

    await screen.findByText('Recent progress')
    await userEvent.click(screen.getByText('Recent progress'))

    expect(await screen.findByText('Spec writer')).toBeTruthy()
    expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
    expect(screen.getByText('Milestone')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /shape merchant platform spec/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/moved the task to awaiting approval/i)).toBeTruthy()
    expect(document.body.textContent).not.toContain('spec-agent')
    expect(document.body.textContent).not.toContain('_meta')
    expect(document.body.textContent).not.toContain('spec_review')
    expect(document.body.textContent).not.toContain('task-alpha')
  })

  it('reloads recent progress with the rendered project id when switching projects', async () => {
    cleanup()
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, 'http://localhost')
      const projectId = parsed.searchParams.get('projectId')
      return json({
        progress: projectId === 'font-something'
          ? 'Font project progress'
          : 'Looma project progress',
    })
  })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    path.value = '/projects/looma-knit/work'

    const rendered = render(WorkTab, {
      props: {
        detail: detail([]),
      },
    })
    expect(await screen.findByText('Looma project progress')).toBeTruthy()

    rendered.rerender({
      detail: {
        ...detail([]),
        id: 'font-something',
        name: 'Font something',
        path: '/repo/font-something',
      },
    })

    expect(await screen.findByText('Font project progress')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Looma project progress')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/project/progress?projectId=looma-knit',
      '/api/project/progress?projectId=font-something',
    ])
  })

  it('routes an empty setup project to the setup flow instead of leaving Work inert', async () => {
    render(WorkTab, {
      props: {
        detail: {
          ...detail([]),
          config: { coordinators: [] },
        } as ProjectDetail,
      },
    })

    await screen.findByText('No tasks yet. Finish project setup first.')
    await userEvent.click(screen.getByRole('button', { name: /open setup/i }))
    expect(path.value).toBe('/projects/looma-knit/setup')
  })
})
