<!--
  Journey tab: a reader-friendly summary of how the task moved from plan to
  worker pass, review, verification, and final outcome. History remains the
  lower-level event log.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Modal from '../../lib/Modal.svelte'
  import { projectFetch } from '../../lib/project-routes.js'
  import { readableTaskDescription } from '../../lib/task-display.js'
  import type { TaskWorkProgressDisplay } from '../../lib/work-progress-display.js'
  import type { ExpectedEvidence, LaunchStep, Task, VerificationRecord } from '../../lib/types.js'

  interface Props {
    task: Task
    projectId?: string | null
    workProgress?: TaskWorkProgressDisplay | null
  }

  interface FilePreview {
    path: string
    absolutePath?: string
    content: string
    language?: string
    truncated?: boolean
  }

  let { task, projectId = null, workProgress = null }: Props = $props()
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
  const proofPaths = $derived(task.proofPaths ?? [])
  const completionProof = $derived(task.completionProof ?? null)
  const completionHandoff = $derived(task.completionHandoff ?? null)
  const verdicts = $derived(task.reviewVerdicts ?? [])
  const gates = $derived(task.gateResults ?? [])
  const taskDescription = $derived(readableTaskDescription(task.description, task.title) || 'This task was shaped from the saved brief and spec.')
  const changedFiles = $derived(uniqueFiles([
    ...(checkpoint?.filesTouched ?? []),
    ...(task.gitStory?.samplePaths ?? []),
  ]))
  const passedGateCount = $derived(gates.filter(gate => gate.passed).length)
  const failedGateCount = $derived(gates.filter(gate => gate.passed === false).length)
  const runtimeEvidence = $derived.by(() => {
    const proofEvidence = proofPaths
      .flatMap(path => path.verificationRecords ?? [])
      .filter(record => record.command || record.url || record.summary)
    const gateEvidence = gates.map(gate => ({
      status: gate.passed ? 'passed' : 'failed',
      summary: gate.output ?? gate.gateId ?? 'Gate recorded.',
      command: gate.gateId,
    }))
    return [...proofEvidence, ...gateEvidence].slice(0, 6)
  })
  const reviewLaneSummary = $derived((reviewPlan?.selectedLanes ?? []).slice(0, 4).map(friendlyToken).join(', '))
  const hiddenLaneCount = $derived(Math.max(0, (reviewPlan?.selectedLanes?.length ?? 0) - 4))
  const deliverySteps = $derived(workProgress?.deliverySteps ?? [])
  const requiredDeliveryCount = $derived(workProgress?.rollup?.requiredStepCount ?? deliverySteps.filter(step => step.required).length)
  const doneDeliveryCount = $derived(workProgress?.rollup?.doneStepCount ?? deliverySteps.filter(step => step.status === 'done').length)
  const blockedDeliverySteps = $derived(deliverySteps.filter(step => step.status === 'blocked'))

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
    if (isDecompositionAction(action)) return 'Decompose before execution'
    if (action === 'proceed_with_warning') return 'Proceed with warning'
    if (action === 'ask_clarifying_question') return 'Ask a question'
    return friendlyToken(action)
  }

  function isDecompositionAction(action: string | undefined): boolean {
    return action === 'split_recommended' ||
      action === 'split_required' ||
      action === 'decompose_before_execution'
  }

  function sizeActionTone(action: string | undefined): 'danger' | 'warn' | 'neutral' {
    if (action === 'split_required' || action === 'decompose_before_execution') return 'danger'
    if (action === 'split_recommended') return 'warn'
    return 'neutral'
  }

  function evidenceChipLabel(evidence: ExpectedEvidence | string): string {
    if (typeof evidence === 'string') return 'Expected proof'
    return `${friendlyToken(evidence.kind)} ${evidence.required === false ? 'Optional' : 'Required'}`
  }

  function evidenceDescription(evidence: ExpectedEvidence | string): string {
    if (typeof evidence === 'string') return evidence
    return evidence.description ?? evidence.sourceRef ?? 'Evidence expectation recorded.'
  }

  function evidenceKey(evidence: ExpectedEvidence | string, index: number): string {
    if (typeof evidence === 'string') return `evidence-string-${index}-${evidence.slice(0, 32)}`
    return `evidence-${evidence.id ?? index}`
  }

  function verificationTone(record: { status?: string }): 'ok' | 'danger' | 'warn' | 'neutral' {
    if (record.status === 'passed') return 'ok'
    if (record.status === 'failed') return 'danger'
    if (record.status === 'blocked') return 'warn'
    return 'neutral'
  }

  function completionProofTone(state: string | undefined): 'ok' | 'warn' | 'neutral' {
    if (state === 'verified') return 'ok'
    if (state === 'missing') return 'warn'
    return 'neutral'
  }

  function launchStepDetail(step: LaunchStep): string {
    switch (step.kind) {
      case 'copy_command':
        return step.command ?? ''
      case 'open_url':
        return step.url ?? ''
      case 'manual_step':
        return step.instructions ?? ''
      case 'external_dashboard':
        return [step.service, step.url, step.instructions].filter(Boolean).join(' · ')
      case 'blocked_until_setup':
        return [step.setupRequirement, step.ownerAction].filter(Boolean).join(' · ')
      default:
        return step.expectedOutcome ?? ''
    }
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
          <p>{taskDescription}</p>
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
                <Chip label={`${friendlyToken(sizePlan.band)} task`} tone={sizeActionTone(sizePlan.action)} />
                <Chip label={sizeActionText(sizePlan.action)} tone={sizeActionTone(sizePlan.action)} />
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
              {#each gates.slice(0, 5) as gate, i (`gate-${gate.gateId ?? 'unknown'}-${gate.checkedAt ?? 'undated'}-${i}`)}
                <Chip label={gate.gateId ?? 'gate'} tone={gate.passed ? 'ok' : 'danger'} />
              {/each}
            </div>
          {/if}
          {#if completionProof}
            <section class="detail">
              <h4>Completion proof</h4>
              <div class="chips">
                <Chip label={friendlyToken(completionProof.state)} tone={completionProofTone(completionProof.state)} />
                <Chip label={`${completionProof.verifiedCount ?? 0} verified`} tone={(completionProof.verifiedCount ?? 0) > 0 ? 'ok' : 'neutral'} />
                <Chip label={`${completionProof.expectedCount ?? 0} expected`} tone="neutral" />
              </div>
              {#if completionProof.verified?.length}
                <ul class="proof-list">
                  {#each completionProof.verified as proof, i (`completion-proof-${i}`)}
                    <li>
                      <Chip label="Proof" tone="ok" />
                      <span>{proof}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if completionProof.historical?.length}
                <section class="detail historical-proof">
                  <h4>Historical claims</h4>
                  <p class="muted">These were recorded before the current proof gap and do not count toward release readiness.</p>
                  <ul class="proof-list">
                    {#each completionProof.historical as proof, i (`historical-proof-${i}`)}
                      <li>
                        <Chip label="Historical" tone="neutral" />
                        <span>{proof}</span>
                      </li>
                    {/each}
                  </ul>
                  {#if (completionProof.historicalCount ?? 0) > completionProof.historical.length}
                    <p class="muted">{(completionProof.historicalCount ?? 0) - completionProof.historical.length} more historical claims remain in the evidence trail.</p>
                  {/if}
                </section>
              {/if}
              {#if completionProof.missing?.length}
                <ul class="proof-list">
                  {#each completionProof.missing as missing, i (`missing-proof-${i}`)}
                    <li>
                      <Chip label="Missing" tone="warn" />
                      <span>{missing}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/if}
          {#if proofPaths.length > 0}
            <section class="detail">
              <h4>Proof path</h4>
              <Stack gap="2">
                {#each proofPaths as proofPath, i (`proof-${proofPath.id ?? i}`)}
                  <article class="mini-record proof-record">
                    <div>
                      <strong>{proofPath.title ?? 'Proof path'}</strong>
                      {#if proofPath.summary}<p class="muted">{proofPath.summary}</p>{/if}
                    </div>
                    <div class="chips">
                      <Chip label={friendlyToken(proofPath.status)} tone={proofPath.status === 'verified' ? 'ok' : proofPath.status === 'blocked' ? 'warn' : 'neutral'} />
                      {#if proofPath.scope?.type}<Chip label={`${friendlyToken(proofPath.scope.type)} scope`} tone="neutral" />{/if}
                    </div>
                    {#if proofPath.launchSteps?.length}
                      <ul class="proof-list">
                        {#each proofPath.launchSteps as step, stepIndex (`launch-${step.id ?? stepIndex}`)}
                          <li>
                            <span>{step.title ?? friendlyToken(step.kind)}</span>
                            {#if step.kind === 'open_url' && step.url}
                              <a href={step.url} target="_blank" rel="noreferrer">{step.title ?? step.url}</a>
                            {:else if step.kind === 'copy_command' && step.command}
                              <code>{step.command}</code>
                            {:else if launchStepDetail(step)}
                              <small>{launchStepDetail(step)}</small>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if proofPath.expectedEvidence?.length}
                      <ul class="proof-list">
                        {#each proofPath.expectedEvidence as evidence, evidenceIndex (evidenceKey(evidence, evidenceIndex))}
                          <li>
                            <Chip
                              label={evidenceChipLabel(evidence)}
                              tone={typeof evidence === 'object' && evidence.required === false ? 'neutral' : 'accent'}
                            />
                            <span>{evidenceDescription(evidence)}</span>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    {#if proofPath.verificationRecords?.length}
                      <ul class="proof-list">
                        {#each proofPath.verificationRecords as record, recordIndex (`verification-${record.id ?? recordIndex}`)}
                          <li>
                            <Chip label={record.status ?? 'recorded'} tone={verificationTone(record)} />
                            <span>{record.summary ?? record.command ?? record.url ?? 'Verification recorded.'}</span>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </article>
                {/each}
              </Stack>
            </section>
          {/if}
          {#if runtimeEvidence.length > 0}
            <section class="detail">
              <h4>Runtime evidence</h4>
              <ul class="proof-list">
                {#each runtimeEvidence as record, i (`runtime-evidence-${i}`)}
                  <li>
                    <Chip label={record.status ?? 'recorded'} tone={verificationTone(record)} />
                    <span>{record.summary ?? record.command ?? record.url ?? 'Runtime evidence recorded.'}</span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
          {#if deliverySteps.length > 0}
            <section class="detail">
              <h4>Delivery completed</h4>
              <p class="muted">{doneDeliveryCount} of {requiredDeliveryCount || deliverySteps.length} required delivery steps complete.</p>
              {#if blockedDeliverySteps.length > 0}
                <ul class="proof-list">
                  {#each blockedDeliverySteps as step (step.id ?? step.title)}
                    <li>
                      <Chip label="Blocked" tone="warn" />
                      <span>{step.title ?? 'Blocked delivery step'}</span>
                    </li>
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
          {#if completionHandoff}
            <section class="detail">
              <h4>Completion handoff</h4>
              {#if completionHandoff.summary}<p>{completionHandoff.summary}</p>{/if}
              {#if completionHandoff.verificationSummary}<p class="muted">{completionHandoff.verificationSummary}</p>{/if}
              <div class="chips">
                <Chip label={`${completionHandoff.automatedProof?.length ?? 0} automated`} tone={(completionHandoff.automatedProof?.length ?? 0) > 0 ? 'ok' : 'neutral'} />
                <Chip label={`${completionHandoff.manualProof?.length ?? 0} manual`} tone={(completionHandoff.manualProof?.length ?? 0) > 0 ? 'ok' : 'neutral'} />
                <Chip label={`${completionHandoff.providerProof?.length ?? 0} provider`} tone={(completionHandoff.providerProof?.length ?? 0) > 0 ? 'ok' : 'neutral'} />
              </div>
              {#if completionHandoff.residualRisk}
                <section class="detail">
                  <h4>Remaining uncertainty</h4>
                  <p class="muted">{completionHandoff.residualRisk}</p>
                </section>
              {/if}
            </section>
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
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
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
    font-weight: var(--gh-type-weight-strong);
    font-size: var(--gh-type-size-meta);
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
    font-size: var(--gh-type-size-body);
  }
  time,
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
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
    font-size: var(--gh-type-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .file-list {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  .proof-record {
    align-items: stretch;
    flex-direction: column;
  }
  .proof-list {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    overflow-wrap: anywhere;
  }
  .proof-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2);
  }
  .proof-list code,
  .proof-list small {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--gh-type-size-caption);
  }
  .proof-list a {
    color: var(--accent);
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
    font-size: var(--gh-type-size-caption);
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
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-body);
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
    font-size: var(--gh-type-size-caption);
  }
  .mini-record {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  @media (max-width: 760px) {
    .files-modal {
      grid-template-columns: 1fr;
      min-height: 0;
    }
  }
</style>
