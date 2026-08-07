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
  /**
   * Stable source-owned identity for this signal. This is the only identity
   * the hypothesis former may use when folding signals into durable records;
   * title/evidence prose is display evidence, never an identity key.
   */
  signalId?: string
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
   * Optional structural role for context-like signals. `capability` means
   * "show this in the project map as part of the product skeleton" rather than
   * "turn this into runnable queue work."
   */
  role?: 'capability' | 'reference' | 'brief_input'
  /**
   * Optional shape hint for structural context. `record` means the signal
   * names a durable project record (for example "Book brief") rather than a
   * loose prose note about that record.
   */
  structure?: 'record' | 'note'
  /**
   * Optional explicit task ids/titles documented as owning this signal's
   * reference. This lets durable planning docs state "spec X is covered by
   * task Y" without forcing downstream consumers to guess from title overlap.
   */
  linkedTaskHints?: string[]
  /**
   * Optional project-area hint inferred from the evidence path, such as
   * `knit` or `looma`. This lets the hypothesis former keep nested repo
   * structure instead of flattening everything into a generic core bucket.
   */
  domainHint?: string
  /**
   * Whether the source suggests this work belongs in the currently selected
   * bounded scope or should stay visible as later/deferred scope.
   */
  scopeHint?: 'current' | 'later'
  /**
   * Optional explicit release/scope container documented by the source. This
   * must come from owner-visible project material, not from generic current vs
   * later inference.
   */
  releaseId?: string
  /** Owner-visible label for `releaseId`, when the source names one. */
  releaseLabel?: string
  /** How confident the source is that this signal means what it claims. */
  confidence: 'high' | 'medium' | 'low'
  /**
   * Explicit source disposition. Sources may mark a structural note as
   * context-only or intentionally ignore it; the hypothesis former must not
   * rediscover that decision from the signal's wording.
   */
  taskDisposition?: 'candidate' | 'context_only' | 'ignore'
}

/**
 * A source-owned capability record. Unlike a signal, this is structured
 * planning input and may seed the durable capability catalog. The identity is
 * supplied by the adapter; `label` is display text only.
 */
export interface SourceCapabilityInput {
  id: string
  label: string
  state: 'planned' | 'retired'
  releaseIds: readonly string[]
  dependsOnCapabilityIds: readonly string[]
  evidenceRefs: readonly string[]
}

/** One immutable adapter revision, suitable for one CAS catalog write. */
export interface StructuredSourceCapabilitySnapshot {
  adapterId: string
  adapterSchemaVersion: number
  sourceRevision: string
  capabilities: readonly SourceCapabilityInput[]
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

/**
 * Deliberately separate from `TaskSource`: these adapters are the only intake
 * providers allowed to create durable executable scope. Markdown, Git, TODO,
 * and transcript sources may still emit signals/evidence but cannot implement
 * this interface by scraping text.
 */
export interface StructuredSourceCapabilityAdapter {
  id: string
  schemaVersion: number
  snapshot(ctx: TaskSourceContext): Promise<StructuredSourceCapabilitySnapshot>
}
