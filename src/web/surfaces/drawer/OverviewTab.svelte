<script lang="ts">
  import Card from '../../lib/ui-compat/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Button from '../../lib/Button.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Row from '../../lib/Row.svelte'
  import Stack from '../../lib/Stack.svelte'
  import { friendlyDomain, friendlyPriority, friendlyStatus } from '../../lib/display.js'
  import { labelForIdentifier } from '../../lib/identifier-labels.js'
  import { currentTaskHref } from '../../lib/project-routes.js'
  import { roleLabel } from '../../lib/escalation-labels.js'
  import { readableTaskDescription } from '../../lib/task-display.js'
  import { projectDerivedRecommendedChildren } from '../../lib/task-drawer-integrity.js'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
    projectId?: string | null
    onNavigateTask?: (taskId: string) => void
    onCreateSplitChildren?: () => void
    createSplitBusy?: boolean
  }

  let {
    task,
    projectId = null,
    onNavigateTask,
    onCreateSplitChildren,
    createSplitBusy = false,
  }: Props = $props()

  const sizePlan = $derived(task.sizePlan ?? null)
  const reviewPlan = $derived(task.reviewPlan ?? null)
  const requestIntake = $derived(task.requestIntake ?? null)
  const latestCheckpoint = $derived(task.latestCheckpoint ?? null)
  const recommendedChildren = $derived(projectDerivedRecommendedChildren(task))
  const taskDescription = $derived(readableTaskDescription(task.description, task.title) || '(no description)')
  const createdChildren = $derived(recommendedChildren.filter((child) => child.createdTaskId))
  const containingWorkId = $derived(task.hierarchy?.parentId ?? null)
  const nestedWorkIds = $derived(task.hierarchy?.childIds ?? [])
  const goalEnvelopeId = $derived(task.businessEnvelope?.goalId ?? null)
  const needsSplitAction = $derived(
    sizePlan?.action === 'split_required' &&
    recommendedChildren.length > 0 &&
    createdChildren.length === 0,
  )
  const canCreateSplitChildren = $derived(
    needsSplitAction &&
    Boolean(onCreateSplitChildren),
  )
  const splitNeeded = $derived(
    sizePlan?.action === 'split_required' || sizePlan?.action === 'split_recommended',
  )
  const reviewLaneCount = $derived(reviewPlan?.selectedLanes?.length ?? 0)
  const reviewerGroupCount = $derived(reviewPlan?.requiredRecipes?.length ?? 0)
  const dependsOn = $derived(task.dependsOn ?? [])

  type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'

  function token(value: string | undefined): string {
    if (!value) return 'Unknown'
    return value
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace(/\bUx\b/g, 'UX')
      .replace(/\bApi\b/g, 'API')
  }

  function sizeTone(action: string | undefined): ChipTone {
    if (action === 'split_required') return 'danger'
    if (action === 'split_recommended' || action === 'ask_clarifying_question') return 'warn'
    if (action === 'proceed_with_warning') return 'warn'
    return 'neutral'
  }

  function statusTone(status: string | undefined): ChipTone {
    const tone = labelForIdentifier('status', status).tone
    return tone === 'accent' ? 'ok' : tone
  }

  function priorityTone(priority: string | undefined): ChipTone {
    const tone = labelForIdentifier('priority', priority).tone
    return tone === 'accent' ? 'agent' : tone
  }

  function goalLabel(goalId: string): string {
    return goalId.replace(/^goal-/, '').replace(/^task-/, '').replace(/[-_]+/g, ' ')
  }

  function navigateTask(event: MouseEvent, nextTaskId: string | undefined): void {
    if (!nextTaskId || !onNavigateTask) return
    event.preventDefault()
    onNavigateTask(nextTaskId)
  }

  function childReason(child: { reason?: string; suggestedDomain?: string }): string {
    const parts = [
      child.suggestedDomain ? token(child.suggestedDomain) : null,
      child.reason,
    ].filter((part): part is string => Boolean(part))
    return parts.join(' · ')
  }
</script>

<Stack gap="4">
  <Card title="Overview">
    <Stack gap="3">
      <Markdown source={taskDescription} />
      <Row wrap gap="2">
        <Chip label={friendlyStatus(task.status)} tone={statusTone(task.status)} />
        {#if task.domain}<Chip label={friendlyDomain(task.domain)} tone="neutral" />{/if}
        {#if task.priority}<Chip label={`Priority: ${friendlyPriority(task.priority)}`} tone={priorityTone(task.priority)} />{/if}
        {#if task.assignedTo}<Chip label={`Assigned: ${roleLabel(task.assignedTo)}`} tone="neutral" />{/if}
        {#if task.revisionCount}<Chip label={`Revisions: ${task.revisionCount}`} tone="neutral" />{/if}
      </Row>
    </Stack>
  </Card>

  <Card title="Work hierarchy" tone={splitNeeded ? 'warn' : 'default'}>
    <Stack gap="3">
      {#if containingWorkId}
        <div class="hierarchy-row">
          <span>{containingWorkId === task.id ? 'Hierarchy role' : 'Containing work'}</span>
          {#if containingWorkId !== task.id}
            <a href={currentTaskHref(containingWorkId, projectId)} onclick={(event) => navigateTask(event, containingWorkId)}>
              {containingWorkId}
            </a>
          {:else}
            <strong>Containing work</strong>
          {/if}
        </div>
      {:else if nestedWorkIds.length > 0}
        <div class="hierarchy-row">
          <span>Hierarchy role</span>
          <strong>Containing work</strong>
        </div>
      {:else}
        <p class="muted">No containing work recorded.</p>
      {/if}

      {#if goalEnvelopeId}
        <div class="hierarchy-row">
          <span>Goal envelope</span>
          <strong>{goalLabel(goalEnvelopeId)}</strong>
        </div>
      {/if}

      {#if dependsOn.length > 0}
        <div>
          <h4>Depends on</h4>
          <ul class="link-list">
            {#each dependsOn as dependency (dependency)}
              <li>
                <a href={currentTaskHref(dependency, projectId)} onclick={(event) => navigateTask(event, dependency)}>
                  {dependency}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if splitNeeded}
        <div class="split-callout">
          <strong>
            {#if needsSplitAction}
              Split this task
            {:else}
              {sizePlan?.action === 'split_required' ? 'Split required' : 'Split recommended'}
            {/if}
          </strong>
          <span>
            {#if createdChildren.length > 0}
              Work happens in the nested work below.
            {:else if needsSplitAction}
              Split it now: this stays as containing work and the nested work below is created.
            {:else}
              This is too large for one clean worker/review pass. Split it into containing work with nested work below before work starts.
            {/if}
          </span>
          {#if canCreateSplitChildren}
            <div class="split-actions">
              <Button variant="agent" size="sm" disabled={createSplitBusy} onclick={onCreateSplitChildren}>
                <Icon name="sparkles" size={14} />
                {createSplitBusy ? 'Splitting...' : 'Split this task'}
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      {#if nestedWorkIds.length > 0 && createdChildren.length === 0}
        <div>
          <h4>Nested work</h4>
          <ul class="link-list">
            {#each nestedWorkIds as childId (childId)}
              <li>
                <a href={currentTaskHref(childId, projectId)} onclick={(event) => navigateTask(event, childId)}>
                  {childId}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if recommendedChildren.length > 0}
        <div>
          <h4>{createdChildren.length > 0 ? 'Nested work' : needsSplitAction ? 'Work to create' : 'Recommended nested work'}</h4>
          <ul class="child-list">
            {#each recommendedChildren as child, index (`${child.title ?? 'child'}-${index}`)}
              <li>
                {#if child.createdTaskId}
                  <a href={currentTaskHref(child.createdTaskId, projectId)} onclick={(event) => navigateTask(event, child.createdTaskId)}>
                    {child.title ?? child.createdTaskId}
                  </a>
                {:else}
                  <strong>{child.title ?? `Child task ${index + 1}`}</strong>
                {/if}
                {#if childReason(child)}
                  <span>{childReason(child)}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </Stack>
  </Card>

  {#if sizePlan}
    <Card title="Task size">
      <Stack gap="3">
        <Row wrap gap="2">
          <Chip label={token(sizePlan.band)} tone={sizeTone(sizePlan.action)} />
          <Chip label={token(sizePlan.action)} tone={sizeTone(sizePlan.action)} />
          {#if sizePlan.score}<Chip label={`Score ${sizePlan.score}`} tone="neutral" />{/if}
          {#if sizePlan.reviewBudgetHint}<Chip label={`${token(sizePlan.reviewBudgetHint)} review`} tone="ok" />{/if}
        </Row>
        {#if sizePlan.reasons?.length}
          <p class="muted">{sizePlan.reasons[0]}</p>
        {/if}
        {#if sizePlan.factors?.length}
          <ul class="factor-list">
            {#each sizePlan.factors as factor (`${factor.id ?? factor.label}`)}
              <li>{factor.label ?? factor.reason}</li>
            {/each}
          </ul>
        {/if}
      </Stack>
    </Card>
  {/if}

  {#if requestIntake}
    <Card title="Request shape">
      <Stack gap="3">
        <Row wrap gap="2">
          {#if requestIntake.intent}<Chip label={token(requestIntake.intent)} tone="neutral" />{/if}
          {#if requestIntake.recommendedNextAction}<Chip label={token(requestIntake.recommendedNextAction)} tone="ok" />{/if}
        </Row>
        {#if requestIntake.ambiguity}
          <p class="muted">{requestIntake.ambiguity}</p>
        {/if}
        {#if requestIntake.componentStack?.length}
          <ul class="child-list">
            {#each requestIntake.componentStack as component, index (`${component.kind ?? 'component'}-${index}`)}
              <li>
                <strong>{component.title ?? token(component.kind)}</strong>
                {#if component.role}<span>{component.role}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </Stack>
    </Card>
  {/if}

  {#if latestCheckpoint}
    <Card title="Latest checkpoint">
      <Stack gap="2">
        {#if latestCheckpoint.intent}
          <p class="muted">{latestCheckpoint.intent}</p>
        {/if}
        {#if latestCheckpoint.nextPlannedAction}
          <p>{latestCheckpoint.nextPlannedAction}</p>
        {/if}
        <Row wrap gap="2">
          {#if latestCheckpoint.agentId}<Chip label={roleLabel(latestCheckpoint.agentId)} tone="neutral" />{/if}
          {#if latestCheckpoint.step}<Chip label={`Step ${latestCheckpoint.step}`} tone="neutral" />{/if}
          {#if latestCheckpoint.filesTouched?.length}
            <Chip label={`${latestCheckpoint.filesTouched.length} file${latestCheckpoint.filesTouched.length === 1 ? '' : 's'}`} tone="neutral" />
          {/if}
        </Row>
      </Stack>
    </Card>
  {/if}

  {#if reviewPlan}
    <Card title="Review plan">
      <Stack gap="3">
        <Row wrap gap="2">
          {#if reviewPlan.effort}<Chip label={`${token(reviewPlan.effort)} review`} tone="ok" />{/if}
          {#if reviewPlan.depth}<Chip label={`${token(reviewPlan.depth)} depth`} tone="neutral" />{/if}
          <Chip label={`${reviewerGroupCount} reviewer group${reviewerGroupCount === 1 ? '' : 's'}`} tone="neutral" />
          <Chip label={`${reviewLaneCount} lane${reviewLaneCount === 1 ? '' : 's'}`} tone="neutral" />
        </Row>
        {#if reviewPlan.selectedLanes?.length}
          <div class="lane-list" aria-label="Selected review lanes">
            {#each reviewPlan.selectedLanes.slice(0, 6) as lane (lane)}
              <Chip label={token(lane)} tone="neutral" />
            {/each}
            {#if reviewPlan.selectedLanes.length > 6}
              <Chip label={`+${reviewPlan.selectedLanes.length - 6} more`} tone="neutral" />
            {/if}
          </div>
        {/if}
        {#if reviewPlan.requiredArtifacts?.length}
          <p class="muted">Evidence needed: {reviewPlan.requiredArtifacts.join(', ')}</p>
        {/if}
      </Stack>
    </Card>
  {/if}
</Stack>

<style>
  .muted,
  .hierarchy-row span,
  .child-list span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .hierarchy-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
  }
  h4 {
    margin: 0 0 var(--s-2);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .split-callout {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-3);
    border: 1px solid color-mix(in srgb, var(--warn) 38%, transparent);
    border-radius: var(--r-2);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .split-callout span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .split-actions {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    margin-top: var(--s-1);
  }
  .link-list,
  .child-list,
  .factor-list {
    margin: 0;
    padding-left: var(--s-4);
  }
  .child-list {
    display: grid;
    gap: var(--s-2);
  }
  .child-list li {
    padding-left: var(--s-1);
  }
  .child-list strong {
    display: block;
  }
  .factor-list {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .lane-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  a {
    color: var(--accent-text);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  @media (max-width: 720px) {
    .hierarchy-row {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
