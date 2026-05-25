<!--
  Journey tab: a reader-friendly summary of how the task moved from plan to
  worker pass, review, verification, and final outcome. History remains the
  lower-level event log.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  const checkpoint = $derived(task.latestCheckpoint ?? null)
  const reviewPlan = $derived(task.reviewPlan ?? null)
  const reviewSummary = $derived(task.reviewAuditSummary ?? null)
  const verdicts = $derived(task.reviewVerdicts ?? [])
  const gates = $derived(task.gateResults ?? [])
  const changedFiles = $derived(unique([
    ...(checkpoint?.filesTouched ?? []),
    ...(task.gitStory?.samplePaths ?? []),
  ]))
  const passedGateCount = $derived(gates.filter(gate => gate.passed).length)
  const failedGateCount = $derived(gates.filter(gate => gate.passed === false).length)
  const reviewLaneSummary = $derived((reviewPlan?.selectedLanes ?? []).slice(0, 4).map(friendlyToken).join(', '))
  const hiddenLaneCount = $derived(Math.max(0, (reviewPlan?.selectedLanes?.length ?? 0) - 4))

  function unique(values: readonly string[]): string[] {
    return [...new Set(values.map(value => value.trim()).filter(Boolean))]
  }

  function friendlyToken(value: string | undefined): string {
    if (!value) return 'Unknown'
    return value
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace(/\bUx\b/g, 'UX')
      .replace(/\bApi\b/g, 'API')
      .replace(/\bLlm\b/g, 'LLM')
  }

  function reviewerRunText(): string {
    const count = reviewSummary?.reviewerRunCount ?? verdicts.length
    if (count === 0) return 'No reviewer run is recorded yet.'
    const reviseCount = reviewSummary?.reviseCount ?? verdicts.filter(v => v.verdict === 'revise').length
    const parts = [
      `${count} reviewer run${count === 1 ? '' : 's'}`,
      reviseCount > 0 ? `${reviseCount} revision request${reviseCount === 1 ? '' : 's'}` : 'no revision requests',
    ]
    return parts.join(' · ')
  }

  function outcomeText(): string {
    if (task.mergeRecord?.result) {
      return `Finished with ${friendlyToken(task.mergeRecord.result)}${task.mergeRecord.commitSha ? ` at ${task.mergeRecord.commitSha}` : ''}.`
    }
    if (task.completedAt) return `Marked done at ${task.completedAt}.`
    return `Current status: ${friendlyToken(task.status)}.`
  }
</script>

<Stack gap="4">
  <Card title="Task journey">
    <p class="intro">
      A quick read of what happened: who worked on it, what changed, what got checked, and how it finished.
    </p>
  </Card>

  <ol class="journey">
    <li>
      <article class="step">
        <div class="marker">1</div>
        <div class="step-body">
          <header>
            <strong>Planned</strong>
            {#if task.createdAt}<time>{task.createdAt}</time>{/if}
          </header>
          <p>{task.description ?? 'Guildhall shaped the task from the saved brief and spec.'}</p>
          {#if reviewPlan}
            <div class="chips">
              <Chip label={`${friendlyToken(reviewPlan.effort)} review`} tone="accent" />
              <Chip label={`${reviewPlan.requiredRecipes?.length ?? 0} reviewer group${(reviewPlan.requiredRecipes?.length ?? 0) === 1 ? '' : 's'}`} tone="neutral" />
            </div>
          {/if}
        </div>
      </article>
    </li>

    <li>
      <article class="step">
        <div class="marker">2</div>
        <div class="step-body">
          <header>
            <strong>Worker pass</strong>
            {#if checkpoint?.writtenAt}<time>{checkpoint.writtenAt}</time>{/if}
          </header>
          <p>
            {checkpoint?.agentId ?? task.assignedTo ?? 'The worker'} worked from the task brief
            {#if checkpoint?.intent}
              : {checkpoint.intent}
            {:else}
              .
            {/if}
          </p>
          {#if changedFiles.length > 0}
            <section class="detail">
              <h4>Files changed</h4>
              <ul class="file-list">
                {#each changedFiles.slice(0, 8) as file (file)}
                  <li>{file}</li>
                {/each}
              </ul>
              {#if changedFiles.length > 8}
                <p class="muted">+{changedFiles.length - 8} more</p>
              {/if}
            </section>
          {/if}
        </div>
      </article>
    </li>

    <li>
      <article class="step">
        <div class="marker">3</div>
        <div class="step-body">
          <header>
            <strong>Reviewed</strong>
            {#if reviewSummary?.latestReviewerRunAt}<time>{reviewSummary.latestReviewerRunAt}</time>{/if}
          </header>
          <p>{reviewerRunText()}</p>
          {#if reviewLaneSummary}
            <p class="muted">
              Looked at {reviewLaneSummary}{#if hiddenLaneCount > 0}, +{hiddenLaneCount} more{/if}.
            </p>
          {/if}
          {#if verdicts.length > 0}
            <section class="detail">
              <h4>Reviewer notes</h4>
              <Stack gap="2">
                {#each verdicts.slice(0, 3) as verdict, i (`verdict-${i}`)}
                  <article class="mini-record">
                    <Chip label={verdict.verdict ?? 'unknown'} tone={verdict.verdict === 'approve' ? 'ok' : 'warn'} />
                    <span>{verdict.reason ?? verdict.reviewerPath ?? 'Reviewer verdict recorded.'}</span>
                  </article>
                {/each}
              </Stack>
            </section>
          {/if}
        </div>
      </article>
    </li>

    <li>
      <article class="step">
        <div class="marker">4</div>
        <div class="step-body">
          <header>
            <strong>Verified</strong>
          </header>
          {#if gates.length === 0}
            <p>No gate run is recorded yet.</p>
          {:else}
            <p>{passedGateCount} check{passedGateCount === 1 ? '' : 's'} passed{#if failedGateCount > 0}; {failedGateCount} failed{/if}.</p>
            <div class="chips">
              {#each gates.slice(0, 5) as gate, i (`gate-${gate.gateId ?? i}`)}
                <Chip label={gate.gateId ?? 'gate'} tone={gate.passed ? 'ok' : 'danger'} />
              {/each}
            </div>
          {/if}
        </div>
      </article>
    </li>

    <li>
      <article class="step">
        <div class="marker">5</div>
        <div class="step-body">
          <header>
            <strong>Finished</strong>
            {#if task.completedAt}<time>{task.completedAt}</time>{/if}
          </header>
          <p>{outcomeText()}</p>
          {#if task.terminalSummary?.detail}
            <Markdown source={task.terminalSummary.detail} />
          {/if}
        </div>
      </article>
    </li>
  </ol>
</Stack>

<style>
  .intro,
  p {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .journey {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .step {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--s-3);
    align-items: start;
  }
  .marker {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 800;
    font-size: var(--fs-1);
  }
  .step-body {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
  }
  header strong {
    color: var(--text);
    font-size: var(--fs-2);
  }
  time,
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-0);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h4 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .file-list {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    overflow-wrap: anywhere;
  }
  .mini-record {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
</style>
