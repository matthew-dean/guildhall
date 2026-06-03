<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import { friendlyStatus } from '../../lib/display.js'
  import { friendlyTaskId } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentTaskHref } from '../../lib/project-routes.js'
  import { buildWorkHierarchy } from '../../lib/work-hierarchy.js'
  import type { Task } from '../../lib/types.js'

  interface Props {
    tasks: Task[]
    filter?: Filter
  }

  type Filter = 'open' | 'all' | 'runnable' | 'blocked' | 'needs-you'
  type PacketSelection = { kind: 'task'; taskId: string }

  interface ColumnItem {
    kind: 'task'
    id: string
    parentId: string | null
    title: string
    detail: string
    status?: string
    statusLabel: string
    statusTone: ReturnType<typeof statusTone>
    childCount: number
    rollup: ReturnType<typeof rollupFor>
  }

  interface WorkColumn {
    id: string
    title: string
    subtitle: string
    depth: number
    items: ColumnItem[]
    emptyText?: string
  }

  let { tasks, filter = 'open' }: Props = $props()

  const hierarchy = $derived(buildWorkHierarchy(tasks))
  const tasksById = $derived(new Map(tasks.map(task => [task.id, task])))
  const roots = $derived(tasks.filter(task => !hierarchy.byId.get(task.id)?.parentId))

  let selectedPath = $state<string[]>([])
  const selectedTask = $derived.by(() => {
    const taskId = selectedPath[selectedPath.length - 1]
    return taskId ? tasksById.get(taskId) ?? null : null
  })

  const packetSelection = $derived<PacketSelection | null>(
    selectedTask ? { kind: 'task', taskId: selectedTask.id } : null,
  )

  const columns = $derived.by(() => {
    const result: WorkColumn[] = []
    if (selectedPath.length === 0) {
      result.push(siblingColumn(null, 0))
      result.push({
        id: 'empty:children',
        title: 'Children',
        subtitle: 'Select an item',
        depth: 1,
        items: [],
        emptyText: 'Select a work item to show its children here.',
      })
      return result
    }

    const contextParentId = selectedPath.length === 1 ? null : selectedPath[selectedPath.length - 2]
    const contextDepth = selectedPath.length === 1 ? 0 : selectedPath.length - 1
    result.push(siblingColumn(contextParentId, contextDepth))

    if (selectedTask) {
      const childColumn = childColumnFor(selectedTask, selectedPath.length)
      result.push(childColumn ?? {
        id: `empty:${selectedTask.id}`,
        title: 'Child work',
        subtitle: 'No child work',
        depth: selectedPath.length,
        items: [],
        emptyText: needsBreakdownReview(selectedTask)
          ? 'No child tasks or decomposition proposal exists yet. Review a breakdown before treating this as runnable work.'
          : 'This item has no child tasks yet.',
      })
    }
    return result
  })

  function childTasksFor(task: Task): Task[] {
    return (hierarchy.byId.get(task.id)?.childIds ?? [])
      .map(id => tasksById.get(id))
      .filter(isTask)
      .sort((left, right) => (left.hierarchy?.order ?? 0) - (right.hierarchy?.order ?? 0))
  }

  function siblingColumn(parentId: string | null, depth: number): WorkColumn {
    if (!parentId) {
      const items = roots.filter(matchesFilterOrDescendant)
      return {
        id: 'root',
        title: 'Work',
        subtitle: `${items.length} top-level ${items.length === 1 ? 'item' : 'items'}`,
        depth,
        items: items.map(taskColumnItem),
      }
    }
    const parent = tasksById.get(parentId)
    const siblings = parent ? childTasksFor(parent).filter(matchesFilterOrDescendant) : []
    return {
      id: `siblings:${parentId}`,
      title: parent?.title ?? friendlyTaskId(parentId),
      subtitle: `${siblings.length} sibling ${siblings.length === 1 ? 'item' : 'items'}`,
      depth,
      items: siblings.map(taskColumnItem),
    }
  }

  function childColumnFor(parent: Task, depth: number): WorkColumn | null {
    const children = childTasksFor(parent).filter(matchesFilterOrDescendant)
    if (children.length > 0) {
      return {
        id: `children:${parent.id}`,
        title: 'Child work',
        subtitle: `${children.length} child ${children.length === 1 ? 'item' : 'items'}`,
        depth,
        items: children.map(taskColumnItem),
      }
    }
    return null
  }

  function isTask(value: Task | undefined): value is Task {
    return Boolean(value)
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
    const descendants = descendantsFor(task)
    const subject = descendants.length > 0 ? descendants : [task]
    return {
      total: subject.length,
      done: subject.filter(item => ['done', 'pending_pr'].includes(item.status ?? '')).length,
      blocked: subject.filter(item => item.status === 'blocked').length,
      needsYou: subject.filter(hasOpenQuestion).length,
      runnable: subject.filter(isActionableTask).length,
    }
  }

  function hasOpenQuestion(task: Task): boolean {
    return Boolean(task.openQuestions?.some(question => !question.answeredAt && !question.answer))
  }

  function isActionableTask(task: Task): boolean {
    return ['ready', 'blocked', 'spec_review', 'review', 'gate_check', 'in_progress'].includes(task.status ?? '')
  }

  function matchesFilter(task: Task): boolean {
    if (filter === 'all') return true
    if (filter === 'open') return !['done', 'pending_pr', 'shelved'].includes(task.status ?? '')
    if (filter === 'blocked') return task.status === 'blocked'
    if (filter === 'needs-you') return hasOpenQuestion(task)
    return ['ready', 'spec_review', 'review', 'gate_check'].includes(task.status ?? '')
  }

  function matchesFilterOrDescendant(task: Task): boolean {
    return matchesFilter(task) || descendantsFor(task).some(matchesFilter)
  }

  function taskColumnItem(task: Task): ColumnItem {
    const childCount = childTasksFor(task).length
    return {
      kind: 'task',
      id: task.id,
      parentId: hierarchy.byId.get(task.id)?.parentId ?? null,
      title: task.title ?? friendlyTaskId(task.id),
      detail: childCount > 0 ? progressText(task) : primaryText(task),
      status: task.status,
      statusLabel: taskStatusLabel(task),
      statusTone: taskStatusTone(task),
      childCount,
      rollup: rollupFor(task),
    }
  }

  function primaryText(task: Task): string {
    if (needsBreakdownReview(task)) {
      const count = task.acceptanceCriteria?.length ?? 0
      return `${count} requirements; no child tasks or decomposition proposal yet.`
    }
    if (task.blockReason) return task.blockReason
    if (task.latestCheckpoint?.nextPlannedAction) return task.latestCheckpoint.nextPlannedAction
    if (task.acceptanceCriteria?.[0]?.description) return task.acceptanceCriteria[0].description
    return task.description ?? friendlyTaskId(task.id)
  }

  function proofText(task: Task): string {
    if (task.proofPaths?.[0]?.title) return task.proofPaths[0].title
    if (task.definitionOfDone?.evidenceRequired?.[0]) return task.definitionOfDone.evidenceRequired[0]
    return 'Proof path not attached yet'
  }

  function progressText(task: Task): string {
    const rollup = rollupFor(task)
    return `${rollup.done} / ${rollup.total} done${rollup.blocked ? ` · ${rollup.blocked} blocked` : ''}${rollup.needsYou ? ` · ${rollup.needsYou} needs you` : ''}`
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
    return needsBreakdownReview(task) ? 'Review breakdown' : friendlyStatus(task.status)
  }

  function taskStatusTone(task: Task): ReturnType<typeof statusTone> {
    return needsBreakdownReview(task) ? 'warn' : statusTone(task.status)
  }

  function statusTone(status: string | undefined): 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' {
    switch (status) {
      case 'done':
      case 'pending_pr':
        return 'ok'
      case 'blocked':
        return 'danger'
      case 'ready':
      case 'review':
      case 'gate_check':
        return 'ok'
      case 'spec_review':
        return 'warn'
      case 'in_progress':
        return 'accent'
      default:
        return 'neutral'
    }
  }

  function selectItem(item: ColumnItem, depth: number): void {
    selectedPath = [...selectedPath.slice(0, depth), item.id]
  }

  function itemSelected(item: ColumnItem, depth: number): boolean {
    return selectedPath[depth] === item.id
  }

  function openSelected(): void {
    if (packetSelection?.kind !== 'task') return
    const task = tasksById.get(packetSelection.taskId)
    if (task) nav(currentTaskHref(task.id), { backgroundPath: path.value })
  }

</script>

<section class="tree-workbench" aria-label="Deliverable tree workbench">
  <div class="browser-layout">
    <div class="column-browser" aria-label="Work hierarchy columns">
      {#each columns as column (column.id)}
        <section class="work-column" aria-label={column.title}>
          <div class="column-head">
            <strong>{column.title}</strong>
            <span>{column.subtitle}</span>
          </div>
          <div class="column-items">
            {#if column.items.length === 0}
              <p class="empty-column">{column.emptyText ?? 'No items in this view.'}</p>
            {:else}
              {#each column.items as item (item.id)}
                <button
                  type="button"
                  class="column-item"
                  class:selected={itemSelected(item, column.depth)}
                  onclick={() => selectItem(item, column.depth)}
                >
                  <span class="item-copy">
                    <strong title={item.title}>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <span class="item-meta">
                    {#if item.status}
                      <Chip label={item.statusLabel} tone={item.statusTone} />
                    {/if}
                    {#if item.childCount > 0}
                      <Icon name="chevron-right" size={15} />
                    {/if}
                  </span>
                </button>
              {/each}
            {/if}
          </div>
        </section>
      {/each}
    </div>

    <aside class="node-packet" aria-label="Selected deliverable packet">
      <p class="panel-label">Details</p>
      {#if packetSelection?.kind === 'task' && selectedTask}
        {@const rollup = rollupFor(selectedTask)}
        <p class="details-context">{childTasksFor(selectedTask).length ? 'Containing work' : 'Selected item'}</p>
        <Chip label={taskStatusLabel(selectedTask)} tone={taskStatusTone(selectedTask)} />
        <dl>
          <dt>Scope</dt>
          <dd>{primaryText(selectedTask)}</dd>
          <dt>Proof</dt>
          <dd>{proofText(selectedTask)}</dd>
          <dt>Rollup</dt>
          <dd>{rollup.done} / {rollup.total} done · {rollup.blocked} blocked · {rollup.needsYou} needs you</dd>
        </dl>
        <Button variant="primary" size="sm" onclick={openSelected}>Open drawer</Button>
      {:else}
        <p class="subtle">Select work to inspect its scope, proof path, and rollup.</p>
      {/if}
    </aside>
  </div>
</section>

<style>
  .tree-workbench {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised);
  }
  .browser-layout {
    display: flex;
    gap: var(--s-3);
  }
  .panel-label {
    margin: 0 0 var(--s-1);
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .browser-layout {
    min-width: 0;
    align-items: stretch;
  }
  .column-browser {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(260px, 1fr);
    gap: var(--s-3);
    min-width: 0;
    flex: 1 1 auto;
    overflow-x: auto;
    padding-bottom: var(--s-2);
  }
  .work-column,
  .node-packet {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .work-column {
    display: flex;
    flex-direction: column;
    max-height: 520px;
    overflow: hidden;
  }
  .column-head {
    display: grid;
    gap: 2px;
    padding: var(--s-3);
    border-bottom: 1px solid var(--border);
  }
  .column-head strong {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text);
    line-height: var(--gh-type-line-height-tight);
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .column-head span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .column-items {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-2);
    overflow: auto;
  }
  .column-item {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: stretch;
    width: 100%;
    padding: var(--s-2);
    border: 1px solid transparent;
    border-radius: var(--r-2);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .column-item:hover,
  .column-item.selected {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .item-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .item-copy strong {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text);
    line-height: var(--gh-type-line-height-tight);
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .item-copy small {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .item-meta {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    min-height: 24px;
    gap: var(--s-1);
    color: var(--text-muted);
  }
  .empty-column {
    margin: 0;
    padding: var(--s-3);
    border: 1px dashed var(--border);
    border-radius: var(--r-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .node-packet {
    flex: 0 0 270px;
    padding: var(--s-3);
  }
  .details-context {
    margin: 0 0 var(--s-2);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }
  .node-packet dl {
    display: grid;
    gap: var(--s-2);
    margin: var(--s-3) 0;
  }
  .node-packet dt {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .node-packet dd {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  @media (max-width: 980px) {
    .browser-layout {
      display: flex;
      flex-direction: column;
    }
    .node-packet {
      flex-basis: auto;
    }
  }
</style>
