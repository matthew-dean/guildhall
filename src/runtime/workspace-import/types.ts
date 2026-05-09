/**
 * Workspace-import signal model (FR-34).
 *
 * A `TaskSource` is a pluggable input provider that inspects the project and
 * emits `WorkspaceSignal` records. Sources do NOT create tasks directly —
 * that's the hypothesis-former's job in a later phase. Sources only report
 * evidence.
 *
 * Built-in sources (git log, README, AGENTS/CLAUDE md, TODO/FIXME comments,
 * ROADMAP) all implement the same interface, and future sources (Jira MCP,
 * Linear, GitHub Issues) slot in the same way.
 */

export type SignalKind =
  | 'goal' // "what this project is trying to do" — top-level north-star
  | 'milestone' // already-done work (completed commits, shipped features)
  | 'open_work' // in-progress or queued — TODO/FIXME, roadmap items
  | 'context' // framing/tech-stack/constraints that inform tasks but aren't tasks

export interface WorkspaceSignal {
  /** Which source produced this (e.g. `git-log`, `readme`, `todo-comments`). */
  source: string
  kind: SignalKind
  /** One-line summary suitable for a task title or bullet. */
  title: string
  /**
   * Short excerpt of the raw evidence (commit subject, README line, TODO
   * comment). Kept short — sources should not dump full files here.
   */
  evidence: string
  /** File paths / commit shas / URLs backing this signal. */
  references?: string[]
  /**
   * Optional project-area hint inferred from the evidence path, such as
   * `knit` or `looma`. This lets the hypothesis former keep nested repo
   * structure instead of flattening everything into a generic core bucket.
   */
  domainHint?: string
  /** How confident the source is that this signal means what it claims. */
  confidence: 'high' | 'medium' | 'low'
}

export interface TaskSourceContext {
  projectPath: string
  /**
   * Optional injected exec (defaults to node:child_process). Tests use this to
   * fake `git log`, `rg`, etc. without hitting the host.
   */
  exec?: (
    cmd: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number },
  ) => Promise<{ stdout: string; stderr: string; code: number }>
}

export interface TaskSource {
  /** Stable machine-readable id (e.g. `git-log`). */
  id: string
  /** Human-readable label shown in dashboard previews. */
  label: string
  /**
   * Inspect the workspace and return any signals found. Must not throw on
   * missing files/commands — return `[]` instead. Sources run in parallel, so
   * they should be side-effect free beyond reading the filesystem and
   * executing idempotent shell commands.
   */
  detect(ctx: TaskSourceContext): Promise<readonly WorkspaceSignal[]>
}
