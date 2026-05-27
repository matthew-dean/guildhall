// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsTab from '../SettingsTab.svelte'
import { path } from '../../../lib/nav.svelte.js'
import { project } from '../../../lib/project.svelte.js'

const now = '2026-05-19T16:00:00.000Z'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installProjectState() {
  window.history.replaceState({}, '', '/projects/looma-knit/settings')
  path.value = '/projects/looma-knit/settings'
  project.error = null
  project.detail = {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/workspace/looma-knit',
    tasks: [],
    config: {
      coordinators: [
        {
          id: 'editor-coordinator',
          name: 'Editor coordinator',
          domain: 'Editor',
          mandate: 'Keep editor work scoped.',
        },
      ],
    },
  }
}

function codebaseMapStatus(overrides: Record<string, unknown> = {}) {
  return {
    configured: false,
    generatedAt: null,
    stale: null,
    counts: { files: 0, areas: 0, abstractions: 0 },
    designSystem: null,
    frameworks: [],
    packageManagers: [],
    ...overrides,
  }
}

function providersPayload(preferredProvider = 'openai-api') {
  return {
    preferredProvider,
    providers: {
      'openai-api': {
        label: 'Remote OpenAI-compatible',
        detected: true,
        detail: 'Stored globally.',
        verifiedAt: now,
      },
    },
  }
}

describe('SettingsTab', () => {
  beforeEach(() => {
    installProjectState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    project.detail = null
    project.error = null
  })

  it('runs bootstrap from readiness and reports the detected gates in the toast', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') {
        return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      }
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: true,
          needed: false,
          status: null,
          bootstrap: {
            commands: ['pnpm install'],
            successGates: ['pnpm test'],
            timeoutMs: 120000,
          },
        })
      }
      if (url.pathname === '/api/project/bootstrap/run') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({
          detected: {
            packageManager: 'pnpm',
            gates: {
              test: { available: true },
              build: { available: true },
              lint: { available: false },
            },
          },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(screen.getByRole('button', { name: 'Providers' }))
    expect(path.value).toBe('/projects/looma-knit/settings/providers')

    const runBootstrapButton = screen.getByRole('button', { name: /^run bootstrap$/i })
    expect(runBootstrapButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(runBootstrapButton)

    await screen.findByText('Bootstrap verified (pnpm): test, build')
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/bootstrap/run'))).toBe(true)
  })

  it('surfaces bootstrap run failures without marking the project ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json({ preferredProvider: null, providers: {} })
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({ configured: true, needed: true, status: null, bootstrap: { commands: [], successGates: [], timeoutMs: 0 } })
      }
      if (url.pathname === '/api/project/bootstrap/run') return json({ error: 'pnpm install failed' }, 500)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    await userEvent.click(screen.getByRole('button', { name: /^run bootstrap$/i }))

    await screen.findByText('Bootstrap failed: pnpm install failed')
    expect(screen.getByText('pnpm install failed')).toBeInTheDocument()
  })

  it('explains workspace child-project gates without treating the root shell as the only app', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: false,
          needed: false,
          status: null,
          workspaceProjects: [
            {
              id: 'looma',
              label: 'Looma',
              path: 'looma',
              bootstrap: { commands: ['pnpm install'], successGates: ['pnpm test'], timeoutMs: 120000 },
            },
            {
              id: 'knit',
              label: 'Knit',
              path: 'knit',
              bootstrap: { commands: ['pnpm install'], successGates: ['pnpm typecheck'], timeoutMs: 120000 },
            },
          ],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('2 child projects')).toBeInTheDocument()
    expect(screen.getByText('This workspace coordinates child projects')).toBeInTheDocument()
    expect(screen.getByText(/The root shell is the council layer/)).toBeInTheDocument()
    expect(screen.getByText('Looma')).toBeInTheDocument()
    expect(screen.getByText('Knit')).toBeInTheDocument()
    expect(screen.getAllByText('1 gate')).toHaveLength(2)
  })

  it('counts bootstrap as ready when the project does not need bootstrap commands', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Fair Labor License', id: 'fair-labor-license' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: false,
          needed: false,
          status: null,
          workspaceProjects: [],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('3/3 ready')).toBeInTheDocument()
    expect(screen.getByText('not required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run bootstrap$/i })).not.toBeInTheDocument()
  })

  it('does not count bootstrap as ready when a previous pass succeeded but must be rerun', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') return json({ initialized: true, name: 'Narrative Harness', id: 'narrative-harness' })
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') {
        return json({
          configured: true,
          needed: true,
          status: {
            success: true,
            lastRunAt: now,
            durationMs: 120,
            steps: [],
          },
          bootstrap: {
            commands: ['pnpm install'],
            successGates: ['pnpm build'],
            timeoutMs: 120000,
          },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'ready' })

    await screen.findByRole('heading', { name: /ready to start/i })
    expect(screen.getByText('2/3 ready')).toBeInTheDocument()
    expect(screen.getAllByText('re-run needed')).toHaveLength(2)
    const rerunBootstrapButton = screen.getByRole('button', { name: /^run bootstrap$/i })
    expect(rerunBootstrapButton).toBeInTheDocument()
    expect(rerunBootstrapButton.classList.contains('v-agent')).toBe(true)
  })

  it('saves advanced identity, resets lever errors, and approves a design-system draft', async () => {
    const refresh = vi.spyOn(project, 'refresh').mockResolvedValue()
    let leverOverride = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') {
        return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      }
      if (url.pathname === '/api/config/levers' && init?.method !== 'POST') {
        return json({
          error: fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/config/levers/reset'))
            ? undefined
            : 'Lever file is malformed.',
          levers: fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/config/levers/reset'))
            ? [
                {
                  name: 'worktree_isolation',
                  position: 'per_task',
                  defaultPosition: 'per_task',
                  setBy: leverOverride ? 'user-direct' : 'system-default',
                  rationale: 'Use one isolated worktree per task.',
                  scope: 'project',
                },
                {
                  name: 'review_effort',
                  position: 'balanced',
                  defaultPosition: 'balanced',
                  setBy: 'system-default',
                  rationale: 'Use balanced review depth while calibration data accumulates.',
                  scope: 'domain:default',
                },
              ]
            : undefined,
        })
      }
      if (url.pathname === '/api/config/levers/reset') {
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/config/levers' && init?.method === 'POST') {
        leverOverride = true
        expect(JSON.parse(String(init.body))).toMatchObject({
          scope: 'project',
          name: 'worktree_isolation',
          position: 'per_attempt',
        })
        return json({
          levers: [
            {
              name: 'worktree_isolation',
              position: 'per_attempt',
              defaultPosition: 'per_task',
              setBy: 'user-direct',
              rationale: 'Set from project settings.',
              scope: 'project',
            },
          ],
        })
      }
      if (url.pathname === '/api/project/design-system') {
        return json({
          designSystem: {
            revision: 2,
            authoredBy: 'design-agent',
            authoredAt: now,
            primitives: [{ name: 'Button', usage: 'Primary actions' }],
            tokens: { color: [{ name: 'accent' }], spacing: [{ name: 'sm' }] },
            copyVoice: { tone: 'plain' },
            a11y: { minContrastRatio: 4.5 },
            approvedAt: fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/project/design-system/approve'))
              ? now
              : undefined,
          },
        })
      }
      if (url.pathname === '/api/project/design-system/approve') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/codebase-map/status') {
        return json(codebaseMapStatus({
          configured: true,
          generatedAt: now,
          counts: { files: 121, areas: 8, abstractions: 5 },
          project: {
            summary: 'Local project with Svelte workers and documentation.',
            languages: ['typescript', 'svelte'],
            packageManagers: ['pnpm'],
            primaryFrameworks: ['svelte'],
          },
          entrypoints: [
            { kind: 'readme', path: 'README.md', summary: 'Repository overview.' },
          ],
          areas: [
            {
              id: 'web-ui',
              title: 'Web UI',
              summary: 'Project view and task surfaces.',
              owns: ['src/web/**'],
              canonicalFiles: [{ path: 'src/web/surfaces/ProjectView.svelte', symbols: [], summary: 'Project shell.' }],
              conventions: ['Keep task cards readable.'],
              tests: ['src/web/surfaces/__tests__/ProjectView.svelte.test.ts'],
            },
          ],
          abstractions: [
            {
              id: 'button',
              title: 'Button',
              kind: 'component',
              canonicalPath: 'packages/ui/src/components/Button.svelte',
              useWhen: ['Use for click actions instead of local button styling.'],
              avoid: ['Do not invent one-off button treatments.'],
              related: ['src/web/lib/Button.svelte'],
            },
          ],
          semantic: {
            modelId: 'zai-org/GLM-4.6',
            corpusKind: 'documentation',
            confidence: 0.95,
            projectPurpose: 'Documentation-led product specification.',
            currentTruth: ['Thread cards should be readable without opening details.'],
            architectureAreas: [{
              name: 'Thread UI',
              purpose: 'Shows current work and user decisions.',
              canonicalFiles: ['src/web/surfaces/project/ThreadTab.svelte'],
            }],
            canonicalAbstractions: [{
              name: 'Task drawer',
              purpose: 'Details for one task.',
              canonicalFiles: ['src/web/surfaces/TaskDrawer.svelte'],
              reuseRule: 'Open the drawer for details; keep thread cards scannable.',
            }],
            gapsOrRisks: ['Some older tasks still use opaque internal wording.'],
            readNext: [{ path: 'docs/architecture.md', reason: 'Canonical architecture note.' }],
            workerGuidance: ['Read the semantic map before editing.'],
            needsBroaderRead: true,
          },
          designSystem: {
            maturity: 'thin',
            approved: true,
            tokenCounts: { color: 2, spacing: 2, typography: 0, radius: 1, shadow: 0 },
            primitives: 1,
            recommendations: ['UI surface area is larger than the captured token/primitive set.'],
          },
          frameworks: ['svelte'],
          packageManagers: ['pnpm'],
        }))
      }
      if (url.pathname === '/api/project/codebase-map/refresh') {
        expect(init?.method).toBe('POST')
        return json({
          ok: true,
          mode: 'full',
          status: codebaseMapStatus({
            configured: true,
            generatedAt: now,
            counts: { files: 122, areas: 8, abstractions: 6 },
          }),
        })
      }
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: false, needed: true, status: null })
      if (url.pathname === '/api/setup/identity') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: 'Looma and Knit',
          id: 'looma-and-knit',
        })
        return json({ ok: true })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'advanced' })

    await screen.findByRole('heading', { name: /advanced settings/i })
    await userEvent.clear(screen.getByLabelText(/workspace name/i))
    await userEvent.type(screen.getByLabelText(/workspace name/i), 'Looma and Knit')
    await userEvent.clear(screen.getByLabelText(/workspace id/i))
    await userEvent.type(screen.getByLabelText(/workspace id/i), 'looma-and-knit')
    await userEvent.click(screen.getByRole('button', { name: /save identity/i }))

    await screen.findByText('Saved')
    expect(refresh).toHaveBeenCalled()

    await screen.findByText('Lever file is malformed.')
    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }))
    await screen.findByText(/Worktree isolation/i)
    await screen.findByText(/Review effort/i)
    expect(screen.getByRole('option', { name: /Release-critical/i })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /worktree isolation setting/i }), 'per_attempt')
    await screen.findByText(/Current: Per attempt/)

    await screen.findByRole('heading', { name: 'Codebase map' })
    expect(screen.getByText('121')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('thin')).toBeInTheDocument()
    expect(screen.getByText('documentation')).toBeInTheDocument()
    expect(screen.getByText('Local project with Svelte workers and documentation.')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('zai-org/GLM-4.6')).toBeInTheDocument()
    expect(screen.getByText('Documentation-led product specification.')).toBeInTheDocument()
    expect(screen.getByText('Thread cards should be readable without opening details.')).toBeInTheDocument()
    expect(screen.getByText('docs/architecture.md')).toBeInTheDocument()
    expect(screen.getByText(/Read the semantic map before editing/i)).toBeInTheDocument()
    expect(screen.getByText('Web UI')).toBeInTheDocument()
    expect(screen.getByText('Project view and task surfaces.')).toBeInTheDocument()
    expect(screen.getAllByText('Button').length).toBeGreaterThan(0)
    expect(screen.getByText('packages/ui/src/components/Button.svelte')).toBeInTheDocument()
    expect(screen.getByText('Thread UI')).toBeInTheDocument()
    expect(screen.getByText('Task drawer')).toBeInTheDocument()
    expect(screen.getByText('Some older tasks still use opaque internal wording.')).toBeInTheDocument()
    expect(screen.getByText('UI surface area is larger than the captured token/primitive set.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /refresh map/i }))
    await screen.findByText('122')

    await screen.findByText('Revision 2')
    await userEvent.click(screen.getByRole('button', { name: /approve current draft/i }))
    await screen.findByText('approved')
  })

  it('reviews learned project habits, preferences, playbooks, and product ideas', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/setup/status') {
        return json({ initialized: true, name: 'Looma + Knit', id: 'looma-knit' })
      }
      if (url.pathname === '/api/config/levers') return json({ levers: [] })
      if (url.pathname === '/api/project/design-system') return json({ designSystem: null })
      if (url.pathname === '/api/project/codebase-map/status') return json(codebaseMapStatus())
      if (url.pathname === '/api/setup/providers') return json(providersPayload())
      if (url.pathname === '/api/project/bootstrap/status') return json({ configured: false, needed: true, status: null })
      if (url.pathname === '/api/project/learning/action') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          kind: 'accept',
          scope: 'project',
          id: 'learn-1',
        })
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/skill-proposals/action') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          kind: 'activate',
          id: 'skill-1',
          approved: true,
        })
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/learning') {
        const accepted = fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/project/learning/action'))
        const skillActivated = fetchMock.mock.calls.some(([prior]) => String(prior).includes('/api/project/skill-proposals/action'))
        return json({
          project: {
            workspaceImport: {
              approvedRuns: 2,
              dismissedRuns: 0,
              averageTaskAcceptanceRatio: 1,
              updatedAt: now,
            },
            suggestedLearnings: [
              {
                id: 'learn-1',
                summary: 'Run Knit typecheck from web root after API changes.',
                destination: 'project_memory',
                scope: 'project',
                confidence: 'high',
                risk: 'medium',
                status: accepted ? 'active' : 'suggested',
                evidence: [{
                  summary: 'The workspace members task failed until the scoped typecheck was rerun.',
                  links: [{
                    kind: 'task',
                    label: 'Open task evidence',
                    href: '/task/task-link-editor',
                    localHistoryRef: 'transcripts/exploring/task-link-editor.md',
                  }],
                }],
              },
            ],
          },
          user: {
            suggestedLearnings: [
              {
                id: 'user-1',
                summary: 'Prefer sentence-case project titles.',
                destination: 'user_preference',
                scope: 'user_global',
                confidence: 'medium',
                risk: 'low',
                status: 'suggested',
              },
            ],
          },
          effective: {
            workspaceImport: {
              approvedRuns: 2,
              dismissedRuns: 0,
              averageTaskAcceptanceRatio: 1,
              updatedAt: now,
            },
            productSuggestions: [
              {
                id: 'product-1',
                title: 'Make outline-first task shaping explicit',
                summary: 'Ask coordinators to draft structure before implementation.',
                evidence: ['Navigation work needed a stable outline before UI fill-in.'],
              },
            ],
          },
          projectContext: {
            projectBrief: { present: true, nonEmptyLines: 2 },
            workspaceGoals: { present: true, goalCount: 1 },
            decisions: { present: true, nonEmptyLines: 9 },
            projectNotes: { present: true, nonEmptyLines: 0 },
          },
          projectSkillProposals: [
            {
              id: 'skill-1',
              name: 'Workspace API repair playbook',
              description: 'Read the API route, run the scoped typecheck, then patch the narrow handler.',
              status: skillActivated ? 'active' : 'suggested',
              triggerKeywords: ['workspace', 'api'],
            },
          ],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SettingsTab, { subView: 'learning' })

    await screen.findByRole('heading', { name: /reusable guidance/i })
    expect(screen.getByText('0 in use')).toBeInTheDocument()
    expect(screen.getByText('3 waiting')).toBeInTheDocument()
    expect(screen.getByText('Project context Guildhall already has')).toBeInTheDocument()
    expect(screen.getByText('Project brief')).toBeInTheDocument()
    expect(screen.getByText('Workspace goals')).toBeInTheDocument()
    expect(screen.getByText('Import choices')).toBeInTheDocument()
    expect(screen.getByText('Decision log')).toBeInTheDocument()
    expect(screen.getByText('2 approved')).toBeInTheDocument()
    expect(screen.getByText('1 goal')).toBeInTheDocument()
    expect(screen.getByText('Run Knit typecheck from web root after API changes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open task evidence/i })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-link-editor',
    )
    expect(screen.getByText('Project memory')).toBeInTheDocument()
    expect(screen.getByText('Strong signal')).toBeInTheDocument()
    expect(screen.getByText('Needs care')).toBeInTheDocument()
    expect(screen.getByText('Prefer sentence-case project titles.')).toBeInTheDocument()
    expect(screen.getByText('Workspace API repair playbook')).toBeInTheDocument()
    expect(screen.getByText('workspace')).toBeInTheDocument()
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByText('Make outline-first task shaping explicit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /give product feedback/i })).toHaveAttribute(
      'href',
      expect.stringContaining('Make+outline-first+task+shaping+explicit'),
    )

    await userEvent.click(screen.getByRole('button', { name: /use this/i }))
    await screen.findByText('1 in use')
    expect(screen.getByText('2 waiting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /use playbook/i }))
    await screen.findByText('2 in use')
  })
})
