<script lang="ts">
  import Card from '../../lib/ui-compat/Card.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import StateSummary from '../../lib/StateSummary.svelte'
  import StatusLine from '../../lib/StatusLine.svelte'
  import StatusLight from '../../lib/StatusLight.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import {
    escalationPrimaryAction,
    escalationReasonLabel,
    escalationUserGuidance,
    roleLabel,
  } from '../../lib/escalation-labels.js'
  import {
    hasIncompleteTaskChecklist,
    isImportedDraftShaping,
    isQueuedSpecRevision,
    needsWorkerHandoffSpecCleanup,
    needsRecovery,
  } from '../../lib/task-state.js'
  import type {
    Task,
    TaskThreadTurn,
    TaskThreadEscalationTurn,
    TaskThreadInFlightTurn,
    ExternalBlockerStep,
  } from '../../lib/types.js'

  interface Props {
    task: Task
    turns?: TaskThreadTurn[]
    busy?: boolean
    runBusy?: boolean
    runError?: string | null
    runStatus?: string
    projectStartBlockerMessage?: string | null
    onApproveBrief: () => void
    onApproveSpec: () => void
    onRunTask: () => void
    onShapeDraft: () => void
    onOpenSpecTab: () => void
    onOpenEscalationAction: (escalationId: string, mode: 'retry' | 'resolve') => void
    onRunEscalationAction: (escalationId: string) => void
    onOpenThread: () => void
  }

  let {
    task,
    turns = [],
    busy = false,
    runBusy = false,
    runError = null,
    runStatus = 'stopped',
    projectStartBlockerMessage = null,
    onApproveBrief,
    onApproveSpec,
    onRunTask,
    onShapeDraft,
    onOpenSpecTab,
    onOpenEscalationAction,
    onRunEscalationAction,
    onOpenThread,
  }: Props = $props()

  const relevantTurns = $derived.by(() =>
    [...turns]
      .filter(turn => turn.status !== 'done')
      .sort((a, b) => {
        if (a.status === b.status) return 0
        if (a.status === 'active') return -1
        if (b.status === 'active') return 1
        return 0
      }),
  )

  const taskNeedsBriefCleanup = $derived(needsWorkerHandoffSpecCleanup(task))

  function activityElapsed(iso: string | undefined): string | null {
    if (!iso) return null
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 1_000) return 'just now'
    const seconds = Math.floor(ms / 1_000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  function taskStateLabel(turn: TaskThreadInFlightTurn): string {
    if (needsRecovery(turn)) return 'Needs recovery'
    if (briefShapingTimedOut(turn)) return 'Shaping timed out'
    if (briefShapingPaused(turn)) return 'Shaping paused'
    if (turn.liveAgent?.name === 'spec-agent') return turn.importedDraft ? 'Shaping draft' : 'Drafting'
    if (turn.liveAgent?.name?.startsWith('coordinator-')) return 'Ready'
    if (turn.liveAgent?.name === 'worker-agent') return 'In flight'
    if (turn.liveAgent?.name === 'reviewer-agent') return 'Review'
    if (turn.liveAgent?.name === 'gate-checker-agent') return 'Gates'
    switch (turn.taskStatus) {
      case 'import_draft': return 'Needs task brief'
      case 'exploring': return isImportedDraftShaping(turn) ? 'Guildhall shaping' : isQueuedSpecRevision(turn) ? 'Spec revision queued' : 'Intake'
      case 'ready':
        if (hasIncompleteTaskChecklist(turn)) return 'Needs task brief'
        if (isProjectRunActive()) return 'Queued for Guildhall'
        return 'Ready'
      case 'gate_check': return 'Gates'
      case 'review': return 'Review'
      case 'in_progress': return turn.liveAgent ? 'In flight' : 'Paused'
      default: return canRunTask(turn) ? 'Queued' : 'In flight'
    }
  }

  function taskStateDescription(turn: TaskThreadInFlightTurn): string {
    if (needsRecovery(turn)) {
      return 'Guildhall made partial progress, then the agent failed. Review the durable worktree changes or restart from that recovery point.'
    }
    if (briefShapingTimedOut(turn)) {
      return 'Guildhall stopped while shaping the brief before it could write the missing acceptance criteria. Try again from this task, or open the spec if you want to add the checks yourself.'
    }
    if (briefShapingPaused(turn)) {
      return 'Guildhall stopped before writing the missing acceptance criteria. Try again from this task, or open the spec if you want to add the checks yourself.'
    }
    if (
      turn.liveAgent?.lastEventLabel === 'Waiting for the local model to respond.' &&
      (turn.liveAgent.silentMs ?? 0) >= 60_000
    ) {
      return 'Local model is still loading or generating.'
    }
    if (turn.liveAgent?.name === 'spec-agent') {
      if (turn.importedDraft) return 'Guildhall is drafting the task brief for this imported note now.'
      return 'Guildhall is drafting this now.'
    }
    if (turn.taskStatus === 'ready' && !turn.liveAgent) {
      if (hasIncompleteTaskChecklist(turn)) {
        return briefFixDescription(turn)
      }
      if (projectStartBlockerMessage) {
        return projectStartBlockerMessage
      }
      if (isProjectRunActive()) {
        return 'Approved and queued. Guildhall is already running for this project, so this task will stay in the queue until the coordinator picks it.'
      }
      return 'Approved and queued. Start only this work item when you want Guildhall to pick it up.'
    }
    if (turn.taskStatus === 'import_draft' && !turn.liveAgent) {
      return 'Imported from your project notes, but not ready for a worker yet. Next step: turn this note into a task brief with scope, evidence, and acceptance criteria.'
    }
    if (turn.taskStatus === 'exploring' && !turn.liveAgent) {
      if (isQueuedSpecRevision(turn)) {
        return 'Guildhall already has the draft spec plus your latest answers. Start Guildhall when you want it to revise the spec.'
      }
      return turn.importedDraft
        ? 'Guildhall is shaping the task brief for this imported note. You can add context, but you do not need to babysit the draft.'
        : 'Guildhall has started shaping this task, but the brief is not ready yet. The checklist below shows what is still missing.'
    }
    if (turn.taskStatus === 'in_progress' && !turn.liveAgent) {
      return 'Work is paused. Start Guildhall when you want it to continue.'
    }
    if (turn.taskStatus === 'review' && !turn.liveAgent) {
      return 'Review is queued. Start Guildhall when you want it to continue.'
    }
    if (turn.taskStatus === 'gate_check' && !turn.liveAgent) {
      return 'Gate checks are queued. Start Guildhall when you want it to continue.'
    }
    return turn.summary
  }

  function taskStateTone(turn: TaskThreadInFlightTurn): 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running' | 'agent' | 'agent-attention' {
    if (needsRecovery(turn)) return 'warn'
    if (briefShapingTimedOut(turn)) return 'warn'
    if (briefShapingPaused(turn)) return 'warn'
    if (turn.liveAgent) return 'running'
    if (turn.taskStatus === 'ready' && hasIncompleteTaskChecklist(turn)) return 'agent-attention'
    switch (turn.taskStatus) {
      case 'ready': return 'agent'
      case 'import_draft': return 'agent-attention'
      case 'gate_check': return 'agent'
      case 'review': return 'agent'
      case 'exploring': return 'agent'
      case 'in_progress': return 'neutral'
      default: return 'neutral'
    }
  }

  function canRunTask(turn: TaskThreadInFlightTurn): boolean {
    if (projectStartBlockerMessage) return false
    if (turn.taskStatus === 'ready' && hasIncompleteTaskChecklist(turn)) return false
    if (isProjectRunActive() && turn.taskStatus !== 'import_draft') return false
    return !turn.liveAgent && (
      turn.taskStatus === 'ready' ||
      turn.taskStatus === 'import_draft' ||
      turn.taskStatus === 'exploring' ||
      turn.taskStatus === 'in_progress' ||
      turn.taskStatus === 'review' ||
      turn.taskStatus === 'gate_check'
    )
  }

  function briefShapingTimedOut(turn: TaskThreadInFlightTurn): boolean {
    if (turn.liveAgent) return false
    if (turn.taskStatus !== 'exploring') return false
    if (!hasIncompleteTaskChecklist(turn)) return false
    return (turn.activity ?? []).some(item => {
      const label = typeof item.label === 'string' ? item.label : ''
      const detail = typeof item.detail === 'string' ? item.detail : ''
      return /spec-agent timed out|Agent spec-agent failed/i.test(`${label} ${detail}`)
    })
  }

  function briefShapingPaused(turn: TaskThreadInFlightTurn): boolean {
    if (turn.liveAgent) return false
    if (turn.taskStatus !== 'exploring') return false
    if (!hasIncompleteTaskChecklist(turn)) return false
    return (turn.activity ?? []).some(item => {
      const label = typeof item.label === 'string' ? item.label : ''
      const detail = typeof item.detail === 'string' ? item.detail : ''
      return /paused after gathering enough context|durable-progress nudge|read-only tool calls/i.test(`${label} ${detail}`)
    })
  }

  function isProjectRunActive(): boolean {
    return runStatus === 'running' || runStatus === 'stopping'
  }

  function showsTaskAction(turn: TaskThreadInFlightTurn): boolean {
    if (projectStartBlockerMessage) {
      return !turn.liveAgent && (
        turn.taskStatus === 'ready' ||
        turn.taskStatus === 'exploring' ||
        turn.taskStatus === 'in_progress' ||
        turn.taskStatus === 'review' ||
        turn.taskStatus === 'gate_check'
      )
    }
    return canRunTask(turn) ||
      (!turn.liveAgent && turn.taskStatus === 'ready' && hasIncompleteTaskChecklist(turn)) ||
      (!turn.liveAgent && turn.taskStatus !== 'import_draft' && isProjectRunActive())
  }

  function runLabel(turn: TaskThreadInFlightTurn): string {
    if (projectStartBlockerMessage) return 'Project blocked'
    if (briefShapingTimedOut(turn) || briefShapingPaused(turn)) return 'Try shaping brief again'
    switch (turn.taskStatus) {
      case 'ready': return hasIncompleteTaskChecklist(turn) ? briefFixButtonLabel(turn) : 'Start only this work item'
      case 'import_draft': return 'Draft task brief'
      case 'exploring':
        if (turn.importedDraft || hasIncompleteTaskChecklist(turn)) return 'Continue shaping brief'
        return isQueuedSpecRevision(turn) ? 'Revise spec' : 'Continue drafting spec'
      case 'review': return 'Resume review'
      case 'gate_check': return 'Resume gates'
      case 'in_progress': return 'Resume work'
      default: return 'Run this task'
    }
  }

  function missingChecklistSteps(turn: TaskThreadInFlightTurn): NonNullable<TaskThreadInFlightTurn['checklist']>['steps'] {
    return (turn.checklist?.steps ?? [])
      .filter(step => step.status !== 'done' && step.status !== 'skipped')
  }

  function missingBriefFieldKind(turn: TaskThreadInFlightTurn): 'success' | 'acceptance' | 'both' | 'unknown' {
    const missing = missingChecklistSteps(turn)
    const hasSuccess = missing.some(step => /success|done|outcome|target/i.test(`${step.id} ${step.title}`))
    const hasAcceptance = missing.some(step => /acceptance|criteria|check|verify/i.test(`${step.id} ${step.title}`))
    if (hasSuccess && hasAcceptance) return 'both'
    if (hasSuccess) return 'success'
    if (hasAcceptance) return 'acceptance'
    return 'unknown'
  }

  function briefFixTitle(turn: TaskThreadInFlightTurn): string {
    switch (missingBriefFieldKind(turn)) {
      case 'success': return 'Brief cleanup needed'
      case 'acceptance': return 'Brief cleanup needed'
      case 'both': return 'Brief cleanup needed'
      default: return 'Brief cleanup needed'
    }
  }

  function briefFixDescription(turn: TaskThreadInFlightTurn): string {
    switch (missingBriefFieldKind(turn)) {
      case 'success':
        return 'Guildhall needs to turn the source notes into a success target before implementation.'
      case 'acceptance':
        return 'Guildhall needs to turn the source notes into concrete acceptance checks before implementation.'
      case 'both':
        return 'Guildhall needs to turn the source notes into an outcome and acceptance checks before implementation.'
      default:
        return 'Guildhall needs to turn the missing task-brief field into a usable task brief before implementation.'
    }
  }

  function briefFixButtonLabel(turn: TaskThreadInFlightTurn): string {
    switch (missingBriefFieldKind(turn)) {
      case 'success': return 'Start'
      case 'acceptance': return 'Start'
      default: return 'Start'
    }
  }

  function cardTitleForTurn(turn: TaskThreadInFlightTurn): string {
    if (briefShapingTimedOut(turn)) return 'Shaping timed out'
    if (briefShapingPaused(turn)) return 'Shaping paused'
    if (hasIncompleteTaskChecklist(turn)) return 'Needs brief cleanup'
    return turn.liveAgent ? 'Live progress' : 'Task status'
  }

  function checklistStepTone(
    turn: TaskThreadInFlightTurn,
    step: { status: 'done' | 'active' | 'pending' | 'skipped' },
  ): 'ok' | 'running' | 'idle' {
    if (step.status === 'done') return 'ok'
    if (step.status === 'active') return turn.liveAgent ? 'running' : 'idle'
    return 'idle'
  }

  function checklistStepLabel(
    turn: TaskThreadInFlightTurn,
    step: { status: 'done' | 'active' | 'pending' | 'skipped' },
  ): string {
    if (step.status === 'done') return 'Done'
    if (step.status === 'active') return turn.liveAgent ? 'Now' : 'Missing'
    if (step.status === 'skipped') return 'Skipped'
    return 'Missing'
  }

  function externalStepOwnerLabel(step: ExternalBlockerStep): string {
    if (step.owner === 'guildhall') return 'Guildhall'
    if (step.owner === 'external') return 'External service'
    return 'You'
  }

  function checklistForEscalation(turn: TaskThreadEscalationTurn): ExternalBlockerStep[] {
    if (turn.externalChecklist?.length) return turn.externalChecklist
    const match = (task.escalations ?? []).find(item => item.id === turn.escalationId)
    return match?.externalChecklist ?? []
  }
</script>

<Stack gap="4">
  {#if relevantTurns.length === 0 && taskNeedsBriefCleanup}
    <Card title="Needs brief cleanup" tone="warn">
      <Stack gap="3">
        <StateSummary
          label="Brief cleanup needed"
          description="Guildhall needs to turn the source notes into a usable task brief before implementation."
          tone="agent-attention"
        />
        <p class="detail-copy">
          The Work board sent you here because this task is marked ready, but its brief/spec is not complete enough for a worker yet. Start lets Guildhall clean up the brief before implementation.
        </p>
        <Row justify="end" gap="2">
          <Button variant="secondary" onclick={onOpenSpecTab}>View brief</Button>
          <Button variant="agent" disabled={runBusy || Boolean(projectStartBlockerMessage)} onclick={onRunTask}>
            <Icon name="sparkles" size={14} />
            {projectStartBlockerMessage ? 'Project blocked' : 'Start'}
          </Button>
        </Row>
      </Stack>
    </Card>
  {:else if relevantTurns.length === 0}
    <Card title="Current status">
      <StateSummary
        label="Nothing is waiting"
        description="This task does not currently need a decision from you."
        tone="neutral"
      />
    </Card>
  {:else}
    {#each relevantTurns as turn (turn.id)}
      {#if turn.kind === 'agent_question'}
        <Card title="Needs your answer" tone="accent">
          <Stack gap="3">
            <StateSummary
              label="Question waiting in Thread"
              description="Open Thread to answer this with the rest of the project conversation."
              tone="accent"
            />
            <div class="question-link-preview">
              <Markdown source={turn.question.prompt ?? turn.question.restatement ?? 'Guildhall needs one answer before it continues.'} />
            </div>
            <Row justify="end" gap="2">
              <Button variant="primary" disabled={busy} onclick={onOpenThread}>Open Thread</Button>
            </Row>
          </Stack>
        </Card>
      {:else if turn.kind === 'brief_approval'}
        <Card title="Needs your approval" tone="accent">
          <Stack gap="3">
            <StateSummary
              label="Approve brief"
              description="Guildhall drafted the task brief and is waiting for your go-ahead before it moves on."
              tone="accent"
            />
            <Row justify="end" gap="2">
              <Button variant="secondary" onclick={onOpenSpecTab}>Review draft...</Button>
              <Button variant="primary" disabled={busy} onclick={onApproveBrief}>Approve brief</Button>
            </Row>
          </Stack>
        </Card>
      {:else if turn.kind === 'spec_review'}
        <Card title="Needs your approval" tone="accent">
          <Stack gap="3">
            <StateSummary
              label="Approve spec"
              description="Guildhall drafted the spec. Review it, then approve when it matches what you want."
              tone="warn"
            />
            {#if turn.spec}
              <div class="spec-preview">
                <Markdown source={turn.spec.split('\n').slice(0, 8).join('\n')} />
              </div>
            {/if}
            <Row justify="end" gap="2">
              <Button variant="secondary" onclick={onOpenSpecTab}>Review draft...</Button>
              <Button variant="primary" disabled={busy} onclick={onApproveSpec}>Approve spec</Button>
            </Row>
          </Stack>
        </Card>
      {:else if turn.kind === 'review_feedback'}
        <Card title="Revision requested" tone="warn">
          <Stack gap="3">
            <StateSummary
              label="Revision requested"
              description={turn.summary}
              tone="warn"
            />
            <p class="detail-copy">{turn.feedback}</p>
            <Row justify="end" gap="2">
              <Button variant="secondary" onclick={onOpenSpecTab}>Open task details</Button>
            </Row>
          </Stack>
        </Card>
      {:else if turn.kind === 'escalation'}
        {@const guidance = escalationUserGuidance({ summary: turn.summary, details: turn.details, reason: turn.escalationReason, agentId: turn.escalationAgentId })}
        {@const recoveryAction = escalationPrimaryAction({ reason: turn.escalationReason, agentId: turn.escalationAgentId, summary: turn.summary, details: turn.details })}
        {@const reasonLabel = escalationReasonLabel(turn.escalationReason)}
        {@const ownerLabel = roleLabel(turn.escalationAgentId)}
        {@const externalChecklist = checklistForEscalation(turn)}
        <Card title={guidance.actionOwner === 'guildhall' ? 'Guildhall can continue' : 'Recovery needed'} tone="warn">
          <Stack gap="3">
            <StateSummary
              label={guidance.actionOwner === 'guildhall' ? 'Guildhall action' : reasonLabel}
              description={guidance.actionOwner === 'guildhall' ? guidance.title : guidance.detail}
              tone={guidance.actionOwner === 'guildhall' ? 'accent' : 'warn'}
            />
            <div class="recovery-meta" aria-label="Recovery owner">
              {#if ownerLabel !== 'Unknown'}
                <Chip label={ownerLabel} tone="accent" />
              {/if}
            </div>
            {#if guidance.actionOwner === 'guildhall'}
              <p class="detail-copy">{guidance.detail}</p>
              <p class="detail-copy">{guidance.nextStep}</p>
            {:else}
              <p class="detail-copy">
                Guildhall stopped because this blocker changes what the task means or how it should continue.
                The recommended next step is shown first; use the other action only if you already fixed the blocker outside Guildhall.
              </p>
              <p class="detail-copy"><strong>Most likely next step:</strong> {recoveryAction.label}</p>
            {/if}
            {#if guidance.technicalNote}
              <details class="more">
                <summary>Show blocker detail</summary>
                <p class="detail-copy">{guidance.technicalNote}</p>
              </details>
            {/if}
            {#if externalChecklist.length > 0}
              <section class="state-section external-checklist" aria-label="External setup checklist">
                <p class="section-label">External setup checklist</p>
                <div class="external-steps">
                  {#each externalChecklist as step, index (`${step.id ?? step.title ?? 'step'}:${index}`)}
                    <div class="external-step">
                      <StatusLight tone={step.status === 'done' ? 'ok' : 'idle'} />
                      <div class="external-step-copy">
                        <strong>{step.title}</strong>
                        {#if step.detail}
                          <span>{step.detail}</span>
                        {/if}
                      </div>
                      <span class="external-step-owner">{externalStepOwnerLabel(step)}</span>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
            <Row justify="end" gap="2">
              <Button variant="secondary" onclick={onOpenSpecTab}>View spec and evidence</Button>
              {#if guidance.actionOwner === 'user'}
                <Button
                  variant="agent"
                  disabled={busy}
                  onclick={() => onOpenEscalationAction(turn.escalationId, 'retry')}
                >
                  <Icon name="sparkles" size={14} />
                  {recoveryAction.label}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onclick={() => onOpenEscalationAction(turn.escalationId, 'resolve')}
                >
                  I handled this...
                </Button>
              {:else}
                <Button
                  variant="agent"
                  disabled={busy || runBusy}
                  onclick={() => onRunEscalationAction(turn.escalationId)}
                >
                  <Icon name="sparkles" size={14} />
                  {recoveryAction.label}
                </Button>
              {/if}
            </Row>
            {#if turn.activity?.length}
              <section class="state-section" aria-label="Activity log">
                <p class="section-label">Activity log</p>
                <div class="live-activity">
                {#each turn.activity as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                  <StatusLine
                    label={item.label}
                    detail={item.detail}
                    time={activityElapsed(item.at)}
                    tone={item.tone}
                    pulse={item.tone === 'running'}
                  />
                {/each}
                </div>
              </section>
            {/if}
          </Stack>
        </Card>
      {:else if turn.kind === 'inflight'}
        <Card title={cardTitleForTurn(turn)} tone={briefShapingTimedOut(turn) || briefShapingPaused(turn) || hasIncompleteTaskChecklist(turn) ? 'warn' : turn.importedDraft ? 'accent' : 'default'}>
          <Stack gap="3">
            <section class="state-section" aria-label="Current task status">
              <p class="section-label">Current status</p>
              <StateSummary
                label={briefShapingTimedOut(turn) || briefShapingPaused(turn) ? taskStateLabel(turn) : hasIncompleteTaskChecklist(turn) ? briefFixTitle(turn) : taskStateLabel(turn)}
                description={taskStateDescription(turn)}
                tone={taskStateTone(turn)}
              />
            </section>
            {#if turn.activity?.length}
              <section class="state-section" aria-label="Activity log">
                <p class="section-label">Activity log</p>
                <div class="live-activity">
                {#each turn.activity as item, index (`${item.at ?? 'event'}:${item.label}:${index}`)}
                  <StatusLine
                    label={item.label}
                    detail={item.detail}
                    time={activityElapsed(item.at)}
                    tone={item.tone}
                    pulse={item.tone === 'running'}
                  />
                {/each}
                </div>
              </section>
            {/if}
            {#if turn.checklist && (!turn.importedDraft || Boolean(turn.liveAgent)) && !isQueuedSpecRevision(turn)}
              <section class="state-section live-checklist">
                <div class="live-checklist-head">
                  <strong>{turn.checklist.title}</strong>
                  <span>{turn.checklist.doneCount} of {turn.checklist.totalSteps}</span>
                </div>
                <div class="live-checklist-steps">
                  {#each turn.checklist.steps as step (step.id)}
                    <div class="live-step" class:done={step.status === 'done'} class:active={step.status === 'active'}>
                      <StatusLight
                        tone={checklistStepTone(turn, step)}
                        pulse={step.status === 'active' && Boolean(turn.liveAgent)}
                      />
                      <div class="live-step-copy">
                        <strong>{step.title}</strong>
                        <span>{step.why}</span>
                      </div>
                      <span class="live-step-state">{checklistStepLabel(turn, step)}</span>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
            {#if showsTaskAction(turn)}
              <Row justify="end" gap="2">
                {#if turn.taskStatus === 'ready' && hasIncompleteTaskChecklist(turn)}
                  <Button variant="agent" disabled={runBusy || Boolean(projectStartBlockerMessage)} onclick={onRunTask}>
                    <Icon name="sparkles" size={14} />
                    {projectStartBlockerMessage ? 'Project blocked' : briefFixButtonLabel(turn)}
                  </Button>
                {:else if turn.taskStatus !== 'import_draft' && isProjectRunActive()}
                  <Button variant="secondary" disabled>
                    Already queued
                  </Button>
                {:else if turn.importedDraft && !turn.liveAgent}
                  <Button
                    variant="agent"
                    disabled={runBusy || Boolean(projectStartBlockerMessage)}
                    onclick={turn.taskStatus === 'import_draft' ? onShapeDraft : onRunTask}
                  >
                    <Icon name="sparkles" size={14} />
                    {runLabel(turn)}
                  </Button>
                {:else if isQueuedSpecRevision(turn)}
                  <Button
                    variant="agent"
                    disabled={runBusy || Boolean(projectStartBlockerMessage)}
                    onclick={onRunTask}
                  >
                    <Icon name="sparkles" size={14} />
                    Revise spec
                  </Button>
                {:else}
                  <Button
                    variant="agent"
                    disabled={runBusy || Boolean(projectStartBlockerMessage)}
                    onclick={turn.taskStatus === 'import_draft' ? onShapeDraft : onRunTask}
                  >
                    <Icon name="sparkles" size={14} />
                    {runLabel(turn)}
                  </Button>
                {/if}
              </Row>
              {#if runError}
                <p class="error">{runError}</p>
              {/if}
            {/if}
          </Stack>
        </Card>
      {/if}
    {/each}
  {/if}
</Stack>

<style>
  .spec-preview {
    max-height: 16rem;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0));
  }
  .detail-copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .recovery-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 700;
    letter-spacing: 0.05em;
    list-style: none;
    text-transform: uppercase;
  }
  .more > summary::-webkit-details-marker {
    display: none;
  }
  .more > summary::before {
    content: '▸ ';
  }
  .more[open] > summary::before {
    content: '▾ ';
  }
  .state-section {
    display: grid;
    gap: var(--s-2);
  }
  .external-steps {
    display: grid;
    gap: var(--s-2);
  }
  .external-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .external-step-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .external-step-copy strong {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
  }
  .external-step-copy span,
  .external-step-owner {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .external-step-owner {
    white-space: nowrap;
  }
  .section-label {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 800;
    letter-spacing: 0.05em;
    line-height: 1;
    text-transform: uppercase;
  }
  .live-activity {
    display: grid;
    gap: var(--s-2);
  }
  .live-checklist {
    display: grid;
    gap: var(--s-2);
  }
  .live-checklist-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .live-checklist-steps {
    display: grid;
    gap: var(--s-2);
  }
  .live-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .live-step.done {
    opacity: 0.78;
  }
  .live-step-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .live-step-copy strong {
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
  }
  .live-step-copy span,
  .live-step-state {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-1);
  }
</style>
