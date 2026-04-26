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
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Input from '../../lib/Input.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Select from '../../lib/Select.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import AgentQuestion from '../../lib/AgentQuestion.svelte'
  import StatusLight from '../../lib/StatusLight.svelte'
  import Help from '../../lib/Help.svelte'
  import { onEvent } from '../../lib/events.js'
  import { nav } from '../../lib/nav.svelte.js'

  // ---- Turn shape (mirrors src/runtime/thread.ts) ------------------------
  type TurnPersona = 'intake' | 'spec' | 'worker' | 'coord' | 'system'
  type TurnStatus = 'done' | 'active' | 'pending'
  type TurnPhase = 'setup' | 'intake' | 'spec' | 'ready' | 'inflight' | 'blocked' | 'done'
  type SetupAffordance = 'link' | 'inline-text' | 'inline-textarea' | 'inline-button' | 'inline-choice'

  interface SetupStepTurn {
    kind: 'setup_step'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    stepId: string; title: string; why: string; skippable: boolean
    affordance: SetupAffordance; actionLabel: string
    actionHref?: string | undefined; submitEndpoint?: string | undefined
    currentValue?: string | undefined; placeholder?: string | undefined
    choices?: Array<{ value: string; label: string }> | undefined
  }
  interface BriefTurn {
    kind: 'brief_approval'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    brief: {
      userJob?: string; successMetric?: string; successCriteria?: string
      antiPatterns?: string[]; rolloutPlan?: string; authoredBy?: string
    }
    liveAgent?: { name: string; startedAt?: string | undefined } | undefined
    approvedAt?: string | null
  }
  interface AgentQuestionTurn {
    kind: 'agent_question'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string
    liveAgent?: { name: string; startedAt?: string | undefined } | undefined
    question: {
      kind: 'confirm' | 'yesno' | 'choice' | 'text'
      id: string; askedBy: string; askedAt: string
      answeredAt?: string; answer?: string
      restatement?: string; prompt?: string; choices?: string[]
      selectionMode?: 'single' | 'multiple' | undefined
    }
  }
  interface SpecReviewTurn {
    kind: 'spec_review'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; spec: string
    draftCoordinators?: Array<{
      id: string
      name: string
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
    summary: string; details?: string
  }
  interface InFlightTurn {
    kind: 'inflight'
    id: string; at: string; persona: TurnPersona; status: TurnStatus; phase: TurnPhase
    taskId: string; taskTitle: string; taskStatus?: string; summary: string
    liveAgent?: { name: string; startedAt?: string } | undefined
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
    | EscalationTurn
    | InFlightTurn

  let turns = $state<Turn[]>([])
  let activeTurnId = $state<string | null>(null)
  let caughtUp = $state(false)
  let loaded = $state(false)
  let busyTurnId = $state<string | null>(null)
  let busyTaskId = $state<string | null>(null)
  let setupValues = $state<Record<string, string>>({})
  let setupErrors = $state<Record<string, string>>({})
  let replyTurnId = $state<string | null>(null)
  let replyDrafts = $state<Record<string, string>>({})
  let replyErrors = $state<Record<string, string>>({})
  let sentReplies = $state<Record<string, boolean>>({})
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
  let pollHandle: ReturnType<typeof setInterval> | null = null
  let clockHandle: ReturnType<typeof setInterval> | null = null
  let nowMs = $state(Date.now())
  const turnElements = new Map<string, HTMLDivElement>()
  const phaseOrder: TurnPhase[] = ['setup', 'intake', 'spec', 'ready', 'inflight', 'blocked', 'done']
  const phaseLabels: Record<TurnPhase, string> = {
    setup: 'Setup',
    intake: 'Intake',
    spec: 'Spec',
    ready: 'Ready',
    inflight: 'In flight',
    blocked: 'Blocked',
    done: 'Done',
  }

  // Staged answers for co-active agent_question turns. Keyed by question id.
  // Submitted as a batch (per-task) via POST /answer-questions so the agent
  // gets one resume with the full set of answers, not N partial resumes.
  let staged = $state<Record<string, string>>({})

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

  async function load(): Promise<void> {
    try {
      const r = await fetch('/api/project/thread', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { turns?: Turn[]; activeTurnId?: string | null; caughtUp?: boolean }
      turns = j.turns ?? []
      activeTurnId = j.activeTurnId ?? null
      caughtUp = !!j.caughtUp
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
    } catch {
      /* surface as empty thread; Notifications handles the "broken" case */
    } finally {
      loaded = true
    }
  }

  onMount(() => {
    void load()
    pollHandle = setInterval(() => void load(), 4000)
    clockHandle = setInterval(() => {
      nowMs = Date.now()
    }, 1000)
  })
  $effect(() => {
    const off = onEvent(ev => {
      const type = ev.event?.type ?? ev.type ?? ''
      if (
        type === 'agent_started' ||
        type === 'agent_finished' ||
        type === 'task_transition' ||
        type === 'agent_issue' ||
        type === 'escalation_raised'
      ) {
        void load()
      }
    })
    return off
  })
  onDestroy(() => {
    if (pollHandle) clearInterval(pollHandle)
    if (clockHandle) clearInterval(clockHandle)
  })

  function personaLabel(p: TurnPersona): string {
    switch (p) {
      case 'intake': return 'Setup guide'
      case 'spec':   return 'Spec author'
      case 'worker': return 'Worker'
      case 'coord':  return 'Coordinator'
      case 'system': return 'Guildhall'
    }
  }

  function displayTaskTitle(t: { taskId: string; taskTitle: string }): string {
    if (t.taskId === 'task-meta-intake') return 'Map project areas and starter tasks'
    return t.taskTitle
  }

  function tone(t: Turn): 'ok' | 'warn' | 'neutral' {
    if (t.status === 'done')   return 'ok'
    if (t.status === 'active') return 'warn'
    return 'neutral'
  }

  function isWorkingTurn(t: Turn): boolean {
    return t.status === 'active' && (t.kind === 'inflight' || Boolean(turnLiveAgent(t)))
  }

  function turnLiveAgent(t: Turn): { name: string; startedAt?: string | undefined } | undefined {
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

  function liveAgentMessage(startedAt: string | undefined): string {
    const seconds = elapsedSeconds(startedAt)
    if (seconds === null) return 'Model call in progress'
    const prefix = seconds >= 90 ? 'Still waiting on model' : 'Model call in progress'
    return `${prefix} · ${formatElapsed(seconds)}`
  }

  const phaseGroups = $derived.by(() => phaseOrder
    .map(phase => ({
      phase,
      label: phaseLabels[phase],
      turns: turns.filter(t => t.phase === phase),
    }))
    .filter(group => group.turns.length > 0))

  function captureTurn(node: HTMLDivElement, id: string) {
    turnElements.set(id, node)
    return {
      destroy() {
        if (turnElements.get(id) === node) turnElements.delete(id)
      },
    }
  }

  function togglePhase(phase: TurnPhase): void {
    expandedPhases = { ...expandedPhases, [phase]: !expandedPhases[phase] }
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
    if (!activeTurnId || caughtUp || activeTurnId === lastScrolledId) return
    const targetId = activeTurnId
    void tick().then(() => {
      const el = turnElements.get(targetId)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      lastScrolledId = targetId
    })
  })

  // ---- Brief approve / reply ---------------------------------------------
  async function approveBrief(turn: BriefTurn): Promise<void> {
    busyTurnId = turn.id
    try {
      await fetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/approve-brief`, { method: 'POST' })
      await load()
    } finally { busyTurnId = null }
  }

  async function approveSpec(turn: SpecReviewTurn): Promise<void> {
    busyTurnId = turn.id
    try {
      const endpoint = turn.taskId === 'task-meta-intake'
        ? '/api/project/meta-intake/approve'
        : `/api/project/task/${encodeURIComponent(turn.taskId)}/approve-spec`
      await fetch(endpoint, { method: 'POST' })
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
      const r = await fetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
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

  async function synthesizeMetaIntake(turn: InFlightTurn): Promise<void> {
    busyTurnId = turn.id
    replyErrors[turn.id] = ''
    try {
      const r = await fetch('/api/project/meta-intake/synthesize', { method: 'POST' })
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

  async function submitSetup(turn: SetupStepTurn): Promise<void> {
    if (!turn.submitEndpoint) return
    const body = setupBody(turn)
    if (body === null) {
      setupErrors = { ...setupErrors, [turn.id]: 'Required' }
      return
    }
    busyTurnId = turn.id
    try {
      const r = await fetch(turn.submitEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || j.error) {
        setupErrors = { ...setupErrors, [turn.id]: j.error ?? `HTTP ${r.status}` }
        return
      }
      await load()
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
      .map(t => ({ questionId: t.question.id, answer: staged[t.question.id] }))
      .filter((a): a is { questionId: string; answer: string } => typeof a.answer === 'string' && a.answer.length > 0)
    if (answers.length === 0) return
    busyTaskId = taskId
    try {
      await fetch(`/api/project/task/${encodeURIComponent(taskId)}/answer-questions`, {
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
      stageAnswer(turn.question.id, trimmed)
      return
    }
    busyTaskId = turn.taskId
    try {
      await fetch(`/api/project/task/${encodeURIComponent(turn.taskId)}/answer-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: turn.question.id, answer: trimmed }] }),
      })
      await load()
    } finally {
      busyTaskId = null
    }
  }

  function taskStateLabel(turn: InFlightTurn): string {
    if (turn.liveAgent?.name === 'spec-agent') return 'Spec'
    if (turn.liveAgent?.name === 'worker-agent') return 'In flight'
    if (turn.liveAgent?.name === 'reviewer-agent') return 'Review'
    if (turn.liveAgent?.name === 'gate-checker-agent') return 'Gates'
    switch (turn.taskStatus) {
      case 'exploring': return 'Intake'
      case 'ready': return 'Ready'
      case 'gate_check': return 'Gates'
      case 'review': return 'Review'
      default: return 'In flight'
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
      slot.askedQuestionIds.push(t.question.id)
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
    <p class="lede">Structured project interactions: decisions, questions, and live agent updates. Active work stays near the bottom.</p>
  </header>

  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else if turns.length === 0}
    <Card title="Nothing here yet">
      <p class="muted">Add a task to start the thread.</p>
    </Card>
  {:else}
    <Stack gap="3">
      {#each phaseGroups as group (group.phase)}
        <section class="phase">
          <button
            type="button"
            class="phase-head"
            aria-expanded={expandedPhases[group.phase]}
            onclick={() => togglePhase(group.phase)}
          >
            <span>{group.label}</span>
            <Chip label={String(group.turns.length)} tone={group.turns.some(t => t.status === 'active') ? 'warn' : 'neutral'} />
          </button>
          {#if expandedPhases[group.phase]}
            <Stack gap="3">
              {#each group.turns as t (t.id)}
        <div class="turn turn-{t.status}" data-turn-id={t.id} use:captureTurn={t.id}>
          <Card tone={tone(t)}>
            {#snippet actions()}
              {#if isWorkingTurn(t)}
                <StatusLight pulse />
              {/if}
              <Chip
                label={t.status === 'done' ? 'done' : t.status === 'active' ? 'now' : 'next'}
                tone={t.status === 'done' ? 'ok' : t.status === 'active' ? 'warn' : 'neutral'}
              />
            {/snippet}

            <Stack gap="2">
              <div class="meta">
                <span class="persona">{personaLabel(t.persona)}</span>
                {#if 'taskTitle' in t}
                  {@const taskTitle = displayTaskTitle(t)}
                  <button
                    type="button"
                    class="task-chip"
                    title={taskTitle}
                    onclick={() => nav(`/task/${encodeURIComponent(t.taskId)}`)}
                  >
                    <span class="task-chip-text">{taskTitle}</span>
                  </button>
                {/if}
              </div>
              {#if t.status === 'active' && turnLiveAgent(t)}
                {@const live = turnLiveAgent(t)}
                <div class="live-agent">
                  <StatusLight tone="running" pulse={true} />
                  <span>{liveAgentMessage(live?.startedAt)}</span>
                </div>
              {/if}

              {#if t.kind === 'setup_step'}
                <h3 class="prompt"><Markdown source={t.title} inline /></h3>
                <p class="why">{t.why}</p>
                {#if t.status === 'active'}
                  {#if t.affordance === 'link' && t.actionHref}
                    <Row justify="end" gap="2">
                      <Button variant="primary" onclick={() => nav(t.actionHref!)}>{t.actionLabel}</Button>
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
                        {busyTurnId === t.id ? 'Saving…' : t.actionLabel}
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
                          {busyTurnId === t.id ? 'Saving…' : t.actionLabel}
                        </Button>
                      </Row>
                    </Stack>
                  {:else if t.affordance === 'inline-button'}
                    <Row justify="end" gap="2">
                      <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => submitSetup(t)}>
                        {busyTurnId === t.id ? 'Verifying…' : t.actionLabel}
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
                        {busyTurnId === t.id ? 'Adding…' : t.actionLabel}
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
                  {#if blockedByQuestions}
                    <p class="lede gating">
                      Answer the open questions below before approving — the
                      brief depends on what you say.
                    </p>
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
                  {#if staged[t.question.id]}
                    <div class="prompt"><Markdown source={t.question.restatement ?? t.question.prompt ?? ''} /></div>
                    <div class="field"><span class="field-label">Staged</span>
                      <div class="answer"><Markdown source={staged[t.question.id]} inline /></div>
                    </div>
                    <Row justify="end">
                      <Button
                        variant="ghost"
                        disabled={busyTaskId === t.taskId}
                        onclick={() => unstageAnswer(t.question.id)}
                      >Change</Button>
                    </Row>
                  {:else}
                    <AgentQuestion
                      question={t.question}
                      busy={busyTaskId === t.taskId}
                      onAnswer={(a) => answerQuestion(t, a)}
                    />
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
                <div class="prompt-row">
                  <h3 class="prompt">
                    {t.taskId === 'task-meta-intake' ? 'Coordinator roles are ready for review' : 'Spec ready for review'}
                  </h3>
                  {#if t.taskId === 'task-meta-intake'}
                    <Help topic="guide.coordinators" />
                  {/if}
                </div>
                {#if t.taskId === 'task-meta-intake' && t.draftCoordinators?.length}
                  <p class="why">
                    Coordinator roles are review lanes for future work. Guildhall uses them to route
                    tasks, choose the right reviewer, and decide what an agent may handle without
                    interrupting you. Approve these if the lanes match how this repo should be split.
                  </p>
                  <div class="coord-list">
                    {#each t.draftCoordinators as d (d.id)}
                      <div class="coord">
                        <div class="coord-title">
                          <strong><Markdown source={d.name} inline /></strong>
                          {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                        </div>
                        {#if d.mandate}
                          <div class="coord-mandate"><strong>Will watch:</strong> <Markdown source={d.mandate} inline /></div>
                        {/if}
                        {#if d.concerns?.length}
                          <div class="coord-concerns">
                            <strong>Will check:</strong>
                            {d.concerns.map(c => c.description ?? c.id).join(', ')}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else if t.spec}
                  <div class="spec-preview"><Markdown source={t.spec} /></div>
                {:else if missingSpec}
                  <p class="error">The task is marked ready, but no spec was saved. Ask the spec author to write the spec before approving.</p>
                {/if}
                {#if t.status === 'active'}
                  {@const blockedByQuestions = hasOpenQuestionsForTask(t.taskId)}
                  {#if blockedByQuestions}
                    <p class="lede gating">
                      Answer the open questions below before approving the spec.
                    </p>
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
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => nav(`/task/${encodeURIComponent(t.taskId)}`)}>
                      Open
                    </Button>
                    <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                      Change
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busyTurnId === t.id || blockedByQuestions || missingSpec}
                      onclick={() => approveSpec(t)}
                    >
                      {t.taskId === 'task-meta-intake' ? 'Approve and merge' : 'Approve spec'}
                    </Button>
                  </Row>
                  {/if}
                {/if}

              {:else if t.kind === 'escalation'}
                <h3 class="prompt">Worker is stuck</h3>
                <p class="why">{t.summary}</p>
                {#if t.details}<p class="detail">{t.details}</p>{/if}
                {#if t.status === 'active'}
                  <Row justify="end">
                    <Button variant="primary" onclick={() => nav(`/task/${encodeURIComponent(t.taskId)}`)}>Open task</Button>
                  </Row>
                {/if}
              {:else if t.kind === 'inflight'}
                <h3 class="prompt">{taskStateLabel(t)}</h3>
                <p class="why">{t.summary}</p>
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
                            tone={step.status === 'done' ? 'ok' : step.status === 'active' ? 'running' : 'idle'}
                            pulse={step.status === 'active'}
                          />
                          <div class="live-step-copy">
                            <strong>{step.title}</strong>
                            <span>{step.why}</span>
                          </div>
                          <span class="live-step-state">
                            {step.status === 'done' ? 'Done' : step.status === 'active' ? 'Now' : step.status === 'skipped' ? 'Skipped' : 'Pending'}
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
                    <Button variant="secondary" onclick={() => nav(`/task/${encodeURIComponent(t.taskId)}`)}>Open</Button>
                    {#if t.taskId === 'task-meta-intake' && t.taskStatus === 'exploring'}
                      <Button variant="secondary" disabled={busyTurnId === t.id} onclick={() => synthesizeMetaIntake(t)}>
                        Use saved answers
                      </Button>
                    {/if}
                    <Button variant="primary" disabled={busyTurnId === t.id} onclick={() => (replyTurnId = t.id)}>
                      Tell agent
                    </Button>
                  </Row>
                  {#if replyErrors[t.id]}
                    <p class="error">{replyErrors[t.id]}</p>
                  {/if}
                {/if}
              {/if}
            </Stack>
          </Card>
        </div>
        {#if sectionFooterTurnId[t.id]}
          {@const tid = sectionFooterTurnId[t.id]!}
          {@const total = totalCountForTask(tid)}
          {@const ready = stagedCountForTask(tid)}
          <div class="section-footer">
            <span class="section-status">
              {ready} of {total} answered
            </span>
            <Button
              variant="primary"
              disabled={busyTaskId === tid || ready === 0}
              onclick={() => submitSection(tid)}
            >
              {ready === total ? `Submit ${total} answer${total === 1 ? '' : 's'}` : `Submit ${ready} of ${total}`}
            </Button>
          </div>
        {/if}
              {/each}
            </Stack>
          {/if}
        </section>
      {/each}

      {#if caughtUp}
        <p class="muted caught-up">All caught up — agents are working.</p>
      {/if}
    </Stack>
  {/if}
</div>

<style>
  .thread {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--s-3) var(--s-4) var(--s-6);
  }
  .thread-head { margin-bottom: var(--s-4); }
  .thread-head h1 { margin: 0 0 var(--s-1); font-size: var(--fs-5); }
  .lede { margin: 0; color: var(--text-muted); font-size: var(--fs-2); }
  .phase {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    position: relative;
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
    top: var(--s-2);
    z-index: 3;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--bg-base) 80%, transparent);
  }
  .phase-head:hover {
    background: var(--bg-raised-2);
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
    color: var(--text);
    font-size: var(--fs-1);
    font-weight: 550;
    line-height: var(--lh-tight);
  }
  .task-chip {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 0;
    border-radius: var(--r-1);
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-0);
    line-height: var(--lh-tight);
  }
  .task-chip:hover {
    color: var(--text);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .task-chip-text {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prompt { margin: 0; font-size: var(--fs-3); font-weight: 550; line-height: var(--lh-tight); }
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
  .live-agent {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    width: fit-content;
    color: var(--warn);
    font-size: var(--fs-1);
    font-weight: 700;
    text-transform: uppercase;
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
  .turn-pending { opacity: 0.5; }
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
