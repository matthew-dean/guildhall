<script lang="ts">
  import Card from '../../lib/ui-compat/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Button from '../../lib/Button.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Row from '../../lib/Row.svelte'
  import Stack from '../../lib/Stack.svelte'
  import { friendlyDomain, friendlyPriority } from '../../lib/display.js'
  import { humanizeRuntimeText, labelForIdentifier, taskDisplayKey, taskTitleMap } from '../../lib/identifier-labels.js'
  import { currentTaskHref } from '../../lib/project-routes.js'
  import { roleLabel } from '../../lib/escalation-labels.js'
  import { readableTaskDescription } from '../../lib/task-display.js'
  import { projectDerivedRecommendedChildren } from '../../lib/task-drawer-integrity.js'
  import { taskStagePresentation } from '../../lib/task-presentation.js'
  import { deliveryProgressBadge, type TaskWorkProgressDisplay } from '../../lib/work-progress-display.js'
  import type { DeliverySpine, PrimitiveSummary, Task } from '../../lib/types.js'

  interface Props {
    task: Task
    tasks?: Task[]
    projectId?: string | null
    deliverySpine?: DeliverySpine | null
    workProgress?: TaskWorkProgressDisplay | null
    onNavigateTask?: (taskId: string) => void
    onCreateSplitChildren?: () => void
    createSplitBusy?: boolean
  }

  let {
    task,
    tasks = [],
    projectId = null,
    deliverySpine = null,
    workProgress = null,
    onNavigateTask,
    onCreateSplitChildren,
    createSplitBusy = false,
  }: Props = $props()

  const sizePlan = $derived(task.sizePlan ?? null)
  const reviewPlan = $derived(task.reviewPlan ?? null)
  const requestIntake = $derived(task.requestIntake ?? null)
  const latestCheckpoint = $derived(task.latestCheckpoint ?? null)
  const plannedChildren = $derived(projectDerivedRecommendedChildren(task))
  const taskDescription = $derived(
    humanizeRuntimeText(
      readableTaskDescription(task.description, task.title) || '(no description)',
      taskTitleMap([task, ...tasks]),
      projectId,
    ),
  )
  const createdChildren = $derived(plannedChildren.filter((child) => child.createdTaskId))
  const taskById = $derived(new Map([task, ...tasks].filter((candidate): candidate is Task => Boolean(candidate?.id)).map(candidate => [candidate.id, candidate])))
  const statusPresentation = $derived(taskStagePresentation(task, { tasks: [task, ...tasks] }))
  const deliveryBadge = $derived(deliveryProgressBadge(workProgress))
  const deliverySteps = $derived(workProgress?.deliverySteps ?? [])
  const containingWorkId = $derived(task.hierarchy?.parentId ?? null)
  const nestedWorkIds = $derived(task.hierarchy?.childIds ?? [])
  const goalEnvelopeId = $derived(task.businessEnvelope?.goalId ?? null)
  const needsSplitAction = $derived(
    isDecompositionAction(sizePlan?.action) &&
    plannedChildren.length > 0 &&
    createdChildren.length === 0,
  )
  const canCreateSplitChildren = $derived(
    needsSplitAction &&
    Boolean(onCreateSplitChildren),
  )
  const splitNeeded = $derived(
    isDecompositionAction(sizePlan?.action),
  )
  const splitStillNeedsAction = $derived(
    splitNeeded && createdChildren.length === 0,
  )
  const reviewLaneCount = $derived(reviewPlan?.selectedLanes?.length ?? 0)
  const reviewerGroupCount = $derived(reviewPlan?.requiredRecipes?.length ?? 0)
  const blockingTaskIds = $derived(task.dependsOn ?? [])
  const contextPacket = $derived(deliverySpine?.contextPacket ?? null)
  const shapingBlockers = $derived(contextPacket?.executionOrder?.shapingBlockers ?? [])
  const relationships = $derived(deliverySpine?.relationships ?? null)
  const usedPrimitives = $derived(
    contextPacket?.primitiveContext?.direct ??
      relationships?.primitiveUse?.direct ??
      [],
  )
  const primitiveBlockers = $derived(
    contextPacket?.primitiveContext?.blockers ??
      relationships?.primitiveUse?.blockers ??
      [],
  )
  const provedPrimitives = $derived(
    contextPacket?.proofContext?.provesPrimitives ??
      relationships?.primitiveProof?.proves ??
      [],
  )
  const blockedTaskIds = $derived(
    tasks
      .filter((candidate) => candidate.id !== task.id && (candidate.dependsOn ?? []).includes(task.id))
      .map((candidate) => candidate.id),
  )
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
    if (action === 'split_required' || action === 'decompose_before_execution') return 'danger'
    if (action === 'split_recommended' || action === 'ask_clarifying_question') return 'warn'
    if (action === 'proceed_with_warning') return 'warn'
    return 'neutral'
  }

  function isDecompositionAction(action: string | undefined): boolean {
    return action === 'split_required' ||
      action === 'split_recommended' ||
      action === 'decompose_before_execution'
  }

  function sizeActionLabel(action: string | undefined): string {
    if (isDecompositionAction(action)) return 'Decompose before execution'
    return token(action)
  }

  function priorityTone(priority: string | undefined): ChipTone {
    const tone = labelForIdentifier('priority', priority).tone
    return tone === 'accent' ? 'agent' : tone
  }

  function goalLabel(goalId: string): string {
    return goalId.replace(/^goal-/, '').replace(/^task-/, '').replace(/[-_]+/g, ' ')
  }

  function taskLabel(taskId: string): string {
    return taskById.get(taskId)?.title?.trim() || taskDisplayKey(taskId, [task, ...tasks], projectId)
  }

  function primitiveLabel(primitive: PrimitiveSummary): string {
    return primitive.label?.trim() || primitive.id || 'Primitive'
  }

  function primitiveStatusTone(status: string | undefined): ChipTone {
    if (status === 'ready') return 'ok'
    if (status === 'needs_proof' || status === 'proposed') return 'warn'
    if (status === 'deprecated') return 'neutral'
    return 'neutral'
  }

  function deliveryStatusTone(status: string | undefined): ChipTone {
    if (status === 'done' || status === 'waived') return 'ok'
    if (status === 'blocked') return 'warn'
    if (status === 'active') return 'running'
    return 'neutral'
  }

  function deliveryKindLabel(kind: string | undefined): string {
    return token(kind)
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
        <Chip label={statusPresentation.label} tone={statusPresentation.tone} />
        {#if task.domain}<Chip label={friendlyDomain(task.domain)} tone="neutral" />{/if}
        {#if task.priority}<Chip label={`Priority: ${friendlyPriority(task.priority)}`} tone={priorityTone(task.priority)} />{/if}
        {#if task.assignedTo}<Chip label={`Assigned: ${roleLabel(task.assignedTo)}`} tone="neutral" />{/if}
        {#if task.revisionCount}<Chip label={`Revisions: ${task.revisionCount}`} tone="neutral" />{/if}
      </Row>
    </Stack>
  </Card>

  <Card title="Task links" tone={splitStillNeedsAction ? 'warn' : 'default'}>
    <Stack gap="3">
      {#if goalEnvelopeId}
        <div class="hierarchy-row">
          <span>Goal envelope</span>
          <strong>{goalLabel(goalEnvelopeId)}</strong>
        </div>
      {/if}

      {#if blockingTaskIds.length > 0}
        <div>
          <h4>Blocked by</h4>
          <ul class="link-list">
            {#each blockingTaskIds as dependency (dependency)}
              <li>
                <a href={currentTaskHref(dependency, projectId)} onclick={(event) => navigateTask(event, dependency)}>
                  {taskLabel(dependency)}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if blockedTaskIds.length > 0}
        <div>
          <h4>Blocks</h4>
          <ul class="link-list">
            {#each blockedTaskIds as dependentId (dependentId)}
              <li>
                <a href={currentTaskHref(dependentId, projectId)} onclick={(event) => navigateTask(event, dependentId)}>
                  {taskLabel(dependentId)}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if contextPacket?.deliveryIntent?.driver || contextPacket?.deliveryIntent?.provider || task.delivery?.proofKind || shapingBlockers.length > 0}
        <div>
          <h4>Delivery</h4>
          <Row wrap gap="2">
            {#if contextPacket?.deliveryIntent?.driver}
              <Chip label={`Driven by ${contextPacket.deliveryIntent.driver.label ?? contextPacket.deliveryIntent.driver.id}`} tone="accent" />
            {/if}
            {#if contextPacket?.deliveryIntent?.provider}
              <Chip label={`Provided by ${contextPacket.deliveryIntent.provider.label ?? contextPacket.deliveryIntent.provider.id}`} tone="neutral" />
            {/if}
            {#if task.delivery?.proofKind}
              <Chip label={`Proof: ${token(task.delivery.proofKind)}`} tone="ok" />
            {/if}
          </Row>
          {#if contextPacket?.whyThisNow}
            <p class="muted">{contextPacket.whyThisNow}</p>
          {/if}
          {#if shapingBlockers.length > 0}
            <div class="delivery-blockers">
              <h4>Not runnable yet</h4>
              <Row wrap gap="2">
                {#each shapingBlockers as blocker (`shape-${blocker.code ?? blocker.summary}`)}
                  <Chip label={token(blocker.code)} tone="warn" />
                {/each}
              </Row>
              <ul class="link-list">
                {#each shapingBlockers as blocker (`shape-summary-${blocker.code ?? blocker.summary}`)}
                  <li>{blocker.summary}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}

      {#if usedPrimitives.length > 0}
        <div>
          <h4>Uses primitives</h4>
          <div class="primitive-list">
            {#each usedPrimitives as primitive (`use-${primitive.id}`)}
              <span class="primitive-pill">
                {primitiveLabel(primitive)}
                {#if primitive.status}<small>{token(primitive.status)}</small>{/if}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if provedPrimitives.length > 0}
        <div>
          <h4>Proves primitives</h4>
          <div class="primitive-list">
            {#each provedPrimitives as primitive (`prove-${primitive.id}`)}
              <span class="primitive-pill primitive-pill-proof">
                {primitiveLabel(primitive)}
                {#if primitive.status}<small>{token(primitive.status)}</small>{/if}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if primitiveBlockers.length > 0}
        <div class="primitive-blockers">
          <h4>Primitive proof blockers</h4>
          <Row wrap gap="2">
            {#each primitiveBlockers as primitive (`blocker-${primitive.id}`)}
              <Chip label={primitiveLabel(primitive)} tone={primitiveStatusTone(primitive.status)} />
            {/each}
          </Row>
        </div>
      {/if}

      {#if splitNeeded && createdChildren.length === 0}
        <div class:split-callout-warning={splitStillNeedsAction} class="split-callout">
          <strong>
            {#if needsSplitAction}
              Split into smaller work
            {:else}
              Decompose before execution
            {/if}
          </strong>
          <span>
            {#if needsSplitAction}
              Split it now: this stays as containing work and the nested work below is created.
            {:else}
              This is too large for one clean worker/review pass. Split it into containing work with nested work below before work starts.
            {/if}
          </span>
          {#if canCreateSplitChildren}
            <div class="split-actions">
              <Button variant="agent" size="sm" disabled={createSplitBusy} onclick={onCreateSplitChildren}>
                <Icon name="sparkles" size={14} />
                {createSplitBusy ? 'Splitting...' : 'Split into smaller work'}
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      {#if nestedWorkIds.length > 0 && createdChildren.length === 0}
        <div>
          <h4>Child tasks</h4>
          <ul class="link-list">
            {#each nestedWorkIds as childId (childId)}
              <li>
                <a href={currentTaskHref(childId, projectId)} onclick={(event) => navigateTask(event, childId)}>
                  {taskLabel(childId)}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if plannedChildren.length > 0}
        <div>
          <h4>{createdChildren.length > 0 ? 'Child tasks' : 'Work to create'}</h4>
          <ul class="child-list">
            {#each plannedChildren as child, index (`${child.title ?? 'child'}-${index}`)}
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

      {#if nestedWorkIds.length === 0 && blockingTaskIds.length === 0 && blockedTaskIds.length === 0 && plannedChildren.length === 0 && usedPrimitives.length === 0 && provedPrimitives.length === 0}
        <p class="muted">No linked tasks recorded.</p>
      {/if}
    </Stack>
  </Card>

  {#if deliverySteps.length > 0 || deliveryBadge}
    <Card title="Delivery steps" tone={deliveryBadge?.tone === 'warn' ? 'warn' : 'default'}>
      <Stack gap="3">
        {#if deliveryBadge}
          <Row wrap gap="2">
            <Chip label={deliveryBadge.label} tone={deliveryBadge.tone} title={deliveryBadge.title} />
          </Row>
        {/if}
        {#if deliverySteps.length > 0}
          <div class="delivery-step-list">
            {#each deliverySteps as step (step.id ?? step.title)}
              <div class="delivery-step-row">
                <div>
                  <strong>{step.title ?? 'Delivery step'}</strong>
                  <span>{deliveryKindLabel(step.kind)}</span>
                </div>
                <Chip label={token(step.status)} tone={deliveryStatusTone(step.status)} />
              </div>
            {/each}
          </div>
        {/if}
      </Stack>
    </Card>
  {/if}

  {#if sizePlan}
    <Card title="Task size">
      <Stack gap="3">
        <Row wrap gap="2">
          <Chip label={token(sizePlan.band)} tone={sizeTone(sizePlan.action)} />
          <Chip label={sizeActionLabel(sizePlan.action)} tone={sizeTone(sizePlan.action)} />
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
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  }
  .split-callout-warning {
    border-color: color-mix(in srgb, var(--warn) 38%, transparent);
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
  .primitive-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .delivery-step-list {
    display: grid;
    gap: var(--s-2);
  }

  .delivery-step-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
  }

  .delivery-step-row > div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }

  .delivery-step-row span {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .primitive-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 28px;
    padding: 0 var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }
  .primitive-pill-proof {
    border-color: color-mix(in srgb, var(--ok) 35%, var(--border));
  }
  .primitive-pill small {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .primitive-blockers {
    padding-top: var(--s-1);
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
