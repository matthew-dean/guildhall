<!--
  Provenance tab: a definition-list of where this task came from and when.
  Lists only fields that are present; renders a shelve-reason card if set.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Card from '../../lib/Card.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import Byline from '../../lib/Byline.svelte'
  import type {
    ContextDebugRecord,
    ContextHealthWarning,
    Task,
  } from '../../lib/types.js'

  interface Props {
    task: Task
    contextDebug?: ContextDebugRecord[]
  }

  let { task, contextDebug = [] }: Props = $props()

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

  function toneForWarnings(warnings: ContextHealthWarning[]): 'default' | 'warn' | 'danger' {
    if (warnings.some((warning) => warning.severity === 'error')) return 'danger'
    if (warnings.some((warning) => warning.severity === 'warn')) return 'warn'
    return 'default'
  }
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

  {#if contextDebug.length > 0}
    <Card title="Runtime context" tone={toneForWarnings(contextDebug[0]?.health ?? [])}>
      <Stack gap="4">
        {#each contextDebug as record}
          <section class="debug-record">
            <header class="debug-head">
              <div>
                <h4>{record.agentName ?? 'agent'} {#if record.modelId}<span>· {record.modelId}</span>{/if}</h4>
                <p>{record.at ?? '—'} · {record.taskStatus ?? task.status ?? '—'}</p>
              </div>
              <div class="counts">
                <span>{record.contextChars ?? 0} ctx</span>
                <span>{record.promptChars ?? 0} prompt</span>
              </div>
            </header>

            {#if record.reasons?.length}
              <div>
                <h5>Why this context</h5>
                <ul>
                  {#each record.reasons as reason}
                    <li>{reason}</li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if record.health?.length}
              <div>
                <h5>Health checks</h5>
                <ul>
                  {#each record.health as warning}
                    <li class:danger={warning.severity === 'error'} class:warn={warning.severity === 'warn'}>
                      <strong>{warning.code}</strong>: {warning.message}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if record.sections?.length}
              <div>
                <h5>Section sizes</h5>
                <ul>
                  {#each record.sections as section}
                    <li>{section.label ?? section.key ?? 'section'}: {section.chars ?? 0} chars{#if !section.included} (empty){/if}</li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if record.promptPreview}
              <div>
                <h5>Prompt preview</h5>
                <pre>{record.promptPreview}</pre>
              </div>
            {/if}

            {#if record.snapshotPath}
              <p class="path">{record.snapshotPath}</p>
            {/if}
          </section>
        {/each}
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
  .debug-record {
    display: grid;
    gap: var(--s-3);
    padding-top: var(--s-2);
    border-top: 1px solid var(--border);
  }
  .debug-record:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .debug-head {
    display: flex;
    justify-content: space-between;
    gap: var(--s-3);
    align-items: flex-start;
  }
  .debug-head h4 {
    margin: 0;
    font-size: var(--fs-2);
  }
  .debug-head h4 span,
  .debug-head p,
  .counts,
  .path {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .counts {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  h5 {
    margin: 0 0 var(--s-1);
    font-size: var(--fs-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  ul {
    margin: 0;
    padding-left: 1rem;
    display: grid;
    gap: var(--s-1);
  }
  li.warn strong,
  li.danger strong {
    color: var(--text);
  }
  li.warn {
    color: var(--stripe-warn);
  }
  li.danger {
    color: var(--stripe-danger);
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    max-height: 14rem;
    overflow: auto;
  }
</style>
