import { readFileSync, existsSync, promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  bootstrapWorkspace,
  readProjectConfig,
  updateProjectConfig,
  FORGE_YAML_FILENAME,
  slugify,
} from '@guildhall/config'
import { MODEL_CATALOG, DEFAULT_LOCAL_MODEL_ASSIGNMENT } from '@guildhall/core'
import { loadLeverSettings, defaultAgentSettingsPath } from '@guildhall/levers'
import { OrchestratorSupervisor } from './serve-supervisor.js'
import { createExploringTask } from './intake.js'
import {
  approveMetaIntake,
  createMetaIntakeTask,
  META_INTAKE_TASK_ID,
  parseCoordinatorDraft,
  workspaceNeedsMetaIntake,
} from './meta-intake.js'

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
//   GET    /api/project/progress      → tail of memory/PROGRESS.md
//   GET    /api/project/events        → SSE feed of orchestrator events
//   GET    /api/config                → project-local config (secrets redacted)
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
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/start', c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const run = supervisor.start({ workspaceId: project.id, workspacePath: project.path })
      return c.json({ status: run.status, startedAt: run.startedAt })
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
      const result = await approveMetaIntake({
        workspacePath: project.path,
        memoryDir: join(project.path, 'memory'),
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Approval failed' }, 400)
      }
      // Re-resolve so subsequent GETs reflect the newly-added coordinators.
      project = resolveProject(project.path)
      return c.json({ ok: true, coordinatorsAdded: result.coordinatorsAdded ?? 0 })
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
      const tail = raw.split('\n').slice(-120).join('\n')
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

  app.get('/api/setup/providers', async c => {
    try {
      const stored = readProjectConfig(projectPath)
      const claudeCredPath = join(homedir(), '.claude', '.credentials.json')
      const codexCredPath = join(homedir(), '.codex', 'auth.json')

      const claudeInstalled = existsSync(claudeCredPath)
      const codexInstalled = existsSync(codexCredPath)

      let lmStudioReachable = false
      try {
        const res = await fetch(stored.lmStudioUrl + '/models', { signal: AbortSignal.timeout(800) })
        lmStudioReachable = res.ok
      } catch { /* unreachable — expected */ }

      return c.json({
        preferredProvider: stored.preferredProvider ?? null,
        providers: {
          'claude-oauth': {
            label: 'Claude Pro/Max (via Claude Code CLI)',
            detected: claudeInstalled,
            detail: claudeInstalled
              ? `Credentials detected at ${claudeCredPath}`
              : 'Install Claude Code (`brew install anthropic/claude/claude`) and run `claude auth login`.',
          },
          'codex': {
            label: 'Codex (via Codex CLI)',
            detected: codexInstalled,
            detail: codexInstalled
              ? `Credentials detected at ${codexCredPath}`
              : 'Install the Codex CLI and run `codex auth login`.',
          },
          'llama-cpp': {
            label: 'Local llama.cpp / LM Studio',
            detected: lmStudioReachable,
            detail: lmStudioReachable
              ? `Reachable at ${stored.lmStudioUrl}`
              : `Not reachable at ${stored.lmStudioUrl}. Start LM Studio or llama.cpp and click refresh.`,
            url: stored.lmStudioUrl,
          },
          'anthropic-api': {
            label: 'Anthropic API key',
            detected: Boolean(stored.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY),
            detail: stored.anthropicApiKey
              ? 'Stored in .guildhall/config.yaml'
              : (process.env.ANTHROPIC_API_KEY ? 'Picked up from $ANTHROPIC_API_KEY' : 'Paste an API key to enable.'),
          },
          'openai-api': {
            label: 'OpenAI API key',
            detected: Boolean(stored.openaiApiKey ?? process.env.OPENAI_API_KEY),
            detail: stored.openaiApiKey
              ? 'Stored in .guildhall/config.yaml'
              : (process.env.OPENAI_API_KEY ? 'Picked up from $OPENAI_API_KEY' : 'Paste an API key to enable.'),
          },
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/setup/providers/config', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        preferredProvider?: string
        anthropicApiKey?: string
        openaiApiKey?: string
        lmStudioUrl?: string
      }
      const allowed = ['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api'] as const
      const patch: Parameters<typeof updateProjectConfig>[1] = {}
      if (body.preferredProvider) {
        if (!(allowed as readonly string[]).includes(body.preferredProvider)) {
          return c.json({ error: `Unknown provider "${body.preferredProvider}"` }, 400)
        }
        patch.preferredProvider = body.preferredProvider as typeof allowed[number]
      }
      if (typeof body.anthropicApiKey === 'string') patch.anthropicApiKey = body.anthropicApiKey
      if (typeof body.openaiApiKey === 'string') patch.openaiApiKey = body.openaiApiKey
      if (typeof body.lmStudioUrl === 'string') patch.lmStudioUrl = body.lmStudioUrl
      const saved = updateProjectConfig(projectPath, patch)
      const redacted: Record<string, unknown> = { ...saved }
      if (redacted.anthropicApiKey) redacted.anthropicApiKey = '•••'
      if (redacted.openaiApiKey) redacted.openaiApiKey = '•••'
      return c.json(redacted)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
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
  // SPA (catch-all)
  // -------------------------------------------------------------------------
  app.get('*', c => c.html(dashboardHtml()))

  return { app, supervisor, projectPath }
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const { app, projectPath } = buildServeApp(opts)
  const project = resolveProject(projectPath)
  const cfg = readProjectConfig(projectPath)
  const port = opts.port ?? cfg.servePort

  console.log(`[guildhall serve] Project: ${project.path}`)
  console.log(`[guildhall serve] ${project.initializationNeeded ? '⚠ Not initialized — wizard at /setup' : `✓ ${project.config?.name ?? project.id}`}`)
  console.log(`[guildhall serve] Dashboard: http://localhost:${port}`)
  console.log(`[guildhall serve] Press Ctrl+C to stop.`)
  console.log()

  serve({ fetch: app.fetch, port }, info => {
    console.log(`[guildhall serve] ✓ Running at http://localhost:${info.port}`)
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
  <style>${dashboardCss()}</style>
</head>
<body>
  <header>
    <h1 onclick="location.href='/'" style="cursor:pointer">⚔ Guildhall</h1>
    <span id="project-name" class="badge"></span>
    <span style="flex:1"></span>
    <a href="/settings" class="nav-link" id="nav-settings">Settings</a>
    <span id="sse-status" class="muted">● connecting…</span>
  </header>

  <main id="app">
    <div class="muted" style="padding:40px">Loading…</div>
  </main>

  <script type="module">
${dashboardJs()}
  </script>
</body>
</html>`
}

function dashboardCss(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f0f11;
      --surface: #1a1a1f;
      --surface-2: #24242c;
      --border: #2a2a33;
      --accent: #7c6df0;
      --accent2: #4ecca3;
      --text: #e8e8f0;
      --muted: #888899;
      --danger: #e05252;
      --warn: #d4a23c;
      --success: #4ecca3;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; min-height: 100vh; }
    header {
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--surface);
      position: sticky; top: 0; z-index: 10;
    }
    header h1 { font-size: 16px; font-weight: 600; letter-spacing: -0.3px; }
    .badge { font-size: 11px; color: var(--accent2); background: rgba(78,204,163,0.12); padding: 2px 8px; border-radius: 12px; }
    .muted { color: var(--muted); font-size: 13px; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; letter-spacing: -0.2px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 24px 0 10px; }
    .pill { border-radius: 10px; padding: 1px 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .pill.running { background: rgba(78,204,163,0.15); color: var(--accent2); }
    .pill.stopped { background: rgba(136,136,153,0.12); color: var(--muted); }
    .pill.error { background: rgba(224,82,82,0.15); color: var(--danger); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; flex-shrink: 0; }
    .status-dot.running { background: var(--accent2); box-shadow: 0 0 6px var(--accent2); animation: pulse 1.4s ease-in-out infinite; }
    .status-dot.idle { background: var(--muted); }
    .status-dot.error { background: var(--danger); }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }
    button {
      background: var(--accent); color: white; border: none; font-weight: 600;
      padding: 6px 14px; border-radius: 5px; cursor: pointer; font-size: 12px;
    }
    button:hover { filter: brightness(1.1); }
    button.secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
    button.danger { background: var(--danger); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .detail-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
    .detail-header h2 { margin: 0; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 14px;
    }
    .two-col { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; }
    @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; }
    .feed { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; max-height: 420px; overflow-y: auto; font-family: 'SF Mono', monospace; font-size: 11.5px; line-height: 1.55; }
    .feed .ev { padding: 3px 0; border-bottom: 1px dashed transparent; }
    .feed .ev.transition { color: var(--accent2); }
    .feed .ev.escalation { color: var(--warn); }
    .feed .ev.error { color: var(--danger); }
    .feed .ev.issue { color: var(--accent); }
    .feed .ev.supervisor { color: var(--muted); }
    .feed .ts { color: var(--muted); margin-right: 6px; }
    pre.progress { white-space: pre-wrap; font-family: 'SF Mono', monospace; font-size: 11.5px; background: var(--bg); padding: 10px; border-radius: 6px; max-height: 320px; overflow-y: auto; border: 1px solid var(--border); color: var(--muted); }
    .empty { text-align: center; padding: 48px 16px; color: var(--muted); }
    .empty code { background: var(--surface); border: 1px solid var(--border); padding: 10px 16px; border-radius: 5px; display: inline-block; margin-top: 14px; font-size: 13px; font-family: 'SF Mono', monospace; }
    code.inline { background: var(--surface-2); padding: 1px 6px; border-radius: 3px; font-size: 11px; font-family: 'SF Mono', monospace; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      width: min(560px, 92vw);
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .modal h2 { margin-bottom: 14px; }
    .modal label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; font-weight: 700; }
    .modal textarea, .modal input, .modal select {
      width: 100%;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 10px 12px;
      font-family: inherit;
      font-size: 13px;
      margin-bottom: 14px;
    }
    .modal textarea { min-height: 120px; resize: vertical; font-family: 'SF Mono', monospace; line-height: 1.5; }
    .modal textarea:focus, .modal input:focus, .modal select:focus { border-color: var(--accent); outline: none; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
    .meta-intake-banner {
      background: rgba(212,162,60,0.08);
      border: 1px solid rgba(212,162,60,0.4);
      border-radius: 6px;
      padding: 14px 18px;
      margin-bottom: 16px;
      display: flex; gap: 16px; align-items: center;
    }
    .meta-intake-banner .text { flex: 1; font-size: 13px; }
    .meta-intake-banner strong { color: var(--warn); }
    .wizard { max-width: 720px; margin: 0 auto; }
    .wizard .step-header { display: flex; gap: 8px; align-items: center; margin-bottom: 18px; color: var(--muted); font-size: 12px; }
    .wizard .step-dot { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-2); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; }
    .wizard .step-dot.active { background: var(--accent); color: white; }
    .wizard .step-dot.done { background: var(--accent2); color: var(--bg); }
    .provider-list { display: flex; flex-direction: column; gap: 10px; }
    .provider-row {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px 16px;
      display: flex; gap: 14px; align-items: center;
      cursor: pointer;
      transition: border-color 0.12s;
    }
    .provider-row:hover { border-color: var(--accent); }
    .provider-row.selected { border-color: var(--accent); background: rgba(124,109,240,0.08); }
    .provider-row .status-chip { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
    .provider-row .status-chip.ok { background: rgba(78,204,163,0.15); color: var(--accent2); }
    .provider-row .status-chip.missing { background: rgba(136,136,153,0.12); color: var(--muted); }
    .provider-row .label { font-weight: 600; font-size: 14px; }
    .provider-row .detail { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .provider-row .radio { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; }
    .provider-row.selected .radio { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 40%, transparent 45%); }
    .nav-link { color: var(--muted); text-decoration: none; font-size: 12px; padding: 4px 10px; border-radius: 5px; }
    .nav-link:hover, .nav-link.active { color: var(--text); background: var(--surface-2); }
    .settings-grid { display: grid; gap: 14px; }
    .save-status { font-size: 12px; color: var(--accent2); opacity: 0; transition: opacity 0.3s; margin-right: 10px; }
    .save-status.visible, .save-status.ok, .save-status.error { opacity: 1; }
    .save-status.error { color: var(--danger); }
    .save-status.ok { color: var(--accent2); }
    .coord-list { display: grid; gap: 8px; }
    .coord-preview { padding: 10px 12px; background: var(--surface-2); border-radius: 6px; }
    .coord-title { font-weight: 600; font-size: 13px; }
    .lever-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .lever-table td { padding: 4px 8px 4px 0; vertical-align: top; }
    .lever-table tr.lever-rationale td { padding-top: 0; }
    .bootstrap-log { max-height: 260px; overflow-y: auto; background: var(--surface-2); border-radius: 6px; padding: 10px; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5; }
    .bootstrap-log-line { padding: 2px 0; color: var(--muted); }
    .bootstrap-log-line.highlight { color: var(--text); }
  `
}

function dashboardJs(): string {
  return `
    const app = document.getElementById('app')
    const projectName = document.getElementById('project-name')
    const sseStatus = document.getElementById('sse-status')

    function route() {
      const path = location.pathname
      const navSettings = document.getElementById('nav-settings')
      if (navSettings) navSettings.classList.toggle('active', path === '/settings')
      if (path === '/setup') return renderSetup()
      if (path === '/settings') return renderSettings()
      // Leaving wizard routes — reset wizard state so returning later starts fresh.
      wizardDefaults = null
      wizardIdentity = null
      return renderProject()
    }
    window.addEventListener('popstate', route)
    function nav(href) { history.pushState({}, '', href); route() }

    // Intercept in-app anchor clicks so they don't full-page reload.
    document.addEventListener('click', e => {
      const a = e.target.closest?.('a[href^="/"]')
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return
      const href = a.getAttribute('href')
      if (!href) return
      e.preventDefault()
      nav(href)
    })

    // ---- Project (root) view ----------------------------------------------
    async function renderProject() {
      app.innerHTML = '<div class="muted">Loading project…</div>'
      const detail = await fetch('/api/project').then(r => r.json())
      if (detail.error) { app.innerHTML = \`<div class="muted">Error: \${detail.error}</div>\`; return }

      if (detail.initializationNeeded) {
        projectName.textContent = ''
        app.innerHTML = \`
          <div class="empty">
            <h2>Project not initialized</h2>
            <p class="muted" style="margin:14px 0">\${detail.path}</p>
            <button onclick="location.href='/setup'">Start setup wizard →</button>
          </div>
        \`
        return
      }

      projectName.textContent = detail.name
      const runStatus = detail.run?.status ?? 'stopped'
      const coordinators = detail.config?.coordinators ?? []
      const needsMeta = coordinators.length === 0

      // Fire-and-forget: fetch the current meta-intake draft state so we can
      // show the approval card or the "in progress" hint without blocking the
      // first paint. Result lands in window.__metaDraft for later renders.
      const draftPromise = fetch('/api/project/meta-intake/draft').then(r => r.json()).catch(() => null)

      app.innerHTML = \`
        <div class="detail-header">
          <h2>\${escapeHtml(detail.name)}</h2>
          <span class="pill \${runStatus === 'running' ? 'running' : runStatus === 'error' ? 'error' : 'stopped'}">\${runStatus}</span>
          <span style="flex:1"></span>
          <button id="btn-new-task" class="secondary" \${needsMeta ? 'disabled title="Bootstrap the project first"' : ''}>+ New Task</button>
          <button id="btn-start" \${runStatus === 'running' || runStatus === 'stopping' ? 'disabled' : ''}>▶ Start</button>
          <button id="btn-stop" class="danger" \${runStatus !== 'running' ? 'disabled' : ''}>■ Stop</button>
        </div>

        \${needsMeta ? \`
          <div id="meta-intake-zone">
            <div class="meta-intake-banner">
              <div class="text">
                <strong>Project not yet bootstrapped.</strong> No coordinators are configured — click
                Bootstrap and the meta-intake agent will interview you about the codebase and draft a
                guildhall.yaml with coordinators for each domain it finds.
              </div>
              <button id="btn-bootstrap">Bootstrap project</button>
            </div>
          </div>
        \` : ''}

        <div class="two-col">
          <div>
            <div class="card">
              <h2>Live activity</h2>
              <div class="feed" id="feed"><div class="muted">Connecting…</div></div>
            </div>
            <div class="card">
              <h2>Recent PROGRESS.md</h2>
              <pre class="progress" id="progress">Loading…</pre>
            </div>
          </div>
          <div>
            <div class="card">
              <h2>Tasks (\${detail.tasks.length})</h2>
              \${detail.tasks.length === 0
                ? '<div class="muted">No tasks yet. Click "+ New Task" or let the meta-intake agent bootstrap them.</div>'
                : '<table><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Domain</th></tr></thead><tbody>' +
                  detail.tasks.map(t => \`
                    <tr>
                      <td><code class="inline">\${escapeHtml(t.id ?? '')}</code></td>
                      <td>\${escapeHtml(t.title ?? '')}</td>
                      <td>\${escapeHtml(t.status ?? '')}</td>
                      <td>\${escapeHtml(t.domain ?? '')}</td>
                    </tr>
                  \`).join('') + '</tbody></table>'}
            </div>
            <div class="card">
              <h2>Coordinators</h2>
              \${coordinators.map(c => \`
                <div style="margin-bottom:10px">
                  <div style="font-weight:600">\${escapeHtml(c.name)} <span class="muted" style="font-weight:400">— \${escapeHtml(c.domain)}</span></div>
                  <div class="muted" style="font-size:12px">\${escapeHtml(c.mandate?.slice(0, 180) ?? '')}\${(c.mandate?.length ?? 0) > 180 ? '…' : ''}</div>
                </div>
              \`).join('') || '<div class="muted">No coordinators configured.</div>'}
            </div>
          </div>
        </div>
      \`

      document.getElementById('btn-start').addEventListener('click', async () => {
        await fetch('/api/project/start', { method: 'POST' })
        setTimeout(renderProject, 300)
      })
      document.getElementById('btn-stop').addEventListener('click', async () => {
        await fetch('/api/project/stop', { method: 'POST' })
        setTimeout(renderProject, 300)
      })
      const btnNew = document.getElementById('btn-new-task')
      if (btnNew && !btnNew.disabled) {
        btnNew.addEventListener('click', () => showIntakeModal(coordinators))
      }
      const btnBootstrap = document.getElementById('btn-bootstrap')
      if (btnBootstrap) {
        btnBootstrap.addEventListener('click', async () => {
          btnBootstrap.disabled = true
          btnBootstrap.textContent = 'Creating…'
          const r = await fetch('/api/project/meta-intake', { method: 'POST' })
          const j = await r.json()
          if (j.error) {
            alert('Bootstrap failed: ' + j.error)
            btnBootstrap.disabled = false
            btnBootstrap.textContent = 'Bootstrap project'
            return
          }
          await fetch('/api/project/start', { method: 'POST' })
          setTimeout(renderProject, 400)
        })
      }

      // Swap the bootstrap banner for an approval card when a coordinator
      // draft is ready. This lets users finish the whole flow in-browser
      // instead of dropping to the guildhall approve-meta-intake CLI command.
      if (needsMeta) {
        draftPromise.then(draft => {
          if (!draft || !draft.taskExists) return
          const zone = document.getElementById('meta-intake-zone')
          if (!zone) return
          if (draft.status === 'draft-ready' && draft.drafts.length > 0) {
            renderMetaIntakeApproval(zone, draft.drafts)
          } else if (draft.status === 'in-progress' || draft.status === 'spec-but-no-fence') {
            zone.innerHTML = \`
              <div class="meta-intake-banner">
                <div class="text">
                  <strong>Meta-intake agent is working…</strong>
                  \${draft.status === 'spec-but-no-fence'
                    ? ' The spec is partially drafted but does not yet include a coordinators YAML block.'
                    : ' Watch the live activity feed for progress.'}
                </div>
              </div>
            \`
          }
        })
      }

      fetch('/api/project/progress').then(r => r.json()).then(j => {
        const el = document.getElementById('progress')
        if (el) el.textContent = j.progress || '(empty)'
      })

      const feed = document.getElementById('feed')
      if (feed) {
        feed.innerHTML = ''
        ;(detail.recentEvents || []).forEach(renderEvent)
      }
      connectStream()
    }

    // ---- Setup wizard ------------------------------------------------------
    let wizardStep = 1
    let wizardIdentity = null
    let wizardDefaults = null
    let selectedProvider = null

    async function renderSetup() {
      projectName.textContent = 'Setup'
      const params = new URLSearchParams(location.search)
      const requested = Number(params.get('step') || '1')

      if (!wizardDefaults) {
        const [defaults, status] = await Promise.all([
          fetch('/api/setup/defaults').then(r => r.json()),
          fetch('/api/setup/status').then(r => r.json()),
        ])
        wizardDefaults = defaults
        wizardIdentity = {
          name: status.name || defaults.suggestedName,
          id: status.id || defaults.suggestedId,
          path: status.path,
          initialized: status.initialized,
          providerConfigured: status.providerConfigured,
        }
      }

      // Auto-advance to the furthest incomplete step unless the URL forced a specific one
      if (!params.get('step')) {
        if (!wizardIdentity.initialized) wizardStep = 1
        else if (!wizardIdentity.providerConfigured) wizardStep = 2
        else wizardStep = 3
      } else {
        wizardStep = Math.max(1, Math.min(3, requested))
      }

      if (wizardStep === 1) return renderIdentityStep()
      if (wizardStep === 2) return renderProviderStep()
      return renderReadyStep()
    }

    function wizardHeader() {
      const labels = ['1 · Identity', '2 · Provider', '3 · Launch']
      return \`<div class="step-header">\${labels.map((lbl, i) => {
        const n = i + 1
        const cls = n < wizardStep ? 'done' : n === wizardStep ? 'active' : ''
        return \`<span class="step-dot \${cls}">\${n < wizardStep ? '✓' : n}</span><span style="margin-right:14px">\${escapeHtml(lbl.slice(4))}</span>\`
      }).join('')}</div>\`
    }

    function renderIdentityStep() {
      app.innerHTML = \`
        <div class="wizard">
          \${wizardHeader()}
          <div class="card">
            <h2>Name this project</h2>
            <p class="muted" style="margin-bottom:14px">Guildhall will write <code class="inline">guildhall.yaml</code> at <code class="inline">\${escapeHtml(wizardIdentity.path || '')}</code>. These are just labels — you can change them later from Settings or by editing the file.</p>
            <label>Workspace name</label>
            <input id="identity-name" type="text" value="\${escapeHtml(wizardIdentity.name || '')}" />
            <label>Workspace ID (slug)</label>
            <input id="identity-id" type="text" value="\${escapeHtml(wizardIdentity.id || '')}" />
            <div class="muted" style="font-size:11px; margin-top:-6px; margin-bottom:14px">Lowercase letters, numbers, and dashes only. Used in the CLI and in progress logs.</div>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px">
            <button class="secondary" onclick="location.href='/'">Cancel</button>
            <button id="btn-identity-next">Save and continue →</button>
          </div>
        </div>
      \`
      const nameInput = document.getElementById('identity-name')
      const idInput = document.getElementById('identity-id')
      let idEdited = Boolean(wizardIdentity.initialized)
      nameInput.addEventListener('input', () => {
        if (!idEdited) idInput.value = slugifyClient(nameInput.value)
      })
      idInput.addEventListener('input', () => { idEdited = true })

      document.getElementById('btn-identity-next').addEventListener('click', async () => {
        const name = nameInput.value.trim()
        const id = idInput.value.trim()
        if (!name) { alert('Workspace name is required'); return }
        if (!/^[a-z0-9-]+$/.test(id)) { alert('ID must be lowercase letters, numbers, and dashes only'); return }
        const btn = document.getElementById('btn-identity-next')
        btn.disabled = true; btn.textContent = 'Saving…'
        const r = await fetch('/api/setup/identity', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, id }),
        })
        const j = await r.json()
        if (j.error) {
          alert('Save failed: ' + j.error)
          btn.disabled = false; btn.textContent = 'Save and continue →'
          return
        }
        wizardIdentity = { ...wizardIdentity, name, id, initialized: true }
        wizardStep = 2
        nav('/setup?step=2')
      })
    }

    async function renderProviderStep() {
      app.innerHTML = '<div class="muted">Detecting providers…</div>'
      const data = await fetch('/api/setup/providers').then(r => r.json())
      if (data.error) { app.innerHTML = \`<div class="muted">Error: \${data.error}</div>\`; return }
      selectedProvider = selectedProvider || data.preferredProvider || firstDetected(data.providers)

      app.innerHTML = \`
        <div class="wizard">
          \${wizardHeader()}
          <div class="card">
            <h2>How should agents call an LLM?</h2>
            <p class="muted" style="margin-bottom:14px">Guildhall reads credentials from Anthropic's / OpenAI's official CLIs, or falls back to a paste-in API key stored in <code class="inline">.guildhall/config.yaml</code> (gitignored).</p>
            <div class="provider-list" id="provider-list"></div>
            <div id="api-key-form" style="margin-top:16px"></div>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px">
            <button class="secondary" id="btn-provider-back">← Back</button>
            <button id="btn-save-provider">Save and continue →</button>
          </div>
        </div>
      \`
      renderProviderList(data.providers)

      document.getElementById('btn-provider-back').addEventListener('click', () => {
        wizardStep = 1
        nav('/setup?step=1')
      })

      document.getElementById('btn-save-provider').addEventListener('click', async () => {
        if (!selectedProvider) { alert('Pick a provider first'); return }
        const body = { preferredProvider: selectedProvider }
        if (selectedProvider === 'anthropic-api') {
          const k = document.getElementById('api-key-input')?.value?.trim()
          if (k) body.anthropicApiKey = k
        }
        if (selectedProvider === 'openai-api') {
          const k = document.getElementById('api-key-input')?.value?.trim()
          if (k) body.openaiApiKey = k
        }
        if (selectedProvider === 'llama-cpp') {
          const u = document.getElementById('llama-url-input')?.value?.trim()
          if (u) body.lmStudioUrl = u
        }
        const btn = document.getElementById('btn-save-provider')
        btn.disabled = true; btn.textContent = 'Saving…'
        const r = await fetch('/api/setup/providers/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await r.json()
        if (j.error) {
          alert('Save failed: ' + j.error)
          btn.disabled = false; btn.textContent = 'Save and continue →'
          return
        }
        wizardIdentity.providerConfigured = true
        wizardStep = 3
        nav('/setup?step=3')
      })
    }

    function renderReadyStep() {
      app.innerHTML = \`
        <div class="wizard">
          \${wizardHeader()}
          <div class="card">
            <h2>You're ready to bootstrap.</h2>
            <p class="muted" style="margin:14px 0">Guildhall has saved your identity and chosen provider. Next, the coordinator agent will interview you about the codebase and draft a set of coordinators plus an initial task list. (You can also skip ahead and add coordinators manually in <code class="inline">guildhall.yaml</code>.)</p>
            <div style="display:flex; gap:10px; margin-top:20px">
              <button id="btn-bootstrap-agent">Start agent-guided bootstrap</button>
              <button id="btn-skip-to-dashboard" class="secondary">Skip to dashboard</button>
            </div>
          </div>
          <div id="bootstrap-live" style="margin-top:14px; display:none"></div>
        </div>
      \`
      document.getElementById('btn-skip-to-dashboard').addEventListener('click', () => {
        wizardDefaults = null
        wizardIdentity = null
        nav('/')
      })
      document.getElementById('btn-bootstrap-agent').addEventListener('click', async () => {
        const btn = document.getElementById('btn-bootstrap-agent')
        btn.disabled = true; btn.textContent = 'Seeding meta-intake task…'
        const r = await fetch('/api/project/meta-intake', { method: 'POST' })
        const j = await r.json()
        if (j.error) {
          alert('Bootstrap failed: ' + j.error)
          btn.disabled = false; btn.textContent = 'Start agent-guided bootstrap'
          return
        }
        await fetch('/api/project/start', { method: 'POST' })
        btn.textContent = 'Bootstrap running…'
        renderBootstrapLive()
      })
    }

    // Keep the user on step 3 after "Start" and show a live activity feed +
    // poll for the coordinator draft. When the draft arrives, swap to an
    // inline approval card so the whole bootstrap → merge flow finishes in
    // the same view without a mystery navigate.
    function renderBootstrapLive() {
      const zone = document.getElementById('bootstrap-live')
      if (!zone) return
      zone.style.display = 'block'
      zone.innerHTML = \`
        <div class="card">
          <h2>Meta-intake agent is working</h2>
          <p class="muted" style="margin:6px 0 10px">The orchestrator is running. Watch events below; when a coordinator draft is ready, you can approve it without leaving this page.</p>
          <div class="bootstrap-log" id="bootstrap-log"><div class="bootstrap-log-line">connecting…</div></div>
          <div id="bootstrap-approval" style="margin-top:12px"></div>
        </div>
      \`
      const log = document.getElementById('bootstrap-log')
      const appendLog = (text, highlight = false) => {
        if (!log) return
        const line = document.createElement('div')
        line.className = 'bootstrap-log-line' + (highlight ? ' highlight' : '')
        line.textContent = text
        log.appendChild(line)
        log.scrollTop = log.scrollHeight
      }
      log.innerHTML = ''
      appendLog('Connecting to event stream…')

      const es = new EventSource('/api/project/events')
      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data)
          const label = payload.type || 'event'
          const extra = payload.taskId ? ' · ' + payload.taskId : ''
          appendLog(label + extra, label === 'spec_update' || label === 'task_status_changed')
        } catch {
          appendLog('event')
        }
      }
      es.onerror = () => { appendLog('stream disconnected', true) }

      let stopped = false
      const poll = async () => {
        if (stopped) return
        try {
          const r = await fetch('/api/project/meta-intake/draft')
          const j = await r.json()
          if (j.status === 'draft-ready' && j.drafts?.length > 0) {
            const slot = document.getElementById('bootstrap-approval')
            if (slot) renderMetaIntakeApproval(slot, j.drafts)
            stopped = true
            es.close()
            return
          }
          if (j.status === 'approved') {
            stopped = true
            es.close()
            setTimeout(() => nav('/'), 400)
            return
          }
        } catch {
          // ignore; next tick retries
        }
        setTimeout(poll, 2500)
      }
      setTimeout(poll, 1500)
    }

    function slugifyClient(s) {
      return String(s || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
    }

    // ---- Settings page (post-setup editable config) -----------------------
    async function renderSettings() {
      projectName.textContent = 'Settings'
      app.innerHTML = '<div class="muted">Loading settings…</div>'
      const [status, providers, defaults] = await Promise.all([
        fetch('/api/setup/status').then(r => r.json()),
        fetch('/api/setup/providers').then(r => r.json()),
        fetch('/api/setup/defaults').then(r => r.json()),
      ])
      if (!status.initialized) {
        app.innerHTML = \`
          <div class="empty">
            <h2>Project not initialized yet</h2>
            <p class="muted" style="margin:14px 0">Complete the setup wizard first.</p>
            <button onclick="nav('/setup')">Open setup wizard →</button>
          </div>
        \`
        // Hack: nav isn't exposed globally; wire the handler directly.
        app.querySelector('button')?.addEventListener('click', () => nav('/setup'))
        return
      }
      selectedProvider = providers.preferredProvider ?? selectedProvider ?? firstDetected(providers.providers)

      app.innerHTML = \`
        <div style="max-width:720px; margin:0 auto">
          <h2 style="margin-bottom:16px">Settings</h2>

          <div class="settings-grid">
            <div class="card">
              <h2>Workspace identity</h2>
              <p class="muted" style="margin-bottom:14px">Stored in <code class="inline">guildhall.yaml</code>. Renaming the ID doesn't rewrite existing memory logs — prefer to set it once.</p>
              <label>Workspace name</label>
              <input id="settings-name" type="text" value="\${escapeHtml(status.name ?? '')}" />
              <label>Workspace ID (slug)</label>
              <input id="settings-id" type="text" value="\${escapeHtml(status.id ?? '')}" />
              <div style="display:flex; align-items:center; justify-content:flex-end; margin-top:4px">
                <span id="identity-save-status" class="save-status"></span>
                <button id="btn-save-identity">Save identity</button>
              </div>
            </div>

            <div class="card">
              <h2>Agent provider</h2>
              <p class="muted" style="margin-bottom:14px">Pick how Guildhall agents should call an LLM. Stored in <code class="inline">.guildhall/config.yaml</code> (gitignored).</p>
              <div class="provider-list" id="provider-list"></div>
              <div id="api-key-form" style="margin-top:16px"></div>
              <div style="display:flex; align-items:center; justify-content:flex-end; margin-top:4px">
                <span id="provider-save-status" class="save-status"></span>
                <button id="btn-save-provider-settings">Save provider</button>
              </div>
            </div>

            <div class="card">
              <h2>Coordinators</h2>
              <p class="muted" style="margin-bottom:14px">Defined in <code class="inline">guildhall.yaml</code>. Edit the file directly to add, rename, or adjust concerns; reload this page to see changes.</p>
              <div id="coord-list-readonly"><span class="muted">Loading…</span></div>
            </div>

            <div class="card">
              <h2>Levers</h2>
              <p class="muted" style="margin-bottom:14px">Every policy is a named lever with an explicit position. Stored with provenance in <code class="inline">memory/agent-settings.yaml</code> — read-only here for now.</p>
              <div id="lever-list-readonly"><span class="muted">Loading…</span></div>
            </div>
          </div>
        </div>
      \`

      // Async side-loads for the read-only cards. Failures render inline so a
      // broken levers file doesn't block the identity/provider cards above.
      fetch('/api/project').then(r => r.json()).then(p => {
        renderCoordinatorsReadonly(p?.config?.coordinators ?? [])
      }).catch(() => renderCoordinatorsReadonly([]))
      fetch('/api/config/levers').then(r => r.json()).then(j => {
        if (j?.error) return renderLeversError(j.error)
        renderLeversReadonly(j.levers ?? [])
      }).catch(err => renderLeversError(String(err)))

      const nameInput = document.getElementById('settings-name')
      const idInput = document.getElementById('settings-id')
      document.getElementById('btn-save-identity').addEventListener('click', async () => {
        const name = nameInput.value.trim()
        const id = idInput.value.trim()
        const statusEl = document.getElementById('identity-save-status')
        if (!name) return flashSaveStatus(statusEl, 'Name is required', true)
        if (!/^[a-z0-9-]+$/.test(id)) return flashSaveStatus(statusEl, 'Invalid ID', true)
        const r = await fetch('/api/setup/identity', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, id }),
        })
        const j = await r.json()
        if (j.error) return flashSaveStatus(statusEl, j.error, true)
        flashSaveStatus(statusEl, 'Saved ✓', false)
        // Update header badge to reflect new name.
        projectName.textContent = 'Settings'
      })

      renderProviderList(providers.providers)
      document.getElementById('btn-save-provider-settings').addEventListener('click', async () => {
        const statusEl = document.getElementById('provider-save-status')
        if (!selectedProvider) return flashSaveStatus(statusEl, 'Pick a provider first', true)
        const body = { preferredProvider: selectedProvider }
        if (selectedProvider === 'anthropic-api') {
          const k = document.getElementById('api-key-input')?.value?.trim()
          if (k) body.anthropicApiKey = k
        }
        if (selectedProvider === 'openai-api') {
          const k = document.getElementById('api-key-input')?.value?.trim()
          if (k) body.openaiApiKey = k
        }
        if (selectedProvider === 'llama-cpp') {
          const u = document.getElementById('llama-url-input')?.value?.trim()
          if (u) body.lmStudioUrl = u
        }
        const r = await fetch('/api/setup/providers/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await r.json()
        if (j.error) return flashSaveStatus(statusEl, j.error, true)
        flashSaveStatus(statusEl, 'Saved ✓', false)
      })
    }

    function flashSaveStatus(el, message, isError) {
      if (!el) return
      el.textContent = message
      el.classList.toggle('error', Boolean(isError))
      el.classList.add('visible')
      setTimeout(() => el.classList.remove('visible'), 2500)
    }

    function renderCoordinatorsReadonly(coords) {
      const host = document.getElementById('coord-list-readonly')
      if (!host) return
      if (!coords || coords.length === 0) {
        host.innerHTML = '<div class="muted">No coordinators defined yet. Run meta-intake from the project page to bootstrap them.</div>'
        return
      }
      host.innerHTML = '<div class="coord-list">' + coords.map(c => \`
        <div class="coord-preview">
          <div class="coord-title">\${escapeHtml(c.name || c.id)} <span class="muted" style="font-weight:normal">· \${escapeHtml(c.domain || '')}</span></div>
          \${c.path ? \`<div class="muted" style="font-size:12px">path: <code class="inline">\${escapeHtml(c.path)}</code></div>\` : ''}
          \${c.mandate ? \`<div style="margin-top:6px">\${escapeHtml(c.mandate)}</div>\` : ''}
          \${Array.isArray(c.concerns) && c.concerns.length ? \`<div class="muted" style="margin-top:6px; font-size:12px">\${c.concerns.length} concern\${c.concerns.length === 1 ? '' : 's'}</div>\` : ''}
        </div>
      \`).join('') + '</div>'
    }

    function renderLeversReadonly(levers) {
      const host = document.getElementById('lever-list-readonly')
      if (!host) return
      if (!levers || levers.length === 0) {
        host.innerHTML = '<div class="muted">No levers configured.</div>'
        return
      }
      const byScope = new Map()
      for (const l of levers) {
        const key = l.scope
        if (!byScope.has(key)) byScope.set(key, [])
        byScope.get(key).push(l)
      }
      const sections = []
      for (const [scope, entries] of byScope) {
        sections.push(\`
          <div style="margin-top:8px; margin-bottom:6px; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted)">\${escapeHtml(scope)}</div>
          <table class="lever-table">
            \${entries.map(l => \`
              <tr>
                <td><code class="inline">\${escapeHtml(l.name)}</code></td>
                <td><strong>\${escapeHtml(l.position)}</strong></td>
                <td class="muted" style="font-size:12px">\${escapeHtml(l.setBy)}</td>
              </tr>
              <tr class="lever-rationale">
                <td colspan="3" class="muted" style="font-size:12px; padding-bottom:10px">\${escapeHtml(l.rationale)}</td>
              </tr>
            \`).join('')}
          </table>
        \`)
      }
      host.innerHTML = sections.join('')
    }

    function renderLeversError(msg) {
      const host = document.getElementById('lever-list-readonly')
      if (!host) return
      host.innerHTML = '<div class="muted" style="color:var(--bad)">Could not load levers: ' + escapeHtml(String(msg)) + '</div>'
    }

    function firstDetected(providers) {
      const order = ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp']
      for (const k of order) if (providers[k]?.detected) return k
      return null
    }

    function renderProviderList(providers) {
      const list = document.getElementById('provider-list')
      const order = ['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api']
      list.innerHTML = order.map(key => {
        const p = providers[key]
        if (!p) return ''
        const isSel = key === selectedProvider
        return \`
          <div class="provider-row \${isSel ? 'selected' : ''}" data-key="\${key}">
            <div class="radio"></div>
            <div style="flex:1">
              <div class="label">\${escapeHtml(p.label)}</div>
              <div class="detail">\${escapeHtml(p.detail)}</div>
            </div>
            <span class="status-chip \${p.detected ? 'ok' : 'missing'}">\${p.detected ? 'ready' : 'not found'}</span>
          </div>
        \`
      }).join('')
      list.querySelectorAll('.provider-row').forEach(row => {
        row.addEventListener('click', () => {
          selectedProvider = row.dataset.key
          renderProviderList(providers)
          renderApiKeyForm(providers)
        })
      })
      renderApiKeyForm(providers)
    }

    function renderApiKeyForm(providers) {
      const form = document.getElementById('api-key-form')
      if (!form) return
      if (selectedProvider === 'anthropic-api' || selectedProvider === 'openai-api') {
        form.innerHTML = \`
          <label>API key (stored in .guildhall/config.yaml, gitignored)</label>
          <input id="api-key-input" type="password" placeholder="sk-..." />
        \`
      } else if (selectedProvider === 'llama-cpp') {
        form.innerHTML = \`
          <label>llama.cpp / LM Studio base URL</label>
          <input id="llama-url-input" type="text" value="\${escapeHtml(providers['llama-cpp']?.url ?? 'http://localhost:1234/v1')}" />
        \`
      } else {
        form.innerHTML = ''
      }
    }

    // ---- Event feed --------------------------------------------------------
    function renderEvent(ev) {
      const feed = document.getElementById('feed')
      if (!feed) return
      const inner = ev.event ?? ev
      const type = inner.type || ''
      const cls =
        type === 'task_transition' ? 'transition' :
        type === 'escalation_raised' ? 'escalation' :
        type === 'error' ? 'error' :
        type === 'agent_issue' ? 'issue' :
        type.startsWith('supervisor_') ? 'supervisor' : ''
      const ts = ev.at || new Date().toISOString()
      const summary = summarizeEvent(inner)
      if (!summary) return
      const row = document.createElement('div')
      row.className = 'ev ' + cls
      row.innerHTML = '<span class="ts">' + ts.slice(11, 19) + '</span>' + escapeHtml(summary)
      feed.appendChild(row)
      feed.scrollTop = feed.scrollHeight
    }

    function summarizeEvent(inner) {
      switch (inner.type) {
        case 'task_transition':
          return \`\${inner.task_id} \${inner.from_status} → \${inner.to_status} (\${inner.agent_name ?? ''}\${inner.reason ? ': ' + inner.reason : ''})\`
        case 'escalation_raised':
          return \`ESCALATION \${inner.task_id}\${inner.agent_name ? ' by ' + inner.agent_name : ''} — \${inner.reason ?? ''}\`
        case 'error':
          return 'ERROR: ' + (inner.message ?? '')
        case 'agent_issue':
          return \`issue [\${inner.severity}/\${inner.code}] \${inner.task_id} — \${inner.reason ?? ''}\`
        case 'supervisor_started':
        case 'supervisor_stopped':
        case 'supervisor_error':
          return inner.type.replace('supervisor_', '') + (inner.message ? ': ' + inner.message : '')
        case 'heartbeat':
        case 'connected':
          return ''
        default:
          return inner.type + ' ' + JSON.stringify(inner).slice(0, 200)
      }
    }

    let currentES = null
    function connectStream() {
      if (currentES) currentES.close()
      const es = new EventSource('/api/project/events')
      currentES = es
      es.onopen = () => { sseStatus.textContent = '● live' }
      es.onerror = () => { sseStatus.textContent = '● reconnecting…' }
      es.onmessage = e => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'connected' || data.type === 'heartbeat') return
          renderEvent(data)
          if (data.event?.type?.startsWith('supervisor_')) {
            fetch('/api/project').then(r => r.json()).then(d => {
              const pill = document.querySelector('.detail-header .pill')
              if (pill && d.run) {
                pill.textContent = d.run.status
                pill.className = 'pill ' + (d.run.status === 'running' ? 'running' : d.run.status === 'error' ? 'error' : 'stopped')
              }
            })
          }
        } catch {}
      }
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
    }

    function renderMetaIntakeApproval(container, drafts) {
      const body = drafts.map(d => \`
        <div class="coord-preview">
          <div class="coord-title">\${escapeHtml(d.name)} <span class="muted" style="font-weight:400">— \${escapeHtml(d.domain)}\${d.path ? ' · ' + escapeHtml(d.path) : ''}</span></div>
          <div class="muted" style="font-size:12px; margin-top:4px; white-space:pre-wrap">\${escapeHtml((d.mandate || '').trim())}</div>
          \${(d.concerns || []).length > 0 ? '<div style="margin-top:6px; font-size:12px"><strong>Concerns:</strong> ' + d.concerns.map(c => escapeHtml(c.id)).join(', ') + '</div>' : ''}
        </div>
      \`).join('')
      container.innerHTML = \`
        <div class="meta-intake-banner" style="flex-direction:column; align-items:stretch">
          <div class="text" style="margin-bottom:10px">
            <strong>Draft coordinators are ready for review.</strong>
            The meta-intake agent produced \${drafts.length} coordinator\${drafts.length === 1 ? '' : 's'}
            based on your codebase. Approve to merge into <code class="inline">guildhall.yaml</code>.
          </div>
          <div class="coord-list">\${body}</div>
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
            <span id="approve-status" class="save-status"></span>
            <button id="btn-approve-meta" style="min-width:180px">Approve and merge</button>
          </div>
        </div>
      \`
      const btn = document.getElementById('btn-approve-meta')
      const statusEl = document.getElementById('approve-status')
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Merging…'
        const r = await fetch('/api/project/meta-intake/approve', { method: 'POST' })
        const j = await r.json()
        if (j.error) {
          btn.disabled = false; btn.textContent = 'Approve and merge'
          statusEl.textContent = 'Failed: ' + j.error
          statusEl.className = 'save-status error'
          return
        }
        statusEl.textContent = 'Merged ' + (j.coordinatorsAdded ?? 0) + ' coordinator(s).'
        statusEl.className = 'save-status ok'
        setTimeout(renderProject, 600)
      })
    }

    function showIntakeModal(coordinators) {
      const backdrop = document.createElement('div')
      backdrop.className = 'modal-backdrop'
      const domainOptions = coordinators.map(c => \`<option value="\${escapeHtml(c.domain)}">\${escapeHtml(c.name)} (\${escapeHtml(c.domain)})</option>\`).join('')
      backdrop.innerHTML = \`
        <div class="modal">
          <h2>New Task</h2>
          <label for="intake-ask">What should the agents work on?</label>
          <textarea id="intake-ask" placeholder="Describe the task in plain language. The spec agent will ask follow-ups before a coordinator assigns work."></textarea>
          <label for="intake-domain">Domain (routes to a coordinator)</label>
          <select id="intake-domain">\${domainOptions}</select>
          <label for="intake-title">Title (optional — auto-generated from the ask)</label>
          <input id="intake-title" placeholder="Short descriptive title" />
          <div class="modal-actions">
            <button class="secondary" id="intake-cancel">Cancel</button>
            <button id="intake-submit">Create task</button>
          </div>
        </div>
      \`
      document.body.appendChild(backdrop)
      const close = () => document.body.removeChild(backdrop)
      backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })
      document.getElementById('intake-cancel').addEventListener('click', close)
      document.getElementById('intake-ask').focus()
      document.getElementById('intake-submit').addEventListener('click', async () => {
        const ask = document.getElementById('intake-ask').value.trim()
        const domain = document.getElementById('intake-domain').value
        const title = document.getElementById('intake-title').value.trim()
        if (!ask) { alert('Please describe the task.'); return }
        const btn = document.getElementById('intake-submit')
        btn.disabled = true; btn.textContent = 'Creating…'
        const res = await fetch('/api/project/intake', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ask, domain, ...(title ? { title } : {}) }),
        })
        const j = await res.json()
        if (j.error) {
          alert('Intake failed: ' + j.error)
          btn.disabled = false; btn.textContent = 'Create task'
          return
        }
        close()
        const detail = await fetch('/api/project').then(r => r.json())
        if (!detail.run || detail.run.status !== 'running') {
          await fetch('/api/project/start', { method: 'POST' })
        }
        setTimeout(renderProject, 400)
      })
    }

    route()
  `
}
