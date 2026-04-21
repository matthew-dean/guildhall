import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import {
  listWorkspaces,
  readRegistry,
  ensureForgeHome,
  readGlobalConfig,
  readWorkspaceConfig,
} from '@guildhall/config'

// ---------------------------------------------------------------------------
// guildhall serve — web dashboard
//
// Serves a read/write control plane for all registered workspaces.
// The frontend is a Preact+htm SPA (no build step) served from inline HTML.
//
// Routes:
//   GET  /                    → Dashboard SPA
//   GET  /api/workspaces      → List all registered workspaces + status
//   GET  /api/workspaces/:id  → Single workspace detail (config + recent tasks)
//   GET  /api/config          → Global ~/.guildhall/config.yaml
//   POST /api/workspaces      → Register a new workspace (path body param)
//   DELETE /api/workspaces/:id → Unregister a workspace
//   GET  /api/events          → SSE stream for real-time orchestrator updates
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port?: number
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  ensureForgeHome()

  const globalConfig = readGlobalConfig()
  const port = opts.port ?? globalConfig.servePort

  const app = new Hono()

  // -------------------------------------------------------------------------
  // API: workspaces
  // -------------------------------------------------------------------------
  app.get('/api/workspaces', c => {
    try {
      const workspaces = listWorkspaces().map(ws => {
        let config = null
        try { config = readWorkspaceConfig(ws.path) } catch { /* workspace may have moved */ }
        return { ...ws, valid: config !== null, coordinators: config?.coordinators?.length ?? 0 }
      })
      return c.json({ workspaces })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
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
          tasks = JSON.parse(readFileSync(tasksPath, 'utf8'))
        }
      } catch { /* best-effort */ }

      return c.json({ entry, config, tasks })
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
  // SSE: real-time events (heartbeat for now, orchestrator updates later)
  // -------------------------------------------------------------------------
  app.get('/api/events', c => {
    return streamSSE(c, async stream => {
      // Send initial connected event
      await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) })

      // Heartbeat every 5 seconds until client disconnects
      let running = true
      stream.onAbort(() => { running = false })

      while (running) {
        await stream.sleep(5000)
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
  // SPA: Dashboard
  // -------------------------------------------------------------------------
  app.get('*', c => {
    return c.html(dashboardHtml(port))
  })

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
// Preact + htm (no build step). All logic runs client-side.
// The API routes above serve JSON that this SPA consumes.
// ---------------------------------------------------------------------------

function dashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Forge Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f0f11;
      --surface: #1a1a1f;
      --border: #2a2a33;
      --accent: #7c6df0;
      --accent2: #4ecca3;
      --text: #e8e8f0;
      --muted: #888899;
      --danger: #e05252;
      --success: #4ecca3;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; min-height: 100vh; }
    header {
      border-bottom: 1px solid var(--border);
      padding: 16px 32px;
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--surface);
    }
    header h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.3px; }
    header .badge { font-size: 11px; color: var(--accent2); background: rgba(78,204,163,0.12); padding: 2px 8px; border-radius: 12px; }
    main { padding: 32px; max-width: 1100px; margin: 0 auto; }
    .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 16px; }
    .workspace-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .ws-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .ws-card:hover { border-color: var(--accent); }
    .ws-card h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
    .ws-card .ws-id { font-size: 11px; color: var(--muted); font-family: monospace; }
    .ws-card .ws-path { font-size: 11px; color: var(--muted); margin-top: 8px; word-break: break-all; }
    .ws-card .ws-meta { display: flex; gap: 12px; margin-top: 12px; font-size: 12px; color: var(--muted); }
    .tag { background: rgba(124,109,240,0.15); color: var(--accent); border-radius: 4px; padding: 1px 6px; font-size: 11px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
    .status-dot.active { background: var(--accent2); }
    .status-dot.idle { background: var(--muted); }
    .empty-state { text-align: center; padding: 80px 20px; color: var(--muted); }
    .empty-state h2 { font-size: 18px; margin-bottom: 8px; color: var(--text); }
    .empty-state code { background: var(--surface); border: 1px solid var(--border); padding: 12px 20px; border-radius: 6px; display: inline-block; margin-top: 16px; font-size: 13px; }
    .status-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--surface); border-top: 1px solid var(--border); padding: 8px 32px; font-size: 12px; color: var(--muted); display: flex; gap: 24px; }
  </style>
</head>
<body>
  <header>
    <h1>⚡ Forge</h1>
    <span class="badge" id="ws-count">Loading…</span>
  </header>

  <main>
    <div class="section-title">Registered Workspaces</div>
    <div class="workspace-grid" id="ws-grid">
      <div style="color: var(--muted); font-size: 13px;">Loading workspaces…</div>
    </div>
  </main>

  <div class="status-bar">
    <span id="sse-status">● Connecting…</span>
    <span id="last-update"></span>
  </div>

  <script type="module">
    async function loadWorkspaces() {
      const res = await fetch('/api/workspaces')
      const { workspaces } = await res.json()
      const grid = document.getElementById('ws-grid')
      const count = document.getElementById('ws-count')

      count.textContent = workspaces.length + ' workspace' + (workspaces.length !== 1 ? 's' : '')

      if (workspaces.length === 0) {
        grid.innerHTML = \`
          <div class="empty-state" style="grid-column: 1/-1">
            <h2>No workspaces registered</h2>
            <p>Run the CLI to create your first workspace:</p>
            <code>guildhall init ~/path/to/your/project</code>
          </div>
        \`
        return
      }

      grid.innerHTML = workspaces.map(ws => \`
        <div class="ws-card" onclick="location.href='/workspace/\${ws.id}'">
          <h3>
            <span class="status-dot \${ws.lastSeenAt ? 'active' : 'idle'}"></span>
            \${ws.name}
          </h3>
          <div class="ws-id">\${ws.id}</div>
          <div class="ws-path">\${ws.path}</div>
          <div class="ws-meta">
            <span>\${ws.coordinators} coordinator\${ws.coordinators !== 1 ? 's' : ''}</span>
            \${ws.tags?.map(t => \`<span class="tag">\${t}</span>\`).join('') ?? ''}
            \${ws.valid ? '' : '<span style="color:var(--danger)">⚠ guildhall.yaml not found</span>'}
          </div>
        </div>
      \`).join('')
    }

    // SSE connection for live updates
    function connectSSE() {
      const es = new EventSource('/api/events')
      const status = document.getElementById('sse-status')
      const lastUpdate = document.getElementById('last-update')

      es.onopen = () => { status.textContent = '● Connected' }
      es.onerror = () => { status.textContent = '● Disconnected — retrying…' }

      es.onmessage = e => {
        const data = JSON.parse(e.data)
        if (data.type === 'heartbeat') {
          lastUpdate.textContent = 'Updated ' + new Date(data.timestamp).toLocaleTimeString()
          loadWorkspaces()
        }
      }
    }

    loadWorkspaces()
    connectSSE()
  </script>
</body>
</html>`
}
