import { readFileSync, existsSync, promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import {
  readWorkspaceConfig,
  readProjectConfig,
  updateProjectConfig,
  FORGE_YAML_FILENAME,
  slugify,
} from '@guildhall/config'
import { OrchestratorSupervisor } from './serve-supervisor.js'
import { createExploringTask } from './intake.js'
import { createMetaIntakeTask, workspaceNeedsMetaIntake } from './meta-intake.js'

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

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const projectPath = resolve(opts.projectPath ?? process.cwd())
  const project = resolveProject(projectPath)
  const cfg = readProjectConfig(projectPath)
  const port = opts.port ?? cfg.servePort

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

  // -------------------------------------------------------------------------
  // API: setup wizard
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------
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
  `
}

function dashboardJs(): string {
  return `
    const app = document.getElementById('app')
    const projectName = document.getElementById('project-name')
    const sseStatus = document.getElementById('sse-status')

    function route() {
      const path = location.pathname
      if (path === '/setup') return renderSetup()
      return renderProject()
    }
    window.addEventListener('popstate', route)
    function nav(href) { history.pushState({}, '', href); route() }

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
          <div class="meta-intake-banner">
            <div class="text">
              <strong>Project not yet bootstrapped.</strong> No coordinators are configured — click
              Bootstrap and the meta-intake agent will interview you about the codebase and draft a
              guildhall.yaml with coordinators for each domain it finds.
            </div>
            <button id="btn-bootstrap">Bootstrap project</button>
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
    let selectedProvider = null
    async function renderSetup() {
      projectName.textContent = 'Setup'
      app.innerHTML = '<div class="muted">Detecting providers…</div>'
      const data = await fetch('/api/setup/providers').then(r => r.json())
      if (data.error) { app.innerHTML = \`<div class="muted">Error: \${data.error}</div>\`; return }
      selectedProvider = selectedProvider || data.preferredProvider || firstDetected(data.providers)

      app.innerHTML = \`
        <div class="wizard">
          <div class="step-header">
            <span class="step-dot active">1</span>
            <span>Pick an agent provider</span>
          </div>
          <div class="card">
            <h2>How should agents call an LLM?</h2>
            <p class="muted" style="margin-bottom:14px">Guildhall reads credentials installed by Anthropic's / OpenAI's official CLIs. If none are installed, paste an API key below and Guildhall will store it in <code class="inline">.guildhall/config.yaml</code> (gitignored).</p>
            <div class="provider-list" id="provider-list"></div>
            <div id="api-key-form" style="margin-top:16px"></div>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px">
            <button class="secondary" onclick="location.href='/'">Cancel</button>
            <button id="btn-save-provider">Save and continue →</button>
          </div>
        </div>
      \`
      renderProviderList(data.providers)

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
        // Step 2 (doc-scan / agent interview) is next — for now, hand off to main.
        nav('/')
      })
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
