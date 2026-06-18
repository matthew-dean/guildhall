<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import { friendlyTaskId } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentTaskHref } from '../../lib/project-routes.js'
  import { hasUnmetDependencies } from '../../lib/task-dependencies.js'
  import { taskStagePresentation, type TaskPresentationTone } from '../../lib/task-presentation.js'
  import { buildWorkHierarchy } from '../../lib/work-hierarchy.js'
  import { taskDisplayLabel, taskSourceQuestion } from '../../../shared/task-display-label.js'
  import type { ProjectDetail, Task } from '../../lib/types.js'

  interface Props {
    tasks: Task[]
    selectedTaskId?: string | null
    workProgress?: ProjectDetail['workProgress']
    onSelectTask?: (taskId: string) => void
    onRunTask?: (taskId: string) => void | Promise<void>
    runBusyTaskId?: string | null
    runActiveTaskId?: string | null
    runError?: string | null
  }

  type ChipTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'running'

  let {
    tasks,
    selectedTaskId = null,
    workProgress = undefined,
    onSelectTask,
    onRunTask,
    runBusyTaskId = null,
    runActiveTaskId = null,
    runError = null,
  }: Props = $props()

  const visibleTasks = $derived(tasks.filter(isVisibleLogicalTask))
  const hierarchy = $derived(buildWorkHierarchy(visibleTasks))
  const tasksById = $derived(new Map(visibleTasks.map(task => [task.id, task])))
  const selectedTask = $derived(selectedTaskId ? tasksById.get(selectedTaskId) ?? null : null)
  const containedWork = $derived(selectedTask ? childTasksFor(selectedTask) : [])

  function childTasksFor(task: Task): Task[] {
    return (hierarchy.byId.get(task.id)?.childIds ?? [])
      .map(id => tasksById.get(id))
      .filter(isTask)
      .sort((left, right) => (left.hierarchy?.order ?? 0) - (right.hierarchy?.order ?? 0))
  }

  function isTask(value: Task | undefined): value is Task {
    return Boolean(value)
  }

  function isVisibleLogicalTask(task: Task): boolean {
    const visibility = workProgress?.byTaskId?.[task.id]?.visibility ?? task.workVisibility
    return visibility?.kind !== 'internal_step' && visibility?.kind !== 'hidden'
  }

  function deliveryStepsFor(task: Task): NonNullable<ProjectDetail['workProgress']>['byTaskId'][string]['deliverySteps'] {
    return workProgress?.byTaskId?.[task.id]?.deliverySteps ?? []
  }

  function descendantsFor(task: Task): Task[] {
    const found: Task[] = []
    const visit = (current: Task) => {
      for (const child of childTasksFor(current)) {
        found.push(child)
        visit(child)
      }
    }
    visit(task)
    return found
  }

  function rollupFor(task: Task) {
    const progress = workProgress?.byTaskId?.[task.id]?.rollup
    if (progress) {
      return {
        total: Math.max(progress.visibleChildCount, progress.requiredStepCount, 1),
        done: progress.visibleChildDoneCount + progress.doneStepCount,
        blocked: progress.blockedStepCount,
        needsYou: 0,
        runnable: progress.primaryState === 'active' ? 1 : 0,
      }
    }
    const descendants = descendantsFor(task)
    const subject = descendants.length > 0 ? descendants : [task]
    return {
      total: subject.length,
      done: subject.filter(item => ['done', 'pending_pr'].includes(item.status ?? '')).length,
      blocked: subject.filter(item => item.status === 'blocked' || hasUnmetDependencies(item, tasks)).length,
      needsYou: subject.filter(hasOpenQuestion).length,
      runnable: subject.filter(isActionableTask).length,
    }
  }

  function hasOpenQuestion(task: Task): boolean {
    return Boolean(task.openQuestions?.some(question => !question.answeredAt && !question.answer))
  }

  function isActionableTask(task: Task): boolean {
    return isQueuedWorkTask(task) || task.status === 'blocked' || hasUnmetDependencies(task, tasks)
  }

  function isQueuedWorkTask(task: Task): boolean {
    if (hasUnmetDependencies(task, tasks)) return false
    return ['ready', 'review', 'gate_check', 'in_progress'].includes(task.status ?? '')
  }

  function primaryText(task: Task): string {
    const steps = deliveryStepsFor(task)
    if (steps.length > 0) {
      const required = steps.filter(step => step.required).length || steps.length
      const done = steps.filter(step => step.status === 'done').length
      const blocked = steps.filter(step => step.status === 'blocked').length
      return `${done} / ${required} delivery steps done${blocked ? ` · ${blocked} blocked` : ''}`
    }
    if (needsBreakdownReview(task)) {
      const count = task.acceptanceCriteria?.length ?? 0
      return `${count} requirements; no contained work or decomposition proposal yet.`
    }
    if (task.blockReason) return task.blockReason
    if (task.latestCheckpoint?.nextPlannedAction) return task.latestCheckpoint.nextPlannedAction
    if (task.acceptanceCriteria?.[0]?.description) return task.acceptanceCriteria[0].description
    if (taskSourceQuestion(task)) return taskSourceQuestion(task)!
    return task.description ?? friendlyTaskId(task.id)
  }

  function proofText(task: Task): string {
    const blockedStep = deliveryStepsFor(task).find(step => step.status === 'blocked')
    if (blockedStep) return blockedStep.title
    if (task.proofPaths?.[0]?.title) return task.proofPaths[0].title
    if (task.definitionOfDone?.evidenceRequired?.[0]) return task.definitionOfDone.evidenceRequired[0]
    return 'Proof path not attached yet'
  }

  function needsBreakdownReview(task: Task): boolean {
    return task.status === 'ready'
      && childTasksFor(task).length === 0
      && !hasDecompositionProposal(task)
      && (task.acceptanceCriteria?.length ?? 0) >= 6
  }

  function hasDecompositionProposal(task: Task): boolean {
    const decomposition = (task as Task & { decomposition?: unknown }).decomposition
    if (!decomposition) return false
    if (Array.isArray(decomposition)) return decomposition.length > 0
    if (typeof decomposition === 'object') return Object.keys(decomposition).length > 0
    return true
  }

  function taskStatusLabel(task: Task): string {
    if (hasUnmetDependencies(task, tasks)) return taskStagePresentation(task, { tasks }).label
    return needsBreakdownReview(task) ? 'Review breakdown' : taskStagePresentation(task, { tasks }).label
  }

  function taskStatusTone(task: Task): ChipTone {
    if (hasUnmetDependencies(task, tasks)) return chipTone(taskStagePresentation(task, { tasks }).tone)
    return needsBreakdownReview(task) ? 'warn' : chipTone(taskStagePresentation(task, { tasks }).tone)
  }

  function chipTone(tone: TaskPresentationTone): ChipTone {
    return tone
  }

  function openSelected(): void {
    if (selectedTask) nav(currentTaskHref(selectedTask.id), { backgroundPath: path.value })
  }

  async function runSelected(): Promise<void> {
    if (selectedTask) await onRunTask?.(selectedTask.id)
  }

  function runButtonLabel(task: Task, busy: boolean, active: boolean): string {
    if (active) return 'Running...'
    if (task.status === 'import_draft') return busy ? 'Drafting...' : 'Draft and run'
    return busy ? 'Starting...' : 'Start work'
  }

  function selectContained(task: Task): void {
    onSelectTask?.(task.id)
  }

  function stepStatusLabel(status: string): string {
    if (status === 'done') return 'Done'
    if (status === 'blocked') return 'Blocked'
    if (status === 'active') return 'Active'
    if (status === 'waived') return 'Waived'
    return 'Todo'
  }
</script>

<aside class="work-inspector" aria-label="Selected work inspector">
  <p class="panel-label">Inspector</p>
  {#if selectedTask}
    {@const rollup = rollupFor(selectedTask)}
    {@const deliverySteps = deliveryStepsFor(selectedTask)}
    <div class="inspector-head">
      <div>
        <p class="details-context">{containedWork.length ? 'Containing work' : 'Selected work'}</p>
        <h3>{taskDisplayLabel(selectedTask, friendlyTaskId(selectedTask.id))}</h3>
      </div>
      <Chip label={taskStatusLabel(selectedTask)} tone={taskStatusTone(selectedTask)} />
    </div>

    <dl>
      <dt>Scope</dt>
      <dd>{primaryText(selectedTask)}</dd>
      <dt>Proof</dt>
      <dd>{proofText(selectedTask)}</dd>
      <dt>Rollup</dt>
      <dd>{rollup.done} / {rollup.total} done · {rollup.blocked} blocked · {rollup.needsYou} needs you</dd>
    </dl>

    <section class="inspector-section" aria-label="Contained work">
      <div class="section-head">
        <strong>Contained work</strong>
        <span>{containedWork.length} item{containedWork.length === 1 ? '' : 's'}</span>
      </div>
      {#if containedWork.length > 0}
        <div class="contained-list">
          {#each containedWork as child (child.id)}
            <button type="button" class="contained-item" onclick={() => selectContained(child)}>
              <span>{taskDisplayLabel(child, friendlyTaskId(child.id))}</span>
              <Chip label={taskStatusLabel(child)} tone={taskStatusTone(child)} size="compact" />
            </button>
          {/each}
        </div>
      {:else if deliverySteps.length > 0}
        <p class="subtle">This item has tracked delivery steps and no contained work.</p>
      {:else if needsBreakdownReview(selectedTask)}
        <p class="subtle">No contained work or decomposition proposal exists yet. Review a breakdown before treating this as runnable work.</p>
      {:else}
        <p class="subtle">This item has no contained work yet.</p>
      {/if}
    </section>

    {#if deliverySteps.length > 0}
      <section class="inspector-section" aria-label="Delivery checklist">
        <div class="section-head">
          <strong>Delivery checklist</strong>
          <span>{deliverySteps.filter(step => step.status === 'done').length} / {deliverySteps.filter(step => step.required).length || deliverySteps.length} done</span>
        </div>
        <ul class="delivery-step-list">
          {#each deliverySteps as step (step.id)}
            <li>
              <span>{step.title}</span>
              <Chip label={stepStatusLabel(step.status)} tone={step.status === 'blocked' ? 'warn' : step.status === 'done' ? 'ok' : step.status === 'active' ? 'running' : 'neutral'} size="compact" />
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <div class="inspector-actions">
      {#if onRunTask}
        {@const runBusy = runBusyTaskId === selectedTask.id}
        {@const runActive = runActiveTaskId === selectedTask.id}
        <Button variant="agent" size="sm" disabled={runBusy || runActive} onclick={runSelected}>
          {runButtonLabel(selectedTask, runBusy, runActive)}
        </Button>
      {/if}
      <Button variant="primary" size="sm" onclick={openSelected}>Open drawer</Button>
    </div>
    {#if runError}
      <p class="run-error" role="alert">{runError}</p>
    {/if}
  {:else}
    <p class="subtle">Select work to inspect its scope, proof path, contained work, and delivery checklist.</p>
  {/if}
</aside>

<style>
  .work-inspector {
    position: sticky;
    top: var(--s-3);
    align-self: start;
    display: grid;
    gap: var(--s-3);
    min-width: 0;
    max-height: calc(100vh - 8rem);
    overflow: auto;
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised);
  }
  .panel-label {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .inspector-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: start;
  }
  .details-context {
    margin: 0 0 var(--s-1);
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  h3 {
    margin: 0;
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    gap: var(--s-2);
    margin: 0;
  }
  dt {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  dd {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  .inspector-section {
    display: grid;
    gap: var(--s-2);
    padding-top: var(--s-3);
    border-top: 1px solid var(--border);
  }
  .inspector-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .run-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .section-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: center;
  }
  .section-head strong {
    min-width: 0;
  }
  .section-head span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .contained-list,
  .delivery-step-list {
    display: grid;
    gap: var(--s-1);
  }
  .contained-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: center;
    width: 100%;
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .contained-item:hover,
  .contained-item:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    outline: none;
  }
  .contained-item span,
  .delivery-step-list span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .delivery-step-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .delivery-step-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: center;
  }
  .subtle {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  @media (max-width: 980px) {
    .work-inspector {
      position: static;
      max-height: none;
    }
  }
</style>
