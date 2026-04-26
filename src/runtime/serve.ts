import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync, promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { atomicWriteText } from '@guildhall/sessions'
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  bootstrapWorkspace,
  readProjectConfig,
  updateProjectConfig,
  FORGE_YAML_FILENAME,
  slugify,
  readGlobalProviders,
  setProvider,
  removeProvider,
  markProviderVerified,
  resolveGlobalCredentials,
  migrateProjectProvidersToGlobal,
  type ProviderKind,
} from '@guildhall/config'
import { MODEL_CATALOG, DEFAULT_LOCAL_MODEL_ASSIGNMENT, type ModelAssignmentConfig } from '@guildhall/core'
import {
  loadLeverSettings,
  saveLeverSettings,
  defaultAgentSettingsPath,
  makeDefaultSettings,
} from '@guildhall/levers'
import { resolveEscalation, updateDesignSystem } from '@guildhall/tools'
import { DesignSystem, summarizeDesignSystem } from '@guildhall/core'
import {
  loadProjectGuildRoster,
  selectApplicableGuilds,
  reviewersForTask,
  pickPrimaryEngineer,
} from '@guildhall/guilds'
import { OrchestratorSupervisor } from './serve-supervisor.js'
import { selectApiClient, type PreferredProviderKey } from './provider-selection.js'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
  createBugReportTask,
  parseStackTraceTopFile,
} from './intake.js'
import { loadDesignSystem, saveDesignSystem } from './design-system-store.js'
import {
  approveMetaIntake,
  createMetaIntakeTask,
  META_INTAKE_TASK_ID,
  parseCoordinatorDraft,
  synthesizeMetaIntakeDraft,
  workspaceNeedsMetaIntake,
} from './meta-intake.js'
import {
  readBootstrapStatus,
  bootstrapNeeded,
  runBootstrap,
} from './bootstrap-runner.js'
import {
  runBootstrap as runDetectedBootstrap,
  writeBootstrapResult,
} from './bootstrap.js'
import {
  maybeSeedWorkspaceImport,
  approveWorkspaceImport,
  createWorkspaceImportTask,
  parseWorkspaceImport,
  workspaceNeedsImport,
  WORKSPACE_IMPORT_TASK_ID,
  formatDetectedDraftAsSpec,
} from './workspace-importer.js'
import {
  detectWorkspaceSignals,
  formWorkspaceHypothesis,
} from './workspace-import/index.js'
import { buildInbox, buildInboxBlockers, detectRepoAnchors } from './inbox.js'
import { buildThread } from './thread.js'
import {
  buildSnapshot,
  listWizards,
  progressFor,
  readWizardsState,
  emptyWizardsState,
  buildTaskSnapshot,
  listTaskWizards,
  progressForTask,
  type WizardsState,
} from './wizards.js'
import { stringify as stringifyYaml } from 'yaml'

// ---------------------------------------------------------------------------
// guildhall serve — single-project dashboard
//
// One `guildhall serve` instance corresponds to one project directory. The
// project path is resolved on boot (defaults to cwd) and drives every
// endpoint; there is no cross-project registry here. Cross-project
// aggregation is guild-pro's job.
//
// Routes:
//   GET    /                          → SPA (root = project detail or setup)
//   GET    /setup                     → SPA setup wizard route
//   GET    /api/project               → project detail (config + tasks + run state)
//   POST   /api/project/start         → boot the orchestrator for this project
//   POST   /api/project/stop          → graceful stop
//   POST   /api/project/intake        → create an exploring task
//   POST   /api/project/meta-intake   → create the bootstrap task
//   GET    /api/project/meta-intake/draft → current task spec + parsed coordinator draft preview
//   POST   /api/project/meta-intake/approve → merge the draft into guildhall.yaml
//   GET    /api/project/needs-meta-intake
//   GET    /api/project/bootstrap/status   → last run + whether it needs re-running
//   POST   /api/project/bootstrap/run      → run the verified bootstrap synchronously
//   GET    /api/project/task/:id      → full task + recent events for drawer
//   POST   /api/project/task/:id/pause              → human override → blocked
//   POST   /api/project/task/:id/shelve             → human override → shelved
//   POST   /api/project/task/:id/unshelve           → shelved → proposed (clear shelveReason)
//   POST   /api/project/task/:id/approve-spec       → exploring → spec_review
//   POST   /api/project/task/:id/approve-brief      → mark the product brief as human-approved
//   POST   /api/project/task/:id/resume             → append follow-up to exploring transcript
//   POST   /api/project/task/:id/resolve-escalation → close an open escalation; unblocks when none remain
//   GET    /api/project/activity      → summary for persistent agent chip
//   GET    /api/project/progress      → tail of memory/PROGRESS.md
//   GET    /api/project/events        → SSE feed of orchestrator events
//   GET    /api/config                → project-local config (secrets redacted)
//   GET    /api/config/levers         → lever positions for Settings UI
//   GET    /api/project/design-system → current design system (or null)
//   POST   /api/project/design-system → author/revise the design system
//   POST   /api/project/design-system/approve → mark current DS as human-approved
//   GET    /api/project/release-readiness → aggregated release-readiness readout
//   GET    /api/setup/providers       → detect installed providers
//   POST   /api/setup/providers/config → save chosen provider/API key
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port?: number
  /** Absolute path to the project root. Defaults to process.cwd(). */
  projectPath?: string
}

interface ResolvedProject {
  path: string
  id: string
  /** Null if guildhall.yaml is missing — wizard handles this case. */
  config: ReturnType<typeof readWorkspaceConfig> | null
  initializationNeeded: boolean
}

// ---------------------------------------------------------------------------
// Wizards helpers — small shims so serve.ts doesn't have to know about the
// on-disk layout of memory/wizards.yaml.
// ---------------------------------------------------------------------------
function writeWizardsState(projectPath: string, state: WizardsState): void {
  const memDir = join(projectPath, 'memory')
  if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true })
  const path = join(memDir, 'wizards.yaml')
  writeFileSync(path, stringifyYaml(state), 'utf8')
}

function mutateSkip(
  state: WizardsState,
  wizardId: string,
  stepId: string,
  mode: 'add' | 'remove',
): WizardsState {
  const prev = state.skipped[wizardId] ?? []
  const set = new Set(prev)
  if (mode === 'add') set.add(stepId)
  else set.delete(stepId)
  return {
    ...state,
    skipped: { ...state.skipped, [wizardId]: Array.from(set) },
  }
}

// Exported for tests — runtime doesn't need it directly but the test
// module benefits from sharing the same writer as the endpoint.
export { writeWizardsState as _writeWizardsState, mutateSkip as _mutateSkip }

/**
 * Map short archetype ids to coordinator config seeds. Deliberately minimal —
 * the intent is "start somewhere real" not "nail the full mandate/concerns
 * shape" (which is what meta-intake is for). The user can refine later from
 * Settings → Coordinators.
 */
function archetypesToCoordinators(archetypes: string[]): Array<{
  id: string
  name: string
  domain: string
  mandate: string
  concerns: Array<{ id: string; description: string; reviewQuestions: string[] }>
}> {
  const seeds: Record<string, ReturnType<typeof archetypesToCoordinators>[number]> = {
    product: {
      id: 'product',
      name: 'Product Coordinator',
      domain: 'product',
      mandate:
        'Owns user-facing behavior, product brief coherence, and whether a task is doing the right thing for users before we ask whether it is done correctly.',
      concerns: [
        {
          id: 'user-value',
          description: 'Every shipped change should be traceable to a stated user need.',
          reviewQuestions: [
            'Which user need does this change serve?',
            'What does "done" look like from the user\'s perspective?',
          ],
        },
      ],
    },
    tech: {
      id: 'tech',
      name: 'Tech Coordinator',
      domain: 'tech',
      mandate:
        'Owns implementation quality, architectural coherence, and making sure the codebase stays maintainable as tasks land.',
      concerns: [
        {
          id: 'maintainability',
          description: 'Changes should preserve or improve long-term code health.',
          reviewQuestions: [
            'Does this change introduce accidental complexity?',
            'Are there abstractions being invented where simpler code would do?',
          ],
        },
      ],
    },
    qa: {
      id: 'qa',
      name: 'QA Coordinator',
      domain: 'qa',
      mandate:
        'Owns verification: tests, gates, and making sure we know a change works before it merges.',
      concerns: [
        {
          id: 'test-coverage',
          description: 'Behavior changes should come with verifiable tests.',
          reviewQuestions: [
            'Is this change covered by a test that would fail if the behavior regressed?',
            'Are the gates (typecheck, build, test) still green?',
          ],
        },
      ],
    },
  }
  const result: Array<ReturnType<typeof archetypesToCoordinators>[number]> = []
  for (const a of archetypes) {
    const seed = seeds[a]
    if (seed) result.push(seed)
  }
  return result
}

function resolveProject(projectPath: string): ResolvedProject {
  const yamlPath = join(projectPath, FORGE_YAML_FILENAME)
  if (!existsSync(yamlPath)) {
    // Fall back to directory name as an id; wizard will fix up later.
    const id = slugify(projectPath.split('/').pop() ?? 'project')
    return { path: projectPath, id, config: null, initializationNeeded: true }
  }
  const config = readWorkspaceConfig(projectPath)
  const id = config.id ?? slugify(config.name)
  return { path: projectPath, id, config, initializationNeeded: false }
}

/**
 * Filter a supervisor event buffer down to events for a specific task id.
 *
 * Accepts both the canonical wire-protocol field (`task_id`, snake_case — see
 * src/protocol/wire.ts) and the camelCase `taskId` that older internal
 * supervisor-emitted shapes use. Exported for regression testing because the
 * two field styles previously drifted and left the drawer's recent-events
 * feed silently empty.
 */
export function filterEventsForTask<T extends { event?: unknown }>(
  events: T[],
  taskId: string,
): T[] {
  return events.filter(ev => {
    const inner = ev.event as { task_id?: string; taskId?: string } | undefined
    const t = inner?.task_id ?? inner?.taskId
    return t === taskId
  })
}

/**
 * Build the Hono app for a project without binding to a port. Exposed for
 * integration tests that want to call `app.fetch(new Request(...))` directly;
 * `runServe` wraps this with @hono/node-server.
 */
export function buildServeApp(opts: ServeOptions = {}): {
  app: Hono
  supervisor: OrchestratorSupervisor
  projectPath: string
} {
  const projectPath = resolve(opts.projectPath ?? process.cwd())
  let project = resolveProject(projectPath)

  const supervisor = new OrchestratorSupervisor()
  const app = new Hono()

  // -------------------------------------------------------------------------
  // API: runtime version (shown next to the "Guildhall" wordmark)
  // -------------------------------------------------------------------------
  let _cachedVersion: string | null = null
  function readRuntimeVersion(): string {
    if (_cachedVersion !== null) return _cachedVersion
    try {
      // src/runtime/serve.ts → up to package root
      const here = dirname(fileURLToPath(import.meta.url))
      // Walk up until we find a package.json.
      let dir = here
      for (let i = 0; i < 6; i++) {
        const candidate = join(dir, 'package.json')
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
            name?: string
            version?: string
          }
          if (pkg?.name === 'guildhall' || pkg?.name === '@guildhall/cli') {
            _cachedVersion = pkg.version ?? 'unknown'
            return _cachedVersion
          }
        }
        dir = dirname(dir)
      }
    } catch {
      /* fall through */
    }
    _cachedVersion = 'unknown'
    return _cachedVersion
  }

  app.get('/api/version', c => {
    return c.json({ version: readRuntimeVersion() })
  })

  // -------------------------------------------------------------------------
  // API: build-info — staleness check.
  //
  // Node loads dist/cli.js once at process start; later rebuilds don't take
  // effect until restart. To stop the silent "I rebuilt but the running
  // server is yesterday's binary" failure mode, we capture the dist mtime
  // at startup and re-stat on every request. If they differ, the running
  // server is stale and the web app shows a "restart needed" banner.
  // -------------------------------------------------------------------------
  const distEntryPath = (() => {
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      const candidates = [
        join(here, 'cli.js'),       // dist/cli.js when serve.js sits in dist/
        join(here, '..', 'cli.js'), // dist/cli.js when serve.js is dist/runtime/serve.js
        fileURLToPath(import.meta.url),
      ]
      for (const c of candidates) {
        if (existsSync(c)) return c
      }
    } catch {
      /* fallthrough */
    }
    return null
  })()
  let bootBuildMtimeMs = 0
  try {
    if (distEntryPath) {
      bootBuildMtimeMs = Math.floor(statSync(distEntryPath).mtimeMs)
    }
  } catch {
    bootBuildMtimeMs = 0
  }
  const processStartedAt = new Date().toISOString()

  app.get('/api/build-info', c => {
    let currentBuildMtimeMs = bootBuildMtimeMs
    try {
      if (distEntryPath) {
        currentBuildMtimeMs = Math.floor(statSync(distEntryPath).mtimeMs)
      }
    } catch {
      /* keep boot value */
    }
    return c.json({
      pid: process.pid,
      processStartedAt,
      bootBuildMtimeMs,
      currentBuildMtimeMs,
      stale: currentBuildMtimeMs > bootBuildMtimeMs,
      distPath: distEntryPath,
    })
  })

  // -------------------------------------------------------------------------
  // API: project
  // -------------------------------------------------------------------------
  app.get('/api/project', c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          initializationNeeded: true,
          path: project.path,
          setupUrl: '/setup',
        })
      }
      const tasksPath = join(project.path, 'memory', 'TASKS.json')
      let tasks: unknown[] = []
      if (existsSync(tasksPath)) {
        const raw = JSON.parse(readFileSync(tasksPath, 'utf8'))
        tasks = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : []
      }
      const run = supervisor.get(project.id)
      const recent = supervisor.recent(project.id)
      const bootstrapStatus = readBootstrapStatus(join(project.path, 'memory'))
      return c.json({
        initializationNeeded: false,
        id: project.id,
        path: project.path,
        name: project.config?.name ?? project.id,
        tags: project.config?.tags ?? [],
        config: project.config,
        tasks,
        run: run
          ? {
              status: run.status,
              startedAt: run.startedAt,
              stoppedAt: run.stoppedAt,
              error: run.error,
            }
          : null,
        recentEvents: recent,
        ...(bootstrapStatus ? { bootstrapStatus } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  async function loadedLlamaModelIds(url: string, timeoutMs = 1500): Promise<string[]> {
    const trimmed = url.trim().replace(/\/$/, '')
    if (!trimmed) return []
    const res = await fetch(`${trimmed}/models`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return []
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> }
    return [
      ...new Set(
        (body.data ?? [])
          .map(model => model.id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map(id => id.trim()),
      ),
    ]
  }

  function modelAssignmentForSingleModel(modelId: string): ModelAssignmentConfig {
    return {
      spec: modelId,
      coordinator: modelId,
      worker: modelId,
      reviewer: modelId,
      gateChecker: modelId,
    }
  }

  function missingAssignedModels(
    assignment: ModelAssignmentConfig,
    loadedModels: string[],
  ): string[] {
    const loaded = new Set(loadedModels)
    return [
      ...new Set([
        assignment.spec,
        assignment.coordinator,
        assignment.worker,
        assignment.reviewer,
        assignment.gateChecker,
      ].filter(model => !loaded.has(model))),
    ]
  }

  app.post('/api/project/start', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      // Preflight: a run with no provider is worse than no run — the
      // orchestrator boots, every tick fails, and the UI shows "Running"
      // while nothing actually moves. Catch the missing-provider case here
      // and return an actionable 400 so the Start button surfaces a clear
      // "configure a provider first" message instead of a silent spin.
      const projectCfg = readProjectConfig(project.path)
      try {
        migrateProjectProvidersToGlobal(project.path, {
          readProject: (p) => readProjectConfig(p),
          writeProject: (p, patch) => updateProjectConfig(p, patch),
        })
      } catch {
        /* best-effort */
      }
      const creds = resolveGlobalCredentials()
      const preferred = projectCfg.preferredProvider
      const preflight = await selectApiClient({
        ...(preferred ? { preferredProvider: preferred } : {}),
        ...(creds.anthropicApiKey ? { anthropicApiKey: creds.anthropicApiKey } : {}),
        ...(creds.openaiApiKey ? { openaiApiKey: creds.openaiApiKey } : {}),
        ...(creds.llamaCppUrl ? { llamaCppUrl: creds.llamaCppUrl } : {}),
      })
      if (preflight.providerName === 'none') {
        return c.json(
          {
            error:
              preflight.reason ??
              'No provider configured. Open Providers (/providers) to set one up.',
            code: 'no_provider',
          },
          400,
        )
      }
      if (preflight.providerName === 'llama-cpp' && creds.llamaCppUrl && project.config) {
        const configuredModels = project.config.models ?? {}
        const assignedModels: ModelAssignmentConfig = {
          spec: configuredModels.spec ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.spec,
          coordinator: configuredModels.coordinator ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.coordinator,
          worker: configuredModels.worker ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.worker,
          reviewer: configuredModels.reviewer ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.reviewer,
          gateChecker: configuredModels.gateChecker ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.gateChecker,
        }
        const loadedModels = await loadedLlamaModelIds(creds.llamaCppUrl).catch(() => [])
        if (loadedModels.length === 0) {
          return c.json(
            {
              error:
                'LM Studio is reachable, but Guildhall could not see a loaded model. Load a model in LM Studio, then start again.',
              code: 'no_loaded_model',
              provider: 'llama-cpp',
            },
            400,
          )
        }
        const missingModels = missingAssignedModels(assignedModels, loadedModels)
        if (missingModels.length > 0) {
          return c.json(
            {
              error:
                `LM Studio has ${loadedModels.join(', ')} loaded, but this project is configured for ${missingModels.join(', ')}. ` +
                'Save the LM Studio provider again or load the configured model before starting.',
              code: 'model_unavailable',
              provider: 'llama-cpp',
              loadedModels,
              missingModels,
            },
            400,
          )
        }
      }
      const run = supervisor.start({ workspaceId: project.id, workspacePath: project.path })
      return c.json({
        status: run.status,
        startedAt: run.startedAt,
        provider: preflight.providerName,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/stop', async c => {
    try {
      const stopped = await supervisor.stop(project.id)
      if (!stopped) return c.json({ error: 'stop timed out' }, 504)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/intake', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as {
        ask?: string
        domain?: string
        title?: string
      }
      if (!body.ask || body.ask.trim().length === 0) {
        return c.json({ error: 'Missing "ask" in request body' }, 400)
      }
      const coordinators = project.config?.coordinators ?? []
      const defaultDomain = coordinators[0]?.domain
      const domain = body.domain ?? defaultDomain
      if (!domain) {
        return c.json({ error: 'Project has no coordinators — run meta-intake first' }, 400)
      }
      const result = await createExploringTask({
        memoryDir: join(project.path, 'memory'),
        ask: body.ask,
        domain,
        projectPath: project.path,
        ...(body.title ? { title: body.title } : {}),
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/bug-report', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as {
        title?: string
        body?: string
        stackTrace?: string
        env?: Record<string, string>
        domain?: string
        priority?: 'low' | 'normal' | 'high' | 'critical'
      }
      if (!body.title || body.title.trim().length === 0) {
        return c.json({ error: 'Missing "title" in request body' }, 400)
      }
      if (!body.body || body.body.trim().length === 0) {
        return c.json({ error: 'Missing "body" in request body' }, 400)
      }
      const coordinators = project.config?.coordinators ?? []
      if (coordinators.length === 0) {
        return c.json({ error: 'Project has no coordinators — run meta-intake first' }, 400)
      }
      // Route by stack-trace top file when the reporter didn't pick a domain:
      // match the first frame's file path against each coordinator's `path`,
      // falling through to the first coordinator if nothing hits.
      let domain = body.domain
      if (!domain && body.stackTrace) {
        const topFile = parseStackTraceTopFile(body.stackTrace)
        if (topFile) {
          const match = coordinators.find(c => c.path && topFile.includes(c.path))
          if (match) domain = match.domain
        }
      }
      domain = domain ?? coordinators[0]!.domain
      const result = await createBugReportTask({
        memoryDir: join(project.path, 'memory'),
        projectPath: project.path,
        title: body.title,
        body: body.body,
        ...(body.stackTrace ? { stackTrace: body.stackTrace } : {}),
        ...(body.env ? { env: body.env } : {}),
        domain,
        ...(body.priority ? { priority: body.priority } : {}),
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const result = await createMetaIntakeTask({
        memoryDir: join(project.path, 'memory'),
        projectPath: project.path,
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/needs-meta-intake', c => {
    try {
      if (project.initializationNeeded) return c.json({ needsMetaIntake: true })
      return c.json({ needsMetaIntake: workspaceNeedsMetaIntake(project.path) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Bootstrap status + manual re-run. Read-only GET is cheap; POST runs the
  // verified commands synchronously and returns the fresh status. Both gate
  // on `project.config.bootstrap` being present — absent means meta-intake
  // hasn't established a bootstrap yet.
  // -------------------------------------------------------------------------
  app.get('/api/project/bootstrap/status', c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ configured: false, needed: false, status: null })
      }
      const bootstrap = project.config?.bootstrap
      if (!bootstrap || bootstrap.commands.length === 0) {
        return c.json({ configured: false, needed: false, status: null })
      }
      const memoryDir = join(project.path, 'memory')
      const status = readBootstrapStatus(memoryDir)
      const needed = bootstrapNeeded(
        memoryDir,
        project.path,
        bootstrap.commands,
        bootstrap.successGates,
      )
      return c.json({
        configured: true,
        needed,
        status,
        bootstrap: {
          commands: bootstrap.commands,
          successGates: bootstrap.successGates,
          timeoutMs: bootstrap.timeoutMs,
          provenance: bootstrap.provenance ?? null,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/bootstrap/run', c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const bootstrap = project.config?.bootstrap
      const memoryDir = join(project.path, 'memory')

      // Legacy path: run the array-based commands from guildhall.yaml when
      // present. Fall through to detection-based bootstrap otherwise so
      // workspaces without a pre-authored bootstrap block still get the
      // environment verified (detect package manager, install, probe gates).
      if (bootstrap && bootstrap.commands.length > 0) {
        const result = runBootstrap({
          projectPath: project.path,
          memoryDir,
          commands: bootstrap.commands,
          successGates: bootstrap.successGates,
          timeoutMs: bootstrap.timeoutMs,
        })
        const status = readBootstrapStatus(memoryDir)
        return c.json({ success: result.success, status })
      }

      const detected = runDetectedBootstrap(project.path)
      writeBootstrapResult(project.path, detected)
      return c.json({
        success: detected.ok,
        detected: detected.bootstrap,
        logs: detected.logs,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/meta-intake/draft', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ status: 'uninitialized', taskExists: false, specReady: false, drafts: [] })
      }
      const tasksPath = join(project.path, 'memory', 'TASKS.json')
      if (!existsSync(tasksPath)) {
        return c.json({ status: 'no-task', taskExists: false, specReady: false, drafts: [] })
      }
      const raw = await fsp.readFile(tasksPath, 'utf-8')
      const parsed = JSON.parse(raw) as { tasks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      const tasks = Array.isArray(parsed) ? parsed : parsed.tasks ?? []
      const task = tasks.find(t => (t as { id?: string }).id === META_INTAKE_TASK_ID) as
        | { spec?: string; status?: string }
        | undefined
      if (!task) {
        return c.json({ status: 'no-task', taskExists: false, specReady: false, drafts: [] })
      }
      const spec = typeof task.spec === 'string' ? task.spec : ''
      if (spec.trim().length === 0) {
        return c.json({
          status: task.status === 'done' ? 'approved' : 'in-progress',
          taskExists: true,
          specReady: false,
          taskStatus: task.status ?? null,
          drafts: [],
        })
      }
      const drafts = parseCoordinatorDraft(spec) ?? []
      return c.json({
        status: task.status === 'done' ? 'approved' : drafts.length > 0 ? 'draft-ready' : 'spec-but-no-fence',
        taskExists: true,
        specReady: drafts.length > 0,
        taskStatus: task.status ?? null,
        drafts,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake/approve', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = join(project.path, 'memory')
      const result = await approveMetaIntake({
        workspacePath: project.path,
        memoryDir,
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Approval failed' }, 400)
      }
      // Re-resolve so subsequent GETs reflect the newly-added coordinators.
      project = resolveProject(project.path)

      // Bootstrap the environment eagerly so the user doesn't have to hunt
      // for a separate "Configure" action. Skip install (slow, needs real
      // network) — that still runs on the first explicit Configure press or
      // on first dispatch. Gate-resolution + structural detection here is
      // cheap and lets the orchestrator unblock on its own.
      let autoBootstrap: { success: boolean; packageManager?: string } | null = null
      try {
        const detected = runDetectedBootstrap(project.path, { skipInstall: true })
        writeBootstrapResult(project.path, detected)
        autoBootstrap = { success: detected.ok, packageManager: detected.bootstrap.packageManager }
      } catch {
        autoBootstrap = { success: false }
      }

      // FR-34: now that coordinators exist, check whether the workspace has
      // existing artifacts worth importing into TASKS.json. The lever
      // (`workspace_import_autonomy`) gates this — default 'suggest' seeds
      // the reserved task but waits for human approval.
      const importOutcome = await maybeSeedWorkspaceImport({
        memoryDir,
        projectPath: project.path,
      })

      return c.json({
        ok: true,
        coordinatorsAdded: result.coordinatorsAdded ?? 0,
        autoBootstrap,
        workspaceImport: {
          outcome: importOutcome.outcome,
          seeded: importOutcome.seeded,
          leverPosition: importOutcome.leverPosition,
          draftPreview: {
            goals: importOutcome.draft.goals.length,
            tasks: importOutcome.draft.tasks.length,
            milestones: importOutcome.draft.milestones.length,
          },
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake/synthesize', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const result = await synthesizeMetaIntakeDraft({
        workspacePath: project.path,
        memoryDir: join(project.path, 'memory'),
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Could not synthesize meta-intake draft' }, 400)
      }
      return c.json({ ok: true, drafts: result.drafts ?? [] })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // FR-34 workspace import — status / draft preview / approval.
  // -------------------------------------------------------------------------
  app.get('/api/project/workspace-import/status', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          needed: false,
          seeded: false,
          taskStatus: null,
          draft: { goals: 0, tasks: 0, milestones: 0 },
        })
      }
      const memoryDir = join(project.path, 'memory')
      const need = await workspaceNeedsImport({
        memoryDir,
        projectPath: project.path,
      })

      // Lever read — mirror the defaulting rule in maybeSeedWorkspaceImport.
      let leverPosition: 'off' | 'suggest' | 'apply' = 'suggest'
      try {
        const settings = await loadLeverSettings({
          path: defaultAgentSettingsPath(project.path),
        })
        const pos = settings.project['workspace_import_autonomy']?.position
        if (pos === 'off' || pos === 'suggest' || pos === 'apply') {
          leverPosition = pos
        }
      } catch {}

      // Is there a reserved task?
      const tasksPath = join(memoryDir, 'TASKS.json')
      let taskStatus: string | null = null
      let specPresent = false
      if (existsSync(tasksPath)) {
        const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
          | { tasks?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>
        const list = Array.isArray(raw) ? raw : raw.tasks ?? []
        const task = list.find(
          t => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
        ) as { status?: string; spec?: string } | undefined
        if (task) {
          taskStatus = task.status ?? null
          specPresent =
            typeof task.spec === 'string' && task.spec.trim().length > 0
        }
      }

      return c.json({
        needed: need.needed,
        seeded: taskStatus !== null,
        taskStatus,
        specPresent,
        leverPosition,
        draft: {
          goals: need.draft.goals.length,
          tasks: need.draft.tasks.length,
          milestones: need.draft.milestones.length,
        },
        inventory: {
          ran: need.inventory.ran,
          signals: need.inventory.signals.length,
          failed: need.inventory.failed,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/workspace-import', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = join(project.path, 'memory')
      const res = await maybeSeedWorkspaceImport({
        memoryDir,
        projectPath: project.path,
      })
      return c.json({
        seeded: res.seeded,
        outcome: res.outcome,
        leverPosition: res.leverPosition,
        draft: {
          goals: res.draft.goals.length,
          tasks: res.draft.tasks.length,
          milestones: res.draft.milestones.length,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/workspace-import/draft', async c => {
    try {
      // The same cheap anchor check the inbox chip uses, echoed back so the
      // Workspace Import tab can say "anchors present but nothing extracted"
      // when the semantic detector returns empty — which otherwise produces
      // the contradictory "Found 5 signals … click Review … No signals
      // detected" UX.
      const anchors = detectRepoAnchors(project.path)
      if (project.initializationNeeded) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected: null,
          dismissed: false,
          anchors,
        })
      }
      const memoryDir = join(project.path, 'memory')
      // Dismissed state — surface it so the UI can show an "undo" affordance
      // instead of re-running the scan silently.
      let dismissed = false
      try {
        const goalsPath = join(memoryDir, 'workspace-goals.json')
        if (existsSync(goalsPath)) {
          const g = JSON.parse(await fsp.readFile(goalsPath, 'utf-8')) as {
            dismissed?: boolean
          }
          dismissed = Boolean(g.dismissed)
        }
      } catch {
        /* treat as not-dismissed */
      }

      // Deterministic detector preview — runs regardless of whether the
      // agent has populated the task spec yet. This is what the UI shows
      // first: real findings the user can Approve or Dismiss *now*.
      let detected: {
        goals: unknown[]
        tasks: unknown[]
        milestones: unknown[]
        context: unknown[]
        stats: { inputSignals: number; drafted: number; deduped: number }
      } | null = null
      try {
        const inventory = await detectWorkspaceSignals({ projectPath: project.path })
        const draft = formWorkspaceHypothesis(inventory)
        detected = {
          goals: [...draft.goals],
          tasks: [...draft.tasks],
          milestones: [...draft.milestones],
          context: [...draft.context],
          stats: draft.stats,
        }
      } catch {
        /* detector best-effort */
      }

      const tasksPath = join(memoryDir, 'TASKS.json')
      if (!existsSync(tasksPath)) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected,
          dismissed,
          anchors,
        })
      }
      const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const list = Array.isArray(raw) ? raw : raw.tasks ?? []
      const task = list.find(
        t => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
      ) as { spec?: string; status?: string } | undefined
      if (!task) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected,
          dismissed,
          anchors,
        })
      }
      const spec = typeof task.spec === 'string' ? task.spec : ''
      if (spec.trim().length === 0) {
        return c.json({
          taskExists: true,
          specReady: false,
          taskStatus: task.status ?? null,
          parsed: null,
          detected,
          dismissed,
          anchors,
        })
      }
      const parsed = parseWorkspaceImport(spec)
      const specReady =
        parsed.goals.length + parsed.tasks.length + parsed.milestones.length > 0
      return c.json({
        taskExists: true,
        specReady,
        taskStatus: task.status ?? null,
        parsed,
        detected,
        dismissed,
        anchors,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/workspace-import/approve', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = join(project.path, 'memory')

      // Fallback: if the reserved task is missing or has no agent-authored
      // spec yet, create the task (idempotent) and seed the spec from the
      // deterministic detector output. This lets the user Approve immediately
      // without waiting on the workspace-importer agent, and is safe because
      // the detector draft uses the same YAML fence format the agent would
      // have produced.
      try {
        const tasksPath = join(memoryDir, 'TASKS.json')
        const raw = existsSync(tasksPath)
          ? (JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
              | Array<Record<string, unknown>>
              | { tasks?: Array<Record<string, unknown>> })
          : { tasks: [] as Array<Record<string, unknown>> }
        const list = Array.isArray(raw) ? raw : raw.tasks ?? []
        let idx = list.findIndex(
          (t) => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
        )
        // Ensure the reserved task exists. createWorkspaceImportTask is
        // idempotent and seeds the exploring transcript.
        if (idx < 0) {
          await createWorkspaceImportTask({
            memoryDir,
            projectPath: project.path,
          })
          // Re-read after creation.
          const raw2 = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
            | Array<Record<string, unknown>>
            | { tasks?: Array<Record<string, unknown>> }
          const list2 = Array.isArray(raw2) ? raw2 : raw2.tasks ?? []
          idx = list2.findIndex(
            (t) => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
          )
          if (idx >= 0) {
            const task = list2[idx] as { spec?: string }
            const inventory = await detectWorkspaceSignals({ projectPath: project.path })
            const draft = formWorkspaceHypothesis(inventory)
            const spec = formatDetectedDraftAsSpec(draft)
            if (spec) {
              task.spec = spec
              const next = Array.isArray(raw2) ? list2 : { ...raw2, tasks: list2 }
              await fsp.writeFile(tasksPath, JSON.stringify(next, null, 2), 'utf-8')
            }
          }
        } else {
          const task = list[idx] as { spec?: string }
          const specEmpty = !task.spec || task.spec.trim().length === 0
          if (specEmpty) {
            const inventory = await detectWorkspaceSignals({ projectPath: project.path })
            const draft = formWorkspaceHypothesis(inventory)
            const spec = formatDetectedDraftAsSpec(draft)
            if (spec) {
              task.spec = spec
              const next = Array.isArray(raw) ? list : { ...raw, tasks: list }
              await fsp.writeFile(tasksPath, JSON.stringify(next, null, 2), 'utf-8')
            }
          }
        }
      } catch (e) {
        // Surface the underlying problem instead of swallowing it — the user
        // would otherwise see only the generic "No workspace-import task" from
        // approveWorkspaceImport, which hides the real failure.
        return c.json(
          { error: `Could not prepare workspace-import task: ${e instanceof Error ? e.message : String(e)}` },
          500,
        )
      }

      const result = await approveWorkspaceImport({
        memoryDir,
        projectPath: project.path,
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Approval failed' }, 400)
      }
      return c.json({
        ok: true,
        tasksAdded: result.tasksAdded ?? 0,
        goalsRecorded: result.goalsRecorded ?? 0,
        milestonesLogged: result.milestonesLogged ?? 0,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Coordinator inbox — prioritized list of things the human must resolve
  // for the coordinator to make progress. Source of truth is on-disk state
  // (guildhall.yaml, TASKS.json, agent-settings.yaml, workspace-goals.json).
  // -------------------------------------------------------------------------
  // Aggregated "project facts" view — everything the agent knows about the
  // workspace, collected from on-disk state. Read-only; each section has an
  // `editHref` pointing at the canonical place to change it.
  app.get('/api/project/facts', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = join(project.path, 'memory')
      const cfg = project.config

      // Bootstrap block from guildhall.yaml (structural form).
      const b = (cfg?.bootstrap ?? null) as
        | {
            verifiedAt?: string
            packageManager?: string
            install?: { command?: string; status?: string; lastRunAt?: string } | string[]
            gates?: Record<string, { command?: string; available?: boolean; unavailableReason?: string }>
          }
        | null

      // Design system summary.
      let designSummary: string | null = null
      try {
        const ds = await loadDesignSystem(memoryDir)
        if (ds) designSummary = summarizeDesignSystem(ds)
      } catch {
        /* leave null */
      }

      // Workspace goals file (imported or dismissed state).
      const goalsPath = join(memoryDir, 'workspace-goals.json')
      let workspaceGoals:
        | { imported: boolean; dismissed: boolean; goalCount: number; taskCount: number; milestoneCount: number }
        | null = null
      if (existsSync(goalsPath)) {
        try {
          const raw = JSON.parse(readFileSync(goalsPath, 'utf8')) as Record<string, unknown>
          if ((raw as { dismissed?: boolean }).dismissed) {
            workspaceGoals = { imported: false, dismissed: true, goalCount: 0, taskCount: 0, milestoneCount: 0 }
          } else {
            const goals = Array.isArray(raw.goals) ? (raw.goals as unknown[]).length : 0
            const tasks = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]).length : 0
            const milestones = Array.isArray(raw.milestones) ? (raw.milestones as unknown[]).length : 0
            workspaceGoals = {
              imported: true,
              dismissed: false,
              goalCount: goals,
              taskCount: tasks,
              milestoneCount: milestones,
            }
          }
        } catch {
          /* leave null */
        }
      }

      return c.json({
        identity: {
          name: cfg?.name ?? project.id,
          id: project.id,
          path: project.path,
          editHref: '/settings',
        },
        environment: {
          packageManager: b?.packageManager ?? 'unknown',
          verifiedAt: typeof b?.verifiedAt === 'string' ? b.verifiedAt : null,
          install: b?.install ?? null,
          gates: b?.gates ?? null,
          editHref: '/settings',
        },
        workspace: {
          goals: workspaceGoals,
          reviewHref: '/workspace-import',
        },
        coordinators: {
          count: cfg?.coordinators?.length ?? 0,
          list: (cfg?.coordinators ?? []).map(c => ({ id: c.id, name: c.name })),
          editHref: '/coordinators',
        },
        designSystem: {
          summary: designSummary,
          editHref: '/settings',
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Dismiss the workspace-import review. Writes a `dismissed: true` marker
  // into memory/workspace-goals.json so the Inbox item stops appearing;
  // findings stay reachable via /workspace-import for later review.
  app.post('/api/project/workspace-import/dismiss', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = join(project.path, 'memory')
      await fsp.mkdir(memoryDir, { recursive: true })
      const goalsPath = join(memoryDir, 'workspace-goals.json')
      await fsp.writeFile(
        goalsPath,
        JSON.stringify({ dismissed: true, dismissedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      )
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/inbox', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ items: [], blockers: { bootstrap: false, workspaceImport: false } })
      }
      // Self-healing scan: if the workspace has signals but nobody has run
      // the scanner yet, kick it off implicitly. The user shouldn't have to
      // press "Scan" — once a coordinator exists, the agent discovers
      // existing goals/tasks on its own and surfaces them for review.
      // No-op if already seeded, off, or not needed.
      try {
        const memoryDir = join(project.path, 'memory')
        const goalsPath = join(memoryDir, 'workspace-goals.json')
        if (
          !existsSync(goalsPath) &&
          (project.config?.coordinators?.length ?? 0) > 0
        ) {
          await maybeSeedWorkspaceImport({ memoryDir, projectPath: project.path })
        }
      } catch {
        /* never let self-healing break the inbox read */
      }
      const items = buildInbox({ projectPath: project.path })
      const blockers = buildInboxBlockers(items)
      return c.json({ items, blockers })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/thread', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ turns: [], activeTurnId: null, caughtUp: false })
      }
      const thread = buildThread({
        projectPath: project.path,
        recentEvents: supervisor.recent(project.id),
      })
      return c.json(thread)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Wizards — resumable guided checklists (onboard, spec-fill, release, ...).
  // Progress is derived from on-disk facts; wizards.yaml persists only skip
  // markers + completedAt stamps. See src/runtime/wizards.ts.
  //
  // GET  /api/project/wizards                     → all applicable wizards
  // POST /api/project/wizards/:id/skip            → { stepId }
  // POST /api/project/wizards/:id/unskip          → { stepId }
  // -------------------------------------------------------------------------
  app.get('/api/project/wizards', c => {
    try {
      if (project.initializationNeeded) return c.json({ wizards: [] })
      const snap = buildSnapshot({ projectPath: project.path })
      const wizards = listWizards()
        .filter(w => w.applicable(snap))
        .map(w => progressFor(w, snap))
      return c.json({ wizards })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/wizards/:id/skip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const wizardId = c.req.param('id')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!wizardId || !stepId) return c.json({ error: 'wizardId and stepId required' }, 400)
      const wizard = listWizards().find(w => w.id === wizardId)
      if (!wizard) return c.json({ error: `unknown wizard: ${wizardId}` }, 404)
      const step = wizard.steps.find(s => s.id === stepId)
      if (!step) return c.json({ error: `unknown step: ${stepId}` }, 404)
      if (!step.skippable) return c.json({ error: `step is not skippable: ${stepId}` }, 400)
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, wizardId, stepId, 'add')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/wizards/:id/unskip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const wizardId = c.req.param('id')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!wizardId || !stepId) return c.json({ error: 'wizardId and stepId required' }, 400)
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, wizardId, stepId, 'remove')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Task-scoped wizards. Progress derives from the live task record, so any
  // edit (spec agent updates the brief, human approves, reviewer appends an
  // acceptance criterion) auto-flips the corresponding step to done.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id/wizards', c => {
    try {
      if (project.initializationNeeded) return c.json({ wizards: [] })
      const tasksPath = join(project.path, 'memory', 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id)
      if (!task) return c.json({ error: 'task not found' }, 404)
      const snap = buildTaskSnapshot({
        projectPath: project.path,
        task: task as Parameters<typeof buildTaskSnapshot>[0]['task'],
      })
      const wizards = listTaskWizards()
        .filter(w => w.applicable(snap))
        .map(w => progressForTask(w, snap))
      return c.json({ wizards })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/task/:id/wizards/:wizardId/skip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const taskId = c.req.param('id')
      const wizardId = c.req.param('wizardId')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!taskId || !wizardId || !stepId) {
        return c.json({ error: 'taskId, wizardId and stepId required' }, 400)
      }
      const wizard = listTaskWizards().find(w => w.id === wizardId)
      if (!wizard) return c.json({ error: `unknown task wizard: ${wizardId}` }, 404)
      const step = wizard.steps.find(s => s.id === stepId)
      if (!step) return c.json({ error: `unknown step: ${stepId}` }, 404)
      if (!step.skippable) return c.json({ error: `step is not skippable: ${stepId}` }, 400)
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, `${wizardId}:${taskId}`, stepId, 'add')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/task/:id/wizards/:wizardId/unskip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const taskId = c.req.param('id')
      const wizardId = c.req.param('wizardId')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!taskId || !wizardId || !stepId) {
        return c.json({ error: 'taskId, wizardId and stepId required' }, 400)
      }
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, `${wizardId}:${taskId}`, stepId, 'remove')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Onboard step backers: coordinators seed + project brief.
  //
  // These endpoints exist specifically so onboard step bodies have something
  // concrete to POST to without needing a full coordinator-editor UI today.
  // The meta-intake agent remains the "agent-drafted" path; these are the
  // "I'll just pick one" path.
  // -------------------------------------------------------------------------
  app.post('/api/project/coordinators/seed', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = (await c.req.json().catch(() => ({}))) as {
        archetypes?: string[]
      }
      const archetypes = Array.isArray(body.archetypes) ? body.archetypes : []
      if (archetypes.length === 0) return c.json({ error: 'no archetypes selected' }, 400)

      const existing = readWorkspaceConfig(project.path)
      const existingIds = new Set((existing.coordinators ?? []).map(c => c.id))
      const seeds = archetypesToCoordinators(archetypes).filter(s => !existingIds.has(s.id))
      if (seeds.length === 0) {
        return c.json({ ok: true, added: 0, coordinators: existing.coordinators ?? [] })
      }
      const nextConfig = {
        ...existing,
        coordinators: [...(existing.coordinators ?? []), ...seeds],
      }
      writeWorkspaceConfig(project.path, nextConfig as Parameters<typeof writeWorkspaceConfig>[1])
      project = resolveProject(project.path)
      return c.json({ ok: true, added: seeds.length, coordinators: nextConfig.coordinators })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/brief', c => {
    try {
      if (project.initializationNeeded) return c.json({ current: '', seed: { readme: '', roadmap: [] } })
      const briefPath = join(project.path, 'memory', 'project-brief.md')
      const current = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
      const readmePath = join(project.path, 'README.md')
      const roadmapPath = join(project.path, 'ROADMAP.md')
      const readmeFirstPara = existsSync(readmePath)
        ? (readFileSync(readmePath, 'utf8').split(/\n{2,}/).find(p => p.trim() && !p.trim().startsWith('#')) ?? '').trim().slice(0, 800)
        : ''
      const roadmapHeadings = existsSync(roadmapPath)
        ? readFileSync(roadmapPath, 'utf8')
            .split(/\r?\n/)
            .filter(l => /^#{1,3}\s+/.test(l))
            .map(l => l.replace(/^#{1,3}\s+/, '').trim())
            .slice(0, 12)
        : []
      return c.json({ current, seed: { readme: readmeFirstPara, roadmap: roadmapHeadings } })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/brief', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = (await c.req.json().catch(() => ({}))) as { content?: string }
      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (content.length < 40) return c.json({ error: 'brief must be at least 40 characters' }, 400)
      const memDir = join(project.path, 'memory')
      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true })
      writeFileSync(join(memDir, 'project-brief.md'), content + '\n', 'utf8')
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Per-task detail — powers the drawer. Returns the full Task plus a tiny
  // slice of related context (recent events touching this task) so the UI
  // can show "what's happening right now" without a second round-trip.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id', c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(project.path, 'memory', 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id)
      if (!task) return c.json({ error: 'task not found' }, 404)
      const recent = filterEventsForTask(supervisor.recent(project.id), id)
      return c.json({ task, recentEvents: recent })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // GET /api/project/task/:id/experts — which personas are applicable for
  // this task, and how their verdicts / gate results map onto them.
  //
  // Response shape:
  //   {
  //     primaryEngineer: slug | null,
  //     applicable: [{ slug, name, role, blurb }],
  //     reviewers:  [{ slug, name, role }],
  //     verdictsBySlug: {
  //       [slug]: [{ verdict, reason, reasoning, reviewerPath, recordedAt, ... }]
  //     },
  //     gateResultsBySlug: {
  //       [slug]: [{ gateId, passed, output, checkedAt }]
  //     },
  //     warnings: string[]   // composition load warnings, if any
  //   }
  //
  // Gate-result-to-slug mapping uses the gate id namespace: guild checks use
  // dotted prefixes (`a11y.contrast-matrix`, `color.near-duplicate-roles`,
  // `sec.no-hardcoded-secrets`, etc.). Anything that doesn't namespace-match
  // a known guild falls under "unattributed" so the hard-gate results
  // (typecheck / build / test / lint) still surface somewhere in the UI.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id/experts', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(project.path, 'memory', 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as
        | Record<string, unknown>
        | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)

      const memDir = join(project.path, 'memory')
      const designSystem = await loadDesignSystem(memDir).catch(() => undefined)
      const { guilds: roster, warnings } = loadProjectGuildRoster(memDir)

      // `selectApplicableGuilds` expects a Task type; we pass through a
      // structurally-compatible subset without forcing a full schema parse
      // at this endpoint (tasks on disk may predate recent zod additions).
      const signals = {
        task: task as unknown as Parameters<typeof selectApplicableGuilds>[0]['task'],
        ...(designSystem ? { designSystem } : {}),
        memoryDir: memDir,
        projectPath: project.path,
      }
      const applicable = selectApplicableGuilds(signals, roster)
      const reviewers = reviewersForTask(applicable)
      const primaryEngineer = pickPrimaryEngineer(applicable)

      const applicableSlugs = new Set(applicable.map(g => g.slug))

      // Group review verdicts by guild slug. Each PersonaVerdict is persisted
      // with `failingSignals: [guildSlug]` on revise; on approve we
      // attribute by matching `reason` prefix ("The Accessibility Specialist
      // approved"). Keep the mapping robust — unknown attribution falls into
      // a generic bucket.
      const verdicts = Array.isArray(task.reviewVerdicts)
        ? (task.reviewVerdicts as Array<Record<string, unknown>>)
        : []
      const verdictsBySlug: Record<string, Array<Record<string, unknown>>> = {}
      const nameToSlug = new Map<string, string>()
      for (const g of roster) nameToSlug.set(g.name, g.slug)
      for (const v of verdicts) {
        let slug: string | null = null
        const failingSignals = v.failingSignals
        if (Array.isArray(failingSignals) && failingSignals.length > 0) {
          const candidate = failingSignals[0]
          if (typeof candidate === 'string' && applicableSlugs.has(candidate)) {
            slug = candidate
          }
        }
        if (!slug && typeof v.reason === 'string') {
          for (const [name, s] of nameToSlug) {
            if (v.reason.includes(name)) {
              slug = s
              break
            }
          }
        }
        const bucket = slug ?? 'unattributed'
        ;(verdictsBySlug[bucket] ??= []).push(v)
      }

      // Group gate results by guild via the gate-id prefix namespace.
      const prefixToSlug: Record<string, string> = {
        'a11y.': 'accessibility-specialist',
        'color.': 'color-theorist',
        'sec.': 'security-engineer',
        'test.': 'test-engineer',
        'component-designer.': 'component-designer',
        'copy.': 'copywriter',
      }
      const gateResults = Array.isArray(task.gateResults)
        ? (task.gateResults as Array<Record<string, unknown>>)
        : []
      const gateResultsBySlug: Record<string, Array<Record<string, unknown>>> = {}
      for (const g of gateResults) {
        const gateId = typeof g.gateId === 'string' ? g.gateId : ''
        let slug = 'unattributed'
        for (const [prefix, s] of Object.entries(prefixToSlug)) {
          if (gateId.startsWith(prefix)) {
            slug = s
            break
          }
        }
        ;(gateResultsBySlug[slug] ??= []).push(g)
      }

      return c.json({
        primaryEngineer: primaryEngineer?.slug ?? null,
        applicable: applicable.map(g => ({
          slug: g.slug,
          name: g.name,
          role: g.role,
          blurb: g.blurb,
        })),
        reviewers: reviewers.map(g => ({
          slug: g.slug,
          name: g.name,
          role: g.role,
        })),
        verdictsBySlug,
        gateResultsBySlug,
        warnings,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // POST /api/project/task/:id/:action — human overrides on a task.
  //   pause              → blocked      (any non-terminal task)
  //   shelve             → shelved      (any non-done task)
  //   unshelve           → proposed     (shelved task only; clears shelveReason)
  //   approve-spec       → spec_review  (exploring task with a drafted spec; body: {approvalNote?})
  //   approve-brief      → mark productBrief.approvedBy/approvedAt = human
  //   add-acceptance     → append a human-written acceptance criterion
  //   resume             → append a follow-up message to an exploring transcript
  //                        (body: {message?, resolveEscalationId?, resolution?})
  //   resolve-escalation → close a named escalation; unblocks when none remain
  //                        (body: {escalationId, resolution, nextStatus?})
  app.post('/api/project/task/:id/:action', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const action = c.req.param('action')
      const KNOWN_ACTIONS = [
        'pause',
        'shelve',
        'approve-spec',
        'approve-brief',
        'add-acceptance',
        'resume',
        'unshelve',
        'resolve-escalation',
        'answer-question',
        'answer-questions',
      ] as const
      if (!(KNOWN_ACTIONS as readonly string[]).includes(action)) {
        return c.json({ error: 'unknown action' }, 400)
      }

      const memoryDir = join(project.path, 'memory')

      // approve-spec and resume have their own persistence (intake.ts owns the
      // write). Delegate to them so the exploring-transcript stays in sync.
      if (action === 'approve-spec') {
        const body = await c.req.json().catch(() => ({})) as { approvalNote?: string }
        const result = await approveSpec({
          memoryDir,
          taskId: id,
          ...(body.approvalNote ? { approvalNote: body.approvalNote } : {}),
        })
        if (!result.success) return c.json({ error: result.error ?? 'approve failed' }, 400)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'resume') {
        const body = await c.req.json().catch(() => ({})) as {
          message?: string
          resolveEscalationId?: string
          resolution?: string
        }
        if (!body.message && !body.resolveEscalationId) {
          return c.json({ error: 'Provide a message or an escalation to resolve' }, 400)
        }
        const result = await resumeExploring({
          memoryDir,
          taskId: id,
          ...(body.message ? { message: body.message } : {}),
          ...(body.resolveEscalationId ? { resolveEscalationId: body.resolveEscalationId } : {}),
          ...(body.resolution ? { resolution: body.resolution } : {}),
        })
        if (!result.success) return c.json({ error: result.error ?? 'resume failed' }, 400)
        return c.json({ ok: true })
      }

      if (action === 'approve-brief') {
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const brief = task.productBrief as Record<string, unknown> | undefined
        if (!brief || typeof brief !== 'object') {
          return c.json({ error: 'no product brief drafted yet' }, 400)
        }
        if (!brief.userJob || !brief.successMetric) {
          return c.json({ error: 'brief is incomplete — needs userJob and successMetric' }, 400)
        }
        const now = new Date().toISOString()
        brief.approvedBy = 'human'
        brief.approvedAt = now
        task.productBrief = brief
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true })
      }

      if (action === 'add-acceptance') {
        const body = await c.req.json().catch(() => ({})) as { description?: string }
        const description = (body.description ?? '').trim()
        if (!description) return c.json({ error: 'description required' }, 400)
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const now = new Date().toISOString()
        const criteria = Array.isArray(task.acceptanceCriteria)
          ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
          : []
        criteria.push({ description })
        task.acceptanceCriteria = criteria
        const notes = Array.isArray(task.notes)
          ? [...task.notes as Array<Record<string, unknown>>]
          : []
        notes.push({
          agentId: 'human',
          role: 'specifier',
          content: `Added acceptance criterion: ${description}`,
          timestamp: now,
        })
        task.notes = notes
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, count: criteria.length })
      }

      if (action === 'answer-question') {
        // Mark an open AgentQuestion as answered. Body: {questionId, answer}.
        // The answer is also appended to the exploring transcript so the
        // asking agent picks it up on the next tick (same path as `resume`).
        const body = (await c.req.json().catch(() => ({}))) as {
          questionId?: string
          answer?: string
        }
        if (!body.questionId) return c.json({ error: 'Missing questionId' }, 400)
        if (!body.answer || !body.answer.trim()) {
          return c.json({ error: 'Missing answer' }, 400)
        }
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as
          | Record<string, unknown>
          | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
        const q = questions.find(x => (x as { id?: string }).id === body.questionId)
        if (!q) return c.json({ error: 'question not found' }, 404)
        const now = new Date().toISOString()
        q.answeredAt = now
        q.answer = body.answer.trim()
        task.openQuestions = questions
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        // Also append to the exploring transcript so the asking agent reads it.
        await resumeExploring({
          memoryDir,
          taskId: id,
          message: `Answer to "${(q as { id?: string }).id}": ${body.answer.trim()}`,
        })
        return c.json({ ok: true })
      }

      if (action === 'answer-questions') {
        // Batch-answer multiple open AgentQuestions atomically. Body:
        //   { answers: [{questionId, answer}, ...] }
        // Used by the Thread surface when the user fills in a section of
        // co-active questions and submits them together. The orchestrator
        // gets ONE resume with all answers stitched into the transcript,
        // so the asking agent can write a complete brief in one shot
        // instead of partial-then-partial across N resumes.
        const body = (await c.req.json().catch(() => ({}))) as {
          answers?: Array<{ questionId?: string; answer?: string }>
        }
        const list = Array.isArray(body.answers) ? body.answers : []
        if (list.length === 0) return c.json({ error: 'Missing answers' }, 400)
        for (const a of list) {
          if (!a.questionId) return c.json({ error: 'Missing questionId in answers[]' }, 400)
          if (!a.answer || !a.answer.trim()) {
            return c.json({ error: 'Missing answer in answers[]' }, 400)
          }
        }
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as
          | Record<string, unknown>
          | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
        const now = new Date().toISOString()
        const transcriptLines: string[] = []
        const missing: string[] = []
        for (const a of list) {
          const q = questions.find(x => (x as { id?: string }).id === a.questionId)
          if (!q) { missing.push(a.questionId!); continue }
          q.answeredAt = now
          q.answer = a.answer!.trim()
          transcriptLines.push(`Answer to "${a.questionId}": ${a.answer!.trim()}`)
        }
        if (missing.length > 0) {
          return c.json({ error: `question(s) not found: ${missing.join(', ')}` }, 404)
        }
        task.openQuestions = questions
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        // Single resume with all answers — agent gets the full batch in one
        // context restart instead of N separate ones.
        await resumeExploring({
          memoryDir,
          taskId: id,
          message: transcriptLines.join('\n'),
        })
        return c.json({ ok: true, count: list.length })
      }

      if (action === 'resolve-escalation') {
        const body = await c.req.json().catch(() => ({})) as {
          escalationId?: string
          resolution?: string
          nextStatus?: 'exploring' | 'spec_review' | 'ready' | 'in_progress' | 'review' | 'gate_check'
        }
        if (!body.escalationId) return c.json({ error: 'Missing escalationId' }, 400)
        if (!body.resolution || !body.resolution.trim()) {
          return c.json({ error: 'Missing resolution' }, 400)
        }
        const result = await resolveEscalation({
          tasksPath: join(memoryDir, 'TASKS.json'),
          progressPath: join(memoryDir, 'PROGRESS.md'),
          taskId: id,
          escalationId: body.escalationId,
          resolution: body.resolution.trim(),
          resolvedBy: 'human',
          nextStatus: body.nextStatus ?? 'ready',
        })
        if (!result.success) return c.json({ error: result.error ?? 'resolve failed' }, 400)
        return c.json({ ok: true })
      }

      // pause / shelve / unshelve: in-place mutation of TASKS.json.
      const tasksPath = join(memoryDir, 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
        | Array<Record<string, unknown>>
      const queue = Array.isArray(parsed)
        ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
        : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
      const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const now = new Date().toISOString()
      const notes = Array.isArray(task.notes) ? [...(task.notes as unknown[])] : []
      if (action === 'pause') {
        if (task.status === 'done' || task.status === 'shelved') {
          return c.json({ error: `task is ${task.status}` }, 400)
        }
        task.status = 'blocked'
        task.blockReason = 'Paused by human from dashboard'
        notes.push({ agentId: 'system:human', role: 'human', content: 'Task paused via dashboard', timestamp: now })
      } else if (action === 'unshelve') {
        if (task.status !== 'shelved') {
          return c.json({ error: `task is ${task.status}, not shelved` }, 400)
        }
        task.status = 'proposed'
        delete (task as Record<string, unknown>).shelveReason
        notes.push({ agentId: 'system:human', role: 'human', content: 'Task unshelved via dashboard', timestamp: now })
      } else {
        if (task.status === 'done') return c.json({ error: 'task is done' }, 400)
        task.status = 'shelved'
        task.shelveReason = {
          code: 'not_viable',
          detail: 'Shelved by human from dashboard',
          rejectedBy: 'system:human',
          rejectedAt: now,
          source: 'proposal_policy',
          policyApplied: true,
          requeueCount: 0,
        }
        notes.push({ agentId: 'system:human', role: 'human', content: 'Task shelved via dashboard', timestamp: now })
      }
      task.notes = notes
      task.updatedAt = now
      queue.lastUpdated = now
      atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
      return c.json({ ok: true, status: task.status })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // GET /api/project/activity — counts + in-flight tasks for the always-on
  // agent-activity chip. Cheap enough to poll every few seconds from any
  // view (not just the project page).
  app.get('/api/project/activity', c => {
    try {
      if (project.initializationNeeded) return c.json({ running: false, counts: {}, inFlight: [] })
      const run = supervisor.get(project.id)
      const tasksPath = join(project.path, 'memory', 'TASKS.json')
      const empty = { running: run?.status === 'running', counts: {}, inFlight: [] as unknown[] }
      if (!existsSync(tasksPath)) return c.json(empty)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const counts: Record<string, number> = {}
      const inFlight: Array<{ id: string; title: string; status: string; domain: string }> = []
      for (const t of tasks) {
        const st = String((t as { status?: string }).status ?? 'unknown')
        counts[st] = (counts[st] ?? 0) + 1
        if (['in_progress', 'review', 'gate_check', 'spec_review', 'exploring'].includes(st)) {
          inFlight.push({
            id: String((t as { id?: string }).id ?? ''),
            title: String((t as { title?: string }).title ?? ''),
            status: st,
            domain: String((t as { domain?: string }).domain ?? ''),
          })
        }
      }
      return c.json({
        running: run?.status === 'running',
        runStatus: run?.status ?? 'stopped',
        counts,
        inFlight: inFlight.slice(0, 5),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/progress', c => {
    try {
      if (project.initializationNeeded) return c.json({ progress: '' })
      const progressPath = join(project.path, 'memory', 'PROGRESS.md')
      if (!existsSync(progressPath)) return c.json({ progress: '' })
      const raw = readFileSync(progressPath, 'utf8')
      // Heartbeat blocks are routine forward transitions — they duplicate
      // the Live Activity feed and clutter the Recent PROGRESS.md panel.
      // Keep only milestones, blocks, escalations, and free-form agent
      // notes (the signal).
      // Split by H3 headings (each PROGRESS.md entry starts with `### `).
      // Drop heartbeat blocks (routine forward transitions — redundant with
      // Live Activity) and drop max-turns-masquerading-as-escalation blocks
      // (self-healing events, not real failures).
      const parts = raw.split(/\n(?=### )/)
      const kept = parts.filter((p, i) => {
        // Keep the leading preamble (title + date headers) as part[0]
        // regardless of heading shape.
        if (i === 0 && !p.startsWith('### ')) return true
        if (/^###\s+💓\s+HEARTBEAT/.test(p)) return false
        if (/error:\s*Exceeded maximum turn limit/.test(p)) return false
        // Strip trailing `---` rule line that delimited the now-removed
        // neighbor, so we don't leave stray separators.
        return true
      })
      const rejoined = kept.join('\n').replace(/(\n---\n)+/g, '\n---\n')
      const tail = rejoined.split('\n').slice(-120).join('\n')
      return c.json({ progress: tail })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/config', c => {
    try {
      const project = readProjectConfig(projectPath)
      const redacted: Record<string, unknown> = { ...project }
      if (redacted.anthropicApiKey) redacted.anthropicApiKey = '•••'
      if (redacted.openaiApiKey) redacted.openaiApiKey = '•••'
      return c.json(redacted)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // GET /api/config/levers — flatten project + default-domain lever positions
  // into a shape the settings UI can render without knowing the schema details.
  // Read-only for now; editing arrives once we wire lever writes to an audited
  // setBy: 'user-direct' path.
  app.get('/api/config/levers', async c => {
    try {
      const settings = await loadLeverSettings({
        path: defaultAgentSettingsPath(projectPath),
      })
      const renderPos = (pos: unknown): string => {
        if (typeof pos === 'string' || typeof pos === 'number') return String(pos)
        if (pos && typeof pos === 'object' && 'kind' in pos) {
          const k = (pos as { kind: string }).kind
          const parts: string[] = [k]
          for (const [key, val] of Object.entries(pos as Record<string, unknown>)) {
            if (key === 'kind') continue
            parts.push(`${key}=${String(val)}`)
          }
          return parts.join(' ')
        }
        return JSON.stringify(pos)
      }
      const project = Object.entries(settings.project).map(([name, entry]) => ({
        scope: 'project' as const,
        name,
        position: renderPos(entry.position),
        rationale: entry.rationale,
        setBy: entry.setBy,
      }))
      const domain = Object.entries(settings.domains.default).map(([name, entry]) => ({
        scope: 'domain:default' as const,
        name,
        position: renderPos(entry.position),
        rationale: entry.rationale,
        setBy: entry.setBy,
      }))
      return c.json({ levers: [...project, ...domain] })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // POST /api/config/levers/reset — wipe the on-disk lever file and re-seed
  // from defaults. Used to recover from LeverSettingsCorruptError (schema
  // grew, stale on-disk file is missing a newly-required lever).
  app.post('/api/config/levers/reset', async c => {
    try {
      const path = defaultAgentSettingsPath(projectPath)
      await saveLeverSettings({ path, settings: makeDefaultSettings() })
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // API: design system
  //
  // Project-scoped; lives at memory/design-system.yaml. The spec agent
  // drafts it; a human approves. Agents consume the approved revision via
  // context-builder's summary block — read the full file for richer surface.
  // -------------------------------------------------------------------------
  app.get('/api/project/design-system', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = join(project.path, 'memory')
      const ds = await loadDesignSystem(memoryDir)
      if (!ds) return c.json({ designSystem: null })
      return c.json({ designSystem: ds, summary: summarizeDesignSystem(ds) })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/project/design-system', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = join(project.path, 'memory')
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const authoredBy = typeof body.authoredBy === 'string' ? body.authoredBy : 'human'
      const result = await updateDesignSystem({
        memoryDir,
        tokens: (body.tokens as never) ?? undefined,
        primitives: (body.primitives as never) ?? undefined,
        interactions: (body.interactions as never) ?? undefined,
        a11y: (body.a11y as never) ?? undefined,
        copyVoice: (body.copyVoice as never) ?? undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        authoredBy,
      })
      if (!result.success) return c.json({ error: result.error ?? 'update failed' }, 400)
      return c.json({ ok: true, revision: result.revision })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/project/design-system/approve', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = join(project.path, 'memory')
      const ds = await loadDesignSystem(memoryDir)
      if (!ds) return c.json({ error: 'no design system drafted yet' }, 400)
      const now = new Date().toISOString()
      const approved: DesignSystem = DesignSystem.parse({
        ...ds,
        approvedBy: 'human',
        approvedAt: now,
      })
      await saveDesignSystem(memoryDir, approved)
      return c.json({ ok: true, approvedAt: now })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // API: release readiness
  //
  // Aggregates the signals that decide "is this project ready to ship its
  // next milestone?" into a single readout. Intentionally shallow — it
  // summarizes, it doesn't gate. The Release view renders the sections
  // and links back into drawers / Settings for fix-its.
  // -------------------------------------------------------------------------
  app.get('/api/project/release-readiness', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = join(project.path, 'memory')
      const tasksPath = join(memoryDir, 'TASKS.json')
      const tasks: Array<Record<string, unknown>> = (() => {
        if (!existsSync(tasksPath)) return []
        const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>
        return Array.isArray(raw) ? raw : raw.tasks ?? []
      })()
      const ds = await loadDesignSystem(memoryDir).catch(() => undefined)

      const statusCounts: Record<string, number> = {}
      const openEscalations: Array<{ taskId: string; taskTitle: string; escalationId: string; reason: string; summary: string }> = []
      const unapprovedBriefs: Array<{ id: string; title: string }> = []
      const unapprovedSpecs: Array<{ id: string; title: string }> = []
      const shelvedUnclaimed: Array<{ id: string; title: string; detail?: string }> = []
      const blockedByAgent: Array<{ id: string; title: string; reason?: string }> = []

      for (const t of tasks) {
        const status = String((t as { status?: string }).status ?? 'unknown')
        statusCounts[status] = (statusCounts[status] ?? 0) + 1
        const id = String((t as { id?: string }).id ?? '')
        const title = String((t as { title?: string }).title ?? id)
        const brief = (t as { productBrief?: { approvedAt?: string } }).productBrief
        if (brief && !brief.approvedAt) unapprovedBriefs.push({ id, title })
        if (status === 'spec_review') unapprovedSpecs.push({ id, title })
        if (status === 'shelved') {
          const reason = (t as { shelveReason?: { detail?: string } }).shelveReason
          shelvedUnclaimed.push({ id, title, ...(reason?.detail ? { detail: reason.detail } : {}) })
        }
        if (status === 'blocked') {
          const br = (t as { blockReason?: string }).blockReason
          blockedByAgent.push({ id, title, ...(br ? { reason: br } : {}) })
        }
        const escs = (t as { escalations?: Array<{ id: string; reason: string; summary: string; resolvedAt?: string }> }).escalations ?? []
        for (const e of escs) {
          if (!e.resolvedAt) openEscalations.push({
            taskId: id,
            taskTitle: title,
            escalationId: e.id,
            reason: e.reason,
            summary: e.summary,
          })
        }
      }

      const designSystemApproved = Boolean(ds?.approvedAt)
      const designSystemDrafted = Boolean(ds)

      // "Blocking" = something a human almost certainly needs to act on.
      // Everything else is informational.
      const blockingCount =
        openEscalations.length
        + unapprovedBriefs.length
        + unapprovedSpecs.length
        + shelvedUnclaimed.length
        + blockedByAgent.length

      return c.json({
        ready: blockingCount === 0 && statusCounts['exploring'] === undefined && statusCounts['in_progress'] === undefined && statusCounts['review'] === undefined && statusCounts['gate_check'] === undefined,
        statusCounts,
        openEscalations,
        unapprovedBriefs,
        unapprovedSpecs,
        shelvedUnclaimed,
        blockedByAgent,
        designSystem: {
          drafted: designSystemDrafted,
          approved: designSystemApproved,
          revision: ds?.revision ?? 0,
        },
        totals: {
          tasks: tasks.length,
          blockingCount,
          done: statusCounts['done'] ?? 0,
        },
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // API: setup wizard
  // -------------------------------------------------------------------------
  app.get('/api/setup/status', c => {
    const stored = readProjectConfig(projectPath)
    return c.json({
      path: project.path,
      initialized: !project.initializationNeeded,
      providerConfigured: Boolean(stored.preferredProvider),
      name: project.config?.name ?? null,
      id: project.config?.id ?? null,
      coordinatorCount: project.config?.coordinators?.length ?? 0,
    })
  })

  app.get('/api/setup/defaults', c => {
    const basename = project.path.split('/').pop() ?? 'project'
    const suggestedName = project.config?.name ?? basename
    const suggestedId = project.config?.id ?? slugify(suggestedName)
    const localModels = MODEL_CATALOG
      .filter(m => m.provider === 'lm-studio')
      .map(m => ({ id: m.id, notes: m.notes ?? '' }))
    const cloudModels = MODEL_CATALOG
      .filter(m => m.provider !== 'lm-studio')
      .map(m => ({ id: m.id, provider: m.provider, notes: m.notes ?? '' }))
    return c.json({
      suggestedName,
      suggestedId,
      defaultLocalAssignment: DEFAULT_LOCAL_MODEL_ASSIGNMENT,
      localModels,
      cloudModels,
    })
  })

  app.post('/api/setup/identity', async c => {
    try {
      project = resolveProject(project.path)
      const body = await c.req.json().catch(() => ({})) as {
        name?: string
        id?: string
        projectPath?: string
        tags?: string[]
      }
      const name = body.name?.trim()
      if (!name) return c.json({ error: 'Missing "name"' }, 400)
      const id = (body.id?.trim() || slugify(name))
      if (!/^[a-z0-9-]+$/.test(id)) {
        return c.json({ error: 'ID must be lowercase letters, numbers, dashes only' }, 400)
      }
      const subProjectPath = body.projectPath?.trim() || undefined

      const existing = project.initializationNeeded ? null : readWorkspaceConfig(project.path)
      const nextConfig = {
        name,
        id,
        ...(subProjectPath ? { projectPath: subProjectPath } : existing?.projectPath ? { projectPath: existing.projectPath } : {}),
        models: existing?.models ?? { ...DEFAULT_LOCAL_MODEL_ASSIGNMENT },
        coordinators: existing?.coordinators ?? [],
        maxRevisions: existing?.maxRevisions ?? 3,
        heartbeatInterval: existing?.heartbeatInterval ?? 5,
        ignore: existing?.ignore ?? ['node_modules', 'dist', '.git', 'coverage'],
        tags: body.tags ?? existing?.tags ?? [],
      }

      if (project.initializationNeeded) {
        bootstrapWorkspace(project.path, { name, ...(subProjectPath ? { projectPath: subProjectPath } : {}) })
      }
      writeWorkspaceConfig(project.path, nextConfig as Parameters<typeof writeWorkspaceConfig>[1])

      project = resolveProject(project.path)
      return c.json({ ok: true, id: project.id, name, path: project.path })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Providers: global (machine-scoped) credential store.
  //
  // Credentials live in ~/.guildhall/providers.yaml and are shared across
  // all projects on this machine. Project configs carry only a
  // `preferredProvider` selection — no secrets.
  //
  // Endpoints:
  //   GET  /api/setup/providers       detection + stored credentials
  //   POST /api/setup/providers/config set/update one provider's credential
  //                                    or the project's preferredProvider
  //   POST /api/providers/test        send-test-message roundtrip, marks verified
  //   POST /api/providers/disconnect  revoke a stored credential
  // -------------------------------------------------------------------------

  function describeProviders() {
    // Run the legacy-config migration on every request. It is idempotent
    // and cheap (a single YAML read + Zod parse) and means users who
    // upgrade in-place never see stale credentials in their project file.
    try {
      migrateProjectProvidersToGlobal(projectPath, {
        readProject: (p) => readProjectConfig(p),
        writeProject: (p, patch) => updateProjectConfig(p, patch),
      })
    } catch {
      /* best-effort — never let migration break the endpoint */
    }

    const global = readGlobalProviders()
    const creds = resolveGlobalCredentials(global, process.env)
    const claudeCredPath = join(homedir(), '.claude', '.credentials.json')
    const codexCredPath = join(homedir(), '.codex', 'auth.json')
    const claudeInstalled = existsSync(claudeCredPath)
    const codexInstalled = existsSync(codexCredPath)

    return {
      global,
      creds,
      claudeCredPath,
      codexCredPath,
      claudeInstalled,
      codexInstalled,
    }
  }

  async function probeLlamaCpp(url: string): Promise<boolean> {
    try {
      const res = await fetch(url + '/models', { signal: AbortSignal.timeout(800) })
      return res.ok
    } catch {
      return false
    }
  }

  app.get('/api/setup/providers', async c => {
    try {
      const { global, creds, claudeCredPath, codexCredPath, claudeInstalled, codexInstalled } =
        describeProviders()
      const stored = readProjectConfig(projectPath)

      const defaultLlamaUrl = 'http://localhost:1234/v1'
      const configuredLlamaUrl = creds.llamaCppUrl ?? ''
      const llamaUrl = configuredLlamaUrl || defaultLlamaUrl
      const llamaReachable = llamaUrl.length > 0 ? await probeLlamaCpp(llamaUrl) : false

      const v = (kind: ProviderKind) => global.providers[kind]?.verifiedAt ?? null

      return c.json({
        preferredProvider: stored.preferredProvider ?? null,
        providers: {
          'claude-oauth': {
            label: 'Claude Pro/Max (via Claude Code CLI)',
            detected: claudeInstalled,
            verifiedAt: v('claude-oauth'),
            detail: claudeInstalled
              ? `Credentials detected at ${claudeCredPath}`
              : 'Install Claude Code and run `claude auth login`.',
          },
          'codex': {
            label: 'Codex (via Codex CLI)',
            detected: codexInstalled,
            verifiedAt: v('codex-oauth'),
            detail: codexInstalled
              ? `Credentials detected at ${codexCredPath}`
              : 'Install the Codex CLI and run `codex auth login`.',
          },
          'llama-cpp': {
            label: 'Local llama.cpp / LM Studio',
            detected: llamaReachable,
            verifiedAt: v('llama-cpp'),
            url: llamaReachable ? llamaUrl : configuredLlamaUrl || null,
            detail:
              configuredLlamaUrl.length === 0 && !llamaReachable
                ? `Not reachable at ${defaultLlamaUrl}. Start LM Studio / llama.cpp or paste a server URL.`
                : llamaReachable
                  ? `Reachable at ${llamaUrl}`
                  : `Not reachable at ${llamaUrl}. Start LM Studio / llama.cpp and click refresh.`,
          },
          'anthropic-api': {
            label: 'Anthropic API key',
            detected: Boolean(creds.anthropicApiKey),
            verifiedAt: v('anthropic-api'),
            detail: global.providers['anthropic-api']?.apiKey
              ? 'Stored in ~/.guildhall/providers.yaml'
              : process.env.ANTHROPIC_API_KEY
                ? 'Picked up from $ANTHROPIC_API_KEY'
                : 'Paste an API key to enable.',
          },
          'openai-api': {
            label: 'OpenAI API key',
            detected: Boolean(creds.openaiApiKey),
            verifiedAt: v('openai-api'),
            detail: global.providers['openai-api']?.apiKey
              ? 'Stored in ~/.guildhall/providers.yaml'
              : process.env.OPENAI_API_KEY
                ? 'Picked up from $OPENAI_API_KEY'
                : 'Paste an API key to enable.',
          },
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/setup/providers/config', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        preferredProvider?: string
        anthropicApiKey?: string
        openaiApiKey?: string
        lmStudioUrl?: string
      }
      const allowed = ['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api'] as const
      // preferredProvider lives in the project file (selection, not a secret).
      if (body.preferredProvider) {
        if (!(allowed as readonly string[]).includes(body.preferredProvider)) {
          return c.json({ error: `Unknown provider "${body.preferredProvider}"` }, 400)
        }
        updateProjectConfig(projectPath, {
          preferredProvider: body.preferredProvider as (typeof allowed)[number],
        })
      }
      // Credentials go to the global store.
      if (typeof body.anthropicApiKey === 'string' && body.anthropicApiKey.trim().length > 0) {
        setProvider('anthropic-api', { apiKey: body.anthropicApiKey.trim() })
      }
      if (typeof body.openaiApiKey === 'string' && body.openaiApiKey.trim().length > 0) {
        setProvider('openai-api', { apiKey: body.openaiApiKey.trim() })
      }
      if (typeof body.lmStudioUrl === 'string' && body.lmStudioUrl.trim().length > 0) {
        const url = body.lmStudioUrl.trim()
        setProvider('llama-cpp', { url })
        const loadedModels = await loadedLlamaModelIds(url).catch(() => [])
        const loadedModel = loadedModels[0]
        if (loadedModel) {
          const workspace = readWorkspaceConfig(projectPath)
          writeWorkspaceConfig(projectPath, {
            ...workspace,
            models: modelAssignmentForSingleModel(loadedModel),
          })
        }
      }
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Pick a cheap, widely-available model id for a verification round-trip
  // against each provider. For llama.cpp we ask the server which model is
  // currently loaded (it owns that choice; we can't know locally).
  async function modelForRoundtrip(
    name: PreferredProviderKey,
    llamaUrl: string,
  ): Promise<string | undefined> {
    switch (name) {
      case 'claude-oauth':
      case 'anthropic-api':
        return 'claude-haiku-4-5-20251001'
      case 'openai-api':
        return 'gpt-4o-mini'
      case 'codex':
      case 'codex-oauth':
        return 'gpt-5-codex'
      case 'llama-cpp': {
        if (!llamaUrl) return undefined
        try {
          const res = await fetch(llamaUrl.replace(/\/$/, '') + '/models', {
            signal: AbortSignal.timeout(1500),
          })
          if (!res.ok) return undefined
          const body = (await res.json()) as { data?: Array<{ id?: string }> }
          const first = body.data?.[0]?.id
          return typeof first === 'string' && first.length > 0 ? first : undefined
        } catch {
          return undefined
        }
      }
    }
  }

  /**
   * Send a trivial prompt through the provider's real client and return a
   * success marker + first-chars sample (or a human-readable error). The
   * caller records a verifiedAt timestamp on success. No fallback magic:
   * if the forced provider isn't reachable with the configured creds we
   * surface exactly that failure so the user can fix it.
   */
  async function testProviderRoundtrip(
    name: PreferredProviderKey,
  ): Promise<{ ok: boolean; error?: string; sample?: string }> {
    const global = readGlobalProviders()
    const creds = resolveGlobalCredentials(global, process.env)
    const forced: PreferredProviderKey = name
    const forcedInternal = forced === 'codex' ? 'codex-oauth' : forced
    const model = await modelForRoundtrip(forced, creds.llamaCppUrl ?? '')
    if (!model) {
      return {
        ok: false,
        error:
          forced === 'llama-cpp'
            ? 'No model loaded on the llama.cpp/LM Studio server. Load a model and try again.'
            : `No default model known for ${forced}.`,
      }
    }
    let selected
    try {
      const selectOpts: Parameters<typeof selectApiClient>[0] = {
        provider: forcedInternal,
      }
      if (creds.anthropicApiKey) selectOpts.anthropicApiKey = creds.anthropicApiKey
      if (creds.openaiApiKey) selectOpts.openaiApiKey = creds.openaiApiKey
      if (creds.llamaCppUrl) selectOpts.llamaCppUrl = creds.llamaCppUrl
      selected = await selectApiClient(selectOpts)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (selected.providerName === 'none') {
      return { ok: false, error: selected.reason ?? `${forced} not available.` }
    }
    try {
      let sample = ''
      const iterable = selected.apiClient.streamMessage({
        model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply with a single word: OK' }],
          },
        ],
        max_tokens: 32,
        tools: [],
      })
      for await (const ev of iterable) {
        if (ev.type === 'text_delta') {
          sample += ev.text
          if (sample.length > 80) break
        } else if (ev.type === 'message_complete') {
          break
        }
      }
      const trimmed = sample.trim()
      if (trimmed.length === 0) {
        return { ok: false, error: 'Provider returned an empty response.' }
      }
      return { ok: true, sample: trimmed.slice(0, 80) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Send a trivial prompt through the provider's real client and mark
  // verified on success. This is the "did my paste actually work?" button
  // — the alpha-critical piece that was missing before.
  app.post('/api/providers/test', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { provider?: string }
      const allowed = ['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api'] as const
      const name = body.provider
      if (!name || !(allowed as readonly string[]).includes(name)) {
        return c.json({ ok: false, error: `Unknown provider "${name ?? ''}"` }, 400)
      }
      const result = await testProviderRoundtrip(name as (typeof allowed)[number])
      if (result.ok) {
        const storeKind: ProviderKind =
          name === 'codex' ? 'codex-oauth' : (name as ProviderKind)
        try {
          markProviderVerified(storeKind)
        } catch {
          /* verification timestamp is a convenience, not required */
        }
      }
      return c.json(result)
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Revoke a stored credential. For OAuth providers we just clear the
  // "verified" marker; the actual credential lives in a CLI directory
  // that we do not touch.
  app.post('/api/providers/disconnect', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { provider?: string }
      const allowed = ['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api'] as const
      const name = body.provider
      if (!name || !(allowed as readonly string[]).includes(name)) {
        return c.json({ ok: false, error: `Unknown provider "${name ?? ''}"` }, 400)
      }
      const storeKind: ProviderKind =
        name === 'codex' ? 'codex-oauth' : (name as ProviderKind)
      if (storeKind === 'claude-oauth' || storeKind === 'codex-oauth') {
        // Clear the verified marker; CLI-managed credential is left alone.
        removeProvider(storeKind)
        return c.json({
          ok: true,
          note: 'Cleared the verified marker. The underlying OAuth credential is managed by the CLI — run its logout command to revoke it fully.',
        })
      }
      removeProvider(storeKind)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // SSE stream
  // -------------------------------------------------------------------------
  app.get('/api/project/events', c => {
    return streamSSE(c, async stream => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'connected', projectId: project.id }) })
      for (const ev of supervisor.recent(project.id)) {
        await stream.writeSSE({ data: JSON.stringify(ev) })
      }
      const unsubscribe = supervisor.subscribe(ev => {
        if (ev.workspaceId !== project.id) return
        void stream.writeSSE({ data: JSON.stringify(ev) })
      })
      let running = true
      stream.onAbort(() => { running = false; unsubscribe() })
      while (running) {
        await stream.sleep(15_000)
        if (!running) break
        await stream.writeSSE({
          data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
        })
      }
    })
  })

  // -------------------------------------------------------------------------
  // Static web bundle (Svelte 5 dashboard). dist/web/ is emitted by build.mjs.
  // The bundle mounts into the #svelte-root element in dashboardHtml().
  // -------------------------------------------------------------------------
  app.get('/web/app.js', c => serveWebAsset(c, 'app.js', 'text/javascript; charset=utf-8'))
  app.get('/web/app.css', c => serveWebAsset(c, 'app.css', 'text/css; charset=utf-8'))
  app.get('/web/app.js.map', c => serveWebAsset(c, 'app.js.map', 'application/json'))
  app.get('/web/app.css.map', c => serveWebAsset(c, 'app.css.map', 'application/json'))

  // -------------------------------------------------------------------------
  // SPA (catch-all)
  // -------------------------------------------------------------------------
  app.get('*', c => c.html(dashboardHtml()))

  return { app, supervisor, projectPath }
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const { app, supervisor, projectPath } = buildServeApp(opts)
  const project = resolveProject(projectPath)
  const cfg = readProjectConfig(projectPath)
  const port = opts.port ?? cfg.servePort

  console.log(`[guildhall serve] Project: ${project.path}`)
  console.log(`[guildhall serve] ${project.initializationNeeded ? '⚠ Not initialized — wizard at /setup' : `✓ ${project.config?.name ?? project.id}`}`)
  console.log(`[guildhall serve] Dashboard: http://localhost:${port}`)
  console.log(`[guildhall serve] PID: ${process.pid}`)
  // Heads-up to any humans: Node loaded the dist into memory at startup.
  // Subsequent rebuilds need a kill+restart to take effect. The web app
  // surfaces this as a banner via /api/build-info — this line just makes
  // the same fact visible from the terminal.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const distEntry = [join(here, 'cli.js'), join(here, '..', 'cli.js')].find(p => existsSync(p))
    if (distEntry) {
      const mtime = statSync(distEntry).mtimeMs
      console.log(`[guildhall serve] Loaded build: ${new Date(mtime).toISOString()}  (${distEntry})`)
      console.log(`[guildhall serve] Rebuild → restart required (kill ${process.pid} + re-run).`)
    }
  } catch {
    /* non-fatal */
  }
  console.log(`[guildhall serve] Press Ctrl+C to stop.`)
  console.log()

  const server = serve({ fetch: app.fetch, port }, info => {
    console.log(`[guildhall serve] ✓ Running at http://localhost:${info.port}`)
  })

  // FR-28 / AC-19: cooperative shutdown. SIGINT (Ctrl+C) and SIGTERM both
  // drive the same path: stop every running supervisor (which writes the
  // stop marker, flips stopSignal, waits for in-flight ticks to drain,
  // and cleans up registered children), then close the HTTP server, then
  // exit 0. Handlers are idempotent — the shuttingDown flag avoids the
  // "Ctrl+C twice" hard-exit being interpreted as a regression.
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[guildhall serve] ${signal} received — draining…`)
    try {
      await supervisor.stopAll({ reason: `signal:${signal}` })
    } catch (err) {
      console.warn(`[guildhall serve] stopAll error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise<void>(resolve => server.close(() => resolve()))
    console.log('[guildhall serve] shutdown complete')
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

// ---------------------------------------------------------------------------
// Web bundle (dist/web/) lives alongside the built cli.js. At runtime we
// resolve it relative to this module's URL so it works both in the esbuild
// bundle (dist/cli.js) and when running the TS sources via vitest (where
// dist/web/ is still the build output we expect to exist).
// ---------------------------------------------------------------------------

const WEB_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  // In the bundled build, cli.js sits at dist/cli.js and web assets at dist/web/.
  // In dev (running from src/runtime), we walk up to the repo root and find dist/web.
  const bundled = join(here, 'web')
  if (existsSync(bundled)) return bundled
  return resolve(here, '..', '..', 'dist', 'web')
})()

async function serveWebAsset(
  c: Context,
  filename: string,
  contentType: string,
): Promise<Response> {
  const path = join(WEB_DIR, filename)
  if (!existsSync(path)) {
    return c.text(`web asset not built: ${filename} (run pnpm build)`, 404)
  }
  const body = await fsp.readFile(path)
  return new Response(body, {
    headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
  })
}

// ---------------------------------------------------------------------------
// Inline dashboard SPA
// ---------------------------------------------------------------------------

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Guildhall</title>
  <link rel="stylesheet" href="/web/app.css" />
</head>
<body>
  <div id="svelte-root"></div>
  <noscript>
    <p style="color:#e8e8f0;background:#0f0f11;padding:24px;font-family:system-ui,sans-serif">
      Guildhall requires JavaScript. Enable it and reload.
    </p>
  </noscript>
  <script type="module" src="/web/app.js"></script>
</body>
</html>`
}
