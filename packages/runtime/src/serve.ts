import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import {
  listWorkspaces,
  readRegistry,
  registerWorkspace,
  ensureGuildhallHome,
  readGlobalConfig,
  readWorkspaceConfig,
} from '@guildhall/config'
import { OrchestratorSupervisor } from './serve-supervisor.js'
import { createExploringTask } from './intake.js'
import { createMetaIntakeTask, workspaceNeedsMetaIntake } from './meta-intake.js'

// ---------------------------------------------------------------------------
// guildhall serve — web dashboard
//
// Read/write control plane for all registered workspaces. The frontend is a
// Preact+htm SPA (no build step) served inline. All orchestrator lifecycle
// runs in-process via `OrchestratorSupervisor`; each orchestrator pushes
// `BackendEvent`s into the supervisor's event bus, which the SSE handler
// fans out to connected dashboards.
//
// Routes:
//   GET    /                              → SPA (grid + detail, client-routed)
//   GET    /api/workspaces                → List registered workspaces + run state
//   POST   /api/workspaces                → Register a workspace (body: { path })
//   GET    /api/workspaces/:id            → Single workspace detail (config + tasks + run state)
//   DELETE /api/workspaces/:id            → Unregister (stops the run if active)
//   POST   /api/workspaces/:id/start      → Boot an orchestrator for this workspace
//   POST   /api/workspaces/:id/stop       → Graceful stop
//   GET    /api/workspaces/:id/progress   → Tail of PROGRESS.md (last ~80 lines)
//   GET    /api/workspaces/:id/events     → SSE stream filtered to this workspace
//   GET    /api/config                    → Global ~/.guildhall/config.yaml
//   GET    /api/events                    → SSE stream for ALL workspaces
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port?: number
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  ensureGuildhallHome()

  const globalConfig = readGlobalConfig()
  const port = opts.port ?? globalConfig.servePort

  const supervisor = new OrchestratorSupervisor()
  const app = new Hono()

  // -------------------------------------------------------------------------
  // API: workspaces (list / detail / register / unregister)
  // -------------------------------------------------------------------------
  app.get('/api/workspaces', c => {
    try {
      const runs = supervisor.list()
      const workspaces = listWorkspaces().map(ws => {
        let config = null
        try { config = readWorkspaceConfig(ws.path) } catch { /* workspace may have moved */ }
        const run = runs.find(r => r.workspaceId === ws.id)
        return {
          ...ws,
          valid: config !== null,
          coordinators: config?.coordinators?.length ?? 0,
          running: run?.status === 'running' || run?.status === 'stopping',
          runStatus: run?.status ?? 'stopped',
        }
      })
      return c.json({ workspaces })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/workspaces', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as { path?: string }
      const abs = body.path ? resolve(body.path) : ''
      if (!abs) return c.json({ error: 'Missing "path" in request body' }, 400)
      const config = readWorkspaceConfig(abs) // throws if invalid
      const id = config.id ?? ((config.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace')
      const entry = registerWorkspace({
        id,
        path: abs,
        name: config.name,
        tags: config.tags ?? [],
      })
      return c.json({ entry })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.get('/api/workspaces/:id', c => {
    try {
      const { id } = c.req.param()
      const registry = readRegistry()
      const entry = registry.workspaces.find(w => w.id === id)
      if (!entry) return c.json({ error: `Workspace "${id}" not found` }, 404)

      let config = null
      let tasks: unknown[] = []
      try {
        config = readWorkspaceConfig(entry.path)
        const tasksPath = join(entry.path, 'memory', 'TASKS.json')
        if (existsSync(tasksPath)) {
          const raw = JSON.parse(readFileSync(tasksPath, 'utf8'))
          // TASKS.json may be either a bare array (legacy) or `{ tasks: [...] }`
          tasks = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : []
        }
      } catch { /* best-effort */ }

      const run = supervisor.get(id)
      const recent = supervisor.recent(id)

      return c.json({
        entry,
        config,
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
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/workspaces/:id/start', c => {
    try {
      const { id } = c.req.param()
      const entry = readRegistry().workspaces.find(w => w.id === id)
      if (!entry) return c.json({ error: `Workspace "${id}" not found` }, 404)
      const run = supervisor.start({ workspaceId: id, workspacePath: entry.path })
      return c.json({ status: run.status, startedAt: run.startedAt })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/workspaces/:id/intake', async c => {
    try {
      const { id } = c.req.param()
      const entry = readRegistry().workspaces.find(w => w.id === id)
      if (!entry) return c.json({ error: `Workspace "${id}" not found` }, 404)
      const body = await c.req.json().catch(() => ({})) as {
        ask?: string
        domain?: string
        title?: string
      }
      if (!body.ask || body.ask.trim().length === 0) {
        return c.json({ error: 'Missing "ask" in request body' }, 400)
      }
      const wsConfig = readWorkspaceConfig(entry.path)
      const defaultDomain = wsConfig.coordinators[0]?.domain
      const domain = body.domain ?? defaultDomain
      if (!domain) {
        return c.json({ error: 'Workspace has no coordinators — run meta-intake first' }, 400)
      }
      const result = await createExploringTask({
        memoryDir: join(entry.path, 'memory'),
        ask: body.ask,
        domain,
        projectPath: entry.path,
        ...(body.title ? { title: body.title } : {}),
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/workspaces/:id/meta-intake', async c => {
    try {
      const { id } = c.req.param()
      const entry = readRegistry().workspaces.find(w => w.id === id)
      if (!entry) return c.json({ error: `Workspace "${id}" not found` }, 404)
      const result = await createMetaIntakeTask({
        memoryDir: join(entry.path, 'memory'),
        projectPath: entry.path,
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/workspaces/:id/needs-meta-intake', c => {
    try {
      const { id } = c.req.param()
      const entry = readRegistry().workspaces.find(w => w.id === id)
      if (!entry) return c.json({ error: `Workspace "${id}" not found` }, 404)
      return c.json({ needsMetaIntake: workspaceNeedsMetaIntake(entry.path) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/workspaces/:id/stop', async c => {
    try {
      const { id } = c.req.param()
      const stopped = await supervisor.stop(id)
      if (!stopped) return c.json({ error: 'stop timed out' }, 504)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/workspaces/:id/progress', c => {
    try {
      const { id } = c.req.param()
      const entry = readRegistry().workspaces.find(w => w.id === id)
      if (!entry) return c.json({ error: `Workspace "${id}" not found` }, 404)
      const progressPath = join(entry.path, 'memory', 'PROGRESS.md')
      if (!existsSync(progressPath)) return c.json({ progress: '' })
      const raw = readFileSync(progressPath, 'utf8')
      const lines = raw.split('\n')
      const tail = lines.slice(-120).join('\n')
      return c.json({ progress: tail })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/config', c => {
    try {
      return c.json(readGlobalConfig())
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // SSE: workspace-scoped stream
  // -------------------------------------------------------------------------
  app.get('/api/workspaces/:id/events', c => {
    const { id } = c.req.param()
    return streamSSE(c, async stream => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'connected', workspaceId: id }) })

      // Replay recent events on (re)connect so the dashboard isn't blank.
      for (const ev of supervisor.recent(id)) {
        await stream.writeSSE({ data: JSON.stringify(ev) })
      }

      const unsubscribe = supervisor.subscribe(ev => {
        if (ev.workspaceId !== id) return
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
  // SSE: all workspaces
  // -------------------------------------------------------------------------
  app.get('/api/events', c => {
    return streamSSE(c, async stream => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) })

      const unsubscribe = supervisor.subscribe(ev => {
        void stream.writeSSE({ data: JSON.stringify(ev) })
      })

      let running = true
      stream.onAbort(() => { running = false; unsubscribe() })

      while (running) {
        await stream.sleep(15_000)
        if (!running) break
        const registry = readRegistry()
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'heartbeat',
            workspaceCount: registry.workspaces.length,
            timestamp: new Date().toISOString(),
          }),
        })
      }
    })
  })

  // -------------------------------------------------------------------------
  // SPA: Dashboard (catch-all, client-routed)
  // -------------------------------------------------------------------------
  app.get('*', c => c.html(dashboardHtml()))

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------
  console.log(`[guildhall serve] Starting dashboard on http://localhost:${port}`)
  console.log(`[guildhall serve] Registered workspaces: ${listWorkspaces().length}`)
  console.log(`[guildhall serve] Press Ctrl+C to stop.`)
  console.log()

  serve({ fetch: app.fetch, port }, info => {
    console.log(`[guildhall serve] ✓ Running at http://localhost:${info.port}`)
  })
}

// ---------------------------------------------------------------------------
// Inline dashboard SPA
//
// Preact + htm (no build step). All logic runs client-side. The SPA reads
// `location.pathname` and renders either the workspace grid (`/`) or a
// workspace detail page (`/workspace/:id`).
// ---------------------------------------------------------------------------

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Guildhall Dashboard</title>
  <style>${dashboardCss()}</style>
</head>
<body>
  <header>
    <h1 onclick="location.href='/'" style="cursor:pointer">⚔ Guildhall</h1>
    <span class="badge" id="ws-count"></span>
    <span id="breadcrumb" class="breadcrumb"></span>
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
    .breadcrumb { color: var(--muted); font-size: 13px; }
    .muted { color: var(--muted); font-size: 13px; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; letter-spacing: -0.2px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 24px 0 10px; }
    .workspace-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .ws-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      cursor: pointer;
      transition: border-color 0.12s, transform 0.12s;
    }
    .ws-card:hover { border-color: var(--accent); transform: translateY(-1px); }
    .ws-card h3 { font-size: 14px; font-weight: 600; margin-bottom: 4px; display:flex; align-items:center; }
    .ws-id { font-size: 11px; color: var(--muted); font-family: 'SF Mono', monospace; }
    .ws-path { font-size: 11px; color: var(--muted); margin-top: 8px; word-break: break-all; font-family: 'SF Mono', monospace; }
    .ws-meta { display: flex; gap: 10px; margin-top: 10px; font-size: 11px; color: var(--muted); flex-wrap: wrap; align-items:center; }
    .tag { background: rgba(124,109,240,0.12); color: var(--accent); border-radius: 3px; padding: 1px 6px; font-size: 11px; }
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
  `
}

function dashboardJs(): string {
  return `
    const app = document.getElementById('app')
    const wsCount = document.getElementById('ws-count')
    const breadcrumb = document.getElementById('breadcrumb')
    const sseStatus = document.getElementById('sse-status')

    // ---- Routing -----------------------------------------------------------
    function route() {
      const path = location.pathname
      const m = path.match(/^\\/workspace\\/([a-z0-9-]+)\\/?$/)
      if (m) return renderDetail(m[1])
      return renderGrid()
    }

    window.addEventListener('popstate', route)

    function nav(href) {
      history.pushState({}, '', href)
      route()
    }

    // ---- Grid view ---------------------------------------------------------
    async function renderGrid() {
      breadcrumb.textContent = ''
      const res = await fetch('/api/workspaces')
      const { workspaces, error } = await res.json()
      if (error) { app.innerHTML = \`<div class="muted">Error: \${error}</div>\`; return }

      wsCount.textContent = workspaces.length + ' workspace' + (workspaces.length !== 1 ? 's' : '')

      if (workspaces.length === 0) {
        app.innerHTML = \`
          <div class="empty">
            <h2>No workspaces registered</h2>
            <p>Run the CLI to create your first:</p>
            <code>guildhall init ~/path/to/project</code>
            <p class="muted" style="margin-top:16px">or POST the path to /api/workspaces</p>
          </div>
        \`
        return
      }

      app.innerHTML = '<div class="section-title">Workspaces</div><div class="workspace-grid" id="grid"></div>'
      const grid = document.getElementById('grid')
      grid.innerHTML = workspaces.map(ws => \`
        <div class="ws-card" data-id="\${ws.id}">
          <h3>
            <span class="status-dot \${ws.running ? 'running' : (ws.runStatus === 'error' ? 'error' : 'idle')}"></span>
            <span style="flex:1">\${escapeHtml(ws.name)}</span>
            <span class="pill \${ws.running ? 'running' : (ws.runStatus === 'error' ? 'error' : 'stopped')}">\${ws.runStatus}</span>
          </h3>
          <div class="ws-id">\${ws.id}</div>
          <div class="ws-path">\${ws.path}</div>
          <div class="ws-meta">
            <span>\${ws.coordinators} coordinator\${ws.coordinators !== 1 ? 's' : ''}</span>
            \${(ws.tags || []).map(t => \`<span class="tag">\${escapeHtml(t)}</span>\`).join('')}
            \${ws.valid ? '' : '<span style="color:var(--danger)">⚠ guildhall.yaml not found</span>'}
          </div>
        </div>
      \`).join('')
      grid.querySelectorAll('.ws-card').forEach(card => {
        card.addEventListener('click', () => nav('/workspace/' + card.dataset.id))
      })
    }

    // ---- Detail view -------------------------------------------------------
    async function renderDetail(id) {
      breadcrumb.textContent = '› ' + id
      app.innerHTML = '<div class="muted">Loading workspace…</div>'

      const detail = await fetch('/api/workspaces/' + id).then(r => r.json())
      if (detail.error) { app.innerHTML = \`<div class="muted">Error: \${detail.error}</div>\`; return }

      wsCount.textContent = detail.entry.name

      const runStatus = detail.run?.status ?? 'stopped'
      const coordinators = detail.config?.coordinators ?? []
      const needsMeta = coordinators.length === 0
      app.innerHTML = \`
        <div class="detail-header">
          <h2>\${escapeHtml(detail.entry.name)}</h2>
          <span class="pill \${runStatus === 'running' ? 'running' : runStatus === 'error' ? 'error' : 'stopped'}">\${runStatus}</span>
          <span style="flex:1"></span>
          <button id="btn-new-task" class="secondary" \${needsMeta ? 'disabled title="Bootstrap the workspace first"' : ''}>+ New Task</button>
          <button id="btn-start" \${runStatus === 'running' || runStatus === 'stopping' ? 'disabled' : ''}>▶ Start</button>
          <button id="btn-stop" class="danger" \${runStatus !== 'running' ? 'disabled' : ''}>■ Stop</button>
        </div>

        \${needsMeta ? \`
          <div class="meta-intake-banner">
            <div class="text">
              <strong>Workspace not yet bootstrapped.</strong> No coordinators are configured — click
              Bootstrap and the meta-intake agent will interview you about the project and draft a
              guildhall.yaml with coordinators for each domain it finds.
            </div>
            <button id="btn-bootstrap">Bootstrap workspace</button>
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
                ? '<div class="muted">No tasks yet. Add to memory/TASKS.json or let the meta-intake agent bootstrap them.</div>'
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
              \${(detail.config?.coordinators ?? []).map(c => \`
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
        await fetch('/api/workspaces/' + id + '/start', { method: 'POST' })
        setTimeout(() => renderDetail(id), 300)
      })
      document.getElementById('btn-stop').addEventListener('click', async () => {
        await fetch('/api/workspaces/' + id + '/stop', { method: 'POST' })
        setTimeout(() => renderDetail(id), 300)
      })
      const btnNew = document.getElementById('btn-new-task')
      if (btnNew && !btnNew.disabled) {
        btnNew.addEventListener('click', () => showIntakeModal(id, coordinators))
      }
      const btnBootstrap = document.getElementById('btn-bootstrap')
      if (btnBootstrap) {
        btnBootstrap.addEventListener('click', async () => {
          btnBootstrap.disabled = true
          btnBootstrap.textContent = 'Creating…'
          const r = await fetch('/api/workspaces/' + id + '/meta-intake', { method: 'POST' })
          const j = await r.json()
          if (j.error) {
            alert('Bootstrap failed: ' + j.error)
            btnBootstrap.disabled = false
            btnBootstrap.textContent = 'Bootstrap workspace'
            return
          }
          // Auto-start the orchestrator so the meta-intake agent can begin.
          await fetch('/api/workspaces/' + id + '/start', { method: 'POST' })
          setTimeout(() => renderDetail(id), 400)
        })
      }

      // Progress tail
      fetch('/api/workspaces/' + id + '/progress').then(r => r.json()).then(j => {
        document.getElementById('progress').textContent = j.progress || '(empty)'
      })

      // Seed + subscribe to feed
      const feed = document.getElementById('feed')
      feed.innerHTML = ''
      ;(detail.recentEvents || []).forEach(renderEvent)

      connectWorkspaceStream(id)
    }

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
        type.startsWith('supervisor_') ? 'supervisor' :
        ''
      const ts = ev.at || new Date().toISOString()
      const summary = summarizeEvent(inner)
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
          return (inner.type.replace('supervisor_', '')) + (inner.message ? ': ' + inner.message : '')
        case 'heartbeat':
          return ''
        default:
          return inner.type + ' ' + JSON.stringify(inner).slice(0, 200)
      }
    }

    let currentES = null
    function connectWorkspaceStream(id) {
      if (currentES) { currentES.close() }
      const es = new EventSource('/api/workspaces/' + id + '/events')
      currentES = es
      es.onopen = () => { sseStatus.textContent = '● live' }
      es.onerror = () => { sseStatus.textContent = '● reconnecting…' }
      es.onmessage = e => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'connected' || data.type === 'heartbeat') return
          renderEvent(data)
          // If the status changed, refetch metadata chip (lightweight).
          if (data.event?.type?.startsWith('supervisor_')) {
            fetch('/api/workspaces/' + id).then(r => r.json()).then(d => {
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

    // Global grid stream (reloads list on any supervisor_started/stopped)
    function connectGlobalStream() {
      const es = new EventSource('/api/events')
      es.onmessage = e => {
        try {
          const data = JSON.parse(e.data)
          if (data.event?.type?.startsWith('supervisor_')) {
            if (location.pathname === '/') renderGrid()
          }
        } catch {}
      }
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
    }

    function showIntakeModal(workspaceId, coordinators) {
      const backdrop = document.createElement('div')
      backdrop.className = 'modal-backdrop'
      const domainOptions = coordinators.map(c => \`<option value="\${escapeHtml(c.domain)}">\${escapeHtml(c.name)} (\${escapeHtml(c.domain)})</option>\`).join('')
      backdrop.innerHTML = \`
        <div class="modal">
          <h2>New Task</h2>
          <label for="intake-ask">What should the agents work on?</label>
          <textarea id="intake-ask" placeholder="Describe the task in plain language. The spec agent will ask follow-ups before a coordinator assigns work.

Example: \\"Add keyboard navigation to the Looma Combobox component — arrow keys move focus, Enter selects, Escape closes the popup.\\""></textarea>
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
        const res = await fetch('/api/workspaces/' + workspaceId + '/intake', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ask, domain, ...(title ? { title } : {}) }),
        })
        const j = await res.json()
        if (j.error) { alert('Intake failed: ' + j.error); btn.disabled = false; btn.textContent = 'Create task'; return }
        close()
        // If the orchestrator isn't running yet, auto-start it so the spec
        // agent picks up the new exploring task on the next tick.
        const detail = await fetch('/api/workspaces/' + workspaceId).then(r => r.json())
        if (!detail.run || detail.run.status !== 'running') {
          await fetch('/api/workspaces/' + workspaceId + '/start', { method: 'POST' })
        }
        setTimeout(() => renderDetail(workspaceId), 400)
      })
    }

    route()
    connectGlobalStream()
  `
}
