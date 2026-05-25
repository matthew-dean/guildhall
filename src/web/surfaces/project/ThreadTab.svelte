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
  import { escalationPrimaryAction, escalationUserGuidance } from '../../lib/escalation-labels.js'
  import { briefDoneWhenForReaders, briefScopeForReaders } from '../../lib/brief-display.js'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import {
    hasIncompleteTaskChecklist,
    isImportedDraftShaping,
    isQueuedSpecRevision as isQueuedSpecRevisionTurn,
    needsRecovery as taskNeedsRecovery,
  } from '../../lib/task-state.js'
  import { project } from '../../lib/project.svelte.js'
  import type { GitStorySnapshot } from '../../lib/types.js'
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
  type ThreadView = 'current' | 'archive'
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
  interface InFlightTurn {
    kind: 'inflight'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; taskStatus?: string; summary: string
    constructionMode?: ConstructionMode | undefined
    gitStory?: GitStorySnapshot | undefined
    requestKind?: 'task_spec' | 'project_question' | 'settings_proposal' | 'persona_practice_proposal' | 'repair_triage' | 'clarification' | undefined
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
    rawRequest: string
    title: string
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
      evidence: string[]
    }
    answerEndpoint: string
  }
  type Turn =
    | SetupStepTurn
    | BriefTurn
    | AgentQuestionTurn
    | SpecReviewTurn
    | ReviewFeedbackTurn
    | EscalationTurn
    | InFlightTurn
    | RequestTurn
    | PressureTestQuestionTurn

  let turns = $state<Turn[]>([])
  let threadView = $state<ThreadView>('current')
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
  let pressureTestAnswers = $state<Record<string, string>>({})
  let pressureTestErrors = $state<Record<string, string>>({})
  const SOURCE_PREVIEW_RENDER_CHAR_LIMIT = 32_000

  let sourcePreview = $state<{ ref: string; displayPath: string; content: string | null; truncated: boolean; loading: boolean } | null>(null)
  let sourcePreviewLoadingRef = $state<string | null>(null)
  let sourcePreviewError = $state<string | null>(null)
  let sourcePreviewRequestId = 0
  let importHandoff = $state<{ tasksAdded: number; sourceCount: number } | null>(null)
  let importHandoffFocused = $state(false)
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
      return 'accent'
    }
    if (isQueuedForGuildhall(t)) return 'accent'
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
    if (threadView === 'archive') return false
    if (t.kind === 'inflight' && t.requestKind === 'project_question') return false
    const owner = ownershipLabel(t)
    if (owner && owner !== 'Guildhall shaping') return false
    return t.status !== 'done' && Boolean(constructionModeLabel(t)) && !isQueuedForGuildhall(t)
  }

  function showStatusChip(t: Turn): boolean {
    if (threadView === 'archive') return false
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
    if (t.kind === 'pressure_test_question') return t.status === 'done' ? null : 'Needs you'
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
      if (t.taskStatus === 'ready' && hasIncompleteTaskChecklist(t)) {
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
    if (label === 'Needs you' || label === 'Needs recovery' || label === 'Needs brief') return 'warn'
    if (label === 'Queued' || label === 'Queued for Guildhall' || label === 'Guildhall shaping' || label === 'Guildhall can continue') return 'accent'
    return 'neutral'
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

  function pressureQuestionPrompt(turn: PressureTestQuestionTurn): string {
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

  function pressureQuestionWhy(turn: PressureTestQuestionTurn): string {
    if (/Workers need to know which outcome defines success before splitting tasks\./i.test(turn.question.why)) {
      return 'A sentence is enough. Mention the outcome or constraint Guildhall should optimize for.'
    }
    return turn.question.why
  }

  function pressureQuestionMeta(turn: PressureTestQuestionTurn): string {
    const index = activePressureQuestions.findIndex(candidate => candidate.id === turn.id)
    const count = activePressureQuestions.length
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
    let seenPressureQuestion = false
    const hasActivePressureQuestion = turns.some(
      turn => turn.kind === 'pressure_test_question' && turn.status === 'active',
    )
    return turns.filter(turn => {
      if (turn.phase === 'done') return false
      if (
        hasActivePressureQuestion &&
        turn.kind === 'setup_step' &&
        turn.stepId === 'firstTask'
      ) {
        return false
      }
      if (turn.kind === 'pressure_test_question' && turn.status === 'active') {
        if (seenPressureQuestion) return false
        seenPressureQuestion = true
      }
      if (turn.kind === 'agent_question' && turn.status === 'active') {
        if (seenQuestionTasks.has(turn.taskId)) return false
        seenQuestionTasks.add(turn.taskId)
      }
      return true
    })
  })
  const archiveTurns = $derived(turns.filter(turn => turn.phase === 'done'))
  const visibleTurns = $derived(threadView === 'archive' ? archiveTurns : currentTurns)
  const currentCount = $derived(currentTurns.length)
  const archiveCount = $derived(archiveTurns.length)
  const visibleList = $derived([...visibleTurns].sort(threadView === 'archive' ? compareArchiveTurns : compareOperationTurns))
  const activePressureQuestions = $derived(
    turns.filter((turn): turn is PressureTestQuestionTurn =>
      turn.kind === 'pressure_test_question' && turn.status === 'active',
    ),
  )
  const hiddenPressureQuestionCount = $derived(Math.max(0, activePressureQuestions.length - 1))
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
    threadView = 'current'
  }

  function hasPendingSetupStep(stepId: string): boolean {
    return turns.some(
      (turn) => turn.kind === 'setup_step' && turn.stepId === stepId && turn.status !== 'done',
    )
  }

  function focusSetupPhase(): void {
    const firstSetup = turns.find((turn) => turn.kind === 'setup_step' && turn.status === 'active')
    if (!firstSetup) return
    threadView = 'current'
  }

  function revealImportedDrafts(): void {
    const first = turns.find(
      t => t.kind === 'inflight' && t.importedDraft && (t.taskStatus === 'import_draft' || t.taskStatus === 'exploring'),
    )
    if (!first) return
    threadView = 'current'
  }

  function setThreadView(view: ThreadView): void {
    threadView = view
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
      case 'exploring': return turn.importedDraft ? 'Task brief in progress' : isQueuedSpecRevision(turn) ? 'Spec revision queued' : 'Intake'
      case 'ready':
        if (hasIncompleteTaskChecklist(turn)) return 'Needs task brief'
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
      if (turn.importedDraft) {
        return 'Guildhall is turning this imported note into a task brief now.'
      }
      return turn.taskId === 'task-workspace-import'
        ? 'Guildhall is turning your existing project notes into candidate tasks now.'
        : 'Guildhall is drafting this now.'
    }
    if (turn.taskStatus === 'ready' && !live) {
      if (hasIncompleteTaskChecklist(turn)) {
        return 'This is a draft task brief. Before Guildhall can build it, add the missing success target and acceptance criteria.'
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
      return turn.taskId === 'task-workspace-import'
        ? 'Guildhall already drafted part of this import review. Review it if you want, or press Start to let Guildhall keep turning your project notes into candidate tasks.'
        : turn.importedDraft
          ? 'Guildhall is shaping the task brief for this imported note. You can add context, but you do not need to babysit the draft.'
          : isQueuedSpecRevision(turn)
            ? 'Guildhall already has the draft spec plus your latest answers. Press Start when you want Guildhall to revise it.'
            : 'Guildhall drafted a first pass here. Review it if you want, or press Start to let Guildhall revise the draft.'
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

  function gitStoryVisible(turn: Turn): boolean {
    if (!('gitStory' in turn) || !turn.gitStory?.state) return false
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
    if (turn.taskStatus === 'ready' && hasIncompleteTaskChecklist(turn)) return false
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
        if (hasIncompleteTaskChecklist(turn)) return 'Open checklist'
        if (runStatus === 'running' || runStatus === 'stopping') return 'Already queued'
        return 'Start work'
      case 'import_draft': return 'Draft task brief'
      case 'exploring':
        if (turn.taskId === 'task-meta-intake') return 'Let Guildhall keep setting this up'
        if (turn.importedDraft || hasIncompleteTaskChecklist(turn)) return 'Continue task brief'
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

  function setPressureTestAnswer(turnId: string, value: string): void {
    pressureTestAnswers = { ...pressureTestAnswers, [turnId]: value }
    if (pressureTestErrors[turnId]) {
      const next = { ...pressureTestErrors }
      delete next[turnId]
      pressureTestErrors = next
    }
  }

  async function answerPressureTestQuestion(turn: PressureTestQuestionTurn): Promise<void> {
    const answer = (pressureTestAnswers[turn.id] ?? '').trim()
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

<div class="thread" class:thread-archive={threadView === 'archive'}>
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
      <p class="muted">
        {allTerminalReadinessMessage ?? 'Add a task to start the thread.'}
      </p>
    </Card>
  {:else}
    <Stack gap="3">
      <div class="thread-view-bar" role="tablist" aria-label="Thread view">
        <button
          type="button"
          class:active={threadView === 'current'}
          role="tab"
          aria-selected={threadView === 'current'}
          onclick={() => setThreadView('current')}
        >
          <span>Current work</span>
          <Chip label={badgeCountLabel(currentCount)} tone={currentCount > 0 ? 'accent' : 'neutral'} />
        </button>
        <button
          type="button"
          class:active={threadView === 'archive'}
          role="tab"
          aria-selected={threadView === 'archive'}
          onclick={() => setThreadView('archive')}
        >
          <span>Archive</span>
          <Chip label={badgeCountLabel(archiveCount)} tone="neutral" />
        </button>
      </div>

      {#if visibleTurns.length === 0}
        <Card title={threadView === 'archive' ? 'Archive is empty' : 'Nothing current'}>
          <p class="muted">
            {threadView === 'archive'
              ? 'Completed turns will appear here.'
              : allTerminalReadinessMessage ?? 'No open questions, queued work, blockers, or active requests right now.'}
          </p>
        </Card>
      {/if}

      {#if visibleList.length > 0}
        <Stack gap="3" class="thread-list">
          {#each visibleList as t (t.id)}
        <div
          class="turn turn-{t.status}"
          class:turn-import-queue={t.kind === 'inflight' && t.importedDraft && t.status === 'pending'}
          data-turn-id={t.id}
        >
          <Card tone={tone(t)}>
            <InteractionCardLayout>
              {#snippet status()}
                {#if hasCardStatus(t)}
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
                  {#if threadView === 'archive'}
                    {@const archivedAt = formatArchiveTime(t.at)}
                    {#if archivedAt}
                      <span class="archive-time">Completed {archivedAt}</span>
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
              {#if gitStoryVisible(t) && 'gitStory' in t && t.gitStory}
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
                        <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
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
                <h3 class="prompt">New request</h3>
                <div class="field">
                  <span class="field-label">Request</span>
                  <Markdown source={requestSummary(t.rawRequest)} />
                </div>
                <StateSummary label="Request saved" description={t.routingSummary} tone="ok" />

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
                    {#if pressureTestErrors[t.id]}
                      <p class="error">{pressureTestErrors[t.id]}</p>
                    {/if}
                  </Stack>
                {/if}

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
                    <div class="answer"><Markdown source={t.latestUserCorrection} inline /></div>
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
                      </div>
                    </details>
                  {/if}
                  <h3 class="prompt">{totalQuestions === 1 ? 'Before Guildhall continues' : `${totalQuestions} questions before Guildhall continues`}</h3>
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
                    {:else}
                      <div class="question-context-copy">
                        <strong>Missing context is expected.</strong>
                        <span>Ask Guildhall to explain project terms, source notes, or assumptions before you answer. This keeps the question open.</span>
                      </div>
                      <Button variant="human" size="sm" disabled={busyTurnId === t.id} onclick={() => (contextTurnId = t.id)}>
                        Ask Guildhall to explain
                      </Button>
                    {/if}
                  </div>
                  {#if t.activity?.length}
                    <div class="live-activity" aria-label="Recent agent activity">
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
                    </div>
                  {/if}
                  <div class="question-stack">
                    {#each visibleQuestions as question (question.id)}
                      <div class="question-inline">
                        {#if staged[question.id]}
                          <div class="prompt"><Markdown source={question.restatement ?? question.prompt ?? ''} /></div>
                          <div class="field"><span class="field-label">Draft answer</span>
                            <div class="answer"><Markdown source={staged[question.id]} inline /></div>
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
                      <div class="answer"><Markdown source={t.question.answer} inline /></div>
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
                      <div class="draft-summary-item">
                        <strong>{friendlyStewardName(undefined, d.domain, d.id)}</strong>
                        {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                      </div>
                    {/each}
                  </div>
                  <details class="draft-details">
                    <summary>{starterRoutingDraft ? 'See why Guildhall proposed this starter split' : 'See why Guildhall inferred this structure'}</summary>
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
                  <div class="live-activity" aria-label="Recent agent activity">
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
                  </div>
                {/if}
                {#if t.status === 'active'}
                  <Row justify="end" gap="2">
                    <Button variant={guidance.actionOwner === 'guildhall' ? 'secondary' : 'primary'} onclick={() => nav(currentTaskHref(t.taskId))}>Open task</Button>
                    {#if guidance.actionOwner === 'guildhall'}
                      <Button variant="agent" disabled={busyTurnId === t.id || runBusy} onclick={() => resolveEscalationAndResume(t)}>
                        <Icon name="sparkles" size={14} />
                        {recoveryAction.label}
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
                  showLabel={!isQueuedForGuildhall(t)}
                />
                {#if t.taskStatus === 'ready' && hasIncompleteTaskChecklist(t) && replyTurnId !== t.id}
                  <Row justify="end" gap="2">
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                      Open checklist
                    </Button>
                    <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                      Add optional note
                    </Button>
                  </Row>
                {/if}
                {#if t.taskDescription || t.sourceNote}
                  <details class="thread-disclosure task-context-disclosure">
                    <summary>
                      <span>Starting point and source notes</span>
                      {#if t.sourceNote?.references?.length}
                        <Chip label={badgeCountLabel(t.sourceNote.references.length)} tone="neutral" />
                      {/if}
                    </summary>
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
                    </div>
                  </details>
                {/if}
                {#if t.taskId !== 'task-meta-intake' && t.taskStatus === 'exploring' && !turnLiveAgent(t) && !isQueuedSpecRevision(t)}
                  <Row justify="end" gap="2" wrap>
                    <Button variant="secondary" onclick={() => nav(currentTaskHref(t.taskId))}>
                      Inspect details
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
                  <div class="live-activity" aria-label="Recent agent activity">
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
                  </div>
                {/if}
                {#if replyTurnId === t.id}
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
              {:else if !(t.taskStatus === 'ready' && hasIncompleteTaskChecklist(t))}
                  <Row justify="end" gap="2">
                    {#if t.taskStatus === 'ready' && !turnLiveAgent(t) && !hasIncompleteTaskChecklist(t)}
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
                        Inspect details
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
                        {t.taskStatus === 'exploring' ? 'Inspect details' : 'Open task'}
                      </Button>
                      {#if t.taskStatus === 'ready' && hasIncompleteTaskChecklist(t)}
                        <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(currentTaskHref(t.taskId))}>
                          Open checklist
                        </Button>
                        <Button variant="ghost" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                          Add optional note
                        </Button>
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

      {#if threadView === 'current' && caughtUp}
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
    </Stack>
  {/if}
</div>

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
      <div class="source-preview-body">
        {#if sourcePreview.loading}
          <p class="muted">Opening source note...</p>
        {:else if sourcePreviewError}
          <p class="error">{sourcePreviewError}</p>
        {:else}
          <Markdown source={sourcePreview.content || '_This source note is empty._'} />
        {/if}
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
  .thread-view-bar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-1);
    width: 100%;
    padding: var(--s-1);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
    position: sticky;
    top: calc(-1 * var(--app-shell-page-padding-block-start));
    z-index: var(--z-sticky-local);
    box-shadow:
      0 10px 24px color-mix(in srgb, var(--bg-base) 72%, transparent),
      var(--glass-etch);
    backdrop-filter: saturate(1.18) var(--glass-blur);
    -webkit-backdrop-filter: saturate(1.18) var(--glass-blur);
  }
  .thread-view-bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    min-width: 0;
    border: 1px solid transparent;
    border-radius: var(--r-0);
    background: transparent;
    color: var(--text-muted);
    padding: var(--s-1) var(--s-2);
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 700;
    cursor: pointer;
  }
  .thread-view-bar button:hover {
    color: var(--text);
    background: var(--bg-raised-2);
  }
  .thread-view-bar button.active {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }
  @media (max-width: 1100px) {
    .thread {
      padding-top: var(--s-3);
    }
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
  .archive-time {
    color: var(--text-soft);
    font-size: var(--fs-0);
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
  .question-card-heading {
    display: grid;
    gap: var(--s-1);
  }
  .question-card-meta {
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 750;
    letter-spacing: 0;
    text-transform: uppercase;
  }
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
  .next-question-note {
    margin: 0;
    color: var(--text-soft);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .git-story-callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
    padding: var(--s-2);
    border: 1px solid color-mix(in srgb, var(--warning) 32%, var(--border));
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--warning) 8%, var(--bg));
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-normal);
  }
  .git-story-main {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .git-story-main span:last-child {
    overflow-wrap: anywhere;
  }
  .git-story-next {
    color: var(--text);
    font-weight: 650;
  }
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
  .thread-disclosure {
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg) 78%, transparent);
  }
  .thread-disclosure > summary {
    min-height: var(--control-h-sm);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-1);
    font-weight: 650;
    list-style-position: inside;
  }
  .thread-disclosure > summary:hover {
    color: var(--text);
    background: var(--bg-raised);
  }
  .thread-disclosure[open] > summary {
    border-bottom: 1px solid var(--border);
  }
  .task-context-disclosure .task-context {
    border: 0;
    border-radius: 0 0 var(--r-1) var(--r-1);
    background: transparent;
    padding: var(--s-2);
  }
  .source-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: var(--s-2);
  }
  .source-ref {
    appearance: none;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    max-width: 100%;
    border: 1px solid color-mix(in srgb, var(--accent-2) 46%, var(--border));
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--accent-2) 8%, transparent);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    padding: var(--s-1) var(--s-2);
    text-align: left;
  }
  .source-ref span {
    color: var(--accent-2);
    font-size: var(--fs-1);
    font-weight: 700;
    line-height: 1;
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
    font-size: var(--fs-0);
    line-height: var(--lh-tight);
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
  .question-context-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .question-context-actions :global(.btn) {
    flex: none;
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
    font-size: var(--fs-1);
    line-height: var(--lh-tight);
  }
  .question-context-copy span {
    color: var(--text-muted);
    font-size: var(--fs-0);
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
    border: 1px solid var(--glass-inset-border);
    border-radius: var(--r-3);
    background:
      radial-gradient(circle at 90% 10%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 30%),
      var(--glass-inset-bg);
    box-shadow: var(--glass-inset-etch), var(--glass-inset-shadow);
  }
  .question-more-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .setup-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: start;
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
  .live-activity :global(.status-detail) {
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
    padding: var(--s-1);
  }
  .activity-extra {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-1);
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
  .turn-pending { opacity: 1; }
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
    .setup-form {
      grid-template-columns: 1fr;
    }
  }
</style>
