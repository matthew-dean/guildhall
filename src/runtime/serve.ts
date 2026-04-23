import { readFileSync, existsSync, promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import type { Context } from 'hono'
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
import { resolveEscalation, updateDesignSystem } from '@guildhall/tools'
import { DesignSystem, summarizeDesignSystem } from '@guildhall/core'
import { OrchestratorSupervisor } from './serve-supervisor.js'
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
  workspaceNeedsMetaIntake,
} from './meta-intake.js'
import {
  readBootstrapStatus,
  bootstrapNeeded,
  runBootstrap,
} from './bootstrap-runner.js'

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
      if (!bootstrap || bootstrap.commands.length === 0) {
        return c.json({ error: 'No bootstrap configured for this project.' }, 400)
      }
      const memoryDir = join(project.path, 'memory')
      const result = runBootstrap({
        projectPath: project.path,
        memoryDir,
        commands: bootstrap.commands,
        successGates: bootstrap.successGates,
        timeoutMs: bootstrap.timeoutMs,
      })
      const status = readBootstrapStatus(memoryDir)
      return c.json({ success: result.success, status })
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
      const recent = supervisor.recent(project.id).filter(ev => {
        const taskId = (ev as { event?: { taskId?: string } }).event?.taskId
        return taskId === id
      })
      return c.json({ task, recentEvents: recent })
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
        'resume',
        'unshelve',
        'resolve-escalation',
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
        await fsp.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
        return c.json({ ok: true })
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
      await fsp.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
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

