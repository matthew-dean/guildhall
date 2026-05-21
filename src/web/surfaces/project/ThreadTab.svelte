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
  import { onMount, onDestroy, tick } from 'svelte'
  import Card from '../../lib/Card.svelte'
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
  import { friendlyStewardName } from '../../lib/display.js'
  import InteractionCardLayout from '../../lib/InteractionCardLayout.svelte'
  import { onEvent } from '../../lib/events.js'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { buildThreadPhaseGroups } from '../../lib/project-data.js'
  import { project } from '../../lib/project.svelte.js'
  import { toast } from 'svelte-sonner'

  interface Props {
    projectId?: string | null
  }

  const props = $props<Props>()
  const explicitProjectId = $derived(props.projectId?.trim() || null)

  // ---- Turn shape (mirrors src/runtime/thread.ts) ------------------------
  type TurnPersona = 'intake' | 'spec' | 'worker' | 'reviewer' | 'coord' | 'system'
  type TurnStatus = 'done' | 'active' | 'pending'
  type TurnPhase = 'setup' | 'intake' | 'spec' | 'ready' | 'inflight' | 'blocked' | 'done'
  type ConstructionMode = 'survey' | 'blueprint' | 'frame' | 'build' | 'inspect' | 'change_order' | 'punch_list'
  type SetupAffordance = 'link' | 'inline-text' | 'inline-textarea' | 'inline-button' | 'inline-choice'
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
    brief: {
      userJob?: string; successMetric?: string; successCriteria?: string
      antiPatterns?: string[]; rolloutPlan?: string; authoredBy?: string
    }
    liveAgent?: LiveAgent | undefined
    approvedAt?: string | null
  }
  interface AgentQuestionTurn {
    kind: 'agent_question'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    constructionMode?: ConstructionMode | undefined
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
    constructionMode?: ConstructionMode | undefined
    summary: string; details?: string
    activity?: LiveActivity[] | undefined
  }
  interface ReviewFeedbackTurn {
    kind: 'review_feedback'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    constructionMode?: ConstructionMode | undefined
    summary: string; feedback: string; revisionCount?: number | undefined
  }
  interface InFlightTurn {
    kind: 'inflight'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; taskStatus?: string; summary: string
    constructionMode?: ConstructionMode | undefined
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
  type Turn =
    | SetupStepTurn
    | BriefTurn
    | AgentQuestionTurn
    | SpecReviewTurn
    | ReviewFeedbackTurn
    | EscalationTurn
    | InFlightTurn

  let turns = $state<Turn[]>([])
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
  let contextTurnId = $state<string | null>(null)
  let contextDrafts = $state<Record<string, string>>({})
  let contextErrors = $state<Record<string, string>>({})
  let sourcePreview = $state<{ ref: string; displayPath: string; content: string; truncated: boolean } | null>(null)
  let sourcePreviewLoadingRef = $state<string | null>(null)
  let sourcePreviewError = $state<string | null>(null)
  let importHandoff = $state<{ tasksAdded: number; sourceCount: number } | null>(null)
  let importHandoffFocused = $state(false)
  let lastScrolledId = $state<string | null>(null)
  let lastExpandedForId = $state<string | null>(null)
  let expandedPhases = $state<Record<TurnPhase, boolean>>({
    setup: true,
    intake: false,
    spec: false,
    ready: false,
    inflight: false,
    blocked: false,
    done: false,
  })
  let expandedCrowdedPhases = $state<Record<string, boolean>>({})
  let pollHandle: ReturnType<typeof setInterval> | null = null
  let clockHandle: ReturnType<typeof setInterval> | null = null
  let loadTimer: ReturnType<typeof setTimeout> | null = null
  let loadInFlight = false
  let loadQueued = false
  let nowMs = $state(Date.now())
  let runBusy = $state(false)
  let runError = $state<string | null>(null)
  const turnElements = new Map<string, HTMLDivElement>()
  const startReadiness = $derived(project.detail?.startReadiness ?? null)
  const runStatus = $derived(project.detail?.run?.status ?? 'stopped')

  // Staged answers for co-active agent_question turns. Keyed by question id.
  // Submitted as a batch (per-task) via POST /answer-questions so the agent
  // gets one resume with the full set of answers, not N partial resumes.
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

  function stageAnswer(questionId: string, answer: string): void {
    const trimmed = answer.trim()
    if (!trimmed) return
    staged = { ...staged, [questionId]: trimmed }
  }
  function unstageAnswer(questionId: string): void {
    const next = { ...staged }
    delete next[questionId]
    staged = next
  }

  function sourcePath(ref: string): string {
    const cleaned = ref.trim()
    if (!cleaned) return ''
    const fileMatch = cleaned.match(/^(.+?\.(?:md|mdx|txt|tsx?|jsx?|svelte|vue|json|ya?ml|css|scss|html))(?:[:#].*)?$/i)
    return (fileMatch?.[1] ?? cleaned).trim()
  }

  async function openSourceNote(ref: string): Promise<void> {
    const candidate = sourcePath(ref)
    if (!candidate) return
    sourcePreviewLoadingRef = ref
    sourcePreviewError = null
    try {
      const r = await scopedProjectFetch(`/api/project/source-note?path=${encodeURIComponent(candidate)}`, { cache: 'no-store' })
      const body = (await r.json().catch(() => ({}))) as {
        error?: string
        displayPath?: string
        content?: string
        truncated?: boolean
      }
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      sourcePreview = {
        ref,
        displayPath: body.displayPath ?? candidate,
        content: body.content ?? '',
        truncated: Boolean(body.truncated),
      }
    } catch (err) {
      sourcePreviewError = err instanceof Error ? err.message : String(err)
    } finally {
      sourcePreviewLoadingRef = null
    }
  }

  async function load(): Promise<void> {
    try {
      const r = await scopedProjectFetch('/api/project/thread', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { turns?: Turn[]; activeTurnId?: string | null; caughtUp?: boolean }
      turns = j.turns ?? []
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
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
      turns = []
      activeTurnId = null
      caughtUp = false
    } finally {
      loaded = true
    }
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
    pollHandle = setInterval(() => scheduleLoad(100), 4000)
    clockHandle = setInterval(() => {
      nowMs = Date.now()
    }, 5000)
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
    return (
      turn.taskStatus === 'exploring' &&
      !turn.importedDraft &&
      !turn.liveAgent &&
      !turn.checklist &&
      turn.phase === 'spec'
    )
  }

  function tone(t: Turn): 'ok' | 'warn' | 'neutral' | 'accent' {
    if (t.status === 'done') return 'ok'
    const owner = ownershipLabel(t)
    if (owner === 'Needs you') return 'warn'
    if (owner === 'Guildhall next' || owner === 'Guildhall working') return 'accent'
    if (t.status === 'active') return 'warn'
    return 'neutral'
  }

  function turnStatusChipLabel(t: Turn): string {
    if (t.status === 'done') return 'done'
    if (t.kind === 'inflight' && t.taskId === 'task-meta-intake' && !t.liveAgent) {
      return t.status === 'active' ? 'needs setup' : 'setup next'
    }
    if (t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring') && !t.liveAgent) {
      return 'needs you'
    }
    if (t.kind === 'inflight' && t.status === 'active' && !t.liveAgent) {
      return canStartTaskTurn(t) ? 'queued' : 'paused'
    }
    if (t.kind === 'spec_review' && t.status === 'active') return 'awaiting approval'
    return t.status === 'active' ? 'now' : 'next'
  }

  function turnStatusChipTone(t: Turn): 'ok' | 'warn' | 'neutral' | 'accent' {
    if (t.status === 'done') return 'ok'
    if (t.kind === 'inflight' && t.taskId === 'task-meta-intake' && !t.liveAgent) {
      return 'warn'
    }
    if (t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring') && !t.liveAgent) {
      return 'accent'
    }
    if (t.kind === 'inflight' && t.status === 'active' && !t.liveAgent) return 'neutral'
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

  function showStatusChip(t: Turn): boolean {
    const owner = ownershipLabel(t)?.trim().toLowerCase()
    const status = turnStatusChipLabel(t).trim().toLowerCase()
    return !(owner && owner === status)
  }

  function ownershipLabel(t: Turn): string | null {
    if (turnLiveAgent(t)) return 'Guildhall working'
    if (t.kind === 'setup_step') return t.status === 'done' ? null : 'Needs you'
    if (t.kind === 'agent_question' || t.kind === 'brief_approval' || t.kind === 'spec_review' || t.kind === 'escalation') {
      return t.status === 'done' ? null : 'Needs you'
    }
    if (t.kind === 'review_feedback') return 'Needs you'
    if (t.kind === 'inflight') {
      if (t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring')) {
        return 'Needs you'
      }
      if (canStartTaskTurn(t)) return 'Guildhall next'
    }
    return null
  }

  function ownershipTone(t: Turn): 'ok' | 'warn' | 'neutral' | 'accent' | 'running' {
    if (turnLiveAgent(t)) return 'running'
    const label = ownershipLabel(t)
    if (label === 'Needs you') return 'warn'
    if (label === 'Guildhall next') return 'accent'
    return 'neutral'
  }

  function isWorkingTurn(t: Turn): boolean {
    return t.status === 'active' && (t.kind === 'inflight' || Boolean(turnLiveAgent(t)))
  }

  function phaseCountTone(group: { phase: TurnPhase; turns: Turn[] }): 'neutral' | 'warn' | 'accent' {
    if (
      group.phase === 'inflight' &&
      group.turns.length > 0 &&
      group.turns.every(t => t.kind === 'inflight' && !t.liveAgent)
    ) {
      return 'neutral'
    }
    if (group.turns.some(t => isWorkingTurn(t))) return 'warn'
    if (group.turns.some(t => t.status === 'active')) return 'accent'
    return 'neutral'
  }

  function phaseIndicator(group: { phase: TurnPhase; turns: Turn[] }): { tone: 'active' | 'warn' | 'idle'; pulse: boolean; label: string } | null {
    if (group.turns.some(t => isWorkingTurn(t))) {
      return { tone: 'active', pulse: true, label: 'Guildhall working' }
    }
    if (group.turns.some(t => t.status === 'active')) {
      const needsYou = group.turns.some(t => ownershipLabel(t) === 'Needs you')
      return { tone: needsYou ? 'warn' : 'active', pulse: true, label: needsYou ? 'Needs your input' : 'Active' }
    }
    if (group.turns.some(t => t.status === 'pending')) {
      return { tone: 'idle', pulse: false, label: 'Queued work' }
    }
    return null
  }

  function turnLiveAgent(t: Turn): LiveAgent | undefined {
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

  const phaseGroups = $derived(buildThreadPhaseGroups(turns))
  const compactPhaseThreshold = 8
  const operationSummary = $derived.by(() => {
    let needsYou = 0
    let working = 0
    let blocked = 0
    let queued = 0
    let drafts = 0
    for (const turn of turns) {
      const owner = ownershipLabel(turn)
      if (owner === 'Needs you') needsYou += 1
      if (turnLiveAgent(turn)) working += 1
      if (turn.kind === 'escalation') blocked += 1
      if (owner === 'Guildhall next') queued += 1
      if (turn.kind === 'inflight' && turn.importedDraft) drafts += 1
    }
    return { needsYou, working, blocked, queued, drafts }
  })
  const displayPhaseGroups = $derived.by(() =>
    phaseGroups.map(group => ({
      ...group,
      turns: [...group.turns].sort(compareOperationTurns),
    })),
  )

  function questionsForTurn(turn: AgentQuestionTurn): AgentQuestionTurn['question'][] {
    return turn.questions && turn.questions.length > 0 ? turn.questions : [turn.question]
  }

  function captureTurn(node: HTMLDivElement, id: string) {
    turnElements.set(id, node)
    return {
      destroy() {
        if (turnElements.get(id) === node) turnElements.delete(id)
      },
    }
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
    expandedPhases = { ...expandedPhases, [first.phase]: true }
    queueMicrotask(() => {
      const el = turnElements.get(first.id)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  function hasPendingSetupStep(stepId: string): boolean {
    return turns.some(
      (turn) => turn.kind === 'setup_step' && turn.stepId === stepId && turn.status !== 'done',
    )
  }

  function focusSetupPhase(): void {
    expandOnly('setup')
    const firstSetup = turns.find((turn) => turn.kind === 'setup_step' && turn.status === 'active')
    if (!firstSetup) return
    void tick().then(() => {
      const el = turnElements.get(firstSetup.id)
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }

  function revealImportedDrafts(): void {
    const first = turns.find(
      t => t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring'),
    )
    if (!first) return
    expandedPhases = { ...expandedPhases, [first.phase]: true }
    queueMicrotask(() => {
      const el = turnElements.get(first.id)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  function togglePhase(phase: TurnPhase): void {
    expandedPhases = { ...expandedPhases, [phase]: !expandedPhases[phase] }
  }

  function shouldCompactPhase(group: { phase: TurnPhase; turns: Turn[] }): boolean {
    return group.turns.length >= compactPhaseThreshold && !expandedCrowdedPhases[group.phase]
  }

  function operationPriority(t: Turn): number {
    if (ownershipLabel(t) === 'Needs you') return 0
    if (turnLiveAgent(t)) return 1
    if (t.kind === 'escalation' || t.phase === 'blocked') return 2
    if (ownershipLabel(t) === 'Guildhall next') return 3
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

  function toggleCrowdedPhase(group: { phase: TurnPhase }): void {
    expandedCrowdedPhases = {
      ...expandedCrowdedPhases,
      [group.phase]: !expandedCrowdedPhases[group.phase],
    }
  }

  function operationCountLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function compactStatusLabel(t: Turn): string {
    const owner = ownershipLabel(t)
    if (owner) return owner
    if (t.kind === 'inflight') return taskStateLabel(t)
    if (t.kind === 'agent_question') return 'Question'
    if (t.kind === 'brief_approval') return 'Task brief ready'
    if (t.kind === 'spec_review') return 'Spec review'
    if (t.kind === 'escalation') return 'Blocked'
    if (t.kind === 'review_feedback') return 'Revision'
    if (t.kind === 'setup_step') return t.status === 'done' ? 'Done' : 'Setup'
    return t.status === 'done' ? 'Done' : 'Queued'
  }

  function compactTurnTitle(t: Turn): string {
    return 'taskTitle' in t ? displayTaskTitle(t) : t.title
  }

  function compactTurnDescription(t: Turn): string {
    if (t.kind === 'inflight') {
      if (t.importedDraft && t.taskStatus === 'import_draft' && !t.liveAgent) {
        return 'Needs task brief: turn this note into scope, evidence, and acceptance criteria.'
      }
      if (t.importedDraft && t.taskStatus === 'exploring' && !t.liveAgent) {
        return 'Task brief in progress: continue shaping the imported note.'
      }
      if (t.liveAgent) return liveAgentMessage(t.liveAgent)
      if (t.checklist) return `${t.checklist.title}: ${t.checklist.doneCount} of ${t.checklist.totalSteps} complete.`
      return taskStateDescription(t)
    }
    if (t.kind === 'agent_question') {
      const count = questionsForTurn(t).length
      return count === 1 ? 'Needs one answer before the task can continue.' : `Needs ${count} answers before the task can continue.`
    }
    if (t.kind === 'brief_approval') return 'Review the task brief; approve it to queue worker execution.'
    if (t.kind === 'spec_review') return t.taskId === 'task-meta-intake' ? 'Review the project split Guildhall inferred.' : 'Review the spec before worker execution.'
    if (t.kind === 'escalation') return t.summary
    if (t.kind === 'review_feedback') return t.summary
    if (t.kind === 'setup_step') return t.why
    return 'Open for details.'
  }

  function compactTone(t: Turn): 'active' | 'warn' | 'idle' {
    if (turnLiveAgent(t)) return 'active'
    if (ownershipLabel(t) === 'Needs you' || t.kind === 'escalation') return 'warn'
    return t.status === 'active' ? 'active' : 'idle'
  }

  function openCompactTurn(t: Turn): void {
    if ('taskId' in t) {
      nav(currentTaskHref(t.taskId))
      return
    }
    expandedCrowdedPhases = { ...expandedCrowdedPhases, [t.phase]: true }
    queueMicrotask(() => {
      const el = turnElements.get(t.id)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  function expandOnly(phase: TurnPhase): void {
    expandedPhases = {
      setup: phase === 'setup',
      intake: phase === 'intake',
      spec: phase === 'spec',
      ready: phase === 'ready',
      inflight: phase === 'inflight',
      blocked: phase === 'blocked',
      done: phase === 'done',
    }
  }

  $effect(() => {
    if (!activeTurnId || caughtUp || activeTurnId === lastExpandedForId) return
    const active = turns.find(t => t.id === activeTurnId)
    if (!active) return
    expandOnly(active.phase)
    lastExpandedForId = activeTurnId
  })

  $effect(() => {
    if (!importHandoff || importHandoffFocused || !loaded || turns.length === 0) return
    importHandoffFocused = true
    revealImportedDrafts()
  })

  $effect(() => {
    if (!activeTurnId || caughtUp || activeTurnId === lastScrolledId) return
    const targetId = activeTurnId
    void tick().then(() => {
      const el = turnElements.get(targetId)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'auto' })
      lastScrolledId = targetId
    })
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

  async function sendTaskReply(turn: BriefTurn | SpecReviewTurn | InFlightTurn): Promise<void> {
    const message = (replyDrafts[turn.id] ?? '').trim()
    if (!message) return
    busyTurnId = turn.id
    try {
      const r = await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          ...(turn.kind === 'inflight' ? { preserveStatus: true } : {}),
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
        return 'First task created.'
      case 'identity':
        return 'Project identity saved.'
      case 'coordinator':
      case 'routing':
        return 'Repo inspection started.'
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
      await load()
      const nextErrors = { ...setupErrors }
      delete nextErrors[turn.id]
      setupErrors = nextErrors
      toast.success(setupSuccessMessage(turn))
    } finally {
      busyTurnId = null
    }
  }

  async function submitSection(taskId: string): Promise<void> {
    // Collect every staged answer whose question belongs to this task and
    // is currently active. POST as a batch so the agent receives a single
    // resume with all answers — see /answer-questions in serve.ts.
    const sectionQuestions = turns
      .filter((t): t is AgentQuestionTurn =>
        t.kind === 'agent_question' && t.taskId === taskId && t.status === 'active',
      )
    const answers = sectionQuestions
      .flatMap(t => questionsForTurn(t).map(question => ({
        questionId: question.id,
        answer: staged[question.id],
      })))
      .filter((a): a is { questionId: string; answer: string } => typeof a.answer === 'string' && a.answer.length > 0)
    if (answers.length === 0) return
    busyTaskId = taskId
    try {
      await scopedProjectFetch(`/api/project/task/${encodeURIComponent(taskId)}/answer-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      // Clear the staged answers we just submitted.
      const next = { ...staged }
      for (const a of answers) delete next[a.questionId]
      staged = next
      await load()
    } finally { busyTaskId = null }
  }

  async function answerQuestion(turn: AgentQuestionTurn, answer: string): Promise<void> {
    const trimmed = answer.trim()
    if (!trimmed) return
    if (totalCountForTask(turn.taskId) > 1) {
      await persistDraftAnswer(turn.taskId, turn.question.id, trimmed)
      stageAnswer(turn.question.id, trimmed)
      return
    }
    busyTaskId = turn.taskId
    try {
      await scopedProjectFetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/answer-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: turn.question.id, answer: trimmed }] }),
      })
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
    if (turn.liveAgent?.name === 'spec-agent') return turn.importedDraft ? 'Shaping draft' : 'Drafting'
    if (turn.taskId === 'task-meta-intake' && !turn.liveAgent) return 'Project setup'
    if (turn.liveAgent?.name.startsWith('coordinator-')) return 'Ready'
    if (turn.liveAgent?.name === 'worker-agent') return 'In flight'
    if (turn.liveAgent?.name === 'reviewer-agent') return 'Review'
    if (turn.liveAgent?.name === 'gate-checker-agent') return 'Gates'
    switch (turn.taskStatus) {
      case 'import_draft': return 'Needs task brief'
      case 'exploring': return turn.importedDraft ? 'Task brief in progress' : isQueuedSpecRevision(turn) ? 'Spec revision queued' : 'Intake'
      case 'ready': return 'Ready'
      case 'gate_check': return 'Gates'
      case 'review': return 'Review'
      case 'in_progress': return turn.liveAgent ? 'In flight' : 'Queued'
      default: return canStartTaskTurn(turn) ? 'Queued' : 'In flight'
    }
  }

  function taskStateDescription(turn: InFlightTurn): string {
    if (
      turn.liveAgent?.lastEventLabel === 'Waiting for the local model to respond.' &&
      (turn.liveAgent.silentMs ?? 0) >= 60_000
    ) {
      return 'Local model is still loading or generating.'
    }
    if (turn.liveAgent?.name === 'spec-agent') {
      if (turn.importedDraft) {
        return 'Guildhall is turning this imported note into a task brief now.'
      }
      return turn.taskId === 'task-workspace-import'
        ? 'Guildhall is turning your existing project notes into candidate tasks now.'
        : 'Guildhall is drafting this now.'
    }
    if (turn.taskStatus === 'ready' && !turn.liveAgent) {
      return runStatus === 'running'
        ? 'Approved and queued. Guildhall is running and can pick this up.'
        : 'Approved and queued. Start Guildhall when you want it to pick this up.'
    }
    if (turn.taskId === 'task-meta-intake' && !turn.liveAgent) {
      return turn.summary
    }
    if (turn.taskStatus === 'import_draft' && !turn.liveAgent) {
      return 'Imported from your project notes, but not ready for a worker yet. Next step: turn this note into a task brief with scope, evidence, and acceptance criteria.'
    }
    if (turn.taskStatus === 'exploring' && !turn.liveAgent) {
      return turn.taskId === 'task-workspace-import'
        ? 'Guildhall already drafted part of this import review. Review it if you want, or press Start to let Guildhall keep turning your project notes into candidate tasks.'
        : turn.importedDraft
          ? 'Guildhall started the task brief for this imported note. Continue drafting the brief here, or add context before the next pass.'
          : isQueuedSpecRevision(turn)
            ? 'Guildhall already has the draft spec plus your latest answers. Press Start when you want Guildhall to revise it.'
            : 'Guildhall drafted a first pass here. Review it if you want, or press Start to let Guildhall revise the draft.'
    }
    if (turn.taskStatus === 'in_progress' && !turn.liveAgent) {
      return runStatus === 'running'
        ? 'Work is queued. Guildhall is running and can pick this up.'
        : 'Work is queued. Start Guildhall when you want it to continue.'
    }
    if (turn.taskStatus === 'review' && !turn.liveAgent) {
      return runStatus === 'running'
        ? 'Review is queued. Guildhall is running and can pick this up.'
        : 'Review is queued. Start Guildhall when you want it to continue.'
    }
    if (turn.taskStatus === 'gate_check' && !turn.liveAgent) {
      return runStatus === 'running'
        ? 'Gate checks are queued. Guildhall is running and can pick this up.'
        : 'Gate checks are queued. Start Guildhall when you want it to continue.'
    }
    return turn.summary
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
    return !turn.liveAgent && (
      turn.taskStatus === 'ready' ||
      turn.taskStatus === 'import_draft' ||
      turn.taskStatus === 'exploring' ||
      turn.taskStatus === 'in_progress' ||
      turn.taskStatus === 'review' ||
      turn.taskStatus === 'gate_check'
    )
  }

  function startTaskLabel(turn: InFlightTurn): string {
    if (metaIntakeChecklistComplete(turn)) return 'Create split proposal'
    switch (turn.taskStatus) {
      case 'ready': return 'Start work'
      case 'import_draft': return 'Draft task brief'
      case 'exploring':
        if (turn.taskId === 'task-meta-intake') return 'Let Guildhall keep setting this up'
        return turn.importedDraft ? 'Continue task brief' : isQueuedSpecRevision(turn) ? 'Revise spec' : 'Continue drafting spec'
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
    if (turn.liveAgent) return 'running'
    switch (turn.taskStatus) {
      case 'ready': return 'accent'
      case 'import_draft': return 'accent'
      case 'gate_check': return 'warn'
      case 'review': return 'warn'
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
    if (step.status === 'active') return turn.liveAgent ? 'running' : 'idle'
    return 'idle'
  }

  function checklistStepLabel(
    turn: InFlightTurn,
    step: { status: 'done' | 'active' | 'pending' | 'skipped' },
  ): string {
    if (step.status === 'done') return 'Done'
    if (step.status === 'active') {
      if (turn.liveAgent) return 'Now'
      return runStatus === 'running' ? 'Queued' : 'Paused'
    }
    if (step.status === 'skipped') return 'Skipped'
    return 'Pending'
  }

  async function startTaskRun(taskId?: string): Promise<void> {
    runBusy = true
    runError = null
    try {
      const res = await scopedProjectFetch('/api/project/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'continuous',
          ...(taskId ? { taskId } : {}),
        }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || body.error) {
        runError = body.error ?? `Start failed (HTTP ${res.status})`
        return
      }
      await load()
      await refreshProject()
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err)
    } finally {
      runBusy = false
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

  // Group co-active agent_question turns by taskId so we can render the
  // section with ONE submit button at the bottom. Pure derivation off
  // `turns` — keeps render order intact.
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

  // For each section, the LAST question's turn id is where we render the
  // shared "Submit answers" footer. Per-card UI just stages locally.
  const sectionFooterTurnId = $derived.by((): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const sec of Object.values(sectionByTask)) {
      const last = sec.turnIds[sec.turnIds.length - 1]
      if (last) out[last] = sec.taskId
    }
    return out
  })

  function stagedCountForTask(taskId: string): number {
    const sec = sectionByTask[taskId]
    if (!sec) return 0
    return sec.askedQuestionIds.filter(qid => typeof staged[qid] === 'string').length
  }
  function totalCountForTask(taskId: string): number {
    return sectionByTask[taskId]?.askedQuestionIds.length ?? 0
  }
  function hasStagedAnswersForTask(taskId: string): boolean {
    return stagedCountForTask(taskId) > 0
  }
  function stagedSummaryForTask(taskId: string): string {
    const ready = stagedCountForTask(taskId)
    const total = totalCountForTask(taskId)
    if (ready <= 0 || total <= 0) return ''
    if (ready === total) return `${ready} of ${total} answers ready to submit`
    return `${ready} of ${total} answers ready so far`
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

<div class="thread">
  <header class="thread-head">
    <h1>Thread</h1>
    <p class="lede">Decisions, questions, and live task updates.</p>
  </header>

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
    <Card title="Nothing here yet">
      <p class="muted">Add a task to start the thread.</p>
    </Card>
  {:else}
    <Stack gap="3">
      <div class="operation-summary" aria-label="Thread operations summary">
        <span>{operationCountLabel(operationSummary.needsYou, 'thread card needs you', 'thread cards need you')}</span>
        <span>{operationCountLabel(operationSummary.working, 'working', 'working')}</span>
        <span>{operationCountLabel(operationSummary.blocked, 'blocked', 'blocked')}</span>
        <span>{operationCountLabel(operationSummary.queued, 'queued', 'queued')}</span>
        <span>{operationCountLabel(operationSummary.drafts, 'draft')}</span>
      </div>

      {#each displayPhaseGroups as group (group.phase)}
        <section class="phase">
          <button
            type="button"
            class="phase-head"
            class:phase-head-open={expandedPhases[group.phase]}
            class:phase-head-live={Boolean(phaseIndicator(group))}
            class:phase-head-live-pulse={phaseIndicator(group)?.pulse}
            aria-expanded={expandedPhases[group.phase]}
            onclick={() => togglePhase(group.phase)}
          >
            <span class="phase-head-label">
              {#if phaseIndicator(group)}
                <StatusDot
                  tone={phaseIndicator(group)?.tone === 'warn' ? 'warn' : phaseIndicator(group)?.tone === 'active' ? 'active' : 'idle'}
                  pulse={phaseIndicator(group)?.pulse ?? false}
                  size="sm"
                  ariaLabel={phaseIndicator(group)?.label}
                />
              {/if}
              <span>{group.label}</span>
            </span>
            <Chip label={String(group.turns.length)} tone={phaseCountTone(group)} />
          </button>
          {#if expandedPhases[group.phase]}
            {#if shouldCompactPhase(group)}
              <div class="compact-ops" aria-label={`Compact ${group.label} operations`}>
                <div class="compact-ops-head">
                  <span>{group.turns.length} compact rows</span>
                  <Button variant="ghost" size="sm" onclick={() => toggleCrowdedPhase(group)}>
                    Show cards
                  </Button>
                </div>
                <div class="compact-ops-list">
                  {#each group.turns as t (t.id)}
                    <button
                      type="button"
                      class="compact-op-row"
                      data-turn-id={t.id}
                      onclick={() => openCompactTurn(t)}
                    >
                      <StatusDot
                        tone={compactTone(t)}
                        pulse={Boolean(turnLiveAgent(t))}
                        size="sm"
                        ariaLabel={compactStatusLabel(t)}
                      />
                      <span class="compact-op-copy">
                        <span class="compact-op-main">
                          <span class="compact-op-title">{compactTurnTitle(t)}</span>
                          <span class="compact-op-chips">
                            {#if constructionModeLabel(t)}
                              <Chip label={constructionModeLabel(t) ?? ''} tone="neutral" />
                            {/if}
                            <Chip label={compactStatusLabel(t)} tone={ownershipTone(t)} />
                          </span>
                        </span>
                        <span class="compact-op-detail">{compactTurnDescription(t)}</span>
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {:else}
            <Stack gap="3" class="phase-body">
              {#each group.turns as t (t.id)}
        <div
          class="turn turn-{t.status}"
          class:turn-import-queue={t.kind === 'inflight' && t.importedDraft && t.status === 'pending'}
          data-turn-id={t.id}
          use:captureTurn={t.id}
        >
          <Card tone={tone(t)}>
            <InteractionCardLayout>
              {#snippet status()}
                <Row align="center" gap="2">
                  {#if constructionModeLabel(t)}
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
              {/snippet}
              {#snippet meta()}
                <div class="meta">
                  {#if 'taskTitle' in t}
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
                  <span class="persona">{personaLabel(t.persona)}</span>
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
                {#if t.kind === 'setup_step'}
                  <div class="setup-title">
                    <h3 class="prompt"><Markdown source={t.title} inline /></h3>
                    {#if t.skippable}
                      <Chip label="optional" tone="neutral" />
                    {/if}
                  </div>
                  <p class="why">{t.why}</p>
                  {#if t.status === 'active'}
                    {#if t.contextSummary}
                      <div class="setup-context" aria-label="What Guildhall knows right now">
                        <strong>What Guildhall knows right now</strong>
                        <p>{t.contextSummary.intro}</p>
                        <ul>
                          {#each t.contextSummary.facts as fact}
                            <li>{fact}</li>
                          {/each}
                        </ul>
                        <p>{t.contextSummary.uncertainty}</p>
                      </div>
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
                        <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                          {busyTurnId === t.id ? 'Verifying...' : t.actionLabel}
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
                  {/if}

              {:else if t.kind === 'brief_approval'}
                <h3 class="prompt">Is this what you want?</h3>
                {#if t.brief.userJob}
                  <div class="field"><span class="field-label">What it thinks you want</span>
                    <Markdown source={t.brief.userJob} />
                  </div>
                {/if}
                {#if t.brief.successMetric || t.brief.successCriteria}
                  <div class="field"><span class="field-label">How it'll know it's done</span>
                    <Markdown source={t.brief.successMetric ?? t.brief.successCriteria ?? ''} />
                  </div>
                {/if}
                {#if t.brief.antiPatterns && t.brief.antiPatterns.length > 0}
                  <div class="field"><span class="field-label">Explicitly NOT</span>
                    <ul class="bullet">
                      {#each t.brief.antiPatterns as p}<li><Markdown source={p} inline /></li>{/each}
                    </ul>
                  </div>
                {/if}
                {#if t.status === 'active'}
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
                    <p class="answer">Sent. The spec author has the correction.</p>
                  {:else if replyTurnId === t.id}
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
                  {:else}
                    <div class="choices">
                      <button
                        type="button"
                        class="choice"
                        disabled={busyTurnId === t.id || blockedByQuestions}
                        onclick={() => approveBrief(t)}
                      >
                        Yes, that's right
                      </button>
                      <button
                        type="button"
                        class="choice choice-other"
                        disabled={busyTurnId === t.id}
                        onclick={() => (replyTurnId = t.id)}
                      >
                        No, change it
                      </button>
                    </div>
                  {/if}
                {/if}

              {:else if t.kind === 'agent_question'}
                {#if t.status === 'active'}
                  {@const hasStaged = hasStagedAnswersForTask(t.taskId)}
                  {@const stagedSummary = stagedSummaryForTask(t.taskId)}
                  {@const totalQuestions = totalCountForTask(t.taskId)}
                  {@const questions = questionsForTurn(t)}
                  {#if t.taskDescription || t.sourceNote}
                    <div class="task-context">
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
                                <code>{ref}</code>
                              </button>
                            {/each}
                          </div>
                          {#if sourcePreviewError}
                            <p class="error">{sourcePreviewError}</p>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                  <h3 class="prompt">{totalQuestions === 1 ? 'Question about this task' : `${totalQuestions} questions about this task`}</h3>
                  <div class="question-context-actions">
                    {#if contextTurnId === t.id}
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
                            variant="secondary"
                            disabled={busyTurnId === t.id || !(contextDrafts[t.id] ?? '').trim()}
                            onclick={() => askQuestionContext(t)}
                          >
                            Ask for context
                          </Button>
                        </Row>
                        {#if contextErrors[t.id]}
                          <p class="error">{contextErrors[t.id]}</p>
                        {/if}
                      </Stack>
                    {:else}
                      <div class="question-context-copy">
                        <strong>Need more context?</strong>
                        <span>Ask Guildhall to explain the source note or current assumption before you answer. This keeps the question open.</span>
                      </div>
                      <Button variant="secondary" size="sm" disabled={busyTurnId === t.id} onclick={() => (contextTurnId = t.id)}>
                        Ask for context
                      </Button>
                    {/if}
                  </div>
                  {#if t.activity?.length}
                    <div class="live-activity" aria-label="Recent agent activity">
                      {#each t.activity as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                        <StatusLine
                          label={item.label}
                          detail={item.detail}
                          time={activityElapsed(item.at)}
                          tone={item.tone}
                          pulse={item.tone === 'running'}
                        />
                      {/each}
                    </div>
                  {/if}
                  <div class="question-stack">
                    {#each questions as question (question.id)}
                      <div class="question-inline">
                        {#if staged[question.id]}
                          <div class="prompt"><Markdown source={question.restatement ?? question.prompt ?? ''} /></div>
                          <div class="field"><span class="field-label">Staged</span>
                            <div class="answer"><Markdown source={staged[question.id]} inline /></div>
                          </div>
                          <Row justify="end">
                            <Button
                              variant="ghost"
                              disabled={busyTaskId === t.taskId}
                              onclick={() => clearStagedQuestion({ ...t, question })}
                            >Change</Button>
                          </Row>
                        {:else}
                          <AgentQuestion
                            question={question}
                            busy={busyTaskId === t.taskId}
                            onAnswer={(a) => answerQuestion({ ...t, question }, a)}
                          />
                        {/if}
                      </div>
                    {/each}
                  </div>
                  {#if hasStaged && totalQuestions > 1 && sectionFooterTurnId[t.id] === t.taskId}
                    <div class="question-submit-banner">
                      <div>
                        <div class="question-submit-title">Answers staged</div>
                        <div class="question-submit-copy">{stagedSummary}</div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyTaskId === t.taskId}
                        onclick={() => submitSection(t.taskId)}
                      >
                        Submit answers
                      </Button>
                    </div>
                  {/if}
                {:else}
                  <div class="prompt"><Markdown source={t.question.restatement ?? t.question.prompt ?? ''} /></div>
                  {#if t.question.answer}
                    <div class="field"><span class="field-label">You answered</span>
                      <div class="answer"><Markdown source={t.question.answer} inline /></div>
                    </div>
                  {/if}
                {/if}

              {:else if t.kind === 'spec_review'}
                {@const missingSpec = t.taskId !== 'task-meta-intake' && t.spec.trim().length === 0}
                {@const isMetaIntakeDraft = t.taskId === 'task-meta-intake'}
                {@const proposedCount = t.draftCoordinators?.length ?? 0}
                <div class="prompt-row">
                  <h3 class="prompt">
                    {isMetaIntakeDraft
                      ? `Guildhall inferred ${proposedCount || 0} ${proposedCount === 1 ? 'repo slice' : 'repo slices'}`
                      : 'Spec draft awaiting approval'}
                  </h3>
                </div>
                {#if isMetaIntakeDraft && t.draftCoordinators?.length}
                  <p class="why decision-question">Guildhall inferred this structure from the repo.</p>
                  <p class="why">
                    Confirm it only if something here is materially wrong. Guildhall should handle the routing and review structure underneath.
                  </p>
                  <div class="draft-summary-list">
                    {#each t.draftCoordinators as d (d.id)}
                      <div class="draft-summary-item">
                        <strong>{friendlyStewardName(undefined, d.domain, d.id)}</strong>
                        {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                      </div>
                    {/each}
                  </div>
                  <details class="draft-details">
                    <summary>See why Guildhall inferred this structure</summary>
                    <div class="coord-list">
                      {#each t.draftCoordinators as d (d.id)}
                        <div class="coord">
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
                        </div>
                      {/each}
                    </div>
                  </details>
                {:else if t.spec}
                  <div class="spec-preview"><Markdown source={t.spec} /></div>
                {:else if missingSpec}
                  <p class="error">The task is marked ready, but no spec was saved. Ask the spec author to write the spec before approving.</p>
                {/if}
                {#if t.status === 'active'}
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
                  {:else}
                  <Row justify="end" gap="2">
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                      Open task
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
                <h3 class="prompt">Worker is stuck</h3>
                <p class="why">{t.summary}</p>
                {#if t.details}
                  <p class="detail"><strong>Latest blocker:</strong> {t.details}</p>
                  <p class="review-feedback-note">Full blocker details live in the task.</p>
                {/if}
                {#if t.activity?.length}
                  <div class="live-activity" aria-label="Recent agent activity">
                    {#each t.activity as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                      <StatusLine
                        label={item.label}
                        detail={item.detail}
                        time={activityElapsed(item.at)}
                        tone={item.tone}
                        pulse={item.tone === 'running'}
                      />
                    {/each}
                  </div>
                {/if}
                {#if t.status === 'active'}
                  <Row justify="end">
                    <Button variant="primary" onclick={() => nav(currentTaskHref(t.taskId))}>Open task</Button>
                  </Row>
                {/if}
              {:else if t.kind === 'review_feedback'}
                <StateSummary
                  label="Revision requested"
                  description={t.summary}
                  tone="warn"
                />
                <div class="review-feedback">
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
                      Open task
                    </Button>
                  </Row>
                </div>
              {:else if t.kind === 'inflight'}
                <StateSummary
                  label={taskStateLabel(t)}
                  description={taskStateDescription(t)}
                  tone={taskStateTone(t)}
                />
                {#if t.taskDescription || t.sourceNote}
                  <div class="task-context">
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
                              <code>{ref}</code>
                            </button>
                          {/each}
                        </div>
                        {#if sourcePreviewError}
                          <p class="error">{sourcePreviewError}</p>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
                {#if t.taskId !== 'task-meta-intake' && t.taskStatus === 'exploring' && !t.liveAgent && !isQueuedSpecRevision(t)}
                  <Row justify="end" gap="2" wrap>
                    <Button variant="secondary" onclick={() => nav(currentTaskHref(t.taskId))}>
                      Inspect details
                    </Button>
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                      Add note
                    </Button>
                    <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                      <Icon name="sparkles" size={14} />
                      {startTaskLabel(t)}
                    </Button>
                  </Row>
                {/if}
                {#if t.activity?.length}
                  <div class="live-activity" aria-label="Recent agent activity">
                    {#each t.activity as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                      <StatusLine
                        label={item.label}
                        detail={item.detail}
                        time={activityElapsed(item.at)}
                        tone={item.tone}
                        pulse={item.tone === 'running'}
                      />
                    {/each}
                  </div>
                {/if}
                {#if t.checklist}
                  <div class="live-checklist">
                    <div class="live-checklist-head">
                      <strong>{t.checklist.title}</strong>
                      <span>{t.checklist.doneCount} of {t.checklist.totalSteps}</span>
                    </div>
                    <div class="live-checklist-steps">
                      {#each t.checklist.steps as step (step.id)}
                        <div class="live-step" class:done={step.status === 'done'} class:active={step.status === 'active'}>
                          <StatusLight
                            tone={checklistStepTone(t, step)}
                            pulse={step.status === 'active' && Boolean(t.liveAgent)}
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
                  </div>
                {/if}
                {#if replyTurnId === t.id}
                  <Stack gap="2">
                    <Textarea
                      value={replyDrafts[t.id] ?? ''}
                      rows={4}
                      placeholder="Tell the agent what to do next"
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
              {:else}
                  <Row justify="end" gap="2">
                    {#if t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring') && !t.liveAgent}
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                        Inspect details
                      </Button>
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                        Add context
                      </Button>
                      {#if t.taskStatus === 'import_draft'}
                        <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => shapeDraft(t)}>
                          <Icon name="sparkles" size={14} />
                          {startTaskLabel(t)}
                        </Button>
                      {:else if canStartTaskTurn(t)}
                        <Button variant="agent" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                          <Icon name="sparkles" size={14} />
                          {startTaskLabel(t)}
                        </Button>
                      {/if}
                    {:else if t.taskId === 'task-meta-intake' && !t.liveAgent}
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
                    {:else}
                      <Button variant={t.taskStatus === 'exploring' ? 'human' : 'secondary'} onclick={() => nav(currentTaskHref(t.taskId))}>
                        {t.taskStatus === 'exploring' ? 'Inspect details' : 'Open task'}
                      </Button>
                      {#if canStartTaskTurn(t)}
                        <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add note
                        </Button>
                        {#if metaIntakeChecklistComplete(t)}
                          <Button
                            variant="primary"
                            disabled={busyTurnId === t.id}
                            onclick={() => synthesizeMetaIntake(t)}
                          >
                            {startTaskLabel(t)}
                          </Button>
                        {:else if t.taskStatus === 'import_draft'}
                          <Button variant="agent" disabled={busyTurnId === t.id} onclick={() => shapeDraft(t)}>
                            <Icon name="sparkles" size={14} />
                            {startTaskLabel(t)}
                          </Button>
                        {:else}
                          <Button variant="primary" disabled={runBusy || busyTurnId === t.id} onclick={() => startTaskRun(t.taskId)}>
                            {startTaskLabel(t)}
                          </Button>
                        {/if}
                      {:else}
                        <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add note
                        </Button>
                      {/if}
                    {:else}
                      {#if !t.importedDraft}
                        <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add note
                        </Button>
                      {/if}
                    {/if}
                  </Row>
                  {#if runError && canStartTaskTurn(t)}
                    <p class="error">{runError}</p>
                  {/if}
                  {#if sentReplies[t.id]}
                    <p class="answer">
                      Saved. {canStartTaskTurn(t)
                        ? 'Guildhall will read it on the next Start.'
                        : 'The agent will read it on the next run.'}
                    </p>
                  {/if}
                  {#if replyErrors[t.id]}
                    <p class="error">{replyErrors[t.id]}</p>
                  {/if}
                {/if}
              {/if}
            </InteractionCardLayout>
          </Card>
        </div>
              {/each}
            </Stack>
            {/if}
          {/if}
        </section>
      {/each}

      {#if caughtUp}
        <p class="muted caught-up">
          {#if operationSummary.needsYou > 0}
            Needs your input before Guildhall can continue.
          {:else if operationSummary.working > 0}
            Agents are working.
          {:else if operationSummary.queued > 0 || operationSummary.drafts > 0}
            Guildhall has queued work ready for the next run.
          {:else}
            All caught up — nothing is running right now.
          {/if}
        </p>
      {/if}
    </Stack>
  {/if}
</div>

<Modal
  open={Boolean(sourcePreview)}
  title="Source note"
  size="lg"
  onClose={() => {
    sourcePreview = null
    sourcePreviewError = null
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
      <div class="source-preview-body">
        <Markdown source={sourcePreview.content || '_This source note is empty._'} />
      </div>
    </div>
  {/if}
</Modal>

<style>
  .thread {
    width: 680px;
    max-width: 100%;
    margin: 0 auto;
    padding: var(--s-4) var(--s-4) var(--s-6);
  }
  .thread-head {
    margin-bottom: var(--s-4);
  }
  .thread-head h1 { margin: 0 0 var(--s-1); font-size: var(--fs-5); }
  .lede { margin: 0; color: var(--text-muted); font-size: var(--fs-2); }
  .handoff-copy {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    max-width: 44rem;
  }
  .handoff-copy span {
    color: var(--text-muted);
  }
  .operation-summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--s-1);
    padding: var(--s-1);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
  }
  .operation-summary span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-0);
    background: var(--bg);
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 650;
    text-align: center;
  }
  .phase {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    position: relative;
  }
  @media (max-width: 1100px) {
    .thread {
      padding-top: var(--s-3);
    }
  }
  .phase-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
    color: var(--text);
    padding: var(--s-2) var(--s-3);
    font: inherit;
    font-size: var(--fs-2);
    font-weight: 700;
    cursor: pointer;
    position: sticky;
    top: 0;
    z-index: var(--z-sticky-local);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--bg-base) 80%, transparent);
  }
  .phase-head-label {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .phase-head:hover {
    background: var(--bg-raised-2);
  }
  .phase-head-live {
    border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
  }
  .phase-head-live-pulse {
    animation: phase-head-live-pulse 1.8s ease-in-out infinite;
  }
  .phase-head-open {
    background: var(--bg-raised-2);
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
    border-bottom-left-radius: var(--r-0);
    border-bottom-right-radius: var(--r-0);
  }
  @keyframes phase-head-live-pulse {
    0%, 100% {
      box-shadow: 0 4px 12px color-mix(in srgb, var(--bg-base) 80%, transparent);
      border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
    }
    50% {
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent), 0 8px 20px color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
    }
  }
  .phase-body {
    position: relative;
    margin-left: var(--s-3);
    padding-left: var(--s-3);
    padding-top: var(--s-1);
    border-left: 2px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  }
  .compact-ops {
    margin-left: var(--s-3);
    padding: var(--s-2) 0 var(--s-1) var(--s-3);
    border-left: 2px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  }
  .compact-ops-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    margin-bottom: var(--s-2);
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 650;
  }
  .compact-ops-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .compact-op-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-2);
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
    color: var(--text);
    padding: var(--s-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .compact-op-row:hover {
    background: var(--bg-raised-2);
    border-color: color-mix(in srgb, var(--accent) 26%, var(--border));
  }
  .compact-op-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .compact-op-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .compact-op-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-1);
    font-weight: 650;
    line-height: var(--lh-tight);
  }
  .compact-op-chips {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-width: max-content;
  }
  .compact-op-detail {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--fs-0);
    line-height: var(--lh-normal);
  }
  .turn :global(.card) {
    padding: var(--s-3);
  }
  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    color: var(--text-muted);
  }
  .persona {
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 500;
    line-height: var(--lh-tight);
  }
  .task-chip {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text);
    padding: 1px var(--s-1);
    margin: -1px calc(-1 * var(--s-1));
    border-radius: var(--r-1);
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-2);
    font-weight: 550;
    line-height: var(--lh-tight);
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
  .prompt { margin: 0; font-size: var(--fs-3); font-weight: 550; line-height: var(--lh-tight); }
  .setup-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .prompt-row {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  .prompt :global(.md),
  .coord-title :global(.md),
  .coord-mandate :global(.md),
  .answer :global(.md) {
    color: inherit;
    font-size: inherit;
    line-height: inherit;
  }
  .why { margin: 0; color: var(--text-muted); font-size: var(--fs-2); line-height: var(--lh-body); }
  .setup-context {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .setup-context strong {
    color: var(--text);
    font-size: var(--fs-1);
    font-weight: 700;
  }
  .setup-context p {
    margin: 0;
  }
  .setup-context ul {
    display: grid;
    gap: var(--s-1);
    margin: 0;
    padding-inline-start: var(--s-4);
  }
  .gating-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .detail { margin: 0; color: var(--text-muted); font-size: var(--fs-1); }
  .question-submit-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised-2);
    margin-top: var(--s-2);
    flex-wrap: wrap;
  }
  .question-submit-title {
    font-size: var(--fs-1);
    font-weight: 700;
    color: var(--text);
  }
  .question-submit-copy {
    margin-top: 2px;
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .field { display: flex; flex-direction: column; gap: var(--s-1); }
  .field :global(.md) {
    font-size: var(--fs-2);
    font-weight: 400;
  }
  .field-label {
    font-size: var(--fs-1);
    color: var(--text-muted);
    font-weight: 500;
  }
  .task-context {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised-2);
  }
  .source-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .source-list code {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .source-ref {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent-2);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent-2) 50%, transparent);
    text-underline-offset: 3px;
  }
  .source-ref:disabled {
    cursor: progress;
    opacity: 0.65;
  }
  .source-ref:hover code {
    border-color: var(--accent-2);
    color: var(--text);
  }
  .source-ref:focus-visible code {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .question-context-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .question-context-actions :global(.stack) {
    width: 100%;
  }
  .question-context-copy {
    min-width: 220px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .question-context-copy span {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .source-preview {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .source-preview-path {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 600;
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
    font-size: var(--fs-1);
  }
  .source-preview-body {
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .question-stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .question-inline {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .setup-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: start;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    justify-content: flex-end;
  }
  .choice {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-2) var(--s-3);
    font: inherit;
    font-size: var(--fs-2);
    cursor: pointer;
  }
  .choice:hover:not(:disabled) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  }
  .choice:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .choice-other {
    border-style: dashed;
    color: var(--text-muted);
  }
  .answer { margin: 0; padding: var(--s-2); background: var(--bg-raised-2); border-radius: var(--r-1); font-size: var(--fs-2); }
  .bullet { padding-left: var(--s-4); margin: 0; font-size: var(--fs-2); }
  .spec-preview { max-height: 240px; overflow: auto; padding: var(--s-2); background: var(--bg-raised-2); border-radius: var(--r-1); }
  .coord-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .decision-question {
    color: var(--text);
    font-weight: 600;
  }
  .draft-summary-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .draft-summary-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    font-size: var(--fs-2);
  }
  .draft-details {
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    padding: var(--s-2) var(--s-3);
  }
  .draft-details summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 600;
  }
  .draft-details[open] summary {
    margin-bottom: var(--s-2);
  }
  .coord {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .coord-mandate {
    margin: 0;
    color: var(--text);
  }
  .coord-concerns {
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .live-checklist {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .live-activity {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .review-feedback {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    display: grid;
    gap: var(--s-2);
  }
  .review-feedback-meta {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-1);
    font-weight: 600;
  }
  .review-feedback-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .live-checklist-head,
  .live-step {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .live-checklist-head {
    justify-content: space-between;
    color: var(--text);
    font-size: var(--fs-2);
  }
  .live-checklist-head span,
  .live-step-state {
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 700;
    text-transform: uppercase;
  }
  .live-checklist-steps {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .live-step {
    min-height: 44px;
  }
  .live-step-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .live-step-copy span {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .live-step.done .live-step-copy {
    color: var(--text-muted);
  }
  .live-step.active .live-step-state {
    color: var(--warn);
  }
  .turn-done { opacity: 0.7; }
  .turn-pending { opacity: 0.72; }
  .turn-import-queue { opacity: 1; }
  .turn-import-queue :global(.card) {
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  }
  .muted { color: var(--text-muted); }
  .caught-up { text-align: center; padding: var(--s-3); }
  .section-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
    background: var(--bg-raised-2);
    border: 1px dashed var(--border);
    border-radius: var(--r-2);
  }
  .gating {
    color: var(--warn, #d0a146);
    font-size: var(--fs-1);
    margin: 0;
  }
  .section-status {
    font-size: var(--fs-1);
    color: var(--text-muted);
    margin-right: auto;
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-1);
    margin: 0;
  }
  @media (max-width: 640px) {
    .operation-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .compact-op-main {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
    .compact-op-chips {
      flex-wrap: wrap;
      min-width: 0;
    }
    .setup-form {
      grid-template-columns: 1fr;
    }
  }
</style>
