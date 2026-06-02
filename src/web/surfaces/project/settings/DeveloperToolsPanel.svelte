<script lang="ts">
  import { untrack } from 'svelte'
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Byline from '../../../lib/Byline.svelte'
  import Button from '../../../lib/Button.svelte'
  import Help from '../../../lib/Help.svelte'
  import Row from '../../../lib/Row.svelte'
  import Select from '../../../lib/Select.svelte'
  import Stack from '../../../lib/Stack.svelte'
  import UtilityPanel from '../../../lib/UtilityPanel.svelte'
  import { nav } from '../../../lib/nav.svelte.js'
  import { projectActionHref } from '../../../lib/project-routes.js'
  import type { Lever } from './types.js'
  import type { SettingsStore } from './settings-store.svelte.js'

  interface Props {
    store: SettingsStore
    onMigrate?: () => void | Promise<void>
  }

  let { store, onMigrate }: Props = $props()

  $effect(() => {
    untrack(() => {
      void store.loadDeveloper()
      void store.loadReadiness()
    })
  })

  const developer = $derived(store.developer)
  const migrations = $derived(store.readiness.migrations)
  const migrationCount = $derived((migrations?.blocked?.length ?? 0) + (migrations?.pending?.length ?? 0))
  const leversByScope = $derived.by(() => {
    const out = new Map<string, Lever[]>()
    for (const lever of developer.levers ?? []) {
      if (!out.has(lever.scope)) out.set(lever.scope, [])
      out.get(lever.scope)!.push(lever)
    }
    return [...out.entries()]
  })
  const dsTokenCount = $derived(
    developer.designSystem
      ? (developer.designSystem.tokens?.color?.length ?? 0) +
        (developer.designSystem.tokens?.spacing?.length ?? 0) +
        (developer.designSystem.tokens?.typography?.length ?? 0) +
        (developer.designSystem.tokens?.radius?.length ?? 0) +
        (developer.designSystem.tokens?.shadow?.length ?? 0)
      : 0,
  )

  const leverPositionLabels: Record<string, string> = {
    advisory: 'Advisory',
    agent_autonomous: 'Agent autonomous',
    agent_proposed_coordinator_approved: 'Agent proposes, coordinator approves',
    agent_proposed_human_approved: 'Agent proposes, human approves',
    always: 'Always',
    auto: 'Automatic',
    cherry_pick_local: 'Land locally',
    cherry_pick_with_push: 'Land and push',
    confirm_all: 'Confirm all recovery',
    confirm_destructive: 'Confirm destructive recovery',
    coordinator_adjudicates_on_conflict: 'Coordinator adjudicates conflicts',
    coordinator_first: 'Coordinator first',
    coordinator_sufficient: 'Coordinator approval',
    deterministic_only: 'Deterministic only',
    emergent: 'Emergent',
    fanout_2: 'Two at a time',
    fanout_4: 'Four at a time',
    full_upfront: 'Full upfront',
    gates_sufficient: 'Verification gates',
    human_only: 'Human only',
    human_required: 'Human approval',
    lax: 'Lax',
    lean: 'Lean',
    llm_only: 'LLM only',
    llm_with_deterministic_fallback: 'LLM with deterministic fallback',
    majority: 'Majority',
    manual_pr: 'Manual PR',
    never: 'Never',
    none: 'None',
    off: 'Off',
    pause_all_on_issue: 'Pause all on issue',
    pause_for_review: 'Pause for review',
    per_attempt: 'Per attempt',
    per_task: 'Per task',
    prefer_restart_clean: 'Prefer clean restart',
    prefer_resume: 'Prefer resume',
    requeue_lower_priority: 'Requeue lower priority',
    requeue_with_dampening: 'Requeue with dampening',
    release_critical: 'Release-critical',
    same_as_global: 'Same as global setting',
    serial: 'Serial',
    slot_allocation: 'Slot allocation',
    stage_appropriate: 'Stage appropriate',
    standard: 'Standard',
    strict: 'Strict',
    suggest: 'Suggest',
    terminal_shelved: 'Shelve terminal failures',
    thorough: 'Thorough',
  }
  const leverOptions: Record<string, string[]> = {
    agent_health_strictness: ['lax', 'standard', 'strict'],
    business_envelope_strictness: ['strict', 'advisory', 'off'],
    completion_approval: ['human_required', 'coordinator_sufficient', 'gates_sufficient'],
    concurrent_task_dispatch: ['serial', 'fanout_2', 'fanout_4'],
    crash_recovery_default: ['prefer_resume', 'prefer_restart_clean', 'pause_for_review'],
    escalation_on_ambiguity: ['always', 'coordinator_first', 'never'],
    landing_strategy: ['cherry_pick_local', 'cherry_pick_with_push', 'manual_pr'],
    max_revisions: ['1', '2', '3', '4', '5'],
    pre_rejection_policy: ['terminal_shelved', 'requeue_lower_priority', 'requeue_with_dampening'],
    remediation_autonomy: ['auto', 'confirm_destructive', 'confirm_all', 'pause_all_on_issue'],
    review_effort: ['lean', 'balanced', 'thorough', 'release_critical'],
    reviewer_fanout_policy: ['strict', 'coordinator_adjudicates_on_conflict', 'advisory', 'majority'],
    reviewer_mode: ['llm_only', 'deterministic_only', 'llm_with_deterministic_fallback'],
    runtime_isolation: ['none', 'slot_allocation'],
    spec_completeness: ['full_upfront', 'stage_appropriate', 'emergent'],
    task_origination: ['human_only', 'agent_proposed_human_approved', 'agent_proposed_coordinator_approved', 'agent_autonomous'],
    workspace_import_autonomy: ['off', 'suggest', 'apply'],
    worktree_isolation: ['none', 'per_task', 'per_attempt'],
  }

  function humanizeLeverName(name: string): string {
    return name.replace(/[_.-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
  }

  function leverScopeLabel(scope: string): string {
    if (scope === 'project') return 'Project behavior'
    if (scope === 'domain:default') return 'Default task behavior'
    if (scope.startsWith('domain:')) return `${scope.slice('domain:'.length)} task behavior`
    return scope.replaceAll('_', ' ')
  }

  function leverPositionLabel(position: string): string {
    return leverPositionLabels[position] ?? position.replaceAll('_', ' ')
  }

  function leverSetByLabel(setBy: string): string {
    if (setBy === 'system-default') return 'Same as global setting'
    if (setBy === 'user-direct') return 'Project override'
    return setBy.replaceAll('_', ' ').replaceAll('-', ' ')
  }

  function selectValueForLever(lever: Lever): string {
    return lever.setBy === 'system-default' ? 'same_as_global' : lever.position
  }

  function selectOptionsForLever(lever: Lever): Array<{ value: string; label: string }> {
    const values = new Set(leverOptions[lever.name] ?? [lever.position])
    if (lever.position && lever.setBy !== 'system-default') values.add(lever.position)
    if (lever.defaultPosition) values.add(lever.defaultPosition)
    return [
      { value: 'same_as_global', label: `Same as global setting${lever.defaultPosition ? ` (${leverPositionLabel(lever.defaultPosition)})` : ''}` },
      ...[...values].map(value => ({ value, label: leverPositionLabel(value) })),
    ]
  }
</script>

<SectionHeader
  eyebrow="Settings"
  title="Developer tools"
  description="Diagnostics and raw controls for debugging Guildhall behavior on this project."
  headingTag="h2"
  density="compact"
/>

<Stack gap="4">
  <FrameCard class="developer-card" density="compact">
    {#snippet header()}
      <SectionHeader title="Project migrations" description="Required conversions are reviewed before the project starts." headingTag="h3" density="dense">
        {#snippet meta()}
          <StatusPill label={`${migrationCount} pending`} tone={migrationCount > 0 ? 'warn' : 'ok'} />
        {/snippet}
      </SectionHeader>
    {/snippet}
    <Row justify="between" align="center" wrap gap="3">
      <p class="muted">{migrationCount > 0 ? 'Review pending project migrations before unattended work resumes.' : 'No project migrations are pending.'}</p>
      <Button variant="secondary" size="sm" onclick={() => { void onMigrate?.() }}>Review migrations</Button>
    </Row>
  </FrameCard>

  <FrameCard class="developer-card" density="compact">
    {#snippet header()}
      <SectionHeader title="Raw behavior levers" description="This editor is intentionally developer-facing. The profile tab is the owner-facing default." headingTag="h3" density="dense">
        {#snippet meta()}
          <Help topic="lever.index" />
        {/snippet}
      </SectionHeader>
    {/snippet}

    <Stack gap="3">
      {#if developer.leversError}
        <NoticeBand tone="danger" role="alert" label="Levers" title="Could not load levers" density="compact">
          {#snippet actions()}
            <Button variant="secondary" size="sm" onclick={store.resetLevers}>Reset to defaults</Button>
          {/snippet}
          <p>{developer.leversError}</p>
        </NoticeBand>
      {:else if !developer.levers}
        <NoticeBand tone="neutral" role="status" label="Levers" title="Loading levers" density="compact">
          <p>Reading lever provenance and current positions...</p>
        </NoticeBand>
      {:else}
        {#each leversByScope as [scope, entries] (scope)}
          <section class="lever-scope">
            <header class="lever-scope-head">
              <h4>{leverScopeLabel(scope)}</h4>
              <span>{entries.length} setting{entries.length === 1 ? '' : 's'}</span>
            </header>
            <div class="lever-list">
              {#each entries as lever, i (lever.name + i)}
                <UtilityPanel as="article" className="lever-card" tone="neutral">
                  <header class="lever-card-head">
                    <div class="lever-title-row">
                      <strong>{humanizeLeverName(lever.name)}</strong>
                      <Help topic={`lever.${lever.name}`} size={12} />
                    </div>
                    {#if store.savingLever === `${lever.scope}:${lever.name}`}
                      <StatusPill label="Saving" tone="info" density="dense" />
                    {:else if lever.setBy !== 'system-default'}
                      <StatusPill label={leverSetByLabel(lever.setBy)} tone={lever.setBy === 'user-direct' ? 'warn' : 'neutral'} density="dense" />
                    {/if}
                  </header>
                  <div class="lever-control">
                    <Select
                      value={selectValueForLever(lever)}
                      options={selectOptionsForLever(lever)}
                      ariaLabel={`${humanizeLeverName(lever.name)} setting`}
                      disabled={store.savingLever === `${lever.scope}:${lever.name}`}
                      onchange={(value) => store.saveLever(lever, value)}
                    />
                    <p class="lever-current">
                      Current: {leverPositionLabel(lever.position)}
                      {#if lever.setBy === 'system-default'}
                        - inherited from global defaults
                      {:else}
                        - {leverSetByLabel(lever.setBy)}
                      {/if}
                    </p>
                  </div>
                  {#if lever.rationale}
                    <p class="muted">{lever.rationale}</p>
                  {/if}
                </UtilityPanel>
              {/each}
            </div>
          </section>
        {/each}
      {/if}
    </Stack>
  </FrameCard>

  <FrameCard class="developer-card" density="compact">
    {#snippet header()}
      <SectionHeader title="Codebase map" description="Compact architecture context workers use before editing." headingTag="h3" density="dense">
        {#snippet meta()}
          {#if developer.codebaseMap}
            <StatusPill label={developer.codebaseMap.stale ? 'stale' : developer.codebaseMap.configured ? 'ready' : 'not built'} tone={developer.codebaseMap.stale ? 'warn' : developer.codebaseMap.configured ? 'ok' : 'neutral'} />
          {/if}
        {/snippet}
      </SectionHeader>
    {/snippet}

    {#if developer.codebaseMapError}
      <NoticeBand tone="danger" role="alert" label="Codebase map" title="Could not read map" density="compact">
        <p>{developer.codebaseMapError}</p>
      </NoticeBand>
    {:else if !developer.codebaseMap}
      <p class="muted">Checking the compact architecture index...</p>
    {:else}
      <Stack gap="3">
        <div class="fact-grid">
          <div><span>Files</span><strong>{developer.codebaseMap.counts.files}</strong></div>
          <div><span>Areas</span><strong>{developer.codebaseMap.counts.areas}</strong></div>
          <div><span>Abstractions</span><strong>{developer.codebaseMap.counts.abstractions}</strong></div>
          <div><span>Corpus</span><strong>{developer.codebaseMap.semantic?.corpusKind ?? '-'}</strong></div>
        </div>
        {#if developer.codebaseMap.project}
          <p class="muted">{developer.codebaseMap.project.summary}</p>
        {/if}
        {#if developer.codebaseMap.semantic}
          <div class="map-section">
            <strong>{developer.codebaseMap.semantic.modelId}</strong>
            <p class="muted">{developer.codebaseMap.semantic.projectPurpose}</p>
            {#if developer.codebaseMap.semantic.currentTruth?.length}
              <ul class="mini-list">
                {#each developer.codebaseMap.semantic.currentTruth.slice(0, 4) as truth, i (`truth-${i}`)}
                  <li>{truth}</li>
                {/each}
              </ul>
            {/if}
            {#if developer.codebaseMap.semantic.readNext.length}
              <ul class="mini-list">
                {#each developer.codebaseMap.semantic.readNext.slice(0, 3) as item (item.path)}
                  <li><code>{item.path}</code> - {item.reason}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
        {#if developer.codebaseMap.generatedAt}
          <Byline verb="Last built" at={developer.codebaseMap.generatedAt} />
        {/if}
        <Row justify="end">
          <Button variant="secondary" onclick={store.refreshCodebaseMap} disabled={store.codebaseMapBusy}>
            {store.codebaseMapBusy ? 'Refreshing...' : developer.codebaseMap.configured ? 'Refresh map' : 'Build map'}
          </Button>
        </Row>
      </Stack>
    {/if}
  </FrameCard>

  <FrameCard class="developer-card" density="compact">
    {#snippet header()}
      <SectionHeader title="Design feedback" description="Design-system drafts and reusable UI follow-ups." headingTag="h3" density="dense">
        {#snippet meta()}
          {#if developer.designSystem !== undefined}
            <StatusPill label={developer.designSystem?.approvedAt ? 'approved' : developer.designSystem ? 'draft' : 'none'} tone={developer.designSystem?.approvedAt ? 'ok' : developer.designSystem ? 'warn' : 'neutral'} />
          {/if}
        {/snippet}
      </SectionHeader>
    {/snippet}

    <Stack gap="3">
      {#if developer.designSystem === undefined}
        <p class="muted">Fetching the current design-system document...</p>
      {:else if !developer.designSystem}
        <p class="muted">Guildhall has not generated a design-system draft for this project yet.</p>
      {:else}
        <div class="fact-grid">
          <div><span>Revision</span><strong>{developer.designSystem.revision ?? 0}</strong></div>
          <div><span>Tokens</span><strong>{dsTokenCount}</strong></div>
          <div><span>Primitives</span><strong>{developer.designSystem.primitives?.length ?? 0}</strong></div>
          <div><span>Tone</span><strong>{developer.designSystem.copyVoice?.tone ?? 'plain'}</strong></div>
        </div>
        {#if !developer.designSystem.approvedAt}
          <Row justify="end">
            <Button variant="primary" onclick={store.approveDesignSystem}>Approve current draft</Button>
          </Row>
        {/if}
      {/if}

      {#if developer.designFeedback}
        <div class="fact-grid">
          <div><span>Findings</span><strong>{developer.designFeedback.findings?.length ?? 0}</strong></div>
          <div><span>Owner feedback</span><strong>{developer.designFeedback.ownerFeedback?.length ?? 0}</strong></div>
          <div><span>Decision packets</span><strong>{developer.designFeedback.decisionPackets?.length ?? 0}</strong></div>
          <div><span>Reusable candidates</span><strong>{developer.designFeedback.candidates?.length ?? 0}</strong></div>
        </div>
        {#if developer.designFeedback.candidates?.length}
          <ul class="mini-list">
            {#each developer.designFeedback.candidates.slice(0, 3) as candidate, i (`candidate-${i}`)}
              <li><strong>{candidate.targetDesignSystem ?? 'portable'} follow-up</strong> - {candidate.summary ?? 'Reusable design-system candidate queued.'}</li>
            {/each}
          </ul>
        {/if}
      {/if}
    </Stack>
  </FrameCard>

  <FrameCard class="developer-card" density="compact">
    {#snippet header()}
      <SectionHeader title="Re-intake status" description="Re-intake starts from Thread or Work review flows; this only shows the diagnostic state." headingTag="h3" density="dense">
        {#snippet meta()}
          <StatusPill label={developer.reintakeStatus?.status ?? 'not started'} tone={developer.reintakeStatus?.status === 'draft' ? 'warn' : developer.reintakeStatus?.status === 'applied' ? 'ok' : 'neutral'} />
        {/snippet}
      </SectionHeader>
    {/snippet}
    <Row justify="between" align="center" wrap gap="3">
      <p class="muted">
        {developer.reintakeStatus?.draftExists ? 'A re-intake draft is waiting for review.' : 'No active re-intake draft.'}
      </p>
      <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/thread'))}>Open Threads</Button>
    </Row>
  </FrameCard>
</Stack>

<style>
  .muted,
  .lever-current,
  .mini-list {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .lever-scope,
  .lever-list,
  .map-section {
    display: grid;
    gap: var(--gh-space-2);
  }
  .lever-scope-head,
  .lever-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gh-space-3);
    flex-wrap: wrap;
  }
  .lever-scope-head h4,
  .lever-current {
    margin: 0;
  }
  .lever-scope-head span {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  :global(.lever-card) {
    display: grid;
    gap: var(--gh-space-2);
  }
  .lever-title-row {
    display: flex;
    align-items: center;
    gap: var(--gh-space-2);
  }
  .lever-control {
    display: grid;
    gap: var(--gh-space-2);
    max-inline-size: 28rem;
  }
  .fact-grid {
    display: grid;
    gap: var(--gh-space-3);
  }
  .fact-grid > div {
    display: grid;
    gap: var(--gh-space-1);
  }
  .fact-grid span {
    color: var(--text-muted);
    font-size: var(--fs-1);
    text-transform: uppercase;
  }
  .mini-list {
    margin: 0;
    padding-inline-start: var(--gh-space-4);
  }
  @container (min-width: 42rem) {
    .fact-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
