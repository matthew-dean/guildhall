<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Button from '../../lib/Button.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import StateSummary from '../../lib/StateSummary.svelte'
  import StatusLine from '../../lib/StatusLine.svelte'
  import StatusLight from '../../lib/StatusLight.svelte'
  import AgentQuestion from '../../lib/AgentQuestion.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import {
    isImportedDraftShaping,
    isQueuedSpecRevision,
    needsRecovery,
  } from '../../lib/task-state.js'
  import type {
    AgentQuestion as Question,
    Task,
    TaskThreadTurn,
    TaskThreadInFlightTurn,
    TaskThreadQuestionTurn,
  } from '../../lib/types.js'

  interface Props {
    task: Task
    turns?: TaskThreadTurn[]
    busy?: boolean
    runBusy?: boolean
    runError?: string | null
    onApproveBrief: () => void
    onApproveSpec: () => void
    onRunTask: () => void
    onShapeDraft: () => void
    onOpenSpecTab: () => void
    onAnswerQuestion: (questionId: string, answer: string) => Promise<void>
  }

  let {
    task,
    turns = [],
    busy = false,
    runBusy = false,
    runError = null,
    onApproveBrief,
    onApproveSpec,
    onRunTask,
    onShapeDraft,
    onOpenSpecTab,
    onAnswerQuestion,
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
    if (turn.liveAgent?.name === 'spec-agent') return turn.importedDraft ? 'Shaping draft' : 'Drafting'
    if (turn.liveAgent?.name?.startsWith('coordinator-')) return 'Ready'
    if (turn.liveAgent?.name === 'worker-agent') return 'In flight'
    if (turn.liveAgent?.name === 'reviewer-agent') return 'Review'
    if (turn.liveAgent?.name === 'gate-checker-agent') return 'Gates'
    switch (turn.taskStatus) {
      case 'import_draft': return 'Needs task brief'
      case 'exploring': return isImportedDraftShaping(turn) ? 'Guildhall shaping' : isQueuedSpecRevision(turn) ? 'Spec revision queued' : 'Intake'
      case 'ready': return 'Ready'
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
      return 'Approved and queued. Start Guildhall when you want it to pick this up.'
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
        : 'Guildhall has a partial draft here. Review it, then let Guildhall keep shaping it when you are ready.'
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

  function taskStateTone(turn: TaskThreadInFlightTurn): 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running' {
    if (needsRecovery(turn)) return 'warn'
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

  function canRunTask(turn: TaskThreadInFlightTurn): boolean {
    return !turn.liveAgent && (
      turn.taskStatus === 'ready' ||
      turn.taskStatus === 'import_draft' ||
      turn.taskStatus === 'exploring' ||
      turn.taskStatus === 'in_progress' ||
      turn.taskStatus === 'review' ||
      turn.taskStatus === 'gate_check'
    )
  }

  function runLabel(turn: TaskThreadInFlightTurn): string {
    switch (turn.taskStatus) {
      case 'ready': return 'Start work'
      case 'import_draft': return 'Draft task brief'
      case 'exploring': return turn.importedDraft ? 'Continue task brief' : isQueuedSpecRevision(turn) ? 'Revise spec' : 'Continue drafting spec'
      case 'review': return 'Resume review'
      case 'gate_check': return 'Resume gates'
      case 'in_progress': return 'Resume work'
      default: return 'Run this task'
    }
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
    if (step.status === 'active') return turn.liveAgent ? 'Now' : 'Paused'
    if (step.status === 'skipped') return 'Skipped'
    return 'Pending'
  }

  async function answer(turn: TaskThreadQuestionTurn, answer: string): Promise<void> {
    await onAnswerQuestion(turn.question.id, answer)
  }
</script>

<Stack gap="4">
  {#if relevantTurns.length === 0}
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
          <AgentQuestion
            question={turn.question as Question}
            {busy}
            onAnswer={(answerText) => answer(turn, answerText)}
          />
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
        <Card title="Needs your help" tone="warn">
          <Stack gap="3">
            <StateSummary
              label="Escalated"
              description={turn.summary}
              tone="warn"
            />
            {#if turn.details}
              <p class="detail-copy">{turn.details}</p>
            {/if}
            {#if turn.activity?.length}
              <div class="live-activity" aria-label="Recent agent activity">
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
            {/if}
          </Stack>
        </Card>
      {:else if turn.kind === 'inflight'}
        <Card title="Current state" tone={turn.importedDraft ? 'accent' : 'default'}>
          <Stack gap="3">
            <StateSummary
              label={taskStateLabel(turn)}
              description={taskStateDescription(turn)}
              tone={taskStateTone(turn)}
            />
            {#if turn.activity?.length}
              <div class="live-activity" aria-label="Recent agent activity">
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
            {/if}
            {#if turn.checklist && (!turn.importedDraft || Boolean(turn.liveAgent)) && !isQueuedSpecRevision(turn)}
              <div class="live-checklist">
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
              </div>
            {/if}
            {#if canRunTask(turn)}
              <Row justify="end" gap="2">
                {#if turn.importedDraft && !turn.liveAgent}
                  <Button variant="human" onclick={onOpenSpecTab}>
                    Review draft...
                  </Button>
                  <Button
                    variant="agent"
                    disabled={runBusy}
                    onclick={turn.taskStatus === 'import_draft' ? onShapeDraft : onRunTask}
                  >
                    <Icon name="sparkles" size={14} />
                    {runLabel(turn)}
                  </Button>
                {:else if isQueuedSpecRevision(turn)}
                  <Button
                    variant="agent"
                    disabled={runBusy}
                    onclick={onRunTask}
                  >
                    <Icon name="sparkles" size={14} />
                    Revise spec
                  </Button>
                {:else}
                  <Button
                    variant="primary"
                    disabled={runBusy}
                    onclick={turn.taskStatus === 'import_draft' ? onShapeDraft : onRunTask}
                  >{runLabel(turn)}</Button>
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
