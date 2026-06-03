<!--
  Thread — the linear structured interaction surface.

  This is the home of the project: a chronological transcript of interaction
  cards between the user and the agent collective. Past turns scroll up as
  read-only context; the bottom of the feed always carries the single active
  turn (or "all caught up" if none open).

  The mental model is a project log of structured interactions. Cards have
  specific affordances — confirm/approve, yes/no, multiple-choice, free-text,
  or a link to a richer surface (provider page, bootstrap pane). Direct agent
  notes are scoped interventions for a specific task, not an always-additive
  chat transcript.

  Setup steps appear here as the FIRST turns ("intake-agent" persona). Brief
  approvals, agent questions, spec reviews, and escalations are subsequent
  turns from spec/worker/coord personas. Notifications (the async surface)
  is for things that don't fit this linear story.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { fly } from 'svelte/transition'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Button from '../../lib/Button.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Input from '../../lib/Input.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Select from '../../lib/Select.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Modal from '../../lib/Modal.svelte'
  import AgentQuestion from '../../lib/AgentQuestion.svelte'
  import StatusLight from '../../lib/StatusLight.svelte'
  import StatusDot from '../../lib/StatusDot.svelte'
  import StatusLine from '../../lib/StatusLine.svelte'
  import StateSummary from '../../lib/StateSummary.svelte'
  import Help from '../../lib/Help.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import ResolveEscalationModal from '../drawer/ResolveEscalationModal.svelte'
  import { friendlyStewardName } from '../../lib/display.js'
  import InteractionCardLayout from '../../lib/InteractionCardLayout.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import { onEvent } from '../../lib/events.js'
  import { escalationPrimaryAction, escalationUserGuidance } from '../../lib/escalation-labels.js'
  import { briefDoneWhenForReaders, briefScopeForReaders } from '../../lib/brief-display.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import {
    hasIncompleteTaskChecklist,
    isImportedDraftShaping,
    isQueuedSpecRevision as isQueuedSpecRevisionTurn,
    needsRecovery as taskNeedsRecovery,
    needsWorkerHandoffSpecCleanup,
  } from '../../lib/task-state.js'
  import { project } from '../../lib/project.svelte.js'
  import type { Escalation, GitStorySnapshot, ProjectRuntimeSummary } from '../../lib/types.js'
  import { toast } from '../../lib/toast.svelte.js'

  interface Props {
    projectId?: string | null
  }

  const props = $props<Props>()
  const explicitProjectId = $derived(props.projectId?.trim() || null)

  // ---- Turn shape (mirrors src/runtime/thread.ts) ------------------------
  type TurnPersona = 'intake' | 'spec' | 'worker' | 'reviewer' | 'coord' | 'system'
  type TurnStatus = 'done' | 'active' | 'pending'
  type TurnPhase = 'setup' | 'intake' | 'spec' | 'ready' | 'inflight' | 'blocked' | 'done'
  type RequestStage = 'new_request' | 'task_brief_cleanup'
  type ConstructionMode = 'survey' | 'blueprint' | 'frame' | 'build' | 'inspect' | 'change_order' | 'punch_list'
  type SetupAffordance = 'link' | 'inline-text' | 'inline-textarea' | 'inline-button' | 'inline-choice'
  type RuntimeDevServerStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'stale'
  interface RuntimeDevServer {
    id: string
    taskId?: string
    status: RuntimeDevServerStatus
    readiness: 'unknown' | 'ready' | 'failed'
    command: { cwd: string; argv: string[] }
    ports: Array<{ container: number; host: number; purpose: string }>
    url: string
    readinessPath: string
    browserProof: { url: string; ok: boolean; status: number | null; error: string | null } | null
    logs: string[]
    error: string | null
  }
  type CapabilityAccess = 'read-only' | 'read-write'
  interface CapabilityMount {
    hostPath: string
    containerPath: string
    access: CapabilityAccess
  }
  interface CapabilityGrant extends CapabilityMount {
    id: string
    kind: 'mount_directory'
    duration: string
    status: 'active' | 'revoked'
    evidence: string
  }
  interface CapabilityRequest {
    id: string
    taskId: string
    kind: 'mount_directory'
    requestedBy: string
    reason: string
    duration: string
    fallback?: string
    mount: CapabilityMount
    status: 'pending' | 'approved' | 'denied' | 'blocked' | 'revoked'
    blockedReason?: string
    grant?: CapabilityGrant
  }
  interface LiveAgent {
    name: string
    startedAt?: string | undefined
    lastEventAt?: string | undefined
    lastEventLabel?: string | undefined
    silentMs?: number | undefined
    stalled?: boolean | undefined
  }
  interface LiveActivity {
    at?: string | undefined
    label: string
    tone: 'neutral' | 'running' | 'ok' | 'warn' | 'danger'
    detail?: string | undefined
  }

  interface SetupStepTurn {
    kind: 'setup_step'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    stepId: string; title: string; why: string; skippable: boolean
    affordance: SetupAffordance; actionLabel: string
    actionHref?: string | undefined; submitEndpoint?: string | undefined
    currentValue?: string | undefined; placeholder?: string | undefined
    choices?: Array<{ value: string; label: string }> | undefined
    contextSummary?: {
      intro: string
      facts: string[]
      uncertainty: string
    } | undefined
  }
  interface BriefTurn {
    kind: 'brief_approval'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    brief: {
      userJob?: string; successMetric?: string; successCriteria?: string
      antiPatterns?: string[]; rolloutPlan?: string; authoredBy?: string
    }
    liveAgent?: LiveAgent | undefined
    approvedAt?: string | null
    latestUserCorrection?: string | undefined
  }
  interface AgentQuestionTurn {
    kind: 'agent_question'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    taskDescription?: string | undefined
    sourceNote?: { description?: string | undefined; references: string[] } | undefined
    liveAgent?: LiveAgent | undefined
    activity?: LiveActivity[] | undefined
    question: {
      kind: 'confirm' | 'yesno' | 'choice' | 'text'
      id: string; askedBy: string; askedAt: string
      draftAnswer?: string
      answeredAt?: string; answer?: string
      restatement?: string; prompt?: string; choices?: string[]
      selectionMode?: 'single' | 'multiple' | undefined
    }
    questions?: AgentQuestionTurn['question'][] | undefined
  }
  interface SpecReviewTurn {
    kind: 'spec_review'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; spec: string
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    draftCoordinators?: Array<{
      id: string
      name?: string
      domain: string
      path?: string
      mandate: string
      concerns: Array<{ id: string; description?: string }>
    }>
  }
  interface EscalationTurn {
    kind: 'escalation'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; escalationId: string
    escalationReason?: string | undefined; escalationAgentId?: string | undefined
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    summary: string; details?: string
    activity?: LiveActivity[] | undefined
  }
  interface ReviewFeedbackTurn {
    kind: 'review_feedback'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    summary: string; feedback: string; revisionCount?: number | undefined
  }
  interface HistoryNoteTurn {
    kind: 'history_note'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    constructionMode?: ConstructionMode | undefined
    category: 'source' | 'request' | 'system'
    label: string
    summary: string
    references?: string[] | undefined
    count?: number | undefined
    entries?: Array<{ at: string; label: string; summary: string }> | undefined
  }
  interface InFlightTurn {
    kind: 'inflight'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; taskStatus?: string; summary: string
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    requestKind?: 'task_spec' | 'project_question' | 'settings_proposal' | 'persona_practice_proposal' | 'repair_triage' | 'clarification' | undefined
    requestStage?: RequestStage | undefined
    routingSummary?: string | undefined
    taskDescription?: string | undefined
    sourceNote?: { description?: string | undefined; references: string[] } | undefined
    importedDraft?: boolean | undefined
    liveAgent?: LiveAgent | undefined
    activity?: LiveActivity[] | undefined
    checklist?: {
      title: string
      doneCount: number
      totalSteps: number
      activeStepId: string | null
      steps: Array<{
        id: string
        title: string
        why: string
        status: 'done' | 'active' | 'pending' | 'skipped'
      }>
    } | undefined
  }
  interface RequestTurn {
    kind: 'request'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    requestId: string
    taskId?: string
    rawRequest: string
    title: string
    requestStage?: RequestStage | undefined
    routingSummary: string
  }
  interface PressureTestQuestionTurn {
    kind: 'pressure_test_question'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    intakeId: string
    targetTitle: string
    domainId: string
    domainTitle: string
    question: {
      id: string
      prompt: string
      why: string
      choices?: string[]
      evidence: string[]
    }
    answerEndpoint: string
  }
  interface BoundedChatTurn {
    kind: 'bounded_chat'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    sessionId: string
    subObjectiveId: string
    targetTitle: string
    domainTitle: string
    question: {
      id: string
      prompt: string
      why: string
      choices?: string[]
      evidence: string[]
    }
    answerEndpoint: string
  }
  type OwnerInputQuestionTurn = PressureTestQuestionTurn | BoundedChatTurn
  type Turn =
    | SetupStepTurn
    | BriefTurn
    | AgentQuestionTurn
    | SpecReviewTurn
    | HistoryNoteTurn
    | ReviewFeedbackTurn
    | EscalationTurn
    | InFlightTurn
    | RequestTurn
    | PressureTestQuestionTurn
    | BoundedChatTurn

  type ThreadChain = {
    id: string
    turns: Turn[]
    latestTurn: Turn
    activeTurn: Turn | null
    currentTurn: Turn | null
  }
  type HistoryRenderItem =
    | { kind: 'single'; id: string; turn: Turn }
    | { kind: 'cluster'; id: string; key: string; label: string; turns: ReviewFeedbackTurn[] }
  type TaskReplyTurn = BriefTurn | SpecReviewTurn | InFlightTurn | EscalationTurn

  let turns = $state<Turn[]>([])
  let threadLoadRequestId = 0
  let activeTurnId = $state<string | null>(null)
  let caughtUp = $state(false)
  let loaded = $state(false)
  let loadError = $state<string | null>(null)
  let busyTurnId = $state<string | null>(null)
  let busyTaskId = $state<string | null>(null)
  let setupValues = $state<Record<string, string>>({})
  let setupErrors = $state<Record<string, string>>({})
  let replyTurnId = $state<string | null>(null)
  let replyDrafts = $state<Record<string, string>>({})
  let replyErrors = $state<Record<string, string>>({})
  let sentReplies = $state<Record<string, boolean>>({})
  let escalationModal = $state<{ turn: EscalationTurn; mode: 'retry' | 'resolve' } | null>(null)
  let footerQuestionDrafts = $state<Record<string, string>>({})
  let contextTurnId = $state<string | null>(null)
  let contextDrafts = $state<Record<string, string>>({})
  let contextErrors = $state<Record<string, string>>({})
  let pressureTestAnswers = $state<Record<string, string>>({})
  let pressureTestErrors = $state<Record<string, string>>({})
  let devServers = $state<RuntimeDevServer[]>([])
  let threadRuntime = $state<ProjectRuntimeSummary | null>(null)
  let devServerBusyId = $state<string | null>(null)
  let capabilityRequests = $state<CapabilityRequest[]>([])
  let capabilityBusyId = $state<string | null>(null)
  let capabilityPathDrafts = $state<Record<string, string>>({})
  let capabilityFallbackDrafts = $state<Record<string, string>>({})
  let capabilityBlockDrafts = $state<Record<string, string>>({})
  const pendingCapabilityRequests = $derived(capabilityRequests.filter(request => request.status === 'pending'))
  let briefFixTurnId = $state<string | null>(null)
  let briefFixDrafts = $state<Record<string, { successTarget: string; acceptanceCriterion: string }>>({})
  let briefFixErrors = $state<Record<string, string>>({})
  const SOURCE_PREVIEW_RENDER_CHAR_LIMIT = 32_000

  let sourcePreview = $state<{ ref: string; displayPath: string; content: string | null; truncated: boolean; loading: boolean } | null>(null)
  let sourcePreviewLoadingRef = $state<string | null>(null)
  let sourcePreviewError = $state<string | null>(null)
  let sourcePreviewRequestId = 0
  let documentPreview = $state<{
    kind: 'brief' | 'spec'
    taskId: string
    taskTitle: string
    title: string
    content: string
  } | null>(null)
  let importHandoff = $state<{ tasksAdded: number; sourceCount: number } | null>(null)
  let importHandoffFocused = $state(false)
  let selectedTurnId = $state<string | null>(null)
  let detailScrollEl = $state<HTMLElement | null>(null)
  let detailShouldStickToBottom = $state(true)
  let lastAutoScrollKey = $state<string | null>(null)
  let compactThreadMode = $state(false)
  let compactPane = $state<'list' | 'detail'>('list')
  let pollHandle: ReturnType<typeof setInterval> | null = null
  let clockHandle: ReturnType<typeof setInterval> | null = null
  let loadTimer: ReturnType<typeof setTimeout> | null = null
  let loadInFlight = false
  let loadQueued = false
  let nowMs = $state(Date.now())
  let runBusy = $state(false)
  let runError = $state<string | null>(null)
  const startReadiness = $derived(project.detail?.startReadiness ?? null)
  const runStatus = $derived(project.detail?.run?.status ?? 'stopped')
  const projectRuntime = $derived((threadRuntime ?? project.detail?.runtime ?? null) as ProjectRuntimeSummary | null)
  const allTerminalReadinessMessage = $derived(
    startReadiness?.code === 'all_terminal'
      ? startReadiness?.message ?? 'All tasks are already finished.'
      : null,
  )

  // Preserved draft answers for agent_question turns. New answers submit
  // immediately; this only keeps older saved drafts visible and sendable.
  let staged = $state<Record<string, string>>({})

  function scopedProjectFetch(input: string, init?: RequestInit): Promise<Response> {
    return projectFetch(input, init, explicitProjectId)
  }

  function refreshProject(): Promise<unknown> {
    return project.refresh(explicitProjectId)
  }

  async function persistDraftAnswer(taskId: string, questionId: string, answer: string): Promise<void> {
    await scopedProjectFetch(`/api/project/task/${encodeURIComponent(taskId)}/stage-answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId, answer }),
    })
  }

  function unstageAnswer(questionId: string): void {
    const next = { ...staged }
    delete next[questionId]
    staged = next
  }

  function setFooterQuestionDraft(questionId: string, value: string): void {
    footerQuestionDrafts = { ...footerQuestionDrafts, [questionId]: value }
  }

  function clearFooterQuestionDraft(questionId: string): void {
    const next = { ...footerQuestionDrafts }
    delete next[questionId]
    footerQuestionDrafts = next
  }

  function sourcePath(ref: string): string {
    const cleaned = ref.trim()
    if (!cleaned) return ''
    const fileMatch = cleaned.match(/^(.+?\.(?:md|mdx|txt|tsx?|jsx?|svelte|vue|json|ya?ml|css|scss|html))(?:[:#].*)?$/i)
    return (fileMatch?.[1] ?? cleaned).trim()
  }

  function sourceDisplayName(ref: string): string {
    const path = sourcePath(ref)
    if (!path) return ref.trim()
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  }

  function sourceDisplayHint(ref: string): string {
    const path = sourcePath(ref)
    return path || ref.trim()
  }

  function boundedSourcePreviewContent(content: string): { content: string; truncated: boolean } {
    if (content.length <= SOURCE_PREVIEW_RENDER_CHAR_LIMIT) return { content, truncated: false }
    return {
      content: content.slice(0, SOURCE_PREVIEW_RENDER_CHAR_LIMIT).trimEnd(),
      truncated: true,
    }
  }

  function openBriefPreview(turn: BriefTurn): void {
    const sections = [
      `## Scope\n${briefScopeForReaders(turn.brief, turn.taskTitle)}`,
    ]
    const doneWhen = briefDoneWhenForReaders(turn.brief)
    if (doneWhen) sections.push(`## Done when\n${doneWhen}`)
    if (turn.brief.antiPatterns?.length) {
      sections.push(`## Out of scope\n${turn.brief.antiPatterns.map(item => `- ${item}`).join('\n')}`)
    }
    documentPreview = {
      kind: 'brief',
      taskId: turn.taskId,
      taskTitle: turn.taskTitle,
      title: 'Brief',
      content: sections.join('\n\n'),
    }
  }

  function openSpecPreview(turn: SpecReviewTurn): void {
    documentPreview = {
      kind: 'spec',
      taskId: turn.taskId,
      taskTitle: turn.taskTitle,
      title: 'Spec',
      content: turn.spec.trim() || '_No spec saved yet._',
    }
  }

  function preserveTaskExtras(nextTurns: Turn[], priorTurns: Turn[]): Turn[] {
    const priorByTaskId = new Map<string, Turn>()
    for (const turn of priorTurns) {
      if (!('taskId' in turn)) continue
      priorByTaskId.set(turn.taskId, turn)
    }
    return nextTurns.map((turn) => {
      if (!('taskId' in turn) || 'gitStory' in turn) return turn
      const prior = priorByTaskId.get(turn.taskId)
      if (!prior || !('gitStory' in prior) || !prior.gitStory) return turn
      return { ...turn, gitStory: prior.gitStory }
    })
  }

  async function openSourceNote(ref: string): Promise<void> {
    const candidate = sourcePath(ref)
    if (!candidate) return
    const requestId = ++sourcePreviewRequestId
    sourcePreviewLoadingRef = ref
    sourcePreviewError = null
    sourcePreview = {
      ref,
      displayPath: sourceDisplayHint(ref),
      content: null,
      truncated: false,
      loading: true,
    }
    try {
      const r = await scopedProjectFetch(`/api/project/source-note?path=${encodeURIComponent(candidate)}`, { cache: 'no-store' })
      const body = (await r.json().catch(() => ({}))) as {
        error?: string
        displayPath?: string
        content?: string
        truncated?: boolean
      }
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      if (requestId !== sourcePreviewRequestId) return
      const bounded = boundedSourcePreviewContent(body.content ?? '')
      sourcePreview = {
        ref,
        displayPath: body.displayPath ?? candidate,
        content: bounded.content,
        truncated: Boolean(body.truncated) || bounded.truncated,
        loading: false,
      }
    } catch (err) {
      if (requestId !== sourcePreviewRequestId) return
      sourcePreviewError = err instanceof Error ? err.message : String(err)
      sourcePreview = {
        ref,
        displayPath: sourceDisplayHint(ref),
        content: null,
        truncated: false,
        loading: false,
      }
    } finally {
      if (requestId === sourcePreviewRequestId) {
        sourcePreviewLoadingRef = null
      }
    }
  }

  async function load(): Promise<void> {
    const requestId = ++threadLoadRequestId
    try {
      const r = await scopedProjectFetch('/api/project/thread', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { turns?: Turn[]; activeTurnId?: string | null; caughtUp?: boolean }
      if (requestId !== threadLoadRequestId) return
      turns = preserveTaskExtras(j.turns ?? [], turns)
      activeTurnId = j.activeTurnId ?? null
      caughtUp = !!j.caughtUp
      const nextSentReplies = { ...sentReplies }
      for (const turn of turns) {
        if (nextSentReplies[turn.id] && turnLiveAgent(turn)) {
          delete nextSentReplies[turn.id]
        }
      }
      sentReplies = nextSentReplies
      const nextStaged = { ...staged }
      for (const turn of turns) {
        if (turn.kind !== 'agent_question') continue
        if (nextStaged[turn.question.id] === undefined && typeof turn.question.draftAnswer === 'string' && turn.question.draftAnswer.trim()) {
          nextStaged[turn.question.id] = turn.question.draftAnswer.trim()
        }
      }
      staged = nextStaged
      const nextValues = { ...setupValues }
      for (const turn of j.turns ?? []) {
        if (turn.kind !== 'setup_step') continue
        if (nextValues[turn.id] === undefined && turn.currentValue !== undefined) {
          nextValues[turn.id] = turn.currentValue
        }
        if (nextValues[turn.id] === undefined && turn.choices?.[0]?.value) {
          nextValues[turn.id] = turn.choices[0].value
        }
      }
      setupValues = nextValues
      loadError = null
      loaded = true
      void loadThreadExtras(requestId)
      void Promise.allSettled([
        loadRuntimeStatus(),
        loadDevServers(),
        loadCapabilityRequests(),
      ])
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
      turns = []
      devServers = []
      threadRuntime = null
      capabilityRequests = []
      activeTurnId = null
      caughtUp = false
      loaded = true
    }
  }

  async function loadThreadExtras(requestId: number): Promise<void> {
    try {
      const r = await scopedProjectFetch('/api/project/thread/extras', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as { taskGitStories?: Record<string, unknown> }
      if (requestId !== threadLoadRequestId) return
      const taskGitStories = j.taskGitStories ?? {}
      if (Object.keys(taskGitStories).length === 0) return
      turns = turns.map((turn) => {
        if (!('taskId' in turn)) return turn
        const gitStory = taskGitStories[turn.taskId]
        return gitStory ? { ...turn, gitStory } : turn
      })
    } catch {
      /* extras are best-effort only */
    }
  }

  async function loadDevServers(): Promise<void> {
    try {
      const r = await scopedProjectFetch('/api/project/runtime/dev-servers', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as { devServers?: RuntimeDevServer[] }
      devServers = j.devServers ?? []
    } catch {
      devServers = []
    }
  }

  async function loadRuntimeStatus(): Promise<void> {
    try {
      const r = await scopedProjectFetch('/api/project/runtime', { cache: 'no-store' })
      if (!r.ok) return
      threadRuntime = await r.json().catch(() => null) as ProjectRuntimeSummary | null
    } catch {
      threadRuntime = null
    }
  }

  async function loadCapabilityRequests(): Promise<void> {
    try {
      const r = await scopedProjectFetch('/api/project/capability-requests', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as { requests?: CapabilityRequest[] }
      capabilityRequests = j.requests ?? []
      const nextPaths = { ...capabilityPathDrafts }
      const nextFallbacks = { ...capabilityFallbackDrafts }
      const nextBlocks = { ...capabilityBlockDrafts }
      for (const request of capabilityRequests) {
        if (nextPaths[request.id] === undefined) nextPaths[request.id] = request.mount.hostPath
        if (nextFallbacks[request.id] === undefined) nextFallbacks[request.id] = request.fallback ?? ''
        if (nextBlocks[request.id] === undefined) nextBlocks[request.id] = request.blockedReason ?? ''
      }
      capabilityPathDrafts = nextPaths
      capabilityFallbackDrafts = nextFallbacks
      capabilityBlockDrafts = nextBlocks
    } catch {
      capabilityRequests = []
    }
  }

  async function approveCapabilityRequest(request: CapabilityRequest, access: CapabilityAccess): Promise<void> {
    capabilityBusyId = request.id
    try {
      const r = await scopedProjectFetch(`/api/project/capability-requests/${encodeURIComponent(request.id)}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access,
          hostPath: capabilityPathDrafts[request.id]?.trim() || request.mount.hostPath,
          duration: request.duration,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      toast.success('Capability grant approved')
      await loadCapabilityRequests()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      capabilityBusyId = null
    }
  }

  async function denyCapabilityRequest(request: CapabilityRequest): Promise<void> {
    capabilityBusyId = request.id
    try {
      const r = await scopedProjectFetch(`/api/project/capability-requests/${encodeURIComponent(request.id)}/deny`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fallback: capabilityFallbackDrafts[request.id]?.trim() || request.fallback }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      toast.success('Capability request denied')
      await loadCapabilityRequests()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      capabilityBusyId = null
    }
  }

  async function blockCapabilityRequest(request: CapabilityRequest): Promise<void> {
    capabilityBusyId = request.id
    try {
      const r = await scopedProjectFetch(`/api/project/capability-requests/${encodeURIComponent(request.id)}/block`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: capabilityBlockDrafts[request.id]?.trim() || 'Owner marked this grant request blocked.' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      toast.success('Capability request marked blocked')
      await loadCapabilityRequests()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      capabilityBusyId = null
    }
  }

  async function stopDevServer(id: string): Promise<void> {
    devServerBusyId = id
    try {
      const r = await scopedProjectFetch(`/api/project/runtime/dev-servers/${encodeURIComponent(id)}/stop`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadDevServers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      devServerBusyId = null
    }
  }

  async function restartDevServer(id: string): Promise<void> {
    devServerBusyId = id
    try {
      const r = await scopedProjectFetch(`/api/project/runtime/dev-servers/${encodeURIComponent(id)}/restart`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadDevServers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      devServerBusyId = null
    }
  }

  function devServerTone(status: RuntimeDevServerStatus): 'ok' | 'running' | 'warn' | 'danger' | 'neutral' {
    if (status === 'running') return 'ok'
    if (status === 'starting') return 'running'
    if (status === 'failed') return 'danger'
    if (status === 'stale') return 'warn'
    return 'neutral'
  }

  function runtimeUiLabel(status: string | undefined): string {
    if (status === 'running') return 'Runtime running'
    if (status === 'creating') return 'Runtime starting'
    if (status === 'failed') return 'Runtime failed'
    return 'Runtime stopped'
  }

  function runtimeUiDetail(): string {
    const runtime = projectRuntime
    if (!runtime) return 'Runtime state has not been recorded yet.'
    const mode = runtime.migration?.mode === 'runtime-backed'
      ? 'Podman runtime mode'
      : runtime.migration?.mode === 'host-run'
        ? 'Compatibility mode'
        : 'Runtime mode unknown'
    const health = runtime.health?.status ? ` · ${runtime.health.status}` : ''
    const setup = runtime.backendSetup?.status ? ` · setup ${runtime.backendSetup.status}` : ''
    return `${mode}${health}${setup}`
  }

  function runtimeUiTone(): 'neutral' | 'ok' | 'warn' | 'danger' | 'running' {
    if (projectRuntime?.status === 'failed' || projectRuntime?.health?.status === 'unhealthy') return 'danger'
    if (projectRuntime?.status === 'creating' || projectRuntime?.health?.status === 'degraded') return 'warn'
    if (projectRuntime?.status === 'running') return 'running'
    return 'neutral'
  }

  async function runLoad(): Promise<void> {
    if (loadInFlight) {
      loadQueued = true
      return
    }
    loadInFlight = true
    try {
      await load()
    } finally {
      loadInFlight = false
      if (loadQueued) {
        loadQueued = false
        void runLoad()
      }
    }
  }

  function scheduleLoad(delayMs = 0): void {
    if (loadTimer) return
    loadTimer = setTimeout(() => {
      loadTimer = null
      void runLoad()
    }, delayMs)
  }

  onMount(() => {
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 900px)')
      : null
    const syncCompactMode = () => {
      const matches = media?.matches ?? false
      compactThreadMode = matches
      if (!matches) {
        compactPane = 'detail'
      } else if (!selectedTurnId) {
        compactPane = 'list'
      }
    }
    syncCompactMode()
    media?.addEventListener('change', syncCompactMode)
    try {
      const raw = sessionStorage.getItem('guildhall:workspace-import-handoff')
      if (raw) {
        const parsed = JSON.parse(raw) as { tasksAdded?: number; sourceCount?: number }
        importHandoff = {
          tasksAdded: Math.max(0, Number(parsed.tasksAdded ?? 0)),
          sourceCount: Math.max(0, Number(parsed.sourceCount ?? 0)),
        }
        importHandoffFocused = false
        sessionStorage.removeItem('guildhall:workspace-import-handoff')
      }
    } catch {
      importHandoff = null
    }
    scheduleLoad()
    const onRequestCreated = () => {
      scheduleLoad(0)
      void refreshProject()
    }
    window.addEventListener('guildhall:request-created', onRequestCreated)
    pollHandle = setInterval(() => scheduleLoad(100), 4000)
    clockHandle = setInterval(() => {
      nowMs = Date.now()
    }, 5000)
    return () => {
      window.removeEventListener('guildhall:request-created', onRequestCreated)
      media?.removeEventListener('change', syncCompactMode)
    }
  })
  $effect(() => {
    const off = onEvent(ev => {
      const type = ev.event?.type ?? ev.type ?? ''
      if (
        type === 'agent_started' ||
        type === 'agent_finished' ||
        type === 'task_transition' ||
        type === 'agent_issue' ||
        type === 'escalation_raised' ||
        type === 'tool_started' ||
        type === 'tool_completed' ||
        type === 'line_complete' ||
        type === 'error'
      ) {
        scheduleLoad(100)
      }
    })
    return off
  })
  onDestroy(() => {
    if (pollHandle) clearInterval(pollHandle)
    if (clockHandle) clearInterval(clockHandle)
    if (loadTimer) clearTimeout(loadTimer)
  })

  function personaLabel(p: TurnPersona): string {
    switch (p) {
      case 'intake': return 'Setup guide'
      case 'spec':   return 'Guildhall'
      case 'worker': return 'Worker'
      case 'reviewer': return 'Reviewer'
      case 'coord':  return 'Coordinator'
      case 'system': return 'Guildhall'
    }
  }

  function displayTaskTitle(t: { taskId: string; taskTitle: string }): string {
    if (t.taskId === 'task-meta-intake') return 'Inspect the repo and draft starter tasks'
    if (t.taskId === 'task-workspace-import') return 'Review existing project work'
    return t.taskTitle
  }

  function isQueuedSpecRevision(turn: InFlightTurn): boolean {
    return isQueuedSpecRevisionTurn(turn)
  }

  function needsRecovery(turn: Turn): boolean {
    return turn.kind === 'inflight' && taskNeedsRecovery(turn)
  }

  function guildhallShaping(turn: Turn): boolean {
    return turn.kind === 'inflight' && isImportedDraftShaping(turn)
  }

  function tone(t: Turn): 'ok' | 'warn' | 'neutral' | 'accent' {
    if (t.status === 'done') return 'ok'
    if (needsRecovery(t)) return 'warn'
    const owner = ownershipLabel(t)
    if (owner === 'Needs you' || owner === 'Needs brief') return 'warn'
    if (owner === 'Queued' || owner === 'Guildhall working' || owner === 'Guildhall shaping') return 'accent'
    if (t.status === 'active') return 'warn'
    return 'neutral'
  }

  function isQueuedForGuildhall(t: Turn): boolean {
    return t.kind === 'inflight' && t.status === 'active' && !turnLiveAgent(t) && !t.importedDraft && t.taskStatus !== 'in_progress' && canStartTaskTurn(t)
  }

  function turnStatusChipLabel(t: Turn): string {
    if (t.status === 'done') return 'done'
    if (needsRecovery(t)) return 'Needs recovery'
    if (t.kind === 'inflight' && t.taskId === 'task-meta-intake' && !turnLiveAgent(t)) {
      return t.status === 'active' ? 'needs setup' : 'setup next'
    }
    if (t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring') && !turnLiveAgent(t)) {
      return 'needs you'
    }
    if (t.kind === 'inflight' && t.status === 'active' && !turnLiveAgent(t)) {
      if (t.taskStatus === 'in_progress') return runStatus === 'running' ? 'next' : 'paused'
      return canStartTaskTurn(t) ? 'queued' : 'paused'
    }
    if (t.kind === 'spec_review' && t.status === 'active') return 'awaiting approval'
    return t.status === 'active' ? 'now' : 'next'
  }

  function turnStatusChipTone(t: Turn): 'ok' | 'warn' | 'neutral' | 'accent' {
    if (t.status === 'done') return 'ok'
    if (needsRecovery(t)) return 'warn'
    if (t.kind === 'inflight' && t.taskId === 'task-meta-intake' && !turnLiveAgent(t)) {
      return 'warn'
    }
    if (t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring') && !turnLiveAgent(t)) {
      return 'warn'
    }
    if (isQueuedForGuildhall(t)) return 'ok'
    if (t.kind === 'inflight' && t.status === 'active' && !turnLiveAgent(t)) return 'neutral'
    if (t.kind === 'spec_review' && t.status === 'active') return 'neutral'
    return t.status === 'active' ? 'neutral' : 'neutral'
  }

  function constructionModeLabel(t: Turn): string | null {
    if (!('constructionMode' in t)) return null
    switch (t.constructionMode) {
      case 'survey': return 'Survey'
      case 'blueprint': return 'Blueprint'
      case 'frame': return 'Frame'
      case 'build': return 'Build'
      case 'inspect': return 'Inspect'
      case 'change_order': return 'Change order'
      case 'punch_list': return 'Punch list'
      default: return null
    }
  }

  function showConstructionModeChip(t: Turn): boolean {
    if (t.kind === 'inflight' && t.requestKind === 'project_question') return false
    const owner = ownershipLabel(t)
    if (owner && owner !== 'Guildhall shaping') return false
    return t.status !== 'done' && Boolean(constructionModeLabel(t)) && !isQueuedForGuildhall(t)
  }

  function showStatusChip(t: Turn): boolean {
    const owner = ownershipLabel(t)?.trim().toLowerCase()
    const status = turnStatusChipLabel(t).trim().toLowerCase()
    if (owner) return false
    if (t.kind === 'inflight') {
      const taskState = taskStateLabel(t).trim().toLowerCase()
      if (status === taskState) return false
      if ((status === 'paused' || status === 'queued' || status === 'next') && taskState !== 'done') return false
    }
    return true
  }

  function hasCardStatus(t: Turn): boolean {
    return showConstructionModeChip(t) || Boolean(ownershipLabel(t)) || showStatusChip(t)
  }

  function ownershipLabel(t: Turn): string | null {
    if (turnLiveAgent(t)) return 'Guildhall working'
    if (needsRecovery(t)) return 'Needs recovery'
    if (guildhallShaping(t)) return 'Guildhall shaping'
    if (t.kind === 'setup_step') return t.status === 'done' || t.skippable ? null : 'Needs you'
    if (t.kind === 'pressure_test_question' || t.kind === 'bounded_chat') return t.status === 'done' ? null : 'Needs you'
    if (t.kind === 'escalation') {
      if (t.status === 'done') return null
      return escalationUserGuidance({
        summary: t.summary,
        details: t.details,
        reason: t.escalationReason,
        agentId: t.escalationAgentId,
      }).actionOwner === 'guildhall'
        ? 'Guildhall can continue'
        : 'Needs you'
    }
    if (t.kind === 'agent_question' || t.kind === 'brief_approval' || t.kind === 'spec_review') {
      return t.status === 'done' ? null : 'Needs you'
    }
    if (t.kind === 'review_feedback') return t.status === 'done' ? null : 'Needs you'
    if (t.kind === 'inflight') {
      if (t.importedDraft && t.taskStatus === 'import_draft') {
        return 'Needs you'
      }
      if (t.taskStatus === 'in_progress' && !turnLiveAgent(t)) {
        return runStatus === 'running' ? 'Queued for Guildhall' : null
      }
      if (needsWorkerHandoffSpecCleanup(t)) {
        return 'Needs brief'
      }
      if (
        !turnLiveAgent(t) &&
        (runStatus === 'running' || runStatus === 'stopping') &&
        (
          t.taskStatus === 'ready' ||
          t.taskStatus === 'review' ||
          t.taskStatus === 'gate_check' ||
          t.taskStatus === 'exploring'
        )
      ) {
        return 'Queued for Guildhall'
      }
      if (canStartTaskTurn(t)) return 'Queued'
    }
    return null
  }

  function ownershipTone(t: Turn): 'ok' | 'warn' | 'neutral' | 'accent' | 'running' {
    if (turnLiveAgent(t)) return 'running'
    const label = ownershipLabel(t)
    if (label === 'Needs you' || label === 'Needs recovery') return 'warn'
    if (label === 'Needs brief') return 'warn'
    if (label === 'Guildhall can continue') return 'ok'
    if (label === 'Queued' || label === 'Queued for Guildhall') return 'ok'
    if (label === 'Guildhall shaping') return 'accent'
    return 'neutral'
  }

  function turnIndexChip(
    turn: Turn,
  ): { label: string; tone: 'ok' | 'warn' | 'neutral' | 'accent' | 'running' } | null {
    const owner = ownershipLabel(turn)
    if (owner) {
      return { label: owner, tone: ownershipTone(turn) }
    }
    if (showStatusChip(turn)) {
      return { label: turnStatusChipLabel(turn), tone: turnStatusChipTone(turn) }
    }
    if (turn.kind === 'inflight' && turn.status !== 'done') {
      return { label: taskStateLabel(turn), tone: tone(turn) === 'warn' ? 'warn' : 'ok' }
    }
    return null
  }

  function turnLiveAgent(t: Turn): LiveAgent | undefined {
    if (t.status !== 'active') return undefined
    if (runStatus !== 'running' && runStatus !== 'stopping') return undefined
    return 'liveAgent' in t ? t.liveAgent : undefined
  }

  function elapsedSeconds(startedAt: string | undefined): number | null {
    if (!startedAt) return null
    const started = Date.parse(startedAt)
    if (!Number.isFinite(started)) return null
    return Math.max(0, Math.floor((nowMs - started) / 1000))
  }

  function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s elapsed`
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return remainder > 0 ? `${minutes}m ${remainder}s elapsed` : `${minutes}m elapsed`
  }

  function shortElapsed(ms: number | undefined): string | null {
    if (ms === undefined) return null
    const seconds = Math.max(0, Math.floor(ms / 1000))
    if (seconds < 60) return `${seconds}s ago`
    return `${Math.floor(seconds / 60)}m ago`
  }

  function liveAgentMessage(agent: LiveAgent | undefined): string {
    if (!agent) return 'Model call in progress'
    const sinceActivity = shortElapsed(agent.silentMs)
    const label = agent.lastEventLabel ?? 'Model call in progress'
    if (label === 'Waiting for the local model to respond.' && (agent.silentMs ?? 0) >= 60_000) {
      return `Still waiting for the local model${sinceActivity ? ` · ${sinceActivity}` : ''}`
    }
    if (agent.stalled) {
      return `No activity${sinceActivity ? ` for ${sinceActivity.replace(' ago', '')}` : ''}`
    }
    if (sinceActivity) return `${label} · ${sinceActivity}`
    const seconds = elapsedSeconds(agent.startedAt)
    return seconds === null ? label : `${label} · ${formatElapsed(seconds)}`
  }

  function cleanPressureTargetTitle(title: string): string {
    return title
      .replace(/\s+project check-in$/i, '')
      .replace(/^Pressure-test\s+/i, '')
      .replace(/\.\s*Ask me.*$/i, '')
      .trim()
      || title
  }

  function requestSummary(rawRequest: string): string {
    const cleaned = rawRequest
      .replace(/\.\s*Ask me.*$/i, '')
      .replace(/\s+and do not implement anything yet\.?$/i, '')
      .trim()
    const pressureTarget = cleaned.match(/^Pressure-test\s+(.+)$/i)
    if (pressureTarget) {
      const target = cleanPressureTargetTitle(pressureTarget[1] ?? cleaned).replace(/[.?!]+$/, '')
      return `Guildhall saved this as a pressure-test intake for ${target}.`
    }
    return cleaned || rawRequest
  }

  function pressureQuestionPrompt(turn: OwnerInputQuestionTurn): string {
    const target = cleanPressureTargetTitle(turn.targetTitle)
    const prompt = turn.question.prompt.trim()
    if (/^What outcome would make this project successful\?$/i.test(prompt)) {
      return `What would make ${target} successful?`
    }
    const quotedOutcome = prompt.match(/^For "(.+)", what outcome should this request achieve\?$/i)
    if (quotedOutcome) {
      return `What should ${cleanPressureTargetTitle(quotedOutcome[1] ?? target)} accomplish?`
    }
    return prompt
  }

  function pressureQuestionWhy(turn: OwnerInputQuestionTurn): string {
    if (/Workers need to know which outcome defines success before splitting tasks\./i.test(turn.question.why)) {
      return 'A sentence is enough. Mention the outcome or constraint Guildhall should optimize for.'
    }
    return turn.question.why
  }

  function pressureQuestionMeta(turn: OwnerInputQuestionTurn): string {
    const index = activeOwnerInputQuestions.findIndex(candidate => candidate.id === turn.id)
    const count = activeOwnerInputQuestions.length
    const title = cleanPressureTargetTitle(turn.targetTitle)
    if (count > 1 && index >= 0) return `${index + 1} of ${count} · ${title} · ${turn.domainTitle}`
    return `${title} · ${turn.domainTitle}`
  }

  function liveAgentTone(agent: LiveAgent | undefined): 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running' {
    if (
      agent?.lastEventLabel === 'Waiting for the local model to respond.' &&
      (agent.silentMs ?? 0) >= 60_000
    ) {
      return 'warn'
    }
    return agent?.stalled ? 'danger' : 'running'
  }

  function activityElapsed(at: string | undefined): string | null {
    if (!at) return null
    const parsed = Date.parse(at)
    if (!Number.isFinite(parsed)) return null
    return shortElapsed(nowMs - parsed)
  }

  const currentTurns = $derived.by(() => {
    const seenQuestionTasks = new Set<string>()
    let seenOwnerInputQuestion = false
    const hasActiveOwnerInputQuestion = turns.some(
      turn => (turn.kind === 'pressure_test_question' || turn.kind === 'bounded_chat') && turn.status === 'active',
    )
    return turns.filter(turn => {
      if (turn.phase === 'done') return false
      if (
        hasActiveOwnerInputQuestion &&
        turn.kind === 'setup_step' &&
        turn.stepId === 'firstTask'
      ) {
        return false
      }
      if ((turn.kind === 'pressure_test_question' || turn.kind === 'bounded_chat') && turn.status === 'active') {
        if (seenOwnerInputQuestion) return false
        seenOwnerInputQuestion = true
      }
      if (turn.kind === 'agent_question' && turn.status === 'active') {
        if (seenQuestionTasks.has(turn.taskId)) return false
        seenQuestionTasks.add(turn.taskId)
      }
      return true
    })
  })
  const visibleTurns = $derived(currentTurns)
  const visibleList = $derived(threadChains.map(chain => chain.latestTurn))
  const compactListView = $derived(compactThreadMode && compactPane === 'list')
  const compactDetailView = $derived(compactThreadMode && compactPane === 'detail')
  const activeOwnerInputQuestions = $derived(
    turns.filter((turn): turn is OwnerInputQuestionTurn =>
      (turn.kind === 'pressure_test_question' || turn.kind === 'bounded_chat') && turn.status === 'active',
    ),
  )
  const hiddenPressureQuestionCount = $derived(Math.max(0, activeOwnerInputQuestions.length - 1))
  const operationSummary = $derived.by(() => {
    let needsYou = 0
    let working = 0
    let shaping = 0
    let recovery = 0
    let blocked = 0
    let queued = 0
    let drafts = 0
    for (const turn of currentTurns) {
      const owner = ownershipLabel(turn)
      if (owner === 'Needs you' || owner === 'Needs brief') needsYou += 1
      if (owner === 'Guildhall shaping') shaping += 1
      if (owner === 'Needs recovery') recovery += 1
      if (turnLiveAgent(turn)) working += 1
      if (turn.kind === 'escalation') blocked += 1
      if (owner === 'Queued' || owner === 'Queued for Guildhall') queued += 1
      if (turn.kind === 'inflight' && turn.importedDraft) drafts += 1
    }
    return { needsYou, working, shaping, recovery, blocked, queued, drafts }
  })

  function threadChainKey(turn: Turn): string {
    if (turn.kind === 'setup_step') return 'setup'
    if (turn.kind === 'pressure_test_question') return `intake:${turn.intakeId}`
    if (turn.kind === 'bounded_chat') return `bounded-chat:${turn.sessionId}`
    if (turn.kind === 'request') {
      if (turn.taskId) return `task:${turn.taskId}`
      return `intake:${turn.requestId}`
    }
    if ('taskId' in turn) return `task:${turn.taskId}`
    return turn.id
  }

  function threadRouteParamFromHref(href: string): string | null {
    const query = href.split('#')[0]?.split('?')[1] ?? ''
    if (!query) return null
    const value = new URLSearchParams(query).get('thread')?.trim()
    return value || null
  }

  function routeThreadChainId(chains: ThreadChain[]): string | null {
    const param = threadRouteParamFromHref(path.href)
    if (!param) return null
    if (chains.some(chain => chain.id === param)) return param
    const boundedChatId = param.startsWith('bounded-chat:') ? param : `bounded-chat:${param}`
    if (chains.some(chain => chain.id === boundedChatId)) return boundedChatId
    return null
  }

  function hrefForThreadChain(chainId: string): string {
    const basePath = path.value || location.pathname
    const routeId = chainId.startsWith('bounded-chat:') ? chainId.slice('bounded-chat:'.length) : chainId
    const query = new URLSearchParams()
    query.set('thread', routeId)
    return `${basePath}?${query.toString()}`
  }

  function setCapabilityPathDraft(requestId: string, value: string): void {
    capabilityPathDrafts = { ...capabilityPathDrafts, [requestId]: value }
  }

  function setCapabilityFallbackDraft(requestId: string, value: string): void {
    capabilityFallbackDrafts = { ...capabilityFallbackDrafts, [requestId]: value }
  }

  function setCapabilityBlockDraft(requestId: string, value: string): void {
    capabilityBlockDrafts = { ...capabilityBlockDrafts, [requestId]: value }
  }

  const threadChains = $derived.by((): ThreadChain[] => {
    const grouped = new Map<string, Turn[]>()
    for (const turn of turns) {
      const key = threadChainKey(turn)
      const existing = grouped.get(key)
      if (existing) existing.push(turn)
      else grouped.set(key, [turn])
    }
    return Array.from(grouped.entries())
      .map(([id, chainTurns]) => {
        const ordered = [...chainTurns].sort(compareOperationTurns)
        const latestTurn = [...chainTurns].sort(compareArchiveTurns)[0] ?? ordered[ordered.length - 1]!
        const activeTurn = [...ordered].reverse().find(turn => turn.status === 'active') ?? null
        const currentTurn = [...chainTurns]
          .filter(turn => turn.status !== 'done' || turn.phase !== 'done')
          .sort(compareOperationTurns)[0] ?? null
        return { id, turns: ordered, latestTurn, activeTurn, currentTurn }
      })
      .filter(chain => chain.turns.some(turn => turn.phase !== 'done'))
      .sort((left, right) => compareArchiveTurns(left.latestTurn, right.latestTurn))
  })

  $effect(() => {
    if (threadChains.length === 0) {
      selectedTurnId = null
      if (compactThreadMode) compactPane = 'list'
      return
    }
    const routed = routeThreadChainId(threadChains)
    const preferred = activeTurnId
      ? threadChains.find(chain => chain.turns.some(turn => turn.id === activeTurnId))?.id ?? threadChains[0]?.id ?? null
      : threadChains[0]?.id ?? null
    const nextSelection = routed ?? preferred
    if (routed && selectedTurnId !== routed) {
      selectedTurnId = routed
      detailShouldStickToBottom = true
      if (compactThreadMode) compactPane = 'detail'
    } else if (!selectedTurnId || !threadChains.some(chain => chain.id === selectedTurnId)) {
      selectedTurnId = nextSelection
      detailShouldStickToBottom = true
    }
    if (!compactThreadMode) {
      compactPane = 'detail'
    } else if (compactPane === 'detail' && !selectedTurnId) {
      compactPane = 'list'
    }
  })

  $effect(() => {
    const key = detailAutoScrollKey
    if (!detailScrollEl) return
    if (lastAutoScrollKey === key) return
    lastAutoScrollKey = key
    if (!detailShouldStickToBottom) return
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        scrollDetailToBottom('auto')
      })
    })
  })

  $effect(() => {
    const mode = compactThreadMode
      ? compactPane === 'detail' ? 'detail' : 'list'
      : 'split'
    window.dispatchEvent(new CustomEvent('guildhall:set-nav-context', {
      detail: { surface: 'thread', mode },
    }))
    return () => {
      window.dispatchEvent(new CustomEvent('guildhall:set-nav-context', {
        detail: { surface: 'project', mode: 'project' },
      }))
    }
  })
  $effect(() => {
    const handle = () => showThreadListPane()
    window.addEventListener('guildhall:thread-show-list', handle)
    return () => window.removeEventListener('guildhall:thread-show-list', handle)
  })
  function rawQuestionsForTurn(turn: AgentQuestionTurn): AgentQuestionTurn['question'][] {
    return turn.questions && turn.questions.length > 0 ? turn.questions : [turn.question]
  }

  function questionDisplayKey(question: AgentQuestionTurn['question']): string {
    if (question.kind === 'choice' && question.choices?.length) {
      return `choice:${question.selectionMode ?? 'single'}:${question.choices.map(choice => choice.trim().toLowerCase()).join('|')}`
    }
    const prompt = question.restatement ?? question.prompt ?? ''
    return `${question.kind}:${prompt.trim().toLowerCase().replace(/\s+/g, ' ')}`
  }

  function questionsForTurn(turn: AgentQuestionTurn): AgentQuestionTurn['question'][] {
    if (turn.status !== 'active') return rawQuestionsForTurn(turn)
    const seen = new Set<string>()
    const out: AgentQuestionTurn['question'][] = []
    for (const candidate of turns) {
      if (candidate.kind !== 'agent_question' || candidate.status !== 'active' || candidate.taskId !== turn.taskId) continue
      for (const question of rawQuestionsForTurn(candidate)) {
        const key = questionDisplayKey(question)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(question)
      }
    }
    return out.length > 0 ? out : rawQuestionsForTurn(turn)
  }

  function openQuestionCountForTask(taskId: string): number {
    return turns.filter(
      t => t.kind === 'agent_question' && t.taskId === taskId && t.status === 'active',
    ).length
  }

  function revealQuestionsForTask(taskId: string): void {
    const first = turns.find(
      t => t.kind === 'agent_question' && t.taskId === taskId && t.status === 'active',
    )
    if (!first) return
    selectedTurnId = threadChainKey(first)
    if (compactThreadMode) compactPane = 'detail'
  }

  function hasPendingSetupStep(stepId: string): boolean {
    return turns.some(
      (turn) => turn.kind === 'setup_step' && turn.stepId === stepId && turn.status !== 'done',
    )
  }

  function focusSetupPhase(): void {
    const firstSetup = turns.find((turn) => turn.kind === 'setup_step' && turn.status === 'active')
    if (!firstSetup) return
    selectedTurnId = threadChainKey(firstSetup)
    if (compactThreadMode) compactPane = 'detail'
  }

  function revealImportedDrafts(): void {
    const first = turns.find(
      t => t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring'),
    )
    if (!first) return
    selectedTurnId = threadChainKey(first)
    if (compactThreadMode) compactPane = 'detail'
  }

  function operationPriority(t: Turn): number {
    const owner = ownershipLabel(t)
    if (owner === 'Needs you' || owner === 'Needs recovery' || owner === 'Needs brief') return 0
    if (turnLiveAgent(t)) return 1
    if (owner === 'Guildhall shaping') return 2
    if (t.kind === 'escalation' || t.phase === 'blocked') return 3
    if (owner === 'Queued' || owner === 'Queued for Guildhall') return 4
    if (t.kind === 'inflight' && t.importedDraft) return 4
    if (t.status === 'active') return 5
    if (t.status === 'pending') return 6
    return 7
  }

  function compareOperationTurns(left: Turn, right: Turn): number {
    const priority = operationPriority(left) - operationPriority(right)
    if (priority !== 0) return priority
    return (right.at ?? '').localeCompare(left.at ?? '')
  }

  function compareArchiveTurns(left: Turn, right: Turn): number {
    return (right.at ?? '').localeCompare(left.at ?? '')
  }

  function badgeCountLabel(count: number): string {
    return count > 99 ? '99+' : String(Math.max(0, count))
  }

  function formatArchiveTime(at: string | undefined): string | null {
    if (!at) return null
    const parsed = Date.parse(at)
    if (!Number.isFinite(parsed)) return null
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed)
  }

  function isStarterRoutingDraft(
    draftCoordinators: SpecReviewTurn['draftCoordinators'] | undefined,
  ): boolean {
    if (!draftCoordinators?.length) return false
    const domains = new Set(draftCoordinators.map(d => d.domain))
    return domains.has('_meta') && domains.has('project-implementation')
  }

  $effect(() => {
    if (!importHandoff || importHandoffFocused || !loaded || turns.length === 0) return
    importHandoffFocused = true
    revealImportedDrafts()
  })

  // ---- Brief approve / reply ---------------------------------------------
  async function approveBrief(turn: BriefTurn): Promise<void> {
    busyTurnId = turn.id
    try {
      await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/approve-brief`, { method: 'POST' })
      await load()
      await refreshProject()
      await load()
    } finally { busyTurnId = null }
  }

  async function approveSpec(turn: SpecReviewTurn): Promise<void> {
    busyTurnId = turn.id
    try {
      const endpoint = turn.taskId === 'task-meta-intake'
        ? '/api/project/meta-intake/approve'
        : turn.taskId === 'task-workspace-import'
          ? '/api/project/workspace-import/approve'
        : `/api/project/task/${encodeURIComponent(turn.taskId)}/approve-spec`
      await scopedProjectFetch(endpoint, { method: 'POST' })
      await load()
    } finally { busyTurnId = null }
  }

  function setReplyDraft(turnId: string, value: string): void {
    replyDrafts = { ...replyDrafts, [turnId]: value }
    if (replyErrors[turnId]) {
      const next = { ...replyErrors }
      delete next[turnId]
      replyErrors = next
    }
  }

  async function sendTaskReply(turn: TaskReplyTurn): Promise<void> {
    const message = (replyDrafts[turn.id] ?? '').trim()
    if (!message) return
    busyTurnId = turn.id
    try {
      const r = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          ...(turn.kind === 'inflight' || turn.kind === 'escalation' ? { preserveStatus: true } : {}),
        }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || j.error) {
        replyErrors = { ...replyErrors, [turn.id]: j.error ?? `HTTP ${r.status}` }
        return
      }
      const next = { ...replyDrafts }
      delete next[turn.id]
      replyDrafts = next
      replyTurnId = null
      sentReplies = { ...sentReplies, [turn.id]: true }
      await load()
    } finally {
      busyTurnId = null
    }
  }

  function setBriefFixDraft(
    turnId: string,
    field: 'successTarget' | 'acceptanceCriterion',
    value: string,
  ): void {
    const draft = briefFixDrafts[turnId] ?? { successTarget: '', acceptanceCriterion: '' }
    briefFixDrafts = { ...briefFixDrafts, [turnId]: { ...draft, [field]: value } }
    if (briefFixErrors[turnId]) {
      const next = { ...briefFixErrors }
      delete next[turnId]
      briefFixErrors = next
    }
  }

  function missingChecklistTitles(turn: InFlightTurn): string {
    const titles = (turn.checklist?.steps ?? [])
      .filter(step => step.status !== 'done' && step.status !== 'skipped')
      .map(step => step.title.toLowerCase())
    if (titles.length === 0) return 'the missing brief fields'
    if (titles.length === 1) return titles[0] ?? 'the missing brief field'
    return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`
  }

  function missingChecklistSteps(turn: InFlightTurn): NonNullable<InFlightTurn['checklist']>['steps'] {
    return (turn.checklist?.steps ?? [])
      .filter(step => step.status !== 'done' && step.status !== 'skipped')
  }

  function missingBriefFieldKind(turn: InFlightTurn): 'success' | 'acceptance' | 'both' | 'unknown' {
    const missing = missingChecklistSteps(turn)
    const hasSuccess = missing.some(step => /success|done|outcome|target/i.test(`${step.id} ${step.title}`))
    const hasAcceptance = missing.some(step => /acceptance|criteria|check|verify/i.test(`${step.id} ${step.title}`))
    if (hasSuccess && hasAcceptance) return 'both'
    if (hasSuccess) return 'success'
    if (hasAcceptance) return 'acceptance'
    return 'unknown'
  }

  function briefFixTitle(turn: InFlightTurn): string {
    switch (missingBriefFieldKind(turn)) {
      case 'success': return 'Brief cleanup needed'
      case 'acceptance': return 'Brief cleanup needed'
      case 'both': return 'Brief cleanup needed'
      default: return 'Brief cleanup needed'
    }
  }

  function briefFixDescription(turn: InFlightTurn): string {
    if (missingChecklistSteps(turn).length === 0 && needsWorkerHandoffSpecCleanup(turn)) {
      return 'The starter checklist is complete, but Guildhall still needs a full product brief and spec handoff before a worker can start.'
    }
    switch (missingBriefFieldKind(turn)) {
      case 'success':
        return 'Guildhall needs to turn the source notes into a success target before implementation.'
      case 'acceptance':
        return 'Guildhall needs to turn the source notes into concrete acceptance checks before implementation.'
      case 'both':
        return 'Guildhall needs to turn the source notes into an outcome and acceptance checks before implementation.'
      default:
        return `Guildhall needs to turn ${missingChecklistTitles(turn)} into a usable task brief before implementation.`
    }
  }

  function briefFixButtonLabel(turn: InFlightTurn): string {
    switch (missingBriefFieldKind(turn)) {
      case 'success': return 'Clean up brief'
      case 'acceptance': return 'Clean up brief'
      default: return 'Clean up brief'
    }
  }

  function showBriefSuccessField(turn: InFlightTurn): boolean {
    const kind = missingBriefFieldKind(turn)
    return kind === 'success' || kind === 'both' || kind === 'unknown'
  }

  function showBriefAcceptanceField(turn: InFlightTurn): boolean {
    const kind = missingBriefFieldKind(turn)
    return kind === 'acceptance' || kind === 'both' || kind === 'unknown'
  }

  function canSaveBriefFix(turn: InFlightTurn): boolean {
    const draft = briefFixDrafts[turn.id] ?? { successTarget: '', acceptanceCriterion: '' }
    const needsSuccess = showBriefSuccessField(turn)
    const needsAcceptance = showBriefAcceptanceField(turn)
    return (!needsSuccess || draft.successTarget.trim().length > 0) &&
      (!needsAcceptance || draft.acceptanceCriterion.trim().length > 0)
  }

  async function saveBriefFix(turn: InFlightTurn): Promise<void> {
    const draft = briefFixDrafts[turn.id] ?? { successTarget: '', acceptanceCriterion: '' }
    const successTarget = draft.successTarget.trim()
    const acceptanceCriterion = draft.acceptanceCriterion.trim()
    if (!successTarget && !acceptanceCriterion) return
    busyTurnId = turn.id
    try {
      const res = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/update-brief`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ successTarget, acceptanceCriterion }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) {
        briefFixErrors = { ...briefFixErrors, [turn.id]: body.error ?? `HTTP ${res.status}` }
        return
      }
      const nextDrafts = { ...briefFixDrafts }
      delete nextDrafts[turn.id]
      briefFixDrafts = nextDrafts
      briefFixTurnId = null
      await load()
      await refreshProject()
    } finally {
      busyTurnId = null
    }
  }

  function setContextDraft(turnId: string, value: string): void {
    contextDrafts = { ...contextDrafts, [turnId]: value }
    if (contextErrors[turnId]) {
      const next = { ...contextErrors }
      delete next[turnId]
      contextErrors = next
    }
  }

  async function askQuestionContext(turn: AgentQuestionTurn): Promise<void> {
    const message = (contextDrafts[turn.id] ?? '').trim()
    if (!message) return
    busyTurnId = turn.id
    try {
      const r = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preserveStatus: true,
          message: `Before I answer the open question, explain the missing context and evidence. User said: ${message}`,
        }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || j.error) {
        contextErrors = { ...contextErrors, [turn.id]: j.error ?? `HTTP ${r.status}` }
        return
      }
      const next = { ...contextDrafts }
      delete next[turn.id]
      contextDrafts = next
      contextTurnId = null
      await load()
    } finally {
      busyTurnId = null
    }
  }

  async function synthesizeMetaIntake(turn: InFlightTurn): Promise<void> {
    busyTurnId = turn.id
    replyErrors[turn.id] = ''
    try {
      const r = await scopedProjectFetch('/api/project/meta-intake/synthesize', { method: 'POST' })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${r.status}`)
      }
      await load()
    } catch (err) {
      replyErrors[turn.id] = err instanceof Error ? err.message : String(err)
    } finally {
      busyTurnId = null
    }
  }

  function setupValue(id: string): string {
    return setupValues[id] ?? ''
  }

  function setSetupValue(id: string, value: string): void {
    setupValues = { ...setupValues, [id]: value }
    if (setupErrors[id]) {
      const next = { ...setupErrors }
      delete next[id]
      setupErrors = next
    }
  }

  function setupBody(turn: SetupStepTurn): Record<string, unknown> | null {
    const value = setupValue(turn.id).trim()
    switch (turn.stepId) {
      case 'identity':
        if (!value) return null
        return { name: value }
      case 'direction':
        if (!value) return null
        return { content: value }
      case 'firstTask':
        if (!value) return null
        return { ask: value }
      case 'coordinator':
        if (!value) return null
        return { archetypes: [value] }
      default:
        return {}
    }
  }

  function bootstrapOutputLine(output: string): string | null {
    const lines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line =>
        line.length > 0 &&
        !line.startsWith('>') &&
        !line.startsWith('Scope:') &&
        !line.startsWith(' ERR_PNPM_') &&
        !line.startsWith(' ELIFECYCLE'),
      )
    return lines.find(line => /\berror\b|failed|Cannot find module|command not found|spawn ENOENT/i.test(line)) ?? lines[0] ?? null
  }

  function setupSuccessMessage(turn: SetupStepTurn): string {
    switch (turn.stepId) {
      case 'bootstrap':
        return 'Checks passed.'
      case 'direction':
        return 'Project direction saved.'
      case 'firstTask':
        return 'Spec shaping started.'
      case 'identity':
        return 'Project identity saved.'
      case 'coordinator':
      case 'routing':
        return 'Repo inspection started.'
      case 'projectCheckIn':
        return 'Project check-in started.'
      default:
        return `${turn.actionLabel} complete.`
    }
  }

  function setupFailureMessage(turn: SetupStepTurn, body: Record<string, unknown>): string {
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
    if (turn.stepId === 'bootstrap') {
      const status = body.status
      if (status && typeof status === 'object' && Array.isArray((status as { steps?: unknown[] }).steps)) {
        const failed = (status as { steps: Array<{ result?: string; command?: string; exitCode?: number; output?: string }> }).steps
          .find(step => step.result === 'fail')
        if (failed) {
          const detail = failed.output ? bootstrapOutputLine(failed.output) : null
          return detail
            ? `${failed.command ?? 'Bootstrap'} exited ${failed.exitCode ?? '?'}: ${detail}`
            : `${failed.command ?? 'Bootstrap'} exited ${failed.exitCode ?? '?'}.`
        }
      }
      return 'Checks failed.'
    }
    return 'That action failed.'
  }

  async function submitSetup(turn: SetupStepTurn): Promise<void> {
    if (!turn.submitEndpoint) return
    const body = setupBody(turn)
    if (body === null) {
      setupErrors = { ...setupErrors, [turn.id]: 'Required' }
      return
    }
    busyTurnId = turn.id
    try {
      const r = await scopedProjectFetch(turn.submitEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({})) as Record<string, unknown>
      const logicalFailure =
        turn.stepId === 'bootstrap'
          ? j.success === false
          : false
      if (!r.ok || typeof j.error === 'string' || logicalFailure) {
        const message = setupFailureMessage(turn, j)
        setupErrors = { ...setupErrors, [turn.id]: message || `HTTP ${r.status}` }
        toast.error(message || `HTTP ${r.status}`)
        return
      }
      if (turn.stepId === 'firstTask') {
        setupValues = { ...setupValues, [turn.id]: '' }
      }
      await load()
      const nextErrors = { ...setupErrors }
      delete nextErrors[turn.id]
      setupErrors = nextErrors
      toast.success(setupSuccessMessage(turn))
    } finally {
      busyTurnId = null
    }
  }

  async function answerQuestion(turn: AgentQuestionTurn, answer: string): Promise<void> {
    const trimmed = answer.trim()
    if (!trimmed) return
    const answersByQuestion = new Map<string, string>()
    for (const t of turns) {
      if (t.kind !== 'agent_question' || t.status !== 'active' || t.taskId !== turn.taskId) continue
      for (const question of questionsForTurn(t)) {
        const draft = staged[question.id]?.trim()
        if (draft) answersByQuestion.set(question.id, draft)
      }
    }
    answersByQuestion.set(turn.question.id, trimmed)
    const answers = [...answersByQuestion.entries()].map(([questionId, savedAnswer]) => ({
      questionId,
      answer: savedAnswer,
    }))
    busyTaskId = turn.taskId
    try {
      const r = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/answer-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const body = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || body.error) {
        const message = body.error ?? `HTTP ${r.status}`
        replyErrors = { ...replyErrors, [turn.id]: message }
        toast.error(message)
        return
      }
      const next = { ...staged }
      for (const a of answers) delete next[a.questionId]
      staged = next
      const nextErrors = { ...replyErrors }
      delete nextErrors[turn.id]
      replyErrors = nextErrors
      toast.success(answers.length === 1 ? 'Answer saved.' : 'Answers saved.')
      await load()
    } finally {
      busyTaskId = null
    }
  }

  async function clearStagedQuestion(turn: AgentQuestionTurn): Promise<void> {
    await persistDraftAnswer(turn.taskId, turn.question.id, '')
    unstageAnswer(turn.question.id)
  }

  function taskStateLabel(turn: InFlightTurn): string {
    const live = turnLiveAgent(turn)
    if (turn.status === 'done' || turn.taskStatus === 'done') return 'Done'
    if (needsRecovery(turn)) return 'Needs recovery'
    if (turn.requestKind === 'project_question') return 'Project question'
    if (live?.name === 'spec-agent') return turn.importedDraft ? 'Shaping draft' : 'Drafting'
    if (turn.taskId === 'task-meta-intake' && !live) return 'Project setup'
    if (live?.name.startsWith('coordinator-')) return 'Ready'
    if (live?.name === 'worker-agent') return 'In flight'
    if (live?.name === 'reviewer-agent') return 'Review'
    if (live?.name === 'gate-checker-agent') return 'Gates'
    switch (turn.taskStatus) {
      case 'import_draft': return 'Needs task brief'
      case 'exploring':
        if (turn.requestStage === 'task_brief_cleanup') return 'Brief cleanup'
        return turn.importedDraft ? 'Task brief in progress' : isQueuedSpecRevision(turn) ? 'Spec revision queued' : 'Intake'
      case 'ready':
        if (needsWorkerHandoffSpecCleanup(turn)) return 'Needs task brief'
        if (runStatus === 'running' || runStatus === 'stopping') return 'Queued for Guildhall'
        return 'Ready'
      case 'gate_check': return 'Gates'
      case 'review': return 'Review'
      case 'in_progress': return live ? 'In flight' : 'Paused'
      default: return canStartTaskTurn(turn) ? 'Queued' : 'In flight'
    }
  }

  function taskStateDescription(turn: InFlightTurn): string {
    const live = turnLiveAgent(turn)
    if (needsRecovery(turn)) {
      return 'Guildhall made partial progress, then the agent failed. Review the durable worktree changes or restart from that recovery point.'
    }
    if (
      live?.lastEventLabel === 'Waiting for the local model to respond.' &&
      (live.silentMs ?? 0) >= 60_000
    ) {
      return 'Local model is still loading or generating.'
    }
    if (live?.name === 'spec-agent') {
      if (turn.requestKind === 'project_question') {
        return 'Guildhall is inspecting the project to answer this question now.'
      }
      if (turn.requestStage === 'task_brief_cleanup') {
        return 'Guildhall is cleaning up this task brief now.'
      }
      if (turn.importedDraft) {
        return 'Guildhall is turning this imported note into a task brief now.'
      }
      return turn.taskId === 'task-workspace-import'
        ? 'Guildhall is turning your existing project notes into candidate tasks now.'
        : 'Guildhall is drafting this now.'
    }
    if (turn.taskStatus === 'ready' && !live) {
      if (needsWorkerHandoffSpecCleanup(turn)) {
        return briefFixDescription(turn)
      }
      return runStatus === 'running'
        ? 'Approved and queued. Guildhall is running and can pick this up.'
        : 'Approved and queued. Start Guildhall when you want it to pick this up.'
    }
    if (turn.taskId === 'task-meta-intake' && !live) {
      return turn.summary
    }
    if (turn.taskStatus === 'import_draft' && !live) {
      return 'Imported from your project notes, but not ready for a worker yet. Next step: turn this note into a task brief with scope, evidence, and acceptance criteria.'
    }
    if (turn.taskStatus === 'exploring' && !live) {
      if (turn.requestKind === 'project_question') {
        return 'Queued as a project question. Guildhall can inspect files and summarize the answer without turning this into implementation work.'
      }
      if (turn.requestStage === 'task_brief_cleanup') {
        return 'Guildhall queued this task for brief cleanup. The checklist shows what still needs to be clarified before implementation.'
      }
      return turn.taskId === 'task-workspace-import'
        ? 'Guildhall already drafted part of this import review. Review it if you want, or press Start to let Guildhall keep turning your project notes into candidate tasks.'
        : turn.importedDraft
          ? 'Guildhall is shaping the task brief for this imported note. You can add context, but you do not need to babysit the draft.'
          : isQueuedSpecRevision(turn)
            ? 'Guildhall already has the draft spec plus your latest answers. Press Start when you want Guildhall to revise it.'
            : 'Guildhall has started shaping this task, but the brief is not ready yet. The checklist shows what is still missing.'
    }
    if (turn.taskStatus === 'in_progress' && !live) {
      return runStatus === 'running'
        ? 'Work is paused between worker passes. Guildhall is running and can resume it.'
        : 'Work is paused. Start Guildhall when you want it to continue.'
    }
    if (turn.taskStatus === 'review' && !live) {
      return runStatus === 'running'
        ? 'Review is queued. Guildhall is running and can pick this up.'
        : 'Review is queued. Start Guildhall when you want it to continue.'
    }
    if (turn.taskStatus === 'gate_check' && !live) {
      return runStatus === 'running'
        ? 'Gate checks are queued. Guildhall is running and can pick this up.'
        : 'Gate checks are queued. Start Guildhall when you want it to continue.'
    }
    return turn.summary
  }

  function behindTheScenesNote(turn: InFlightTurn): string | null {
    if (turn.taskId === 'task-meta-intake' && turn.checklist) {
      return 'Guildhall is splitting the project into starter lanes before worker tasks begin.'
    }
    if (turn.importedDraft && (turn.taskStatus === 'import_draft' || turn.taskStatus === 'exploring')) {
      return 'Guildhall is reorienting this imported note into a runnable task brief.'
    }
    if (needsWorkerHandoffSpecCleanup(turn)) {
      return 'Guildhall is completing the handoff brief before it lets a worker start.'
    }
    if (turn.requestKind === 'project_question') {
      return 'Guildhall is treating this as a project question, not implementation work.'
    }
    return null
  }

  function taskBriefNeedsCleanup(turn: InFlightTurn): boolean {
    return (
      needsWorkerHandoffSpecCleanup(turn) ||
      (
        hasIncompleteTaskChecklist(turn) &&
        (
          turn.importedDraft ||
          turn.taskStatus === 'import_draft' ||
          turn.taskStatus === 'exploring'
        )
      )
    )
  }

  function checklistTitleForTurn(turn: InFlightTurn): string {
    return taskBriefNeedsCleanup(turn) ? 'Brief checklist' : turn.checklist?.title ?? 'Checklist'
  }

  function checklistToneForTurn(turn: InFlightTurn): 'warn' | 'neutral' {
    return taskBriefNeedsCleanup(turn) ? 'warn' : 'neutral'
  }

  function gitStoryVisible(turn: Turn): boolean {
    if (!('gitStory' in turn) || !turn.gitStory?.state) return false
    if (turn.kind === 'inflight' && taskBriefNeedsCleanup(turn)) return false
    const state = normalizedGitStoryState(turn.gitStory)
    return state !== 'clean' && state !== 'merged' && state !== 'unknown'
  }

  function normalizedGitStoryState(story: GitStorySnapshot): string {
    return String(story.state ?? '').trim().toLowerCase()
  }

  function gitStoryLabel(story: GitStorySnapshot): string {
    switch (normalizedGitStoryState(story)) {
      case 'dirty_uncommitted': return 'Dirty tree'
      case 'committed_local': return 'Local commits'
      case 'no_upstream': return 'No upstream'
      case 'pushed': return 'Pushed'
      case 'pr_open': return 'PR open'
      case 'local_only': return 'Local only'
      case 'deferred': return 'Deferred'
      case 'conflict': return 'Conflict'
      case 'unknown': return 'Unknown'
      default: return 'Git story'
    }
  }

  function gitStoryTone(story: GitStorySnapshot): 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' {
    switch (normalizedGitStoryState(story)) {
      case 'local_only':
      case 'deferred':
      case 'pushed':
      case 'pr_open':
        return 'neutral'
      case 'conflict':
      case 'unknown':
        return 'danger'
      default:
        return 'warn'
    }
  }

  function gitStorySummary(story: GitStorySnapshot): string {
    return story.reason ?? story.nextAction ?? 'Git story needs closure.'
  }

  function metaIntakeChecklistComplete(turn: InFlightTurn): boolean {
    return Boolean(
      turn.taskId === 'task-meta-intake' &&
      turn.taskStatus === 'exploring' &&
      turn.checklist &&
      turn.checklist.totalSteps > 0 &&
      turn.checklist.doneCount >= turn.checklist.totalSteps,
    )
  }

  function canStartTaskTurn(turn: InFlightTurn): boolean {
    if (projectRunBlocksTaskStart(turn)) return false
    return !turnLiveAgent(turn) && (
      turn.taskStatus === 'ready' ||
      turn.taskStatus === 'import_draft' ||
      turn.taskStatus === 'exploring' ||
      turn.taskStatus === 'in_progress' ||
      turn.taskStatus === 'review' ||
      turn.taskStatus === 'gate_check'
    )
  }

  function projectRunBlocksTaskStart(turn: InFlightTurn): boolean {
    if (turnLiveAgent(turn)) return false
    if (turn.taskStatus === 'import_draft') return false
    if (runStatus !== 'running' && runStatus !== 'stopping') return false
    return (
      turn.taskStatus === 'ready' ||
      turn.taskStatus === 'exploring' ||
      turn.taskStatus === 'in_progress' ||
      turn.taskStatus === 'review' ||
      turn.taskStatus === 'gate_check'
    )
  }

  function startTaskLabel(turn: InFlightTurn): string {
    if (turn.requestKind === 'project_question') return 'Answer question'
    if (metaIntakeChecklistComplete(turn)) return 'Create split proposal'
    switch (turn.taskStatus) {
      case 'ready':
        if (needsWorkerHandoffSpecCleanup(turn)) return briefFixButtonLabel(turn)
        if (runStatus === 'running' || runStatus === 'stopping') return 'Already queued'
        return 'Start work'
      case 'import_draft': return 'Draft task brief'
      case 'exploring':
        if (turn.taskId === 'task-meta-intake') return 'Let Guildhall keep setting this up'
        if (turn.requestStage === 'task_brief_cleanup') return 'Clean up brief'
        if (turn.importedDraft || hasIncompleteTaskChecklist(turn)) return 'Continue shaping brief'
        return isQueuedSpecRevision(turn) ? 'Revise spec' : 'Continue drafting spec'
      case 'review': return 'Resume review'
      case 'gate_check': return 'Resume gates'
      case 'in_progress': return 'Resume work'
      default: return 'Continue'
    }
  }

  function metaSetupActionLabel(): string {
    switch (startReadiness?.code) {
      case 'no_provider':
        return 'Connect provider...'
      case 'no_loaded_model':
      case 'model_unavailable':
        return 'Load model...'
      default:
        return 'Fix setup...'
    }
  }

  function taskStateTone(turn: InFlightTurn): 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running' {
    if (needsRecovery(turn)) return 'warn'
    if (turnLiveAgent(turn)) return 'running'
    if (needsWorkerHandoffSpecCleanup(turn)) return 'warn'
    switch (turn.taskStatus) {
      case 'ready': return 'ok'
      case 'import_draft': return 'warn'
      case 'gate_check': return 'ok'
      case 'review': return 'ok'
      case 'exploring': return 'accent'
      case 'in_progress': return 'neutral'
      default: return 'neutral'
    }
  }

  function checklistStepTone(
    turn: InFlightTurn,
    step: { status: 'done' | 'active' | 'pending' | 'skipped' },
  ): 'ok' | 'running' | 'idle' {
    if (step.status === 'done') return 'ok'
    if (step.status === 'active') return turnLiveAgent(turn) ? 'running' : 'idle'
    return 'idle'
  }

  function checklistStepLabel(
    turn: InFlightTurn,
    step: { status: 'done' | 'active' | 'pending' | 'skipped' },
  ): string {
    if (step.status === 'done') return 'Done'
    if (step.status === 'active') {
      if (turnLiveAgent(turn)) return 'Now'
      return 'Missing'
    }
    if (step.status === 'skipped') return 'Skipped'
    return 'Missing'
  }

  async function startTaskRun(target?: string | InFlightTurn): Promise<void> {
    const taskId = typeof target === 'string' ? target : target?.taskId
    const turn = typeof target === 'object'
      ? target
      : turns.find((candidate): candidate is InFlightTurn =>
        candidate.kind === 'inflight' && candidate.taskId === taskId,
      )
    const cleanupTurn = turn && needsWorkerHandoffSpecCleanup(turn) ? turn : null
    runBusy = true
    runError = null
    if (cleanupTurn) busyTurnId = cleanupTurn.id
    try {
      if (cleanupTurn) {
        const continueRes = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(cleanupTurn.taskId)}/continue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'brief_cleanup',
            mode: 'checklist',
            instruction:
              'Complete this task for worker handoff: preserve the useful starting point, write a full product brief and spec handoff, and add concrete acceptance criteria before implementation.',
          }),
        })
        const continueBody = await continueRes.json().catch(() => ({})) as {
          error?: string
          continuation?: { status?: string }
        }
        if (!continueRes.ok || continueBody.error) {
          runError = continueBody.error ?? `Brief cleanup failed (HTTP ${continueRes.status})`
          return
        }
        if (continueBody.continuation?.status === 'queued') {
          toast.info('Brief cleanup is queued for Guildhall.')
        }
        await load()
        await refreshProject()
        return
      }
      const res = await scopedProjectFetch('/api/project/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'continuous',
          ...(taskId ? { taskId } : {}),
        }),
      })
      const body = await res.json().catch(() => ({})) as { code?: string; error?: string }
      if (!res.ok || body.error) {
        if (body.code === 'run_already_active') {
          toast.info('Guildhall is already running. This task stays queued for the coordinator.')
          await load()
          await refreshProject()
          return
        }
        runError = body.error ?? `Start failed (HTTP ${res.status})`
        return
      }
      await load()
      await refreshProject()
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err)
    } finally {
      runBusy = false
      if (cleanupTurn) busyTurnId = null
    }
  }

  async function shapeDraft(turn: InFlightTurn): Promise<void> {
    busyTurnId = turn.id
    try {
      const res = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/shape-draft`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) {
        replyErrors = { ...replyErrors, [turn.id]: body.error ?? `HTTP ${res.status}` }
        return
      }
      await load()
      await refreshProject()
    } finally {
      busyTurnId = null
    }
  }

  async function markTaskDone(turn: InFlightTurn): Promise<void> {
    if (!window.confirm(`Mark "${turn.taskTitle}" done?`)) return
    busyTurnId = turn.id
    try {
      const res = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/mark-done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evidence: 'Confirmed from Thread by the user.',
        }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) {
        replyErrors = { ...replyErrors, [turn.id]: body.error ?? `HTTP ${res.status}` }
        toast.error(body.error ?? `HTTP ${res.status}`)
        return
      }
      toast.success('Task marked done.')
      await load()
      await refreshProject()
    } finally {
      busyTurnId = null
    }
  }

  async function resolveEscalationAndResume(turn: EscalationTurn): Promise<void> {
    const action = escalationPrimaryAction({
      reason: turn.escalationReason,
      agentId: turn.escalationAgentId,
      summary: turn.summary,
      details: turn.details,
    })
    busyTurnId = turn.id
    runError = null
    try {
      const res = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/resolve-escalation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          escalationId: turn.escalationId,
          resolution: action.resolution,
          nextStatus: action.nextStatus,
        }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) {
        replyErrors = { ...replyErrors, [turn.id]: body.error ?? `HTTP ${res.status}` }
        toast.error(body.error ?? `HTTP ${res.status}`)
        return
      }
      toast.success('Guildhall can continue this task.')
      await load()
      await refreshProject()
      await startTaskRun(turn.taskId)
    } finally {
      busyTurnId = null
    }
  }

  function isActionableEscalation(turn: EscalationTurn): boolean {
    return turn.status !== 'done' && turn.phase === 'blocked'
  }

  function escalationRecordForTurn(turn: EscalationTurn): Escalation {
    return {
      id: turn.escalationId,
      reason: turn.escalationReason,
      summary: turn.summary,
      details: turn.details,
      agentId: turn.escalationAgentId,
    }
  }

  const escalationModalRecord = $derived(
    escalationModal ? escalationRecordForTurn(escalationModal.turn) : null,
  )

  function openEscalationResolution(turn: EscalationTurn, mode: 'retry' | 'resolve'): void {
    escalationModal = { turn, mode }
  }

  async function submitEscalationResolution(args: { resolution: string; nextStatus: string }): Promise<void> {
    const current = escalationModal
    if (!current) return
    busyTurnId = current.turn.id
    try {
      const res = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(current.turn.taskId)}/resolve-escalation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          escalationId: current.turn.escalationId,
          resolution: args.resolution,
          nextStatus: args.nextStatus,
        }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) {
        replyErrors = { ...replyErrors, [current.turn.id]: body.error ?? `HTTP ${res.status}` }
        toast.error(body.error ?? `HTTP ${res.status}`)
        return
      }
      escalationModal = null
      toast.success(current.mode === 'retry' ? 'Recovery action saved.' : 'Blocker marked resolved.')
      await load()
      await refreshProject()
    } finally {
      busyTurnId = null
    }
  }

  function setPressureTestAnswer(turnId: string, value: string): void {
    pressureTestAnswers = { ...pressureTestAnswers, [turnId]: value }
    if (pressureTestErrors[turnId]) {
      const next = { ...pressureTestErrors }
      delete next[turnId]
      pressureTestErrors = next
    }
  }

  async function answerPressureTestQuestion(turn: OwnerInputQuestionTurn, answerOverride?: string): Promise<void> {
    const answer = (answerOverride ?? pressureTestAnswers[turn.id] ?? '').trim()
    if (!answer) return
    busyTurnId = turn.id
    try {
      const r = await scopedProjectFetch(turn.answerEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionId: turn.question.id,
          answer,
        }),
      })
      const body = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || body.error) {
        pressureTestErrors = { ...pressureTestErrors, [turn.id]: body.error ?? `HTTP ${r.status}` }
        return
      }
      const nextAnswers = { ...pressureTestAnswers }
      delete nextAnswers[turn.id]
      pressureTestAnswers = nextAnswers
      const nextErrors = { ...pressureTestErrors }
      delete nextErrors[turn.id]
      pressureTestErrors = nextErrors
      await load()
      await refreshProject()
    } finally {
      busyTurnId = null
    }
  }

  // Group co-active agent_question turns by taskId so each card can still show
  // the full number of active questions in its section.
  interface QuestionSection {
    taskId: string
    turnIds: string[]
    askedQuestionIds: string[]
  }
  const sectionByTask = $derived.by((): Record<string, QuestionSection> => {
    const out: Record<string, QuestionSection> = {}
    for (const t of turns) {
      if (t.kind !== 'agent_question' || t.status !== 'active') continue
      const slot = out[t.taskId] ?? { taskId: t.taskId, turnIds: [], askedQuestionIds: [] }
      slot.turnIds.push(t.id)
      for (const question of questionsForTurn(t)) {
        slot.askedQuestionIds.push(question.id)
      }
      out[t.taskId] = slot
    }
    return out
  })

  function totalCountForTask(taskId: string): number {
    return sectionByTask[taskId]?.askedQuestionIds.length ?? 0
  }

  function draftCountForTask(taskId: string): number {
    const sec = sectionByTask[taskId]
    if (!sec) return 0
    return sec.askedQuestionIds.filter(questionId => typeof staged[questionId] === 'string' && staged[questionId].trim().length > 0).length
  }

  function visibleQuestionsForCard(questions: AgentQuestionTurn['question'][]): AgentQuestionTurn['question'][] {
    const firstUnanswered = questions.find(question => !(staged[question.id] ?? '').trim())
    return questions.filter(question => (staged[question.id] ?? '').trim() || question.id === firstUnanswered?.id)
  }

  function hiddenQuestionCountForCard(questions: AgentQuestionTurn['question'][]): number {
    return questions.length - visibleQuestionsForCard(questions).length
  }

  function compactRelativeTime(at: string | undefined): string | null {
    if (!at) return null
    const parsed = Date.parse(at)
    if (!Number.isFinite(parsed)) return null
    const diffMs = Math.max(0, nowMs - parsed)
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 60) return `${Math.max(1, minutes)}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  }

  function turnRelativeTime(turn: Turn): string | null {
    if (turn.kind === 'setup_step') {
      const parsed = Date.parse(turn.at)
      if (Number.isFinite(parsed) && parsed < Date.parse('2020-01-01T00:00:00.000Z')) {
        return null
      }
    }
    return compactRelativeTime(turn.at)
  }

  function setupStepTitle(turn: SetupStepTurn): string {
    if (turn.stepId === 'firstTask') return 'Shape the first spec'
    return turn.title
  }

  function setupStepWhy(turn: SetupStepTurn): string {
    if (turn.stepId === 'firstTask') {
      return 'Turn a rough idea into a product brief, focused questions, and the first buildable spec before implementation work starts.'
    }
    return turn.why
  }

  function turnIndexTitle(turn: Turn): string {
    if (turn.kind === 'setup_step') return setupStepTitle(turn)
    if (turn.kind === 'request') return turn.title
    if (turn.kind === 'pressure_test_question') return turn.targetTitle
    if (turn.kind === 'bounded_chat') return turn.targetTitle
    if ('taskTitle' in turn) return displayTaskTitle(turn)
    return 'Thread'
  }

  function turnIndexSummary(turn: Turn): string {
    if (turn.kind === 'setup_step') return setupStepWhy(turn)
    if (turn.kind === 'request') return turn.routingSummary
    if (turn.kind === 'pressure_test_question') return pressureQuestionWhy(turn)
    if (turn.kind === 'bounded_chat') return pressureQuestionWhy(turn)
    if (turn.kind === 'history_note') return turn.summary
    if (turn.kind === 'agent_question') {
      const question = visibleQuestionsForCard(questionsForTurn(turn))[0]
      return question?.restatement ?? question?.prompt ?? 'Guildhall needs an answer.'
    }
    if (turn.kind === 'brief_approval') return 'Review the drafted brief and either approve it or send corrections.'
    if (turn.kind === 'spec_review') return turn.taskId === 'task-meta-intake' ? 'Review the proposed split and starter structure.' : 'Review the spec draft before Guildhall moves it forward.'
    if (turn.kind === 'escalation') {
      const guidance = escalationUserGuidance({
        summary: turn.summary,
        details: turn.details,
        reason: turn.escalationReason,
        agentId: turn.escalationAgentId,
      })
      return guidance.title
    }
    if (turn.kind === 'review_feedback') return turn.summary
    if (turn.kind === 'inflight') return taskStateDescription(turn)
    return ''
  }

  function requestHeading(turn: RequestTurn): string {
    return turn.requestStage === 'task_brief_cleanup' ? 'Task brief cleanup' : 'New thread'
  }

  function requestStateLabel(turn: RequestTurn): string {
    return turn.requestStage === 'task_brief_cleanup' ? 'Cleanup queued' : 'Request saved'
  }

  function isHistoricalTaskEvent(turn: Turn): boolean {
    if (turn.kind === 'history_note') return true
    return (
      (turn.kind === 'agent_question' ||
        turn.kind === 'brief_approval' ||
        turn.kind === 'spec_review' ||
        turn.kind === 'inflight' ||
        turn.kind === 'review_feedback' ||
        turn.kind === 'escalation') &&
      (turn.status === 'done' || turn.phase === 'done')
    )
  }

  function historyEventLabel(turn: Turn): string | null {
    switch (turn.kind) {
      case 'history_note':
        return turn.label
      case 'brief_approval':
        return turn.status === 'done' ? 'Brief finalized' : 'Brief draft'
      case 'spec_review':
        return turn.status === 'done' ? 'Spec approved' : 'Spec draft'
      case 'agent_question':
        return turn.status === 'done' ? 'Question answered' : 'Question asked'
      case 'review_feedback':
        return 'Review feedback'
      case 'escalation':
        return turn.status === 'done' ? 'Blocker resolved' : 'Blocker raised'
      case 'inflight':
        if (turn.importedDraft || turn.taskStatus === 'exploring' || turn.taskStatus === 'import_draft') {
          return 'Task shaping update'
        }
        if (turn.taskStatus === 'in_progress') return 'Work update'
        if (turn.taskStatus === 'ready') return needsWorkerHandoffSpecCleanup(turn) ? 'Needs brief cleanup' : 'Ready for work'
        return 'Task update'
      default:
        return null
    }
  }

  function historyEventSummary(turn: Turn): string {
    switch (turn.kind) {
      case 'history_note':
        return turn.summary
      case 'brief_approval':
        return turn.status === 'done'
          ? 'Guildhall locked the brief and carried this thread into spec drafting.'
          : 'Guildhall drafted the brief and is waiting for a final decision.'
      case 'spec_review':
        if (turn.taskId === 'task-meta-intake') {
          return turn.status === 'done'
            ? 'The proposed project split was accepted and can shape the next work.'
            : 'Guildhall drafted a proposed project split and is waiting for approval.'
        }
        return turn.status === 'done'
          ? 'The spec was approved and this thread can move into ready work.'
          : 'Guildhall drafted a spec and is waiting for review.'
      case 'agent_question': {
        const answered = [...questionsForTurn(turn)].reverse().find((question) => (question.answer ?? '').trim())
        return answered?.answer?.trim()
          ?? 'You answered Guildhall’s clarifying question and the thread moved forward.'
      }
      case 'review_feedback':
        return turn.summary
      case 'escalation':
        return turn.details?.trim() || turn.summary
      case 'inflight':
        if (turn.importedDraft || turn.taskStatus === 'exploring' || turn.taskStatus === 'import_draft') {
          return 'Guildhall reshaped the request into concrete task requirements and acceptance checks.'
        }
        if (turn.taskStatus === 'ready') {
          if (needsWorkerHandoffSpecCleanup(turn)) {
            return 'Guildhall saved the starter notes, but the worker handoff still needs a full brief and acceptance checks.'
          }
          return 'Guildhall finished shaping this work and left it ready to start.'
        }
        if (turn.taskStatus === 'in_progress') {
          return turn.summary || 'Guildhall advanced this thread into active work.'
        }
        return turn.summary || 'Guildhall advanced this thread to the next stage.'
      default:
        return turnIndexSummary(turn)
    }
  }

  function historyEventNeedsSummary(turn: Turn): boolean {
    if (turn.kind === 'brief_approval' && turn.status === 'done') return false
    if (turn.kind === 'history_note' && turn.category === 'request') return false
    return historyEventSummary(turn).trim().length > 0
  }

  function historyReviewClusterKey(turn: Turn): string | null {
    if (turn.kind !== 'review_feedback' || !isHistoricalTaskEvent(turn)) return null
    return `${turn.taskId}:review_feedback`
  }

  function buildHistoryRenderItems(sourceTurns: Turn[]): HistoryRenderItem[] {
    const items: HistoryRenderItem[] = []
    let pending: Extract<HistoryRenderItem, { kind: 'cluster' }> | null = null

    const flushPending = () => {
      if (!pending) return
      if (pending.turns.length === 1) {
        items.push({ kind: 'single', id: pending.turns[0].id, turn: pending.turns[0] })
      } else {
        items.push(pending)
      }
      pending = null
    }

    for (const turn of sourceTurns) {
      const key = historyReviewClusterKey(turn)
      if (!key || turn.kind !== 'review_feedback') {
        flushPending()
        items.push({ kind: 'single', id: turn.id, turn })
        continue
      }
      if (pending?.key === key) {
        pending.turns.push(turn)
        continue
      }
      flushPending()
      pending = {
        kind: 'cluster',
        id: `history-cluster:${key}:${turn.id}`,
        key,
        label: historyEventLabel(turn) ?? 'Update',
        turns: [turn],
      }
    }

    flushPending()
    return items
  }

  function reviewFeedbackHistoryEntryLabel(turn: ReviewFeedbackTurn, index: number): string {
    if (turn.revisionCount) return `Pass ${turn.revisionCount}`
    return `Note ${index + 1}`
  }

  function historyQuestionPrompt(turn: AgentQuestionTurn): string {
    const question = [...questionsForTurn(turn)].find(candidate =>
      Boolean((candidate.restatement ?? candidate.prompt ?? '').trim()),
    ) ?? turn.question
    return (question.restatement ?? question.prompt ?? 'Guildhall asked a clarifying question.').trim()
  }

  function historyQuestionAnswer(turn: AgentQuestionTurn): string {
    const answered = [...questionsForTurn(turn)].reverse().find((question) => (question.answer ?? '').trim())
    return answered?.answer?.trim()
      ?? 'You answered Guildhall’s clarifying question and the thread moved forward.'
  }

  function showHistoricalMeta(turn: Turn): boolean {
    return !isHistoricalTaskEvent(turn)
  }

  function showHistoricalStatus(turn: Turn): boolean {
    return !isHistoricalTaskEvent(turn)
  }

  function activeDockTitle(turn: Turn): string {
    if (turn.kind === 'brief_approval') return 'Review this task brief'
    if (turn.kind === 'spec_review') {
      return turn.taskId === 'task-meta-intake' ? 'Review the proposed split' : 'Review the spec draft'
    }
    if (turn.kind === 'escalation') {
      const guidance = escalationUserGuidance({
        summary: turn.summary,
        details: turn.details,
        reason: turn.escalationReason,
        agentId: turn.escalationAgentId,
      })
      return guidance.actionOwner === 'guildhall' ? 'Guildhall can continue' : 'Needs recovery'
    }
    if (turn.kind === 'inflight') {
      if (turn.requestStage === 'task_brief_cleanup') return 'Brief cleanup'
      if (turn.importedDraft || turn.taskStatus === 'exploring' || turn.taskStatus === 'import_draft') {
        return 'Continue shaping brief'
      }
      if (turn.taskStatus === 'ready') return needsWorkerHandoffSpecCleanup(turn) ? 'Needs brief cleanup' : 'Ready for work'
      if (turn.taskStatus === 'in_progress') return 'Work in progress'
    }
    return turnIndexTitle(turn)
  }

  function activeDockSummary(turn: Turn): string | null {
    if (turn.kind === 'brief_approval') return null
    if (turn.kind === 'spec_review') return null
    if (turn.kind === 'escalation') {
      return escalationUserGuidance({
        summary: turn.summary,
        details: turn.details,
        reason: turn.escalationReason,
        agentId: turn.escalationAgentId,
      }).title
    }
    if (turn.kind === 'inflight' && (turn.importedDraft || turn.taskStatus === 'exploring' || turn.taskStatus === 'import_draft')) {
      return taskStateDescription(turn)
    }
    const summary = turnIndexSummary(turn).trim()
    return summary.length ? summary : null
  }

  function taskTabHref(taskId: string, tab: 'current' | 'spec'): string {
    return `${currentTaskHref(taskId)}?tab=${tab}`
  }

  function dockSourceSummary(turn: InFlightTurn): string | null {
    const references = turn.sourceNote?.references?.length ?? 0
    if (turn.taskDescription && references > 0) {
      return `Starting point saved · ${references} source note${references === 1 ? '' : 's'}`
    }
    if (turn.taskDescription) return 'Starting point saved'
    if (references > 0) return `${references} source note${references === 1 ? '' : 's'} attached`
    return null
  }

  function dockChecklistSummary(turn: InFlightTurn): { complete: string; missing: string } | null {
    const checklist = turn.checklist
    if (!checklist) return null
    const missingCount = checklist.steps.filter(step => step.status !== 'done' && step.status !== 'skipped').length
    return {
      complete: `${checklist.doneCount} of ${checklist.totalSteps} complete`,
      missing: missingCount === 0
        ? needsWorkerHandoffSpecCleanup(turn)
          ? 'Handoff still needs cleanup'
          : 'Nothing missing'
        : `${missingCount} item${missingCount === 1 ? '' : 's'} still missing`,
    }
  }

  function detailNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.clientHeight - el.scrollTop <= 24
  }

  function scrollDetailToBottom(behavior: ScrollBehavior = 'auto'): void {
    if (!detailScrollEl) return
    detailScrollEl.scrollTo({ top: detailScrollEl.scrollHeight, behavior })
  }

  function handleDetailScroll(): void {
    if (!detailScrollEl) return
    detailShouldStickToBottom = detailNearBottom(detailScrollEl)
  }

  function focusTurn(turnId: string): void {
    selectedTurnId = turnId
    detailShouldStickToBottom = true
    path.replace(hrefForThreadChain(turnId), path.state)
    if (compactThreadMode) compactPane = 'detail'
    queueMicrotask(() => {
      scrollDetailToBottom('smooth')
    })
  }

  function showThreadListPane(): void {
    if (!compactThreadMode) return
    compactPane = 'list'
  }

  type DockedTurn = AgentQuestionTurn | OwnerInputQuestionTurn | BriefTurn | SpecReviewTurn | InFlightTurn | EscalationTurn

  function isDockableTurn(turn: Turn): turn is DockedTurn {
    if (turn.kind === 'escalation') return isActionableEscalation(turn)
    if (turn.kind === 'agent_question' || turn.kind === 'pressure_test_question' || turn.kind === 'bounded_chat') {
      return turn.status === 'active'
    }
    return (turn.kind === 'brief_approval' || turn.kind === 'spec_review' || turn.kind === 'inflight') && turn.status !== 'done'
  }

  const selectedTurn = $derived.by(() => {
    if (!selectedTurnId) return null
    const chain = threadChains.find(candidate => candidate.id === selectedTurnId)
    if (!chain) return null
    return chain.currentTurn ?? chain.latestTurn
  })

  const selectedChain = $derived.by(() => {
    if (!selectedTurnId) return null
    return threadChains.find(chain => chain.id === selectedTurnId) ?? null
  })

  const activeDockTurn = $derived.by((): DockedTurn | null => {
    const current = selectedChain?.currentTurn
    if (!current || !isDockableTurn(current)) return null
    return current
  })

  const historyTurns = $derived.by(() => {
    if (!selectedChain) return []
    if (!activeDockTurn) return selectedChain.turns
    return selectedChain.turns.filter(turn => turn.id !== activeDockTurn.id)
  })
  const historyRenderItems = $derived(buildHistoryRenderItems(historyTurns))

  const footerCandidates = $derived.by(() => {
    if (!selectedChain) return []
    if (!selectedTurn) return selectedChain.turns
    return [selectedTurn, ...selectedChain.turns.filter(turn => turn.id !== selectedTurn.id)]
  })

  const detailAutoScrollKey = $derived.by(() => {
    const chainId = selectedChain?.id ?? 'none'
    const historyKey = historyTurns.map(turn => turn.id).join('|')
    const dockId = activeDockTurn?.id ?? 'none'
    return `${chainId}::${historyKey}::${dockId}`
  })

  type FooterComposer =
    | {
      kind: 'task_reply'
      turn: TaskReplyTurn
      title: string
      description: string
      placeholder: string
      submitLabel: string
    }
    | {
      kind: 'question_context'
      turn: AgentQuestionTurn
      title: string
      description: string
      placeholder: string
      submitLabel: string
    }
    | {
      kind: 'agent_question_text'
      turn: AgentQuestionTurn
      question: AgentQuestionTurn['question']
      title: string
      description: string
      placeholder: string
      submitLabel: string
    }
    | {
      kind: 'pressure_test'
      turn: OwnerInputQuestionTurn
      title: string
      description: string
      placeholder: string
      submitLabel: string
    }
    | {
      kind: 'working'
      turn: Turn
      title: string
      description: string
    }

  function footerReplyDetails(turn: TaskReplyTurn): Omit<Extract<FooterComposer, { kind: 'task_reply' }>, 'kind' | 'turn'> {
    if (turn.kind === 'brief_approval') {
      return {
        title: 'Request changes to the brief',
        description: 'Tell Guildhall what should change before this brief moves forward.',
        placeholder: 'Correct the brief or add missing context…',
        submitLabel: 'Send',
      }
    }
    if (turn.kind === 'spec_review') {
      return {
        title: turn.taskId === 'task-meta-intake' ? 'Change the proposed split' : 'Request changes to the spec',
        description: 'Keep the thread moving, but redirect the current draft before Guildhall treats it as approved.',
        placeholder: 'Correct the spec or ask Guildhall to revisit it…',
        submitLabel: 'Send',
      }
    }
    if (turn.kind === 'escalation') {
      return {
        title: 'Add recovery guidance',
        description: 'Add context for Guildhall without closing this blocker.',
        placeholder: 'Add recovery guidance for Guildhall...',
        submitLabel: 'Send',
      }
    }
    return {
      title: 'Add a thread note',
      description: 'Give Guildhall a correction, constraint, or steering note for this active work.',
      placeholder: 'Add a note for Guildhall…',
      submitLabel: 'Send',
    }
  }

  async function answerFooterQuestion(turn: AgentQuestionTurn, question: AgentQuestionTurn['question']): Promise<void> {
    const answer = (footerQuestionDrafts[question.id] ?? '').trim()
    if (!answer) return
    await answerQuestion({ ...turn, question }, answer)
    if (!replyErrors[turn.id]) clearFooterQuestionDraft(question.id)
  }

  const footerComposer = $derived.by((): FooterComposer | null => {
    const chainTurns = selectedChain?.turns ?? turns

    if (contextTurnId) {
      const turn = chainTurns.find((candidate): candidate is AgentQuestionTurn =>
        candidate.kind === 'agent_question' && candidate.id === contextTurnId && candidate.status === 'active',
      )
      if (turn) {
        return {
          kind: 'question_context',
          turn,
          title: 'Ask Guildhall to explain first',
          description: 'This keeps the question open while Guildhall explains its assumptions, project terms, or source evidence.',
          placeholder: 'Ask what Guildhall means, what evidence it used, or what context is missing…',
          submitLabel: 'Send',
        }
      }
    }

    if (replyTurnId) {
      const turn = chainTurns.find((candidate): candidate is TaskReplyTurn =>
        (candidate.kind === 'brief_approval' || candidate.kind === 'spec_review' || candidate.kind === 'inflight' || candidate.kind === 'escalation') &&
        candidate.id === replyTurnId &&
        (candidate.kind === 'escalation' ? candidate.status !== 'done' : candidate.status === 'active'),
      )
      if (turn) {
        return {
          kind: 'task_reply',
          turn,
          ...footerReplyDetails(turn),
        }
      }
    }

    for (const turn of footerCandidates) {
      if (turn.kind === 'escalation' && isActionableEscalation(turn)) {
        return {
          kind: 'task_reply',
          turn,
          ...footerReplyDetails(turn),
        }
      }
      if (turn.kind === 'agent_question' && turn.status === 'active') {
        const question = visibleQuestionsForCard(questionsForTurn(turn))
          .find(candidate => candidate.kind === 'text' && !(staged[candidate.id] ?? '').trim())
        if (question) {
          return {
            kind: 'agent_question_text',
            turn,
            question,
            title: 'Reply in thread',
            description: 'Guildhall is waiting on a free-form answer before it can continue this thread.',
            placeholder: 'Answer this question or redirect Guildhall…',
            submitLabel: 'Send',
          }
        }
      }
      if (
        (turn.kind === 'pressure_test_question' || turn.kind === 'bounded_chat') &&
        turn.status === 'active' &&
        !(turn.question.choices?.length)
      ) {
        return {
          kind: 'pressure_test',
          turn,
          title: 'Reply in thread',
          description: 'Guildhall needs your answer before it can continue.',
          placeholder: 'Answer with a sentence or short paragraph. Include constraints or success measures if they matter.',
          submitLabel: 'Send',
        }
      }
    }

    if (
      activeDockTurn &&
      (
        activeDockTurn.kind === 'brief_approval' ||
        activeDockTurn.kind === 'spec_review' ||
        activeDockTurn.kind === 'inflight'
      )
    ) {
      return {
        kind: 'task_reply',
        turn: activeDockTurn,
        ...footerReplyDetails(activeDockTurn),
      }
    }

    const workingTurn = footerCandidates.find(turn => turn.status === 'active' && turnLiveAgent(turn))
    if (workingTurn) {
      const live = turnLiveAgent(workingTurn)
      return {
        kind: 'working',
        turn: workingTurn,
        title: live ? liveAgentMessage(live) : 'Guildhall is working',
        description: live?.lastEventLabel ?? 'Guildhall is actively working in this thread.',
      }
    }

    return null
  })

  function isFooterReplyTurn(turnId: string): boolean {
    return footerComposer?.kind === 'task_reply' && footerComposer.turn.id === turnId
  }

  function isFooterContextTurn(turnId: string): boolean {
    return footerComposer?.kind === 'question_context' && footerComposer.turn.id === turnId
  }

  function isFooterPressureTurn(turnId: string): boolean {
    return footerComposer?.kind === 'pressure_test' && footerComposer.turn.id === turnId
  }

  function isFooterAgentQuestion(questionId: string): boolean {
    return footerComposer?.kind === 'agent_question_text' && footerComposer.question.id === questionId
  }

  // True if the task has at least one un-answered agent_question turn.
  // Used to gate brief / spec approval — the user shouldn't approve a
  // brief while the agent still has live clarifying questions on the
  // same task. Once the questions section is submitted, this flips false
  // on the next poll and the Approve button enables itself.
  function hasOpenQuestionsForTask(taskId: string): boolean {
    return turns.some(
      t => t.kind === 'agent_question' && t.taskId === taskId && t.status === 'active',
    )
  }
</script>

<div
  class="thread"
  class:thread-compact-list={compactListView}
  class:thread-compact-detail={compactDetailView}
>
  {#if importHandoff}
    <Card tone="accent">
      <Row justify="between" align="center" gap="3" wrap>
        <div class="handoff-copy">
          <strong>Import complete.</strong>
          {#if importHandoff.tasksAdded > 0}
            <span>
              Guildhall created {importHandoff.tasksAdded} draft task{importHandoff.tasksAdded === 1 ? '' : 's'}
              from {importHandoff.sourceCount} selected source{importHandoff.sourceCount === 1 ? '' : 's'}.
              These drafts still need shaping before any worker starts.
            </span>
          {:else}
            <span>
              Guildhall saved {importHandoff.sourceCount} selected source{importHandoff.sourceCount === 1 ? '' : 's'} as project context.
              No draft tasks were created, so the next task can start from the recorded notes instead of a blank slate.
            </span>
          {/if}
        </div>
        <Row gap="2" wrap>
          {#if importHandoff.tasksAdded > 0}
            <Button variant="secondary" size="sm" onclick={revealImportedDrafts}>
              Jump to first draft
            </Button>
          {/if}
          <Button variant="ghost" size="sm" onclick={() => (importHandoff = null)}>
            Dismiss
          </Button>
        </Row>
      </Row>
    </Card>
  {/if}

  {#if !loaded}
    <p class="muted">Loading...</p>
  {:else if loadError}
    <Card title="Thread unavailable">
      <p class="muted">Could not load the current thread: {loadError}</p>
      <Row justify="end">
        <Button variant="primary" onclick={() => void load()}>Retry</Button>
      </Row>
    </Card>
  {:else if turns.length === 0}
    <Stack gap="3">
      <Card title="Nothing here yet">
        <p class="muted">
          {allTerminalReadinessMessage ?? 'Add a task to start the thread.'}
        </p>
      </Card>

      {#if pendingCapabilityRequests.length > 0}
        <Card title="Access requests" tone="warn" frosted>
          <Stack gap="3">
            {#each pendingCapabilityRequests as request (request.id)}
              <UtilityPanel tone="warn">
                <Stack gap="3">
                  <div class="field">
                    <strong>Guildhall needs a decision before it can safely use this folder.</strong>
                    <p class="muted">{request.reason}</p>
                  </div>

                  {#if request.mount}
                    <Input
                      value={capabilityPathDrafts[request.id] ?? request.mount.hostPath}
                      oninput={(value) => setCapabilityPathDraft(request.id, value)}
                    />
                  {/if}

                  {#if request.fallback}
                    <Textarea
                      rows={2}
                      value={capabilityFallbackDrafts[request.id] ?? request.fallback}
                      oninput={(value) => setCapabilityFallbackDraft(request.id, value)}
                    />
                  {/if}

                  <Row justify="end" gap="2" wrap>
                    <Button variant="secondary" onclick={() => void approveCapabilityRequest(request, 'read-only')}>
                      Approve read-only
                    </Button>
                    <Button variant="primary" onclick={() => void approveCapabilityRequest(request, 'read-write')}>
                      Approve read-write
                    </Button>
                    <Button variant="ghost" onclick={() => void denyCapabilityRequest(request)}>
                      Use fallback
                    </Button>
                  </Row>
                </Stack>
              </UtilityPanel>
            {/each}
          </Stack>
        </Card>
      {/if}
    </Stack>
  {:else}
    <div class="thread-body">
      {#if threadChains.length === 0}
        <Card title="Nothing current">
          <p class="muted">
            {allTerminalReadinessMessage ?? 'No open questions, queued work, blockers, or active requests right now.'}
          </p>
        </Card>
      {/if}

      {#if threadChains.length > 0}
        <div class="thread-columns" class:thread-columns-compact={compactThreadMode}>
          {#if !compactThreadMode || compactPane === 'list'}
          <aside
            class="thread-index"
            aria-label="Thread list"
            in:fly|local={{ x: compactThreadMode ? -26 : 0, duration: 180, opacity: 0.16 }}
            out:fly|local={{ x: compactThreadMode ? -20 : 0, duration: 160, opacity: 0.12 }}
          >
            <div class="thread-index-list">
              {#each threadChains as chain (chain.id)}
                {@const indexTurn = chain.currentTurn ?? chain.latestTurn}
                {@const indexChip = turnIndexChip(indexTurn)}
                <CardListItem
                  as="button"
                  className="thread-index-row"
                  tone={selectedTurnId === chain.id ? 'accent' : 'neutral'}
                  railTone={selectedTurnId === chain.id ? 'accent' : null}
                  selected={selectedTurnId === chain.id}
                  onclick={() => focusTurn(chain.id)}
                >
                  <div class="thread-index-row-chips">
                    {#if indexChip}
                      <Chip label={indexChip.label} tone={indexChip.tone} size="compact" />
                    {/if}
                  </div>
                  <div class="thread-index-row-top">
                    <strong>{turnIndexTitle(chain.latestTurn)}</strong>
                    {#if turnRelativeTime(chain.latestTurn)}
                      <span class="thread-index-time">{turnRelativeTime(chain.latestTurn)}</span>
                    {/if}
                  </div>
                  <p>{turnIndexSummary(indexTurn)}</p>
                </CardListItem>
              {/each}
            </div>
          </aside>
          {/if}

          {#if !compactThreadMode || compactPane === 'detail'}
          <section
            class="thread-detail"
            aria-label="Selected thread"
            bind:this={detailScrollEl}
            onscroll={handleDetailScroll}
            in:fly|local={{ x: compactThreadMode ? 26 : 0, duration: 180, opacity: 0.16 }}
            out:fly|local={{ x: compactThreadMode ? 20 : 0, duration: 160, opacity: 0.12 }}
          >
            <div class="thread-detail-scroll-wrap">
              <div class="thread-detail-scroll" aria-label="Thread history">
                <div class="thread-detail-flow">
                  <div class="thread-list">
                    <Stack gap="3">
                      {#each historyRenderItems as historyItem (historyItem.id)}
        {#if historyItem.kind === 'cluster'}
          {@const latest = historyItem.turns[0]}
          {@const earlierReviewTurns = historyItem.turns.slice(1)}
          {#if latest}
            <div
              class="thread-history-item"
              data-turn-id={historyItem.id}
            >
              <div class="thread-event thread-event-milestone">
                <div class="thread-event-head">
                  <strong>{historyItem.label}</strong>
                  {#if compactRelativeTime(latest.at)}
                    <span>{compactRelativeTime(latest.at)}</span>
                  {/if}
                </div>
                {#if historyEventNeedsSummary(latest)}
                  <p>{historyEventSummary(latest)}</p>
                {/if}
                <details class="thread-history-cluster">
                  <summary>Show {earlierReviewTurns.length} earlier reviewer note{earlierReviewTurns.length === 1 ? '' : 's'}</summary>
                  <div class="thread-history-cluster-list">
                    {#each earlierReviewTurns as reviewTurn, index (reviewTurn.id)}
                      <div class="thread-history-cluster-item">
                        <div class="thread-history-cluster-head">
                          <strong>{reviewFeedbackHistoryEntryLabel(reviewTurn, index)}</strong>
                          {#if compactRelativeTime(reviewTurn.at)}
                            <span>{compactRelativeTime(reviewTurn.at)}</span>
                          {/if}
                        </div>
                        <p>{historyEventSummary(reviewTurn)}</p>
                      </div>
                    {/each}
                  </div>
                </details>
              </div>
            </div>
          {/if}
        {:else}
          {@const t = historyItem.turn}
        {#if isHistoricalTaskEvent(t)}
          <div
            class="thread-history-item"
            class:thread-history-item-question={t.kind === 'agent_question'}
            data-turn-id={t.id}
          >
            {#if t.kind === 'agent_question'}
              <div class="thread-chat-bubble thread-chat-bubble-agent">
                <div class="thread-chat-bubble-head">
                  <strong>Guildhall</strong>
                  {#if turnRelativeTime(t)}
                    <span>{turnRelativeTime(t)}</span>
                  {/if}
                </div>
                <p>{historyQuestionPrompt(t)}</p>
              </div>
              <div class="thread-chat-bubble thread-chat-bubble-user">
                <div class="thread-chat-bubble-head">
                  <strong>You</strong>
                </div>
                <p>{historyQuestionAnswer(t)}</p>
              </div>
            {:else}
              <div
                class="thread-event"
                class:thread-event-source={t.kind === 'history_note' && t.category === 'source'}
                class:thread-event-request={t.kind === 'history_note' && t.category === 'request'}
                class:thread-event-system={t.kind === 'history_note' && t.category === 'system'}
                class:thread-event-milestone={t.kind !== 'history_note'}
              >
                <div class="thread-event-head">
                  <strong>{historyEventLabel(t) ?? 'Update'}</strong>
                  {#if turnRelativeTime(t)}
                    <span>{turnRelativeTime(t)}</span>
                  {/if}
                </div>
                {#if historyEventNeedsSummary(t)}
                  <p>{historyEventSummary(t)}</p>
                {/if}
                {#if t.kind === 'history_note' && t.references?.length}
                  <div class="thread-event-links">
                    {#each t.references as ref (ref)}
                      <button
                        type="button"
                        class="thread-event-link"
                        title="Open source note"
                        aria-label={`Open source note ${ref}`}
                        disabled={sourcePreviewLoadingRef === ref}
                        onclick={() => void openSourceNote(ref)}
                      >
                        <span>{sourceDisplayName(ref)}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
                {#if t.kind === 'history_note' && t.category === 'system' && (t.count ?? 0) > 1 && t.entries?.length}
                  <details class="thread-history-cluster">
                    <summary>Show {t.count} recovery updates</summary>
                    <div class="thread-history-cluster-list">
                      {#each t.entries as entry (`${entry.at}:${entry.label}`)}
                        <div class="thread-history-cluster-item">
                          <div class="thread-history-cluster-head">
                            <strong>{entry.label}</strong>
                            {#if compactRelativeTime(entry.at)}
                              <span>{compactRelativeTime(entry.at)}</span>
                            {/if}
                          </div>
                          <p>{entry.summary}</p>
                        </div>
                      {/each}
                    </div>
                  </details>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div
            class="turn turn-{t.status}"
            class:turn-import-queue={t.kind === 'inflight' && t.importedDraft && t.status === 'pending'}
            data-turn-id={t.id}
          >
            <Card tone={tone(t)} frosted>
              <InteractionCardLayout>
              {#snippet status()}
                {#if showHistoricalStatus(t) && hasCardStatus(t)}
                  <Row align="center" gap="2">
                    {#if showConstructionModeChip(t)}
                      <Chip label={constructionModeLabel(t) ?? ''} tone="neutral" />
                    {/if}
                    {#if ownershipLabel(t)}
                      <Chip label={ownershipLabel(t) ?? ''} tone={ownershipTone(t)} />
                    {/if}
                    {#if showStatusChip(t)}
                      <Chip
                        label={turnStatusChipLabel(t)}
                        tone={turnStatusChipTone(t)}
                      />
                    {/if}
                  </Row>
                {/if}
              {/snippet}
              {#snippet meta()}
                <div class="meta">
                  {#if showHistoricalMeta(t) && 'taskTitle' in t}
                    {@const taskTitle = displayTaskTitle(t)}
                    <button
                      type="button"
                      class="task-chip"
                      title={taskTitle}
                      onclick={() => nav(currentTaskHref(t.taskId))}
                    >
                      <span class="task-chip-text">{taskTitle}</span>
                    </button>
                  {/if}
                  {#if showHistoricalMeta(t)}
                    <span class="persona">{personaLabel(t.persona)}</span>
                    {#if t.phase === 'done' && formatArchiveTime(t.at)}
                      <span class="archive-time">Completed {formatArchiveTime(t.at)}</span>
                    {/if}
                  {/if}
                </div>
              {/snippet}
              {#snippet live()}
                {#if t.status === 'active' && turnLiveAgent(t)}
                  {@const live = turnLiveAgent(t)}
                  <StatusLine
                    label={liveAgentMessage(live)}
                    tone={liveAgentTone(live)}
                    pulse
                    loud
                  />
                {/if}
              {/snippet}
              {#if !isHistoricalTaskEvent(t) && gitStoryVisible(t) && 'gitStory' in t && t.gitStory}
                <div class="git-story-callout" aria-label="Git story">
                  <div class="git-story-main">
                    <Chip label={gitStoryLabel(t.gitStory)} tone={gitStoryTone(t.gitStory)} />
                    <span>{gitStorySummary(t.gitStory)}</span>
                  </div>
                  {#if t.gitStory.nextAction}
                    <span class="git-story-next">{t.gitStory.nextAction}</span>
                  {/if}
                </div>
              {/if}
                {#if isHistoricalTaskEvent(t)}
                  <div
                    class="thread-event"
                    class:thread-event-source={t.kind === 'history_note' && t.category === 'source'}
                    class:thread-event-request={t.kind === 'history_note' && t.category === 'request'}
                    class:thread-event-system={t.kind === 'history_note' && t.category === 'system'}
                    class:thread-event-milestone={t.kind !== 'history_note'}
                  >
                    <div class="thread-event-head">
                      <strong>{historyEventLabel(t) ?? 'Update'}</strong>
                      {#if compactRelativeTime(t.at)}
                        <span>{compactRelativeTime(t.at)}</span>
                      {/if}
                    </div>
                    <p>{historyEventSummary(t)}</p>
                    {#if t.kind === 'history_note' && t.references?.length}
                      <div class="thread-event-links">
                        {#each t.references as ref (ref)}
                          <button
                            type="button"
                            class="thread-event-link"
                            title="Open source note"
                            aria-label={`Open source note ${ref}`}
                            disabled={sourcePreviewLoadingRef === ref}
                            onclick={() => void openSourceNote(ref)}
                          >
                            <span>{sourceDisplayName(ref)}</span>
                          </button>
                        {/each}
                      </div>
                    {/if}
                    {#if t.kind === 'history_note' && t.category === 'system' && (t.count ?? 0) > 1 && t.entries?.length}
                      <details class="thread-history-cluster">
                        <summary>Show {t.count} recovery updates</summary>
                        <div class="thread-history-cluster-list">
                          {#each t.entries as entry (`${entry.at}:${entry.label}`)}
                            <div class="thread-history-cluster-item">
                              <div class="thread-history-cluster-head">
                                <strong>{entry.label}</strong>
                                {#if compactRelativeTime(entry.at)}
                                  <span>{compactRelativeTime(entry.at)}</span>
                                {/if}
                              </div>
                              <p>{entry.summary}</p>
                            </div>
                          {/each}
                        </div>
                      </details>
                    {/if}
                  </div>
                {:else if t.kind === 'setup_step'}
                  <div class="setup-title">
                    <h3 class="prompt"><Markdown source={setupStepTitle(t)} inline /></h3>
                    {#if t.skippable}
                      <Chip label="optional" tone="neutral" />
                    {/if}
                  </div>
                  <p class="why">{setupStepWhy(t)}</p>
                  {#if t.status === 'active'}
                    {#if t.contextSummary}
                      <UtilityPanel className="setup-context" tone="neutral" ariaLabel="What Guildhall knows right now">
                        <strong>What Guildhall knows right now</strong>
                        <p>{t.contextSummary.intro}</p>
                        <ul>
                          {#each t.contextSummary.facts as fact}
                            <li>{fact}</li>
                          {/each}
                        </ul>
                        <p>{t.contextSummary.uncertainty}</p>
                      </UtilityPanel>
                    {/if}
                    {#if t.affordance === 'link' && t.actionHref}
                      <Row justify="end" gap="2">
                        <Button variant="primary" onclick={() => nav(projectActionHref(t.actionHref!))}>{t.actionLabel}</Button>
                      </Row>
                    {:else if t.affordance === 'inline-text'}
                      <div class="setup-form">
                        <Input
                          value={setupValue(t.id)}
                          placeholder={t.placeholder}
                          disabled={busyTurnId === t.id}
                          onchange={(v) => setSetupValue(t.id, v)}
                          oninput={(v) => setSetupValue(t.id, v)}
                        />
                        <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                          {busyTurnId === t.id ? 'Saving...' : t.actionLabel}
                        </Button>
                      </div>
                    {:else if t.affordance === 'inline-textarea'}
                      <Stack gap="2">
                        <Textarea
                          value={setupValue(t.id)}
                          placeholder={t.placeholder}
                          rows={5}
                          disabled={busyTurnId === t.id}
                          oninput={(v) => setSetupValue(t.id, v)}
                        />
                        <Row justify="end">
                          <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                            {busyTurnId === t.id ? 'Saving...' : t.actionLabel}
                          </Button>
                        </Row>
                      </Stack>
                    {:else if t.affordance === 'inline-button'}
                      <Row justify="end" gap="2">
                        <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                          <Icon name="sparkles" size={14} />
                          {busyTurnId === t.id ? (t.stepId === 'projectCheckIn' ? 'Starting...' : 'Verifying...') : t.actionLabel}
                        </Button>
                      </Row>
                    {:else if t.affordance === 'inline-choice'}
                      <div class="setup-form">
                        <Select
                          value={setupValue(t.id)}
                          options={t.choices ?? []}
                          disabled={busyTurnId === t.id}
                          onchange={(v) => setSetupValue(t.id, v)}
                        />
                        <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                          {busyTurnId === t.id ? 'Adding...' : t.actionLabel}
                        </Button>
                      </div>
                    {/if}
                    {#if setupErrors[t.id]}
                      <p class="error">{setupErrors[t.id]}</p>
                    {/if}
                  {:else if t.status !== 'done'}
                    <Row justify="end" gap="2">
                      {#if t.stepId === 'projectCheckIn' && t.affordance === 'inline-button'}
                        <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                          <Icon name="sparkles" size={14} />
                          {busyTurnId === t.id ? 'Starting...' : t.actionLabel}
                        </Button>
                      {:else}
                        <Button variant="secondary" onclick={() => nav(currentProjectHref('/setup'))}>
                          Open setup
                        </Button>
                      {/if}
                    </Row>
                  {/if}

              {:else if t.kind === 'request'}
                <h3 class="prompt">{requestHeading(t)}</h3>
                <div class="field">
                  <span class="field-label">Request</span>
                  <Markdown source={requestSummary(t.rawRequest)} />
                </div>
                <StateSummary label={requestStateLabel(t)} description={t.routingSummary} tone="ok" />

              {:else if t.kind === 'pressure_test_question'}
                <div class="question-card-heading">
                  <div class="question-card-meta">{pressureQuestionMeta(t)}</div>
                  <h3 class="prompt"><Markdown source={pressureQuestionPrompt(t)} inline /></h3>
                </div>
                <p class="why">{pressureQuestionWhy(t)}</p>
                {#if hiddenPressureQuestionCount > 0}
                  <p class="next-question-note">
                    {hiddenPressureQuestionCount} more question{hiddenPressureQuestionCount === 1 ? '' : 's'} will appear after this answer.
                  </p>
                {/if}
                {#if t.question.evidence.length}
                  <div class="field">
                    <span class="field-label">Evidence</span>
                    <ul class="bullet">
                      {#each t.question.evidence as item}
                        <li><Markdown source={item} inline /></li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if t.status !== 'done'}
                  <Stack gap="2">
                    {#if t.question.choices?.length}
                      <div class="pressure-choice-list" aria-label="Answer choices">
                        {#each t.question.choices as choice}
                          <Button
                            variant="secondary"
                            disabled={busyTurnId === t.id}
                            onclick={() => answerPressureTestQuestion(t, choice)}
                          >
                            {choice}
                          </Button>
                        {/each}
                      </div>
                    {:else}
                      {#if isFooterPressureTurn(t.id)}
                        <p class="next-question-note">Reply using the shared composer below.</p>
                      {:else}
                        <Textarea
                          value={pressureTestAnswers[t.id] ?? ''}
                          rows={4}
                          placeholder="Answer with a sentence or short paragraph. Include constraints or success measures if they matter."
                          disabled={busyTurnId === t.id}
                          oninput={(v) => setPressureTestAnswer(t.id, v)}
                        />
                        <Row justify="end" gap="2">
                          <Button
                            variant="primary"
                            disabled={busyTurnId === t.id || !(pressureTestAnswers[t.id] ?? '').trim()}
                            onclick={() => answerPressureTestQuestion(t)}
                          >
                              {busyTurnId === t.id
                                ? 'Submitting...'
                                : hiddenPressureQuestionCount > 0
                                  ? 'Submit and continue'
                                  : 'Submit answer'}
                          </Button>
                        </Row>
                      {/if}
                    {/if}
                    {#if pressureTestErrors[t.id]}
                      <p class="error">{pressureTestErrors[t.id]}</p>
                    {/if}
                  </Stack>
                {/if}

              {:else if t.kind === 'bounded_chat'}
                <UtilityPanel className="bounded-chat-panel" tone="neutral">
                  <div class="thread-active-question">
                    <strong>{pressureQuestionMeta(t)}</strong>
                    <Markdown source={pressureQuestionPrompt(t)} />
                    <p class="why">{pressureQuestionWhy(t)}</p>
                    {#if hiddenPressureQuestionCount > 0}
                      <p class="next-question-note">
                        {hiddenPressureQuestionCount} more question{hiddenPressureQuestionCount === 1 ? '' : 's'} will appear after this answer.
                      </p>
                    {/if}
                    {#if t.question.evidence.length}
                      <div class="field">
                        <span class="field-label">Evidence</span>
                        <ul class="bullet">
                          {#each t.question.evidence as item}
                            <li><Markdown source={item} inline /></li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                    {#if t.status !== 'done'}
                      <Stack gap="2">
                        {#if t.question.choices?.length}
                          <div class="pressure-choice-list" aria-label="Answer choices">
                            {#each t.question.choices as choice}
                              <Button
                                variant="secondary"
                                disabled={busyTurnId === t.id}
                                onclick={() => answerPressureTestQuestion(t, choice)}
                              >
                                {choice}
                              </Button>
                            {/each}
                          </div>
                        {:else}
                          {#if isFooterPressureTurn(t.id)}
                            <p class="next-question-note">Reply using the shared composer below.</p>
                          {:else}
                            <Textarea
                              value={pressureTestAnswers[t.id] ?? ''}
                              rows={4}
                              placeholder="Answer with a sentence or short paragraph. Include constraints or success measures if they matter."
                              disabled={busyTurnId === t.id}
                              oninput={(v) => setPressureTestAnswer(t.id, v)}
                            />
                            <Row justify="end" gap="2">
                              <Button
                                variant="primary"
                                disabled={busyTurnId === t.id || !(pressureTestAnswers[t.id] ?? '').trim()}
                                onclick={() => answerPressureTestQuestion(t)}
                              >
                                {busyTurnId === t.id
                                  ? 'Submitting...'
                                  : hiddenPressureQuestionCount > 0
                                    ? 'Submit and continue'
                                    : 'Submit answer'}
                              </Button>
                            </Row>
                          {/if}
                        {/if}
                        {#if pressureTestErrors[t.id]}
                          <p class="error">{pressureTestErrors[t.id]}</p>
                        {/if}
                      </Stack>
                    {/if}
                  </div>
                </UtilityPanel>

              {:else if t.kind === 'brief_approval'}
                {@const briefScope = briefScopeForReaders(t.brief, t.taskTitle)}
                {@const briefDoneWhen = briefDoneWhenForReaders(t.brief)}
                <h3 class="prompt">Review this task brief</h3>
                <p class="lede">Approve it to queue the work, or tell Guildhall what to change.</p>
                <div class="field"><span class="field-label">Scope</span>
                  <Markdown source={briefScope} />
                </div>
                {#if briefDoneWhen}
                  <div class="field"><span class="field-label">Done when</span>
                    <Markdown source={briefDoneWhen} />
                  </div>
                {/if}
                {#if t.brief.antiPatterns && t.brief.antiPatterns.length > 0}
                  <div class="field"><span class="field-label">Out of scope</span>
                    <ul class="bullet">
                      {#each t.brief.antiPatterns as p}<li><Markdown source={p} inline /></li>{/each}
                    </ul>
                  </div>
                {/if}
                {#if t.latestUserCorrection}
                  <div class="field"><span class="field-label">Latest correction</span>
                    <UtilityPanel className="answer-panel" tone="neutral" dense>
                      <div class="answer"><Markdown source={t.latestUserCorrection} inline /></div>
                    </UtilityPanel>
                  </div>
                {/if}
                {#if t.status !== 'done'}
                  {@const blockedByQuestions = hasOpenQuestionsForTask(t.taskId)}
                  {@const openQuestionCount = openQuestionCountForTask(t.taskId)}
                  {#if blockedByQuestions}
                    <div class="gating-row">
                      <p class="lede gating">
                        Answer {openQuestionCount} open question{openQuestionCount === 1 ? '' : 's'} in Thread before approving — the
                        brief depends on what you say.
                      </p>
                      <Button variant="secondary" size="sm" onclick={() => revealQuestionsForTask(t.taskId)}>
                        Go to questions
                      </Button>
                    </div>
                  {/if}
                  {#if sentReplies[t.id]}
                    <UtilityPanel className="answer-panel" tone="neutral" dense>
                      <p class="answer">Sent. The spec author has the correction.</p>
                    </UtilityPanel>
                  {:else if replyTurnId === t.id}
                    {#if isFooterReplyTurn(t.id)}
                      <p class="next-question-note">Use the shared composer below to send your correction.</p>
                    {:else}
                      <Stack gap="2">
                        <Textarea
                          value={replyDrafts[t.id] ?? ''}
                          rows={4}
                          placeholder="Correct the brief or add missing context"
                          disabled={busyTurnId === t.id}
                          oninput={(v) => setReplyDraft(t.id, v)}
                        />
                        <Row justify="end" gap="2">
                          <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = null)}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            disabled={busyTurnId === t.id || !(replyDrafts[t.id] ?? '').trim()}
                            onclick={() => sendTaskReply(t)}
                          >
                            Send
                          </Button>
                        </Row>
                        {#if replyErrors[t.id]}
                          <p class="error">{replyErrors[t.id]}</p>
                        {/if}
                      </Stack>
                    {/if}
                  {:else}
                    <Row justify="end" gap="2">
                      <Button
                        variant="secondary"
                        disabled={busyTurnId === t.id}
                        onclick={() => (replyTurnId = t.id)}
                      >
                        No, change it
                      </Button>
                      <Button
                        variant="primary"
                        disabled={busyTurnId === t.id || blockedByQuestions}
                        onclick={() => approveBrief(t)}
                      >
                        Yes, that's right
                      </Button>
                    </Row>
                  {/if}
                {/if}

              {:else if t.kind === 'agent_question'}
                {#if t.status === 'active'}
                  {@const totalQuestions = totalCountForTask(t.taskId)}
                  {@const draftQuestions = draftCountForTask(t.taskId)}
                  {@const questions = questionsForTurn(t)}
                  {@const visibleQuestions = visibleQuestionsForCard(questions)}
                  {@const hiddenQuestions = hiddenQuestionCountForCard(questions)}
                  {#if t.taskDescription || t.sourceNote}
                    <details class="thread-disclosure task-context-disclosure">
                      <summary>
                        <span>Starting point and source notes</span>
                        {#if t.sourceNote?.references?.length}
                          <Chip label={badgeCountLabel(t.sourceNote.references.length)} tone="neutral" />
                        {/if}
                      </summary>
                      <UtilityPanel className="task-context" tone="neutral">
                      {#if t.taskDescription}
                        <div class="field">
                          <span class="field-label">Starting point</span>
                          <Markdown source={t.taskDescription} />
                        </div>
                      {/if}
                      {#if t.sourceNote?.references?.length}
                        <div class="field">
                          <span class="field-label">Imported from</span>
                          <div class="source-list">
                            {#each t.sourceNote.references as ref (ref)}
                              <button
                                type="button"
                                class="source-ref"
                                title="Open source note"
                                aria-label={`Open source note ${ref}`}
                                disabled={sourcePreviewLoadingRef === ref}
                                onclick={() => void openSourceNote(ref)}
                              >
                                <span>Open source note</span>
                                <code>{sourceDisplayName(ref)}</code>
                                {#if sourceDisplayHint(ref) !== sourceDisplayName(ref)}
                                  <small>{sourceDisplayHint(ref)}</small>
                                {/if}
                              </button>
                            {/each}
                          </div>
                          {#if sourcePreviewError}
                            <p class="error">{sourcePreviewError}</p>
                          {/if}
                        </div>
                      {/if}
                      </UtilityPanel>
                    </details>
                  {/if}
                  <h3 class="prompt">{totalQuestions === 1 ? 'Before Guildhall continues' : `${totalQuestions} questions before Guildhall continues`}</h3>
                  <UtilityPanel className="question-context-actions" tone="neutral">
                    {#if contextTurnId === t.id}
                      {#if isFooterContextTurn(t.id)}
                        <div class="question-context-copy">
                          <strong>Reply using the shared composer below.</strong>
                          <span>Guildhall will keep this question open and explain the missing context first.</span>
                        </div>
                      {:else}
                        <Stack gap="2">
                          <Textarea
                            value={contextDrafts[t.id] ?? ''}
                            rows={3}
                            placeholder="Ask what the agent means or what source/evidence it is using"
                            disabled={busyTurnId === t.id}
                            oninput={(v) => setContextDraft(t.id, v)}
                          />
                          <Row justify="end" gap="2">
                            <Button
                              variant="ghost"
                              disabled={busyTurnId === t.id}
                              onclick={() => {
                                contextTurnId = null
                                setContextDraft(t.id, '')
                              }}
                            >
                              Cancel
                            </Button>
                          <Button
                            variant="agent"
                            disabled={busyTurnId === t.id || !(contextDrafts[t.id] ?? '').trim()}
                            onclick={() => askQuestionContext(t)}
                          >
                            <Icon name="sparkles" size={14} />
                            Ask for context
                          </Button>
                          </Row>
                          {#if contextErrors[t.id]}
                            <p class="error">{contextErrors[t.id]}</p>
                          {/if}
                        </Stack>
                      {/if}
                    {:else}
                      <div class="question-context-copy">
                        <strong>Missing context is expected.</strong>
                        <span>Ask Guildhall to explain project terms, source notes, or assumptions before you answer. This keeps the question open.</span>
                      </div>
                      <Button variant="human" size="sm" disabled={busyTurnId === t.id} onclick={() => (contextTurnId = t.id)}>
                        Ask Guildhall to explain
                      </Button>
                    {/if}
                  </UtilityPanel>
                  {#if t.activity?.length}
                    <UtilityPanel className="live-activity" tone="neutral" ariaLabel="Recent agent activity">
                      {#each t.activity.slice(0, 3) as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                        <StatusLine
                          label={item.label}
                          detail={item.detail}
                          time={activityElapsed(item.at)}
                          tone={item.tone}
                          pulse={item.tone === 'running'}
                        />
                      {/each}
                      {#if t.activity.length > 3}
                        <details class="thread-disclosure activity-disclosure">
                          <summary>Show {t.activity.length - 3} earlier update{t.activity.length - 3 === 1 ? '' : 's'}</summary>
                          <div class="activity-extra">
                            {#each t.activity.slice(3) as item, index (`${item.at ?? 'event'}:${item.label}:extra:${index}`)}
                              <StatusLine
                                label={item.label}
                                detail={item.detail}
                                time={activityElapsed(item.at)}
                                tone={item.tone}
                                pulse={item.tone === 'running'}
                              />
                            {/each}
                          </div>
                        </details>
                      {/if}
                    </UtilityPanel>
                  {/if}
                  <div class="question-stack">
                    {#each visibleQuestions as question (question.id)}
                      <div class="question-inline">
                        {#if staged[question.id]}
                          <div class="prompt"><Markdown source={question.restatement ?? question.prompt ?? ''} /></div>
                          <div class="field"><span class="field-label">Draft answer</span>
                            <UtilityPanel className="answer-panel" tone="neutral" dense>
                              <div class="answer"><Markdown source={staged[question.id]} inline /></div>
                            </UtilityPanel>
                          </div>
                          <Row justify="end" gap="2">
                            <Button
                              variant="ghost"
                              disabled={busyTaskId === t.taskId}
                              onclick={() => clearStagedQuestion({ ...t, question })}
                            >Change</Button>
                            <Button
                              variant="primary"
                              disabled={busyTaskId === t.taskId}
                              onclick={() => answerQuestion({ ...t, question }, staged[question.id])}
                            >{draftQuestions > 1 ? 'Send saved answers' : 'Send'}</Button>
                          </Row>
                        {:else if question.kind === 'text' && isFooterAgentQuestion(question.id)}
                          <div class="prompt"><Markdown source={question.restatement ?? question.prompt ?? ''} /></div>
                          <p class="next-question-note">Reply using the shared composer below.</p>
                        {:else}
                          <AgentQuestion
                            question={question}
                            busy={busyTaskId === t.taskId}
                            onAnswer={(a) => answerQuestion({ ...t, question }, a)}
                          />
                        {/if}
                      </div>
                    {/each}
                    {#if hiddenQuestions > 0}
                      <p class="question-more-note">
                        Answer this one first. {hiddenQuestions} more question{hiddenQuestions === 1 ? '' : 's'} will stay here until this is saved.
                      </p>
                    {/if}
                  </div>
                  {#if replyErrors[t.id]}
                    <p class="error">{replyErrors[t.id]}</p>
                  {/if}
                {:else}
                  <div class="prompt"><Markdown source={t.question.restatement ?? t.question.prompt ?? ''} /></div>
                  {#if t.question.answer}
                    <div class="field"><span class="field-label">You answered</span>
                      <UtilityPanel className="answer-panel" tone="neutral" dense>
                        <div class="answer"><Markdown source={t.question.answer} inline /></div>
                      </UtilityPanel>
                    </div>
                  {/if}
                {/if}

              {:else if t.kind === 'spec_review'}
                {@const missingSpec = t.taskId !== 'task-meta-intake' && t.spec.trim().length === 0}
                {@const isMetaIntakeDraft = t.taskId === 'task-meta-intake'}
                {@const proposedCount = t.draftCoordinators?.length ?? 0}
                {@const starterRoutingDraft = isStarterRoutingDraft(t.draftCoordinators)}
                <div class="prompt-row">
                  <h3 class="prompt">
                    {isMetaIntakeDraft
                      ? starterRoutingDraft
                        ? `Guildhall proposed ${proposedCount || 0} starter ${proposedCount === 1 ? 'lane' : 'lanes'}`
                        : `Guildhall inferred ${proposedCount || 0} ${proposedCount === 1 ? 'repo slice' : 'repo slices'}`
                      : 'Spec draft awaiting approval'}
                  </h3>
                </div>
                {#if isMetaIntakeDraft && t.draftCoordinators?.length}
                  <p class="why decision-question">
                    {starterRoutingDraft
                      ? 'Guildhall found an empty project and proposed starter routing placeholders.'
                      : 'Guildhall inferred this structure from the repo.'}
                  </p>
                  <p class="why">
                    {starterRoutingDraft
                      ? 'Confirm only if these starter lanes are materially wrong; they give spec shaping a safe place to happen until real product code exists.'
                      : 'Confirm it only if something here is materially wrong. Guildhall should handle the routing and review structure underneath.'}
                  </p>
                  <div class="draft-summary-list">
                    {#each t.draftCoordinators as d (d.id)}
                      <UtilityPanel className="draft-summary-item" tone="neutral" dense>
                        <strong>{friendlyStewardName(undefined, d.domain, d.id)}</strong>
                        {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                      </UtilityPanel>
                    {/each}
                  </div>
                  <details class="draft-details">
                    <summary>{starterRoutingDraft ? 'See why Guildhall proposed this starter split' : 'See why Guildhall inferred this structure'}</summary>
                    <div class="coord-list">
                      {#each t.draftCoordinators as d (d.id)}
                        <UtilityPanel className="coord" tone="neutral">
                          <div class="coord-title">
                            <strong>{friendlyStewardName(undefined, d.domain, d.id)}</strong>
                            {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                          </div>
                          {#if d.mandate}
                            <div class="coord-mandate"><strong>Owns:</strong> <Markdown source={d.mandate} inline /></div>
                          {/if}
                          {#if d.concerns?.length}
                            <div class="coord-concerns">
                              <strong>Review checks:</strong>
                              {d.concerns.map(c => c.description ?? c.id).join(', ')}
                            </div>
                          {/if}
                        </UtilityPanel>
                      {/each}
                    </div>
                  </details>
                {:else if t.spec}
                  <UtilityPanel className="spec-preview-panel" tone="neutral" dense>
                    <div class="spec-preview"><Markdown source={t.spec} /></div>
                  </UtilityPanel>
                {:else if missingSpec}
                  <p class="error">The task is marked ready, but no spec was saved. Ask the spec author to write the spec before approving.</p>
                {/if}
                {#if t.status !== 'done'}
                  {@const blockedByQuestions = hasOpenQuestionsForTask(t.taskId)}
                  {@const openQuestionCount = openQuestionCountForTask(t.taskId)}
                  {#if blockedByQuestions}
                    <div class="gating-row">
                      <p class="lede gating">
                        {openQuestionCount} open question{openQuestionCount === 1 ? '' : 's'} still block{openQuestionCount === 1 ? 's' : ''} this decision.
                      </p>
                      <Button variant="secondary" size="sm" onclick={() => revealQuestionsForTask(t.taskId)}>
                        Go to questions
                      </Button>
                    </div>
                  {/if}
                  {#if replyTurnId === t.id}
                    {#if isFooterReplyTurn(t.id)}
                      <p class="next-question-note">Use the shared composer below to send your change request.</p>
                    {:else}
                      <Stack gap="2">
                        <Textarea
                          value={replyDrafts[t.id] ?? ''}
                          rows={4}
                          placeholder="Correct the spec or ask the agent to revisit it"
                          disabled={busyTurnId === t.id}
                          oninput={(v) => setReplyDraft(t.id, v)}
                        />
                        <Row justify="end" gap="2">
                          <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = null)}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            disabled={busyTurnId === t.id || !(replyDrafts[t.id] ?? '').trim()}
                            onclick={() => sendTaskReply(t)}
                          >
                            Send
                          </Button>
                        </Row>
                        {#if replyErrors[t.id]}
                          <p class="error">{replyErrors[t.id]}</p>
                        {/if}
                      </Stack>
                    {/if}
                  {:else}
                  <Row justify="end" gap="2">
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                      Details...
                    </Button>
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                      {isMetaIntakeDraft ? 'Change the split' : 'Request changes'}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busyTurnId === t.id || blockedByQuestions || missingSpec}
                      onclick={() => approveSpec(t)}
                    >
                      {isMetaIntakeDraft ? 'Yes, use this split' : 'Approve spec'}
                    </Button>
                  </Row>
                  {/if}
                {/if}

              {:else if t.kind === 'escalation'}
                {@const guidance = escalationUserGuidance({ summary: t.summary, details: t.details, reason: t.escalationReason, agentId: t.escalationAgentId })}
                {@const recoveryAction = escalationPrimaryAction({ reason: t.escalationReason, agentId: t.escalationAgentId, summary: t.summary, details: t.details })}
                <h3 class="prompt">{guidance.actionOwner === 'guildhall' ? 'Guildhall can continue' : 'Needs recovery'}</h3>
                <p class="why">{guidance.title}</p>
                <p class="detail">{guidance.detail}</p>
                <p class="detail">{guidance.nextStep}</p>
                {#if guidance.technicalNote}
                  <p class="detail"><strong>Technical note:</strong> {guidance.technicalNote}</p>
                {/if}
                {#if t.activity?.length}
                  <UtilityPanel className="live-activity" tone="neutral" ariaLabel="Recent agent activity">
                    {#each t.activity.slice(0, 3) as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                      <StatusLine
                        label={item.label}
                        detail={item.detail}
                        time={activityElapsed(item.at)}
                        tone={item.tone}
                        pulse={item.tone === 'running'}
                      />
                    {/each}
                    {#if t.activity.length > 3}
                      <details class="thread-disclosure activity-disclosure">
                        <summary>Show {t.activity.length - 3} earlier update{t.activity.length - 3 === 1 ? '' : 's'}</summary>
                        <div class="activity-extra">
                          {#each t.activity.slice(3) as item, index (`${item.at ?? 'event'}:${item.label}:extra:${index}`)}
                            <StatusLine
                              label={item.label}
                              detail={item.detail}
                              time={activityElapsed(item.at)}
                              tone={item.tone}
                              pulse={item.tone === 'running'}
                            />
                          {/each}
                        </div>
                      </details>
                    {/if}
                  </UtilityPanel>
                {/if}
                {#if isActionableEscalation(t)}
                  <Row justify="end" gap="2" wrap>
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>Details...</Button>
                    {#if guidance.actionOwner === 'guildhall'}
                      <Button variant="agent" disabled={busyTurnId === t.id || runBusy} onclick={() => resolveEscalationAndResume(t)}>
                        <Icon name="sparkles" size={14} />
                        {recoveryAction.label}
                      </Button>
                    {:else}
                      <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => openEscalationResolution(t, 'retry')}>
                        <Icon name="sparkles" size={14} />
                        {recoveryAction.label}
                      </Button>
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => openEscalationResolution(t, 'resolve')}>
                        I handled this...
                      </Button>
                    {/if}
                  </Row>
                {/if}
              {:else if t.kind === 'review_feedback'}
                <StateSummary
                  label="Revision requested"
                  description={t.summary}
                  tone="warn"
                />
                <UtilityPanel className="review-feedback" tone="warn">
                  <p class="review-feedback-meta">
                    Review feedback{t.revisionCount ? ` · pass ${t.revisionCount}` : ''}
                  </p>
                  <p class="review-feedback-note">
                    Full reviewer notes live in the task details.
                  </p>
                  <Row justify="end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onclick={() => nav(currentTaskHref(t.taskId))}
                    >
                      Details...
                    </Button>
                  </Row>
                </UtilityPanel>
              {:else if t.kind === 'inflight'}
                <StateSummary
                  label={needsWorkerHandoffSpecCleanup(t) ? briefFixTitle(t) : taskStateLabel(t)}
                  description={taskStateDescription(t)}
                  tone={taskStateTone(t)}
                  showLabel={!isQueuedForGuildhall(t) || t.requestStage === 'task_brief_cleanup'}
                />
                {#if behindTheScenesNote(t)}
                  <StateSummary
                    label="Behind the scenes"
                    description={behindTheScenesNote(t) ?? ''}
                    tone="neutral"
                  />
                {/if}
                {#if needsWorkerHandoffSpecCleanup(t) && replyTurnId !== t.id}
                  {#if briefFixTurnId === t.id}
                    {@const draft = briefFixDrafts[t.id] ?? { successTarget: '', acceptanceCriterion: '' }}
                    <UtilityPanel className="brief-fix-panel" tone="accent">
                      <p class="brief-fix-intro">
                        Fill {missingChecklistTitles(t)} here. Guildhall will use this to finish the task brief.
                      </p>
                      {#if showBriefSuccessField(t)}
                        <label class="brief-fix-field">
                          <span>What should be true when this is done?</span>
                          <Textarea
                            value={draft.successTarget}
                            rows={3}
                            placeholder="Example: Future component docs use human-readable labels while keeping stable ui-* doc ids."
                            disabled={busyTurnId === t.id}
                            oninput={(v) => setBriefFixDraft(t.id, 'successTarget', v)}
                          />
                        </label>
                      {/if}
                      {#if showBriefAcceptanceField(t)}
                        <label class="brief-fix-field">
                          <span>How should Guildhall check it?</span>
                          <Textarea
                            value={draft.acceptanceCriterion}
                            rows={3}
                            placeholder="Example: Reviewer can find the convention note and confirm it gives one clear example."
                            disabled={busyTurnId === t.id}
                            oninput={(v) => setBriefFixDraft(t.id, 'acceptanceCriterion', v)}
                          />
                        </label>
                      {/if}
                      <Row justify="end" gap="2">
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (briefFixTurnId = null)}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          disabled={busyTurnId === t.id || !canSaveBriefFix(t)}
                          onclick={() => saveBriefFix(t)}
                        >
                          Save brief
                        </Button>
                      </Row>
                      {#if briefFixErrors[t.id]}
                        <p class="error">{briefFixErrors[t.id]}</p>
                      {/if}
                    </UtilityPanel>
                  {:else}
                    <Row justify="end" gap="2">
                      <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                        Add optional note
                      </Button>
                      {#if projectRunBlocksTaskStart(t)}
                        <Button variant="secondary" disabled>Already queued</Button>
                      {:else}
                        <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                          <Icon name="sparkles" size={14} />
                          {briefFixButtonLabel(t)}
                        </Button>
                      {/if}
                    </Row>
                  {/if}
                {/if}
                {#if t.taskDescription || t.sourceNote}
                  <details class="thread-disclosure task-context-disclosure">
                    <summary>
                      <span>Starting point and source notes</span>
                      {#if t.sourceNote?.references?.length}
                        <Chip label={badgeCountLabel(t.sourceNote.references.length)} tone="neutral" />
                      {/if}
                    </summary>
                    <UtilityPanel className="task-context" tone="neutral">
                    {#if t.taskDescription}
                      <div class="field">
                        <span class="field-label">Starting point</span>
                        <Markdown source={t.taskDescription} />
                      </div>
                    {/if}
                    {#if t.sourceNote?.references?.length}
                      <div class="field">
                        <span class="field-label">Imported from</span>
                        <div class="source-list">
                          {#each t.sourceNote.references as ref (ref)}
                            <button
                              type="button"
                              class="source-ref"
                              title="Open source note"
                              aria-label={`Open source note ${ref}`}
                              disabled={sourcePreviewLoadingRef === ref}
                              onclick={() => void openSourceNote(ref)}
                              >
                                <span>Open source note</span>
                                <code>{sourceDisplayName(ref)}</code>
                                {#if sourceDisplayHint(ref) !== sourceDisplayName(ref)}
                                  <small>{sourceDisplayHint(ref)}</small>
                                {/if}
                              </button>
                            {/each}
                          </div>
                        {#if sourcePreviewError}
                          <p class="error">{sourcePreviewError}</p>
                        {/if}
                      </div>
                    {/if}
                    </UtilityPanel>
                  </details>
                {/if}
                {#if t.taskId !== 'task-meta-intake' && t.taskStatus === 'exploring' && !turnLiveAgent(t) && !isQueuedSpecRevision(t)}
                  <Row justify="end" gap="2" wrap>
                    <Button variant="secondary" onclick={() => nav(currentTaskHref(t.taskId))}>
                      Details...
                    </Button>
                    <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                      Add optional note
                    </Button>
                    {#if projectRunBlocksTaskStart(t)}
                      <Button variant="secondary" disabled>Already queued</Button>
                    {:else}
                      <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                        <Icon name="sparkles" size={14} />
                        {startTaskLabel(t)}
                      </Button>
                    {/if}
                  </Row>
                {/if}
                {#if t.activity?.length}
                  <UtilityPanel className="live-activity" tone="neutral" ariaLabel="Recent agent activity">
                    {#each t.activity.slice(0, 3) as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                      <StatusLine
                        label={item.label}
                        detail={item.detail}
                        time={activityElapsed(item.at)}
                        tone={item.tone}
                        pulse={item.tone === 'running'}
                      />
                    {/each}
                    {#if t.activity.length > 3}
                      <details class="thread-disclosure activity-disclosure">
                        <summary>Show {t.activity.length - 3} earlier update{t.activity.length - 3 === 1 ? '' : 's'}</summary>
                        <div class="activity-extra">
                          {#each t.activity.slice(3) as item, index (`${item.at ?? 'event'}:${item.label}:extra:${index}`)}
                            <StatusLine
                              label={item.label}
                              detail={item.detail}
                              time={activityElapsed(item.at)}
                              tone={item.tone}
                              pulse={item.tone === 'running'}
                            />
                          {/each}
                        </div>
                      </details>
                    {/if}
                  </UtilityPanel>
                {/if}
                {#if t.checklist}
                  <details class="thread-disclosure checklist-disclosure" open={!hasIncompleteTaskChecklist(t)}>
                    <summary>
                      <span>{checklistTitleForTurn(t)}</span>
                      <Chip label={`${t.checklist.doneCount} of ${t.checklist.totalSteps}`} tone={checklistToneForTurn(t)} />
                    </summary>
                    <UtilityPanel className="live-checklist" tone={checklistToneForTurn(t)}>
                    <div class="live-checklist-steps">
                      {#each t.checklist.steps as step (step.id)}
                        <div class="live-step" class:done={step.status === 'done'} class:active={step.status === 'active'}>
                          <StatusLight
                            tone={checklistStepTone(t, step)}
                            pulse={step.status === 'active' && Boolean(turnLiveAgent(t))}
                          />
                          <div class="live-step-copy">
                            <strong>{step.title}</strong>
                            <span>{step.why}</span>
                          </div>
                          <span class="live-step-state">
                            {checklistStepLabel(t, step)}
                          </span>
                        </div>
                      {/each}
                    </div>
                    </UtilityPanel>
                  </details>
                {/if}
                {#if replyTurnId === t.id}
                  {#if isFooterReplyTurn(t.id)}
                    <p class="next-question-note">Use the shared composer below to send this note.</p>
                  {:else}
                    <Stack gap="2">
                      <Textarea
                        value={replyDrafts[t.id] ?? ''}
                        rows={4}
                        placeholder={needsRecovery(t)
                          ? 'Add recovery context, constraints, or what the next attempt should inspect first'
                          : 'Tell the agent what to do next'}
                        disabled={busyTurnId === t.id}
                        oninput={(v) => setReplyDraft(t.id, v)}
                      />
                      <Row justify="end" gap="2">
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = null)}>
                          Cancel
                        </Button>
                          <Button
                            variant="primary"
                            disabled={busyTurnId === t.id || !(replyDrafts[t.id] ?? '').trim()}
                            onclick={() => sendTaskReply(t)}
                          >
                          {needsRecovery(t) ? 'Send recovery note' : 'Send'}
                        </Button>
                      </Row>
                      {#if replyErrors[t.id]}
                        <p class="error">{replyErrors[t.id]}</p>
                      {/if}
                    </Stack>
                  {/if}
              {:else if !needsWorkerHandoffSpecCleanup(t)}
                  <Row justify="end" gap="2">
                    {#if t.taskStatus === 'ready' && !turnLiveAgent(t) && !needsWorkerHandoffSpecCleanup(t)}
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => markTaskDone(t)}>
                        Mark done...
                      </Button>
                    {/if}
                    {#if needsRecovery(t) && !turnLiveAgent(t)}
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                        Inspect recovery
                      </Button>
                      <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                        Add recovery note
                      </Button>
                      {#if projectRunBlocksTaskStart(t)}
                        <Button variant="secondary" disabled>Already queued</Button>
                      {:else if canStartTaskTurn(t)}
                        <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                          <Icon name="sparkles" size={14} />
                          {startTaskLabel(t)}
                        </Button>
                      {/if}
                    {:else if t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring') && !turnLiveAgent(t)}
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                        Details...
                      </Button>
                      <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                        Add optional note
                      </Button>
                      {#if t.taskStatus === 'import_draft'}
                        <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => shapeDraft(t)}>
                          <Icon name="sparkles" size={14} />
                          {startTaskLabel(t)}
                        </Button>
                      {:else if projectRunBlocksTaskStart(t)}
                        <Button variant="secondary" disabled>Already queued</Button>
                      {:else if canStartTaskTurn(t)}
                        <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                          <Icon name="sparkles" size={14} />
                          {startTaskLabel(t)}
                        </Button>
                      {/if}
                    {:else if t.taskId === 'task-meta-intake' && !turnLiveAgent(t)}
                      <Button variant="secondary" onclick={focusSetupPhase}>
                        Open setup
                      </Button>
                      {#if !startReadiness?.canStart}
                        {#if startReadiness?.actionHref}
                          <Button variant="human" onclick={() => nav(projectActionHref(startReadiness.actionHref))}>
                            <Icon name="arrow-right" size={14} />
                            {metaSetupActionLabel()}
                          </Button>
                        {/if}
                      {:else if projectRunBlocksTaskStart(t)}
                        <Button variant="secondary" disabled>Already queued</Button>
                      {:else if canStartTaskTurn(t)}
                        {#if metaIntakeChecklistComplete(t)}
                          <Button
                            variant="agent"
                            disabled={busyTurnId === t.id}
                            onclick={() => synthesizeMetaIntake(t)}
                          >
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {:else if hasPendingSetupStep('provider')}
                          <Button variant="secondary" onclick={() => nav('/providers')}>
                            Connect provider
                          </Button>
                        {:else if hasPendingSetupStep('bootstrap')}
                          <Button variant="secondary" onclick={() => nav(currentProjectHref('/settings'))}>
                            Run setup checks
                          </Button>
                        {:else}
                          <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {/if}
                      {/if}
                    {:else if isQueuedSpecRevision(t)}
                      <Button variant="secondary" onclick={() => nav(currentTaskHref(t.taskId))}>
                        Open details
                      </Button>
                      {#if projectRunBlocksTaskStart(t)}
                        <Button variant="secondary" disabled>Already queued</Button>
                      {:else if canStartTaskTurn(t)}
                        <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                          <Icon name="sparkles" size={14} />
                          {startTaskLabel(t)}
                        </Button>
                      {/if}
                    {:else}
                      <Button variant={t.taskStatus === 'exploring' ? 'human' : 'secondary'} onclick={() => nav(currentTaskHref(t.taskId))}>
                        Details...
                      </Button>
                      {#if needsWorkerHandoffSpecCleanup(t)}
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add optional note
                        </Button>
                        {#if projectRunBlocksTaskStart(t)}
                          <Button variant="secondary" disabled>Already queued</Button>
                        {:else}
                          <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                            <Icon name="sparkles" size={14} />
                            {briefFixButtonLabel(t)}
                          </Button>
                        {/if}
                      {:else if t.taskStatus === 'ready' && !turnLiveAgent(t)}
                        {#if projectRunBlocksTaskStart(t)}
                          <Button variant="secondary" disabled>Already queued</Button>
                        {:else if canStartTaskTurn(t)}
                          <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                            Add optional note
                          </Button>
                          <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {/if}
                      {:else if projectRunBlocksTaskStart(t)}
                        <Button variant="secondary" disabled>Already queued</Button>
                      {:else if canStartTaskTurn(t)}
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add optional note
                        </Button>
                        {#if metaIntakeChecklistComplete(t)}
                          <Button
                            variant="agent"
                            disabled={busyTurnId === t.id}
                            onclick={() => synthesizeMetaIntake(t)}
                          >
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {:else if t.taskStatus === 'import_draft'}
                          <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => shapeDraft(t)}>
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {:else}
                          <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {/if}
                      {:else}
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add optional note
                        </Button>
                      {/if}
                    {:else}
                      {#if !t.importedDraft}
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add optional note
                        </Button>
                      {/if}
                    {/if}
                  </Row>
                  {#if runError && canStartTaskTurn(t)}
                    <p class="error">{runError}</p>
                  {/if}
                  {#if sentReplies[t.id]}
                    <UtilityPanel className="answer-panel" tone="neutral" dense>
                      <p class="answer">
                        Saved. {canStartTaskTurn(t)
                          ? 'Guildhall will read it on the next Start.'
                          : 'The agent will read it on the next run.'}
                      </p>
                    </UtilityPanel>
                  {/if}
                  {#if replyErrors[t.id]}
                    <p class="error">{replyErrors[t.id]}</p>
                  {/if}
                {/if}
              {/if}
              </InteractionCardLayout>
            </Card>
          </div>
        {/if}
        {/if}
                      {/each}
                    </Stack>
                  </div>

                {#if caughtUp}
                  <p class="muted caught-up">
                    {#if operationSummary.needsYou > 0}
                      Needs your input before Guildhall can continue.
                    {:else if operationSummary.working > 0}
                      Agents are working.
                    {:else if operationSummary.queued > 0 || operationSummary.drafts > 0}
                      Guildhall has queued work ready for the next run.
                    {:else if allTerminalReadinessMessage}
                      {allTerminalReadinessMessage}
                    {:else}
                      All caught up — nothing is running right now.
                    {/if}
                  </p>
                {/if}

                {#if activeDockTurn}
                  <div
                    class="thread-active-dock"
                    aria-label="Active thread dock"
                    data-turn-id={activeDockTurn.id}
                  >
                    <Card tone={tone(activeDockTurn)} frosted>
                      <div class="thread-active-dock-body">
                        <div class="thread-active-dock-head">
                          <div class="thread-active-dock-copy">
                            <strong>{activeDockTitle(activeDockTurn)}</strong>
                            {#if activeDockSummary(activeDockTurn)}
                              <p>{activeDockSummary(activeDockTurn)}</p>
                            {/if}
                          </div>
                          <div class="thread-active-dock-chips">
                            {#if ownershipLabel(activeDockTurn)}
                              <Chip label={ownershipLabel(activeDockTurn) ?? ''} tone={ownershipTone(activeDockTurn)} />
                            {:else if showStatusChip(activeDockTurn)}
                              <Chip label={turnStatusChipLabel(activeDockTurn)} tone={turnStatusChipTone(activeDockTurn)} />
                            {/if}
                          </div>
                        </div>

                        {#if activeDockTurn.kind === 'inflight'}
                          {#if turnLiveAgent(activeDockTurn)}
                            {@const live = turnLiveAgent(activeDockTurn)}
                            <StatusLine
                              label={liveAgentMessage(live)}
                              tone={liveAgentTone(live)}
                              pulse
                              loud
                            />
                          {/if}

                          {#if gitStoryVisible(activeDockTurn) && activeDockTurn.gitStory}
                            <div class="git-story-callout" aria-label="Git story">
                              <div class="git-story-main">
                                <Chip label={gitStoryLabel(activeDockTurn.gitStory)} tone={gitStoryTone(activeDockTurn.gitStory)} />
                                <span>{gitStorySummary(activeDockTurn.gitStory)}</span>
                              </div>
                              {#if activeDockTurn.gitStory.nextAction}
                                <span class="git-story-next">{activeDockTurn.gitStory.nextAction}</span>
                              {/if}
                            </div>
                          {/if}

                          {#if dockSourceSummary(activeDockTurn)}
                            <p class="thread-active-summary">{dockSourceSummary(activeDockTurn)}</p>
                          {/if}

                          {#if activeDockTurn.taskDescription || activeDockTurn.sourceNote}
                            <details class="thread-disclosure task-context-disclosure">
                              <summary>
                                <span>Starting point and source notes</span>
                                {#if activeDockTurn.sourceNote?.references?.length}
                                  <Chip label={badgeCountLabel(activeDockTurn.sourceNote.references.length)} tone="neutral" />
                                {/if}
                              </summary>
                              <UtilityPanel className="task-context" tone="neutral">
                                {#if activeDockTurn.taskDescription}
                                  <div class="field">
                                    <span class="field-label">Starting point</span>
                                    <Markdown source={activeDockTurn.taskDescription} />
                                  </div>
                                {/if}
                                {#if activeDockTurn.sourceNote?.references?.length}
                                  <div class="field">
                                    <span class="field-label">Imported from</span>
                                    <div class="source-list">
                                      {#each activeDockTurn.sourceNote.references as ref (ref)}
                                        <button
                                          type="button"
                                          class="source-ref"
                                          title="Open source note"
                                          aria-label={`Open source note ${ref}`}
                                          disabled={sourcePreviewLoadingRef === ref}
                                          onclick={() => void openSourceNote(ref)}
                                        >
                                          <span>Open source note</span>
                                          <code>{sourceDisplayName(ref)}</code>
                                          {#if sourceDisplayHint(ref) !== sourceDisplayName(ref)}
                                            <small>{sourceDisplayHint(ref)}</small>
                                          {/if}
                                        </button>
                                      {/each}
                                    </div>
                                    {#if sourcePreviewError}
                                      <p class="error">{sourcePreviewError}</p>
                                    {/if}
                                  </div>
                                {/if}
                              </UtilityPanel>
                            </details>
                          {/if}

                          {#if dockChecklistSummary(activeDockTurn)}
                            {@const checklistSummary = dockChecklistSummary(activeDockTurn)}
                            <UtilityPanel className="thread-active-checklist" tone={checklistToneForTurn(activeDockTurn)}>
                              <div class="thread-active-checklist-head">
                                <strong>{checklistTitleForTurn(activeDockTurn)}</strong>
                              </div>
                              <div class="thread-active-checklist-lines">
                                <div class="thread-active-checklist-line">
                                  <span>{checklistSummary.complete}</span>
                                </div>
                                <div class="thread-active-checklist-line">
                                  <span>{checklistSummary.missing}</span>
                                </div>
                              </div>
                            </UtilityPanel>
                          {/if}

                          {#if activeDockTurn.checklist}
                            <details class="thread-disclosure checklist-disclosure" open={!hasIncompleteTaskChecklist(activeDockTurn)}>
                              <summary>
                                <span>{checklistTitleForTurn(activeDockTurn)}</span>
                                <Chip label={`${activeDockTurn.checklist.doneCount} of ${activeDockTurn.checklist.totalSteps}`} tone={checklistToneForTurn(activeDockTurn)} />
                              </summary>
                              <UtilityPanel className="live-checklist" tone={checklistToneForTurn(activeDockTurn)}>
                                <div class="live-checklist-steps">
                                  {#each activeDockTurn.checklist.steps as step (step.id)}
                                    <div class="live-step" class:done={step.status === 'done'} class:active={step.status === 'active'}>
                                      <StatusLight
                                        tone={checklistStepTone(activeDockTurn, step)}
                                        pulse={step.status === 'active' && Boolean(turnLiveAgent(activeDockTurn))}
                                      />
                                      <div class="live-step-copy">
                                        <strong>{step.title}</strong>
                                        <span>{step.why}</span>
                                      </div>
                                      <span class="live-step-state">
                                        {checklistStepLabel(activeDockTurn, step)}
                                      </span>
                                    </div>
                                  {/each}
                                </div>
                              </UtilityPanel>
                            </details>
                          {/if}

                          {#if activeDockTurn.activity?.length}
                            <UtilityPanel className="live-activity" tone="neutral" ariaLabel="Recent agent activity">
                              {#each activeDockTurn.activity.slice(0, 3) as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                                <StatusLine
                                  label={item.label}
                                  detail={item.detail}
                                  time={activityElapsed(item.at)}
                                  tone={item.tone}
                                  pulse={item.tone === 'running'}
                                />
                              {/each}
                              {#if activeDockTurn.activity.length > 3}
                                <details class="thread-disclosure activity-disclosure">
                                  <summary>Show {activeDockTurn.activity.length - 3} earlier update{activeDockTurn.activity.length - 3 === 1 ? '' : 's'}</summary>
                                  <div class="activity-extra">
                                    {#each activeDockTurn.activity.slice(3) as item, index (`${item.at ?? 'event'}:${item.label}:extra:${index}`)}
                                      <StatusLine
                                        label={item.label}
                                        detail={item.detail}
                                        time={activityElapsed(item.at)}
                                        tone={item.tone}
                                        pulse={item.tone === 'running'}
                                      />
                                    {/each}
                                  </div>
                                </details>
                              {/if}
                            </UtilityPanel>
                          {/if}

                          <Row justify="end" gap="2" wrap>
                            <Button variant="secondary" onclick={() => nav(currentTaskHref(activeDockTurn.taskId))}>
                              {needsRecovery(activeDockTurn) ? 'Inspect recovery' : 'Details...'}
                            </Button>
                            {#if needsRecovery(activeDockTurn) && !turnLiveAgent(activeDockTurn)}
                              <Button variant="ghost" disabled={busyTurnId === activeDockTurn.id} onclick={() => (replyTurnId = activeDockTurn.id)}>
                                Add recovery note
                              </Button>
                            {/if}
                            {#if activeDockTurn.taskStatus === 'ready' && !turnLiveAgent(activeDockTurn) && !needsWorkerHandoffSpecCleanup(activeDockTurn)}
                              <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => markTaskDone(activeDockTurn)}>
                                Mark done...
                              </Button>
                            {/if}
                            {#if activeDockTurn.taskStatus === 'import_draft'}
                              <Button variant="agent" disabled={busyTurnId === activeDockTurn.id} onclick={() => shapeDraft(activeDockTurn)}>
                                <Icon name="sparkles" size={14} />
                                {startTaskLabel(activeDockTurn)}
                              </Button>
                            {:else if activeDockTurn.taskId === 'task-meta-intake' && metaIntakeChecklistComplete(activeDockTurn)}
                              <Button variant="agent" disabled={busyTurnId === activeDockTurn.id} onclick={() => synthesizeMetaIntake(activeDockTurn)}>
                                <Icon name="sparkles" size={14} />
                                {startTaskLabel(activeDockTurn)}
                              </Button>
                            {:else if projectRunBlocksTaskStart(activeDockTurn)}
                              <Button variant="secondary" disabled>Already queued</Button>
                            {:else if canStartTaskTurn(activeDockTurn)}
                              <Button
                                variant="agent"
                                disabled={runBusy || busyTurnId === activeDockTurn.id}
                                onclick={() => startTaskRun(activeDockTurn.taskId)}
                              >
                                <Icon name="sparkles" size={14} />
                                {startTaskLabel(activeDockTurn)}
                              </Button>
                            {/if}
                          </Row>
                          {#if runError && canStartTaskTurn(activeDockTurn)}
                            <p class="error">{runError}</p>
                          {/if}
                        {:else if activeDockTurn.kind === 'escalation'}
                          {@const guidance = escalationUserGuidance({ summary: activeDockTurn.summary, details: activeDockTurn.details, reason: activeDockTurn.escalationReason, agentId: activeDockTurn.escalationAgentId })}
                          {@const recoveryAction = escalationPrimaryAction({ reason: activeDockTurn.escalationReason, agentId: activeDockTurn.escalationAgentId, summary: activeDockTurn.summary, details: activeDockTurn.details })}
                          <p class="detail">{guidance.detail}</p>
                          <p class="detail">{guidance.nextStep}</p>
                          {#if guidance.technicalNote}
                            <p class="detail"><strong>Technical note:</strong> {guidance.technicalNote}</p>
                          {/if}
                          {#if activeDockTurn.activity?.length}
                            <UtilityPanel className="live-activity" tone="neutral" ariaLabel="Recent agent activity">
                              {#each activeDockTurn.activity.slice(0, 3) as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                                <StatusLine
                                  label={item.label}
                                  detail={item.detail}
                                  time={activityElapsed(item.at)}
                                  tone={item.tone}
                                  pulse={item.tone === 'running'}
                                />
                              {/each}
                              {#if activeDockTurn.activity.length > 3}
                                <details class="thread-disclosure activity-disclosure">
                                  <summary>Show {activeDockTurn.activity.length - 3} earlier update{activeDockTurn.activity.length - 3 === 1 ? '' : 's'}</summary>
                                  <div class="activity-extra">
                                    {#each activeDockTurn.activity.slice(3) as item, index (`${item.at ?? 'event'}:${item.label}:extra:${index}`)}
                                      <StatusLine
                                        label={item.label}
                                        detail={item.detail}
                                        time={activityElapsed(item.at)}
                                        tone={item.tone}
                                        pulse={item.tone === 'running'}
                                      />
                                    {/each}
                                  </div>
                                </details>
                              {/if}
                            </UtilityPanel>
                          {/if}
                          <Row justify="end" gap="2" wrap>
                            <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => nav(currentTaskHref(activeDockTurn.taskId))}>Details...</Button>
                            {#if guidance.actionOwner === 'guildhall'}
                              <Button variant="agent" disabled={busyTurnId === activeDockTurn.id || runBusy} onclick={() => resolveEscalationAndResume(activeDockTurn)}>
                                <Icon name="sparkles" size={14} />
                                {recoveryAction.label}
                              </Button>
                            {:else}
                              <Button variant="agent" disabled={busyTurnId === activeDockTurn.id} onclick={() => openEscalationResolution(activeDockTurn, 'retry')}>
                                <Icon name="sparkles" size={14} />
                                {recoveryAction.label}
                              </Button>
                              <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => openEscalationResolution(activeDockTurn, 'resolve')}>
                                I handled this...
                              </Button>
                            {/if}
                          </Row>
                        {:else if activeDockTurn.kind === 'agent_question'}
                          {@const dockQuestions = visibleQuestionsForCard(questionsForTurn(activeDockTurn))}
                          <div class="thread-active-question">
                            <strong>{dockQuestions.length === 1 ? 'Latest question' : 'Open questions'}</strong>
                            {#each dockQuestions as question (question.id)}
                              <div class="thread-active-question-block">
                                <Markdown source={question.restatement ?? question.prompt ?? ''} />
                                {#if question.kind === 'choice' && question.choices?.length}
                                  <div class="pressure-choice-list" aria-label="Answer choices">
                                    {#each question.choices as choice}
                                      <Button
                                        variant="secondary"
                                        disabled={busyTaskId === activeDockTurn.taskId}
                                        onclick={() => answerQuestion({ ...activeDockTurn, question }, choice)}
                                      >
                                        {choice}
                                      </Button>
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/each}
                          </div>
                          {#if replyErrors[activeDockTurn.id]}
                            <p class="error">{replyErrors[activeDockTurn.id]}</p>
                          {/if}
                          <UtilityPanel className="question-context-actions" tone="neutral">
                            {#if contextTurnId === activeDockTurn.id}
                              <div class="question-context-copy">
                                <strong>Reply using the shared composer below.</strong>
                                <span>Guildhall will keep this question open and explain the missing context first.</span>
                              </div>
                            {:else}
                              <div class="question-context-copy">
                                <strong>Missing context is expected.</strong>
                                <span>Ask Guildhall to explain project terms, source notes, or assumptions before you answer. This keeps the question open.</span>
                              </div>
                              <Button
                                variant="human"
                                size="sm"
                                disabled={busyTurnId === activeDockTurn.id}
                                onclick={() => (contextTurnId = activeDockTurn.id)}
                              >
                                Ask Guildhall to explain
                              </Button>
                            {/if}
                          </UtilityPanel>
                        {:else if activeDockTurn.kind === 'pressure_test_question'}
                          <div class="thread-active-question">
                            <strong>{pressureQuestionMeta(activeDockTurn)}</strong>
                            <Markdown source={pressureQuestionPrompt(activeDockTurn)} />
                            {#if activeDockTurn.question.evidence.length}
                              <div class="field">
                                <span class="field-label">Evidence</span>
                                <ul class="bullet">
                                  {#each activeDockTurn.question.evidence as item}
                                    <li><Markdown source={item} inline /></li>
                                  {/each}
                                </ul>
                              </div>
                            {/if}
                            {#if activeDockTurn.question.choices?.length}
                              <div class="pressure-choice-list" aria-label="Answer choices">
                                {#each activeDockTurn.question.choices as choice}
                                  <Button
                                    variant="secondary"
                                    disabled={busyTurnId === activeDockTurn.id}
                                    onclick={() => answerPressureTestQuestion(activeDockTurn, choice)}
                                  >
                                    {choice}
                                  </Button>
                              {/each}
                            </div>
                          {/if}
                        </div>
                        {:else if activeDockTurn.kind === 'bounded_chat'}
                          <UtilityPanel className="bounded-chat-panel" tone="neutral">
                            <div class="thread-active-question">
                              <strong>{pressureQuestionMeta(activeDockTurn)}</strong>
                              <Markdown source={pressureQuestionPrompt(activeDockTurn)} />
                              <p class="why">{pressureQuestionWhy(activeDockTurn)}</p>
                              {#if activeDockTurn.question.evidence.length}
                                <div class="field">
                                  <span class="field-label">Evidence</span>
                                  <ul class="bullet">
                                    {#each activeDockTurn.question.evidence as item}
                                      <li><Markdown source={item} inline /></li>
                                    {/each}
                                  </ul>
                                </div>
                              {/if}
                              {#if activeDockTurn.question.choices?.length}
                                <div class="pressure-choice-list" aria-label="Answer choices">
                                  {#each activeDockTurn.question.choices as choice}
                                    <Button
                                      variant="secondary"
                                      disabled={busyTurnId === activeDockTurn.id}
                                      onclick={() => answerPressureTestQuestion(activeDockTurn, choice)}
                                    >
                                      {choice}
                                    </Button>
                                  {/each}
                                </div>
                              {/if}
                            </div>
                          </UtilityPanel>
                        {:else if activeDockTurn.kind === 'brief_approval'}
                          {@const blockedByQuestions = hasOpenQuestionsForTask(activeDockTurn.taskId)}
                          {@const briefScope = briefScopeForReaders(activeDockTurn.brief, activeDockTurn.taskTitle)}
                          {@const briefDoneWhen = briefDoneWhenForReaders(activeDockTurn.brief)}
                          <div class="thread-active-review">
                            <div class="field"><span class="field-label">Scope</span>
                              <Markdown source={briefScope} />
                            </div>
                            {#if briefDoneWhen}
                              <div class="field"><span class="field-label">Done when</span>
                                <Markdown source={briefDoneWhen} />
                              </div>
                            {/if}
                          </div>
                          <Row justify="end" gap="2" wrap>
                            <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => openBriefPreview(activeDockTurn)}>
                              View brief
                            </Button>
                            <Button variant="ghost" disabled={busyTurnId === activeDockTurn.id} onclick={() => nav(currentTaskHref(activeDockTurn.taskId))}>
                              Details...
                            </Button>
                            <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => (replyTurnId = activeDockTurn.id)}>
                              No, change it
                            </Button>
                            <Button
                              variant="primary"
                              disabled={busyTurnId === activeDockTurn.id || blockedByQuestions}
                              onclick={() => approveBrief(activeDockTurn)}
                            >
                              Yes, that's right
                            </Button>
                          </Row>
                        {:else if activeDockTurn.kind === 'spec_review'}
                          {@const missingSpec = activeDockTurn.taskId !== 'task-meta-intake' && activeDockTurn.spec.trim().length === 0}
                          {@const blockedByQuestions = hasOpenQuestionsForTask(activeDockTurn.taskId)}
                          <div class="thread-active-review">
                            <p class="thread-active-summary">
                              {activeDockTurn.taskId === 'task-meta-intake'
                                ? 'Open the full split before you approve it or redirect it.'
                                : 'Open the full spec before you approve it or redirect it.'}
                            </p>
                          </div>
                          <Row justify="end" gap="2" wrap>
                            <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => openSpecPreview(activeDockTurn)}>
                              View spec
                            </Button>
                            <Button variant="ghost" disabled={busyTurnId === activeDockTurn.id} onclick={() => nav(currentTaskHref(activeDockTurn.taskId))}>
                              Details...
                            </Button>
                            <Button variant="secondary" disabled={busyTurnId === activeDockTurn.id} onclick={() => (replyTurnId = activeDockTurn.id)}>
                              {activeDockTurn.taskId === 'task-meta-intake' ? 'Change the split' : 'Request changes'}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={busyTurnId === activeDockTurn.id || blockedByQuestions || missingSpec}
                              onclick={() => approveSpec(activeDockTurn)}
                            >
                              {activeDockTurn.taskId === 'task-meta-intake' ? 'Yes, use this split' : 'Approve spec'}
                            </Button>
                          </Row>
                        {/if}

                      </div>
                    </Card>
                  </div>
                {/if}

                {#if footerComposer}
                  <div class="thread-footer" aria-label="Thread footer">
                    <div class="thread-composer-shell" aria-label="Thread composer" class:thread-composer-working={footerComposer.kind === 'working'}>
                      {#if footerComposer.kind === 'working'}
                          <div class="thread-composer-head">
                            <div class="thread-composer-copy">
                              <strong>{footerComposer.title}</strong>
                              <p>{footerComposer.description}</p>
                            </div>
                          </div>
                          <StatusLine
                            label={footerComposer.title}
                            detail={footerComposer.description}
                            tone="running"
                            pulse
                            loud
                          />
                        {:else}
                          {#if footerComposer.kind !== 'task_reply'}
                            <div class="thread-composer-head">
                              <div class="thread-composer-copy">
                                <strong>{footerComposer.title}</strong>
                                <p>{footerComposer.description}</p>
                              </div>
                            </div>
                          {/if}
                          <div class="thread-composer-frame">
                            <div class="thread-composer-input-shell">
                              <Textarea
                                value={footerComposer.kind === 'task_reply'
                                  ? (replyDrafts[footerComposer.turn.id] ?? '')
                                  : footerComposer.kind === 'question_context'
                                    ? (contextDrafts[footerComposer.turn.id] ?? '')
                                    : footerComposer.kind === 'agent_question_text'
                                      ? (footerQuestionDrafts[footerComposer.question.id] ?? '')
                                      : (pressureTestAnswers[footerComposer.turn.id] ?? '')}
                                rows={2}
                                resize="none"
                                placeholder={footerComposer.placeholder}
                                disabled={footerComposer.kind === 'agent_question_text'
                                  ? busyTaskId === footerComposer.turn.taskId
                                  : busyTurnId === footerComposer.turn.id}
                                oninput={(value) => {
                                  if (footerComposer.kind === 'task_reply') setReplyDraft(footerComposer.turn.id, value)
                                  else if (footerComposer.kind === 'question_context') setContextDraft(footerComposer.turn.id, value)
                                  else if (footerComposer.kind === 'agent_question_text') setFooterQuestionDraft(footerComposer.question.id, value)
                                  else setPressureTestAnswer(footerComposer.turn.id, value)
                                }}
                              />
                              <div class="thread-composer-actions">
                                {#if footerComposer.kind === 'question_context'}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busyTurnId === footerComposer.turn.id}
                                    onclick={() => {
                                      contextTurnId = null
                                      setContextDraft(footerComposer.turn.id, '')
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                {/if}
                                <Button
                                  variant={footerComposer.kind === 'question_context' ? 'agent' : 'primary'}
                                  size="sm"
                                  iconOnly
                                  rounded
                                  ariaLabel={busyTurnId === (footerComposer.kind === 'agent_question_text' ? undefined : footerComposer.turn.id) ? 'Sending' : 'Send'}
                                  title="Send"
                                  disabled={
                                    footerComposer.kind === 'task_reply'
                                      ? busyTurnId === footerComposer.turn.id || !(replyDrafts[footerComposer.turn.id] ?? '').trim()
                                      : footerComposer.kind === 'question_context'
                                        ? busyTurnId === footerComposer.turn.id || !(contextDrafts[footerComposer.turn.id] ?? '').trim()
                                        : footerComposer.kind === 'agent_question_text'
                                          ? busyTaskId === footerComposer.turn.taskId || !(footerQuestionDrafts[footerComposer.question.id] ?? '').trim()
                                          : busyTurnId === footerComposer.turn.id || !(pressureTestAnswers[footerComposer.turn.id] ?? '').trim()
                                  }
                                  onclick={() => {
                                    if (footerComposer.kind === 'task_reply') void sendTaskReply(footerComposer.turn)
                                    else if (footerComposer.kind === 'question_context') void askQuestionContext(footerComposer.turn)
                                    else if (footerComposer.kind === 'agent_question_text') void answerFooterQuestion(footerComposer.turn, footerComposer.question)
                                    else void answerPressureTestQuestion(footerComposer.turn)
                                  }}
                                >
                                  <Icon name="arrow-up" size={14} />
                                </Button>
                              </div>
                            </div>
                            {#if footerComposer.kind === 'task_reply' && replyErrors[footerComposer.turn.id]}
                              <p class="error">{replyErrors[footerComposer.turn.id]}</p>
                            {:else if footerComposer.kind === 'question_context' && contextErrors[footerComposer.turn.id]}
                              <p class="error">{contextErrors[footerComposer.turn.id]}</p>
                            {:else if footerComposer.kind === 'agent_question_text' && replyErrors[footerComposer.turn.id]}
                              <p class="error">{replyErrors[footerComposer.turn.id]}</p>
                            {:else if footerComposer.kind === 'pressure_test' && pressureTestErrors[footerComposer.turn.id]}
                              <p class="error">{pressureTestErrors[footerComposer.turn.id]}</p>
                            {/if}
                          </div>
                      {/if}
                    </div>
                  </div>
                {/if}
                </div>
              </div>
            </div>
          </section>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

</div>

<ResolveEscalationModal
  open={escalationModal !== null}
  escalation={escalationModalRecord}
  mode={escalationModal?.mode ?? 'resolve'}
  busy={Boolean(escalationModal && busyTurnId === escalationModal.turn.id)}
  onClose={() => (escalationModal = null)}
  onSubmit={submitEscalationResolution}
/>

<Modal
  open={Boolean(sourcePreview)}
  title="Source note"
  size="lg"
  onClose={() => {
    sourcePreviewRequestId += 1
    sourcePreview = null
    sourcePreviewError = null
    sourcePreviewLoadingRef = null
  }}
>
  {#if sourcePreview}
    <div class="source-preview">
      <div class="source-preview-path">
        <span>Imported from</span>
        <code>{sourcePreview.displayPath}</code>
      </div>
      {#if sourcePreview.truncated}
        <p class="source-preview-warning">Preview truncated to keep Thread responsive.</p>
      {/if}
      <UtilityPanel className="source-preview-body" tone="neutral">
        {#if sourcePreview.loading}
          <p class="muted">Opening source note...</p>
        {:else if sourcePreviewError}
          <p class="error">{sourcePreviewError}</p>
        {:else}
          <Markdown source={sourcePreview.content || '_This source note is empty._'} />
        {/if}
      </UtilityPanel>
    </div>
  {/if}
</Modal>

<Modal
  open={Boolean(documentPreview)}
  title={documentPreview?.title ?? 'Document'}
  size="lg"
  onClose={() => {
    documentPreview = null
  }}
>
  {#if documentPreview}
    <div class="thread-document-preview">
      <header class="thread-document-preview-head">
        <strong>{documentPreview.taskTitle}</strong>
      </header>
      <Markdown source={documentPreview.content} />
    </div>
  {/if}
</Modal>

<style>
  .thread {
    --thread-color-strong: var(--gh-color-text-primary);
    --thread-color-body: var(--gh-color-text-body);
    --thread-color-soft: var(--gh-color-text-secondary);
    --thread-color-muted: var(--text-muted);
    width: 100%;
    margin: 0;
    flex: 1 1 auto;
    min-height: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .thread-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-3);
    overflow: hidden;
  }
  .lede { margin: 0; color: var(--thread-color-muted); font-size: var(--gh-type-size-meta); }
  .handoff-copy {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
    max-width: 44rem;
  }
  .handoff-copy span {
    color: var(--text-muted);
  }
  .thread-columns {
    display: grid;
    flex: 1 1 auto;
    grid-template-columns: clamp(220px, 24vw, 320px) minmax(0, 1fr);
    gap: 0;
    align-items: stretch;
    min-height: 0;
    height: 100%;
    margin-inline: 0;
    overflow: hidden;
  }
  .thread-columns.thread-columns-compact {
    grid-template-columns: minmax(0, 1fr);
  }
  .thread-index {
    position: relative;
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding: var(--gh-space-2);
    border-right: 1px solid color-mix(in srgb, var(--border) 92%, transparent);
  }
  .thread-index-list {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  :global(.thread-index-row) { width: 100%; color: var(--gh-color-text-body); }
  .thread-index-row-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gh-space-2);
  }
  .thread-index-row-top strong {
    min-width: 0;
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
    font-weight: var(--gh-type-weight-medium);
  }
  :global(.thread-index-row.is-selected) .thread-index-row-top strong {
    color: var(--gh-color-text-primary);
    font-weight: var(--gh-type-weight-strong);
  }
  .thread-index-time {
    flex: none;
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-medium);
  }
  .thread-index-row-chips {
    display: flex;
    align-items: center;
    gap: var(--gh-space-1);
    flex-wrap: wrap;
    min-height: 1rem;
    margin-bottom: 2px;
  }
  :global(.thread-index-row) p {
    margin: 0;
    color: var(--thread-color-soft);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .thread-detail {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
    min-height: 0;
    height: 100%;
    overflow: auto;
    scrollbar-gutter: stable;
    padding-left: var(--gh-space-4);
    padding-right: var(--gh-space-4);
  }
  .thread-detail-scroll-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .thread-detail-scroll {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-3);
    min-height: 100%;
    padding-top: var(--gh-space-1);
  }
  .thread-detail-flow {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-3);
    min-height: 100%;
  }
  .thread-detail-header {
    display: grid;
    gap: var(--gh-space-1);
    padding: var(--gh-space-2) 0 var(--gh-space-1);
  }
  .thread-detail-header strong {
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .thread-detail-header p {
    margin: 0;
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-list {
    margin-top: auto;
  }
  .turn-active-focus :global(.card) {
    border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .thread-composer-shell {
    position: relative;
    z-index: 1;
    display: grid;
    gap: var(--gh-space-2);
  }
  .thread-footer {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: grid;
    gap: var(--gh-space-2);
    padding-top: var(--gh-space-1);
    padding-bottom: var(--gh-layout-sticky-footer-padding-bottom);
    background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg-base) 88%, transparent) 18%, var(--bg-base) 100%);
  }
  .thread-active-dock {
    position: relative;
    z-index: 1;
    padding-inline: 0;
  }
  .thread-active-dock :global(.card) {
    padding: var(--gh-space-3);
  }
  .thread-active-dock-body {
    display: grid;
    gap: var(--gh-space-3);
  }
  .thread-active-dock-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gh-space-2);
  }
  .thread-active-dock-copy {
    min-width: 0;
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-active-dock-copy strong {
    color: var(--gh-color-text-primary);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
    font-weight: var(--gh-type-weight-strong);
  }
  .thread-active-dock-copy p {
    margin: 0;
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-active-dock-chips {
    display: flex;
    align-items: center;
    gap: var(--gh-space-1);
    flex-wrap: wrap;
  }
  .thread-active-checklist {
    display: grid;
    gap: var(--gh-space-2);
  }
  .thread-active-checklist-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-2);
  }
  .thread-active-checklist-lines {
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-active-checklist-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-2);
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-active-checklist-line.is-complete { color: var(--gh-color-text-disabled); }
  .thread-active-question,
  .thread-active-review {
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-active-summary {
    margin: 0;
    color: var(--thread-color-body);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-active-question-block {
    display: grid;
    gap: var(--gh-space-2);
  }
  .thread-composer-head {
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-composer-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
  }
  .thread-composer-copy strong {
    color: var(--thread-color-strong);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
  }
  .thread-composer-copy p {
    margin: 0;
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-composer-frame {
    --thread-composer-action-inset: var(--gh-space-2);
    --thread-composer-action-size: 32px;
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-composer-input-shell {
    position: relative;
  }
  .thread-composer-input-shell :global(.textarea) {
    display: block;
    min-height: 74px;
    padding-right: calc(var(--thread-composer-action-inset) + var(--thread-composer-action-size) + var(--control-pad-x));
    padding-bottom: calc(var(--thread-composer-action-inset) + var(--thread-composer-action-size) + var(--control-pad-y));
    font-size: var(--gh-type-size-meta);
  }
  .thread-composer-actions {
    position: absolute;
    right: var(--thread-composer-action-inset);
    bottom: var(--thread-composer-action-inset);
    display: flex;
    align-items: center;
    gap: var(--gh-space-1);
  }
  @media (max-width: 1100px) {
    .thread-columns {
      grid-template-columns: clamp(200px, 30vw, 280px) minmax(0, 1fr);
    }
    .thread-columns.thread-columns-compact {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 900px) {
    .thread {
      width: 100%;
      padding: 0;
    }
    .thread-columns {
      margin-inline: 0;
      gap: 0;
    }
    .thread.thread-compact-list {
      padding-top: 0;
    }
    .thread.thread-compact-list .thread-index {
      position: static;
      top: auto;
      max-height: none;
      overflow: visible;
      padding: var(--gh-space-2) var(--app-shell-page-padding-inline, var(--gh-space-2)) var(--gh-space-3);
    }
    .thread.thread-compact-list .thread-index-list {
      gap: var(--gh-space-2);
    }
    .thread.thread-compact-list .thread-index-row-top strong {
      font-size: var(--gh-type-size-meta);
    }
    .thread.thread-compact-list .thread-index-list p {
      -webkit-line-clamp: 1;
      font-size: var(--gh-type-size-caption);
    }
    .thread.thread-compact-detail {
      padding-top: 0;
    }
    .thread.thread-compact-detail .thread-columns {
      margin-inline: 0;
    }
    .thread.thread-compact-detail .thread-detail {
      position: relative;
      top: 0;
      min-height: 0;
      height: 100%;
      max-height: none;
      padding-right: 0;
      padding-left: 0;
    }
    .thread.thread-compact-detail .thread-detail-scroll-wrap {
      border-radius: 0;
    }
    .thread.thread-compact-detail .thread-detail-scroll {
      padding-inline: 0;
    }
    .thread.thread-compact-detail .thread-active-dock {
      padding-inline: 0;
    }
  }
  .turn :global(.card) {
    padding: var(--gh-space-3);
  }
  .thread-history-item {
    display: grid;
    gap: var(--gh-space-2);
  }
  .thread-history-item-question {
    gap: var(--gh-space-3);
  }
  .thread-chat-bubble {
    max-width: min(42rem, 74%);
    display: grid;
    gap: var(--gh-space-1);
    padding: var(--gh-space-2) var(--gh-space-3);
    border: 1px solid color-mix(in srgb, var(--glass-border-strong) 40%, var(--border));
    border-radius: var(--gh-radius-full);
    box-shadow:
      var(--glass-shadow),
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
    backdrop-filter: saturate(1.12) blur(14px);
    -webkit-backdrop-filter: saturate(1.12) blur(14px);
  }
  .thread-chat-bubble-agent {
    justify-self: start;
    background:
      linear-gradient(180deg, color-mix(in srgb, white 3%, transparent), transparent 34%),
      color-mix(in srgb, var(--bg-raised) 84%, transparent);
    border-color: color-mix(in srgb, var(--glass-border-strong) 44%, var(--border));
  }
  .thread-chat-bubble-user {
    justify-self: end;
    background:
      linear-gradient(180deg, color-mix(in srgb, white 5%, transparent), transparent 32%),
      color-mix(in srgb, var(--accent) 16%, var(--bg-raised));
    border-color: color-mix(in srgb, var(--accent) 30%, var(--glass-border-strong));
  }
  .thread-chat-bubble-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gh-space-2);
  }
  .thread-chat-bubble-head strong {
    color: var(--thread-color-strong);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
    font-weight: var(--gh-type-weight-strong);
  }
  .thread-chat-bubble-head span {
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-medium);
  }
  .thread-chat-bubble p {
    margin: 0;
    color: var(--thread-color-body);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-event {
    --thread-event-accent: color-mix(in srgb, var(--accent-warn) 72%, transparent);
    --thread-event-title: color-mix(in srgb, var(--text) 78%, var(--text-soft));
    --thread-event-copy: color-mix(in srgb, var(--text) 88%, var(--text-muted));
    display: grid;
    gap: var(--gh-space-2);
    padding: var(--gh-space-1) 0 var(--gh-space-2) var(--gh-space-3);
    border: 0;
    background: none;
    box-shadow: none;
    position: relative;
  }
  .thread-event::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.1rem;
    bottom: 0.15rem;
    width: 2px;
    border-radius: var(--gh-radius-full);
    background: var(--thread-event-accent);
    box-shadow: 0 0 18px color-mix(in srgb, var(--thread-event-accent) 18%, transparent);
  }
  .thread-event-source {
    --thread-event-accent: color-mix(in srgb, var(--accent) 66%, transparent);
    --thread-event-title: color-mix(in srgb, var(--accent) 62%, var(--text-soft));
  }
  .thread-event-request {
    --thread-event-accent: color-mix(in srgb, var(--accent-2) 68%, transparent);
    --thread-event-title: color-mix(in srgb, var(--accent-2) 60%, var(--text-soft));
  }
  .thread-event-system {
    --thread-event-accent: color-mix(in srgb, var(--text-soft) 42%, transparent);
    --thread-event-title: color-mix(in srgb, var(--text-soft) 92%, var(--text-muted));
    --thread-event-copy: color-mix(in srgb, var(--text-soft) 88%, var(--text-muted));
  }
  .thread-event-milestone {
    --thread-event-accent: color-mix(in srgb, var(--accent-warn) 70%, transparent);
    --thread-event-title: color-mix(in srgb, var(--accent-warn) 58%, var(--text-soft));
  }
  .thread-event-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gh-space-2);
  }
  .thread-event-head strong {
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
    color: var(--thread-event-title);
    font-weight: var(--gh-type-weight-strong);
  }
  .thread-event-head span {
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-medium);
  }
  .thread-event p {
    margin: 0;
    color: var(--thread-event-copy);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .thread-event-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-1);
  }
  .thread-event-link {
    display: inline-flex;
    align-items: center;
    gap: var(--gh-space-1);
    padding: 0.35rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--glass-border-strong) 32%, var(--border));
    border-radius: var(--gh-radius-full);
    background: color-mix(in srgb, var(--bg-raised) 72%, transparent);
    color: var(--thread-color-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-control);
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      color 140ms ease;
  }
  .thread-event-link:hover:not(:disabled),
  .thread-event-link:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 32%, var(--glass-border-strong));
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-raised));
    color: var(--text);
  }
  .thread-event-link:disabled {
    opacity: 0.65;
  }
  .thread-history-cluster {
    display: grid;
    gap: var(--gh-space-2);
  }
  .thread-history-cluster summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .thread-document-preview {
    display: grid;
    gap: var(--gh-space-3);
  }
  .thread-document-preview-head {
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-document-preview-head strong {
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
  }
  .thread-history-cluster-list {
    display: grid;
    gap: var(--gh-space-2);
    padding-top: var(--gh-space-1);
  }
  .thread-history-cluster-item {
    display: grid;
    gap: var(--gh-space-1);
  }
  .thread-history-cluster-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gh-space-2);
  }
  .thread-history-cluster-head strong {
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
  }
  .thread-history-cluster-head span {
    color: var(--text-soft);
    font-size: var(--gh-type-size-caption);
  }
  .thread-history-cluster-item p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
  }
  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--gh-space-1);
    min-width: 0;
    color: var(--text-muted);
  }
  .persona {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-medium);
    line-height: var(--gh-type-line-height-tight);
  }
  .archive-time {
    color: var(--text-soft);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
  }
  .task-chip {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text);
    padding: 0 var(--gh-space-1);
    margin: -1px calc(-1 * var(--gh-space-1));
    border-radius: var(--gh-radius-1);
    cursor: pointer;
    font: inherit;
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-medium);
    line-height: var(--gh-type-line-height-tight);
    text-align: left;
  }
  .task-chip:hover {
    color: var(--text);
    background: var(--bg-raised-2);
    border-color: var(--border);
  }
  .task-chip-text {
    display: block;
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: left;
  }
  .prompt { margin: 0; font-size: var(--gh-type-size-panel-title); font-weight: var(--gh-type-weight-medium); line-height: var(--gh-type-line-height-tight); }
  .question-card-heading {
    display: grid;
    gap: var(--gh-space-1);
  }
  .question-card-meta {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-medium);
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .setup-title {
    display: flex;
    align-items: center;
    gap: var(--gh-space-2);
    flex-wrap: wrap;
  }
  .prompt-row {
    display: flex;
    align-items: center;
    gap: var(--gh-space-1);
  }
  .prompt :global(.md),
  :global(.coord) :global(.coord-title) :global(.md),
  :global(.coord) :global(.coord-mandate) :global(.md),
  .answer :global(.md) {
    color: inherit;
    font-size: inherit;
    line-height: inherit;
  }
  .why { margin: 0; color: var(--text-muted); font-size: var(--gh-type-size-body); line-height: var(--gh-type-line-height-body); }
  .next-question-note {
    margin: 0;
    color: var(--text-soft);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .pressure-choice-list {
    display: flex;
    align-items: stretch;
    gap: var(--gh-space-2);
    flex-wrap: wrap;
  }
  .git-story-callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-2);
    flex-wrap: wrap;
    padding: var(--gh-space-2);
    border: 1px solid color-mix(in srgb, var(--warning) 32%, var(--border));
    border-radius: var(--gh-radius-1);
    background: color-mix(in srgb, var(--warning) 8%, var(--bg));
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .git-story-main {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--gh-space-2);
    flex-wrap: wrap;
  }
  .git-story-main span:last-child {
    overflow-wrap: anywhere;
  }
  .git-story-next {
    color: var(--gh-color-text-body);
    font-weight: var(--gh-type-weight-strong);
  }
  :global(.runtime-state-row) {
    gap: var(--gh-space-2);
  }
  :global(.setup-context) {
    display: grid;
    gap: var(--gh-space-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.setup-context) strong {
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-medium);
  }
  :global(.setup-context) p {
    margin: 0;
  }
  :global(.setup-context) ul {
    display: grid;
    gap: var(--gh-space-1);
    margin: 0;
    padding-inline-start: var(--gh-space-4);
  }
  .gating-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-2);
    flex-wrap: wrap;
  }
  .detail { margin: 0; color: var(--text-muted); font-size: var(--gh-type-size-meta); }
  .field { display: flex; flex-direction: column; gap: var(--gh-space-1); }
  .field :global(.md) {
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-body);
  }
  .field-label {
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
    font-weight: var(--gh-type-weight-medium);
  }
  :global(.task-context) {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  .thread-disclosure {
    border: 1px solid var(--border);
    border-radius: var(--gh-radius-1);
    background: color-mix(in srgb, var(--bg) 78%, transparent);
  }
  .thread-disclosure > summary {
    min-height: var(--control-h-sm);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-2);
    padding: var(--gh-space-1) var(--gh-space-2);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-medium);
    list-style-position: inside;
  }
  .thread-disclosure > summary:hover {
    color: var(--text);
    background: var(--bg-raised);
  }
  .thread-disclosure[open] > summary {
    border-bottom: 1px solid var(--border);
  }
  .task-context-disclosure :global(.task-context) {
    border: 0;
    border-radius: 0 0 var(--gh-radius-1) var(--gh-radius-1);
    background: transparent;
    box-shadow: none;
    padding: var(--gh-space-2);
  }
  .source-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--gh-space-2);
  }
  .source-ref {
    appearance: none;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--gh-space-1);
    max-width: 100%;
    border: 1px solid color-mix(in srgb, var(--accent-2) 46%, var(--border));
    border-radius: var(--gh-radius-1);
    background: color-mix(in srgb, var(--accent-2) 8%, transparent);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    padding: var(--gh-space-1) var(--gh-space-2);
    text-align: left;
  }
  .source-ref span {
    color: var(--accent-2);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-control);
  }
  .source-ref code {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    color: var(--text);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent-2) 56%, transparent);
    text-underline-offset: 3px;
  }
  .source-ref small {
    max-width: 100%;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
    overflow-wrap: anywhere;
  }
  .source-ref:disabled {
    cursor: progress;
    opacity: 0.65;
  }
  .source-ref:hover {
    border-color: var(--accent-2);
    background: color-mix(in srgb, var(--accent-2) 13%, transparent);
  }
  .source-ref:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  :global(.question-context-actions) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-2);
    flex-wrap: wrap;
  }
  :global(.question-context-actions) :global(.btn) {
    flex: none;
  }
  :global(.question-context-actions) :global(.stack) {
    width: 100%;
  }
  .question-context-copy {
    min-width: 220px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
  }
  .question-context-copy span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .source-preview {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-3);
  }
  .source-preview-path {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
  }
  .source-preview-path code {
    color: var(--text);
    text-transform: none;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .source-preview-warning {
    margin: 0;
    color: var(--warn);
    font-size: var(--gh-type-size-meta);
  }
  :global(.source-preview-body) { padding: var(--gh-space-3); }
  .question-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  .question-inline {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
    padding: var(--gh-space-2);
    border: 1px solid var(--glass-inset-border);
    border-radius: var(--gh-radius-3);
    background:
      radial-gradient(circle at 90% 10%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 30%),
      var(--glass-inset-bg);
    box-shadow: var(--glass-inset-etch), var(--glass-inset-shadow);
  }
  .question-more-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .setup-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-2);
    align-items: start;
  }
  :global(.answer-panel) {
    padding: var(--gh-space-2);
  }
  .answer { margin: 0; font-size: var(--gh-type-size-body); }
  .bullet { padding-left: var(--gh-space-4); margin: 0; font-size: var(--gh-type-size-body); }
  :global(.spec-preview-panel) { padding: var(--gh-space-2); }
  .spec-preview { max-height: 240px; overflow: auto; }
  .coord-list {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  .decision-question {
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
  }
  .draft-summary-list {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  :global(.draft-summary-item) {
    display: flex;
    align-items: center;
    gap: var(--gh-space-2);
    font-size: var(--gh-type-size-body);
  }
  .draft-details {
    border: 1px solid var(--border);
    border-radius: var(--gh-radius-2);
    background: var(--bg);
    padding: var(--gh-space-2) var(--gh-space-3);
  }
  .draft-details summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
  }
  .draft-details[open] summary {
    margin-bottom: var(--gh-space-2);
  }
  :global(.coord) {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.coord) :global(.coord-mandate) {
    margin: 0;
    color: var(--text);
  }
  :global(.coord) :global(.coord-concerns) {
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.live-checklist) {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  :global(.live-activity) {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
  }
  :global(.live-activity) :global(.status-detail) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .activity-disclosure {
    background: transparent;
  }
  .activity-disclosure > summary {
    min-height: auto;
    padding: var(--gh-space-1);
  }
  .activity-extra {
    display: grid;
    gap: var(--gh-space-1);
    padding: var(--gh-space-1);
  }
  :global(.review-feedback) {
    display: grid;
    gap: var(--gh-space-2);
  }
  .review-feedback-meta {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
  }
  .review-feedback-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.dev-server-row),
  :global(.capability-request-row) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--gh-space-3);
  }
  .dev-server-main,
  .capability-request-main {
    min-width: 0;
    display: grid;
    gap: var(--gh-space-1);
  }
  .dev-server-main p,
  .capability-request-main p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .compact-field {
    margin-top: var(--gh-space-1);
  }
  .dev-server-logs {
    margin: var(--gh-space-2) 0 0;
    max-height: 12rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--gh-type-size-meta);
  }
  :global(.brief-fix-panel) {
    display: grid;
    gap: var(--gh-space-2);
  }
  .brief-fix-intro {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .brief-fix-field {
    display: grid;
    gap: var(--gh-space-1);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
  }
  .live-checklist-head,
  .live-step {
    display: flex;
    align-items: center;
    gap: var(--gh-space-2);
  }
  .live-checklist-head {
    justify-content: space-between;
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }
  .live-checklist-head span,
  .live-step-state {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-medium);
    text-transform: uppercase;
  }
  .live-checklist-steps {
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-2);
  }
  .live-step {
    min-height: 44px;
  }
  .live-step-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gh-space-1);
    color: var(--text);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .live-step-copy span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .live-step.done .live-step-copy { color: var(--gh-color-text-disabled); }
  .live-step.done .live-step-copy strong {
    color: var(--gh-color-text-disabled);
    font-weight: var(--gh-type-weight-medium);
  }
  .live-step.active .live-step-copy strong {
    color: var(--gh-color-text-primary);
    font-weight: var(--gh-type-weight-strong);
  }
  .live-step.active .live-step-state {
    color: var(--warn);
  }
  .turn-done { opacity: 0.7; }
  .turn-pending { opacity: 1; }
  .turn-import-queue { opacity: 1; }
  .turn-import-queue :global(.card) {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }
  .muted { color: var(--text-muted); }
  .caught-up { text-align: center; padding: var(--gh-space-3); }
  .section-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gh-space-3);
    padding: var(--gh-space-2) var(--gh-space-3);
    background: var(--bg-raised-2);
    border: 1px dashed var(--border);
    border-radius: var(--gh-radius-2);
  }
  .gating {
    color: var(--warn, #d0a146);
    font-size: var(--gh-type-size-meta);
    margin: 0;
  }
  .section-status {
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
    margin-right: auto;
  }
  .error {
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
    margin: 0;
  }
  @media (max-width: 640px) {
    .thread-composer-head {
      flex-direction: column;
    }
    .thread-composer-actions {
      align-items: stretch;
    }
    :global(.dev-server-row),
    :global(.capability-request-row) {
      grid-template-columns: 1fr;
    }
    .setup-form {
      grid-template-columns: 1fr;
    }
  }
</style>
