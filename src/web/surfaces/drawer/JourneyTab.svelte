<!--
  Journey tab: a reader-friendly summary of how the task moved from plan to
  worker pass, review, verification, and final outcome. History remains the
  lower-level event log.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Modal from '../../lib/Modal.svelte'
  import { projectFetch } from '../../lib/project-routes.js'
  import type { Task } from '../../lib/types.js'

  interface Props {
    task: Task
    projectId?: string | null
  }

  interface FilePreview {
    path: string
    absolutePath?: string
    content: string
    language?: string
    truncated?: boolean
  }

  let { task, projectId = null }: Props = $props()
  let selectedFile = $state<string | null>(null)
  let filePreview = $state<FilePreview | null>(null)
  let fileBusy = $state(false)
  let fileError = $state<string | null>(null)
  let filesModalOpen = $state(false)

  const checkpoint = $derived(task.latestCheckpoint ?? null)
  const reviewPlan = $derived(task.reviewPlan ?? null)
  const reviewSummary = $derived(task.reviewAuditSummary ?? null)
  const sizePlan = $derived(task.sizePlan ?? null)
  const requestIntake = $derived(task.requestIntake ?? null)
  const doneSummary = $derived(task.doneSummaryBundle ?? null)
  const verdicts = $derived(task.reviewVerdicts ?? [])
  const gates = $derived(task.gateResults ?? [])
  const changedFiles = $derived(uniqueFiles([
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

  function uniqueFiles(values: readonly string[]): string[] {
    return unique(values).filter(value => !looksLikeDirectory(value))
  }

  function looksLikeDirectory(value: string): boolean {
    return /[\\/]$/.test(value.trim())
  }

  async function inspectFile(file: string): Promise<void> {
    selectedFile = file
    filePreview = null
    fileError = null
    fileBusy = true
    try {
      const res = await projectFetch(
        `/api/project/task/${encodeURIComponent(task.id)}/file?path=${encodeURIComponent(file)}`,
        undefined,
        projectId,
      )
      const body = await res.json().catch(() => ({})) as Partial<FilePreview> & { error?: string }
      if (!res.ok) {
        fileError = body.error ?? `Could not read ${file}.`
        return
      }
      filePreview = {
        path: body.path ?? file,
        ...(body.absolutePath ? { absolutePath: body.absolutePath } : {}),
        content: body.content ?? '',
        ...(body.language ? { language: body.language } : {}),
        truncated: Boolean(body.truncated),
      }
    } catch (err) {
      fileError = err instanceof Error ? err.message : String(err)
    } finally {
      fileBusy = false
    }
  }

  function openFilesModal(): void {
    filesModalOpen = true
  }

  function closeFilesModal(): void {
    filesModalOpen = false
    selectedFile = null
    filePreview = null
    fileError = null
    fileBusy = false
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

  function sizeActionText(action: string | undefined): string {
    if (!action) return 'Not sized'
    if (action === 'split_recommended') return 'Split recommended'
    if (action === 'split_required') return 'Split required'
    if (action === 'proceed_with_warning') return 'Proceed with warning'
    if (action === 'ask_clarifying_question') return 'Ask a question'
    return friendlyToken(action)
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
          {#if sizePlan}
            <section class="detail">
              <h4>Task size</h4>
              <div class="chips">
                <Chip label={`${friendlyToken(sizePlan.band)} task`} tone={sizePlan.action === 'split_required' ? 'danger' : sizePlan.action === 'split_recommended' ? 'warn' : 'neutral'} />
                <Chip label={sizeActionText(sizePlan.action)} tone={sizePlan.action === 'split_required' ? 'danger' : sizePlan.action === 'split_recommended' ? 'warn' : 'neutral'} />
                {#if sizePlan.score}
                  <Chip label={`Score ${sizePlan.score}`} tone="neutral" />
                {/if}
              </div>
              {#if sizePlan.factors?.length}
                <p class="muted">{sizePlan.factors.slice(0, 3).map((factor) => factor.label ?? friendlyToken(factor.id)).join(', ')}</p>
              {/if}
              {#if sizePlan.recommendedChildren?.length}
                <ul class="file-list">
                  {#each sizePlan.recommendedChildren.slice(0, 4) as child, i (`child-${i}`)}
                    <li>{child.title}</li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/if}
          {#if requestIntake}
            <section class="detail">
              <h4>Request shape</h4>
              <div class="chips">
                <Chip label={friendlyToken(requestIntake.intent)} tone={requestIntake.intent === 'ambiguous_spec_or_implementation' ? 'warn' : 'neutral'} />
                <Chip label={friendlyToken(requestIntake.recommendedNextAction)} tone={requestIntake.recommendedNextAction === 'ask_clarifying_question' ? 'warn' : 'neutral'} />
              </div>
              {#if requestIntake.ambiguity}
                <p class="muted">{requestIntake.ambiguity}</p>
              {/if}
              {#if requestIntake.componentStack?.length}
                <ul class="file-list">
                  {#each requestIntake.componentStack.slice(0, 5) as component, i (`component-${i}`)}
                    <li>{component.title ?? friendlyToken(component.kind)}{#if component.role}: {component.role}{/if}</li>
                  {/each}
                </ul>
              {/if}
            </section>
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
              <p class="muted">
                {changedFiles.length} file{changedFiles.length === 1 ? '' : 's'} changed.
              </p>
              <Button variant="secondary" size="sm" onclick={openFilesModal}>
                Inspect files
              </Button>
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
          {#if doneSummary?.summary}
            <section class="detail">
              <h4>Done summary</h4>
              {#if doneSummary.summary.journey}<p>{doneSummary.summary.journey}</p>{/if}
              {#if doneSummary.summary.decision}<p>{doneSummary.summary.decision}</p>{/if}
              {#if doneSummary.summary.evidence}<p class="muted">{doneSummary.summary.evidence}</p>{/if}
              {#if doneSummary.summary.learningCandidates?.length}
                <ul class="file-list">
                  {#each doneSummary.summary.learningCandidates as item, i (`learning-${i}`)}
                    <li>{item}</li>
                  {/each}
                </ul>
              {/if}
              <div class="chips">
                <Chip
                  label={doneSummary.retention?.compactedFullTranscript ? 'Transcript compacted' : 'Transcript retained'}
                  tone={doneSummary.retention?.compactedFullTranscript ? 'ok' : 'neutral'}
                />
                <Chip
                  label={doneSummary.retention?.fullEvidenceAvailable === false ? 'Full evidence unavailable' : 'Full evidence available'}
                  tone={doneSummary.retention?.fullEvidenceAvailable === false ? 'warn' : 'neutral'}
                />
              </div>
            </section>
          {:else}
            <p>{outcomeText()}</p>
          {/if}
          {#if task.terminalSummary?.detail}
            <Markdown source={task.terminalSummary.detail} />
          {/if}
        </div>
      </article>
    </li>
  </ol>
</Stack>

<Modal
  open={filesModalOpen}
  title="Files changed"
  size="xl"
  onClose={closeFilesModal}
>
  <div class="files-modal">
    <aside class="files-sidebar" aria-label="Changed files">
      <ul class="file-list modal-list">
        {#each changedFiles as file (file)}
          <li>
            <button
              type="button"
              class:selected={selectedFile === file}
              aria-label={`Inspect ${file}`}
              onclick={() => inspectFile(file)}
            >
              {file}
            </button>
          </li>
        {/each}
      </ul>
    </aside>
    <section class="file-preview modal-preview" aria-live="polite">
      {#if selectedFile}
        <header>
          <strong>{selectedFile}</strong>
          {#if filePreview?.language}<span>{filePreview.language}</span>{/if}
        </header>
        {#if fileBusy}
          <p class="muted">Reading file...</p>
        {:else if fileError}
          <p class="error">{fileError}</p>
        {:else if filePreview}
          {#if filePreview.truncated}
            <p class="muted">Preview is truncated to the first 256 KB.</p>
          {/if}
          <pre><code>{filePreview.content}</code></pre>
        {:else}
          <p class="muted">Choose a file to inspect.</p>
        {/if}
      {:else}
        <p class="muted">Choose a file to inspect.</p>
      {/if}
    </section>
  </div>
</Modal>

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
  .file-list button {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-family: var(--font-mono);
    padding: 0;
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .file-list button:hover,
  .file-list button:focus-visible,
  .file-list button.selected {
    text-decoration: underline;
  }
  .file-preview {
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-subtle);
    overflow: hidden;
  }
  .file-preview header {
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--border);
  }
  .file-preview header strong,
  .file-preview header span {
    font-size: var(--fs-0);
  }
  .file-preview header span {
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .file-preview pre {
    margin: 0;
    max-height: 20rem;
    overflow: auto;
    padding: var(--s-3);
    color: var(--text);
    background: var(--bg);
    font-size: var(--fs-0);
    line-height: 1.55;
  }
  .file-preview code {
    font-family: var(--font-mono);
    white-space: pre;
  }
  .file-preview .muted,
  .file-preview .error {
    margin: 0;
    padding: var(--s-3);
  }
  .files-modal {
    display: grid;
    grid-template-columns: minmax(220px, 0.36fr) minmax(0, 1fr);
    gap: var(--s-3);
    min-height: min(58vh, 560px);
  }
  .files-sidebar {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-subtle);
    overflow: auto;
  }
  .modal-list {
    display: grid;
    gap: 0;
    padding: var(--s-2);
    list-style: none;
  }
  .modal-list li + li {
    border-top: 1px solid var(--border);
  }
  .modal-list button {
    display: block;
    width: 100%;
    padding: var(--s-2);
    border-radius: var(--r-1);
    color: var(--text);
  }
  .modal-list button:hover,
  .modal-list button:focus-visible,
  .modal-list button.selected {
    background: var(--bg-raised);
    text-decoration: none;
  }
  .modal-preview {
    min-width: 0;
    min-height: 0;
  }
  .modal-preview pre {
    max-height: min(52vh, 520px);
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-0);
  }
  .mini-record {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  @media (max-width: 760px) {
    .files-modal {
      grid-template-columns: 1fr;
      min-height: 0;
    }
  }
</style>
