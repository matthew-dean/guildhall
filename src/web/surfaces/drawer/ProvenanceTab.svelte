<!--
  Provenance tab: a definition-list of where this task came from and when.
  Lists only fields that are present; renders a shelve-reason card if set.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Card from '../../lib/Card.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import Byline from '../../lib/Byline.svelte'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  const lines = $derived<Array<readonly [string, string | null]>>([
    ['Origination', task.origination ?? 'human'],
    ['Proposed by', task.proposedBy ?? null],
    ['Proposal rationale', task.proposalRationale ?? null],
    ['Created at', task.createdAt ?? ''],
    ['Updated at', task.updatedAt ?? ''],
    ['Completed at', task.completedAt ?? null],
    ['Parent goal', task.parentGoalId ?? null],
    ['Permission mode', task.permissionMode ?? null],
    ['Depends on', task.dependsOn?.length ? task.dependsOn.join(', ') : null],
  ])
</script>

<Stack gap="4">
  <Card title="Provenance trail">
    <DefinitionList items={lines} />
  </Card>

  {#if task.shelveReason}
    <Card title="Shelve reason" tone="warn">
      <Stack gap="2">
        <header class="meta">
          <span>{task.shelveReason.code ?? '—'}</span>
          <Byline by={task.shelveReason.rejectedBy} at={task.shelveReason.rejectedAt} />
        </header>
        {#if task.shelveReason.detail}
          <p>{task.shelveReason.detail}</p>
        {/if}
      </Stack>
    </Card>
  {/if}
</Stack>

<style>
  .meta {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    flex-wrap: wrap;
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 700;
  }
  p {
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
</style>
