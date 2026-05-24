<script lang="ts">
  import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    FolderOpen,
    PauseCircle,
    Play,
    Square,
  } from 'lucide-svelte'
  import ActionBar from './ActionBar.svelte'
  import Button from './Button.svelte'
  import Card from './Card.svelte'
  import Chip from './Chip.svelte'
  import Tooltip from './Tooltip.svelte'
  import { avatarToneForRole } from './avatar-palette.js'
  import type { ProjectCardSummary } from './project-summary.js'

  interface Props {
    summary: ProjectCardSummary
    busy?: boolean
    optimisticRunning?: boolean
    onInspect?: (id: string) => void
    onOpen?: (id: string) => void
    onStart?: (id: string) => void
    onStop?: (id: string) => void
  }

  let {
    summary,
    busy = false,
    optimisticRunning = false,
    onInspect,
    onOpen,
    onStart,
    onStop,
  }: Props = $props()

  const effectiveRunning = $derived(summary.canStop || optimisticRunning)

  const displayStatusLabel = $derived(optimisticRunning ? 'Starting' : summary.statusLabel)
  const statusTone = $derived(
    effectiveRunning
      ? 'running'
      : summary.tone === 'warn'
        ? 'warn'
        : summary.tone === 'success'
          ? 'ok'
          : 'neutral',
  )

  const workMixTotal = $derived(Math.max(1, summary.counts.total))
  const workMixLabel = $derived(
    `Project work mix: ${summary.counts.active} active, ${summary.counts.draftReview} drafts, ` +
    `${summary.counts.blocked} blocked, ${summary.counts.done} done, ${summary.counts.shelved} shelved.`,
  )
  const recentWorkLabel = $derived(
    summary.taskActivity.max > 0
      ? `Recent task activity, ${summary.taskActivity.windowLabel.toLowerCase()}. Tallest bar is ${summary.taskActivity.max} ${summary.taskActivity.max === 1 ? 'update' : 'updates'}.`
      : `No recorded task updates in ${summary.taskActivity.windowLabel.toLowerCase()}.`,
  )
  const recentWorkBars = $derived(summary.taskActivity.bars)
  const projectGuildMembers = $derived([
    ...(summary.tone === 'active' || summary.counts.blocked > 0
      ? [{ role: 'Coordinator', initial: 'C', active: effectiveRunning }]
      : []),
    ...(summary.counts.draftReview > 0
      ? [{ role: 'Spec', initial: 'S', active: effectiveRunning }]
      : []),
    ...(summary.counts.active > 0
      ? [{ role: 'Builder', initial: 'B', active: effectiveRunning }]
      : []),
    ...(summary.counts.blocked > 0 || summary.counts.done > 0
      ? [{ role: 'Reviewer', initial: 'R', active: effectiveRunning && summary.counts.blocked > 0 }]
      : []),
  ].map(member => ({ ...member, tone: avatarToneForRole(member.role) })).slice(0, 4))

  const primaryTaskSignal = $derived(
    summary.counts.blocked > 0
      ? `${summary.counts.blocked} blocked`
      : summary.counts.active > 0
        ? effectiveRunning
          ? `${summary.counts.active} working`
          : `${summary.counts.active} paused`
        : summary.counts.draftReview > 0
          ? `${summary.counts.draftReview} drafts`
          : summary.counts.done > 0
            ? `${summary.counts.done} done`
            : 'ready',
  )
  const openTitle = $derived(`Open ${summary.name} project`)
  const selectTitle = $derived(`Project: ${summary.name}`)

  function segmentFlex(count: number): string {
    return `flex: ${Math.max(0, count)} 1 0;`
  }

  function taskNoun(count: number, singular: string, plural = `${singular}s`): string {
    return count === 1 ? singular : plural
  }

  function activeTooltip(count = summary.counts.active): string {
    return `${count} active ${taskNoun(count, 'task')}: work Guildhall can currently advance or is advancing.`
  }

  function draftTooltip(count = summary.counts.draftReview): string {
    return `${count} draft ${taskNoun(count, 'brief')}: task ideas waiting for review before workers start.`
  }

  function blockedTooltip(count = summary.counts.blocked): string {
    return `${count} blocked ${taskNoun(count, 'task')}: work needing triage, recovery, or a human decision.`
  }

  function doneTooltip(count = summary.counts.done): string {
    return `${count} done ${taskNoun(count, 'task')}: completed task records.`
  }

  function shelvedTooltip(count = summary.counts.shelved): string {
    return `${count} shelved ${taskNoun(count, 'task')}: intentionally set aside or no longer part of the active plan.`
  }

  function totalTooltip(count = summary.counts.total): string {
    return `${count} total ${taskNoun(count, 'task')} tracked by Guildhall for this project.`
  }

  function guildMemberTooltip(member: { role: string; active: boolean }): string {
    if (member.active) return `${member.role}: working now on ${summary.name}.`
    switch (member.role) {
      case 'Coordinator':
        return `${member.role}: ${summary.counts.blocked} ${taskNoun(summary.counts.blocked, 'blocker')} to triage in ${summary.name}.`
      case 'Spec':
        return `${member.role}: ${summary.counts.draftReview} draft ${taskNoun(summary.counts.draftReview, 'brief')} awaiting review in ${summary.name}.`
      case 'Builder':
        return `${member.role}: ${summary.counts.active} active ${taskNoun(summary.counts.active, 'task')} waiting for a run in ${summary.name}.`
      case 'Reviewer':
        return `${member.role}: ${summary.counts.blocked} blocked and ${summary.counts.done} done ${taskNoun(summary.counts.done, 'task')} in ${summary.name}.`
      default:
        return `${member.role}: part of the ${summary.name} project workflow.`
    }
  }

  function isInteractiveTarget(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    const interactive = target.closest('button, a, input, textarea, select, [role="button"]')
    return !!interactive && interactive !== currentTarget
  }

  function inspectFromCard(event: MouseEvent): void {
    if (isInteractiveTarget(event.target, event.currentTarget)) return
    onInspect?.(summary.id)
  }

  function inspectFromKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (isInteractiveTarget(event.target, event.currentTarget)) return
    event.preventDefault()
    onInspect?.(summary.id)
  }

</script>

<Card
  className={`project-card ${effectiveRunning ? 'project-card-running' : ''}`.trim()}
  tone={summary.tone === 'warn' ? 'warn' : effectiveRunning ? 'ok' : summary.tone === 'success' ? 'accent' : 'default'}
  role="button"
  tabindex={0}
  ariaLabel={selectTitle}
  onclick={inspectFromCard}
  onkeydown={inspectFromKeyboard}
>
  {#snippet actions()}
    <div class="top-chips" aria-label="Project status">
      <Chip label={displayStatusLabel} tone={statusTone} title={`Project status: ${displayStatusLabel}`} />
      <Chip label={summary.maturityLabel} tone="accent" title={`Development maturity: ${summary.maturityDescription}`} />
      {#if summary.gitStory}
        <Chip
          label={summary.gitStory.label}
          tone={summary.gitStory.blockerCount > 0 ? 'warn' : 'neutral'}
          title={summary.gitStory.title}
        />
      {/if}
    </div>
  {/snippet}

  <div class="card-layout">
    <div class="stack">
      <div class="title-block">
        <h3>{summary.name}</h3>
        <p class="path">{summary.path}</p>
      </div>

      <div class="workline" aria-label={workMixLabel}>
        {#if summary.counts.active > 0}
          <Tooltip text={activeTooltip()} style={segmentFlex(summary.counts.active)} className="work-segment-tip">
            <span class="work-segment segment-active" aria-label={`${summary.counts.active} active ${taskNoun(summary.counts.active, 'task')}`}></span>
          </Tooltip>
        {/if}
        {#if summary.counts.draftReview > 0}
          <Tooltip text={draftTooltip()} style={segmentFlex(summary.counts.draftReview)} className="work-segment-tip">
            <span class="work-segment segment-draft" aria-label={`${summary.counts.draftReview} draft ${taskNoun(summary.counts.draftReview, 'brief')}`}></span>
          </Tooltip>
        {/if}
        {#if summary.counts.blocked > 0}
          <Tooltip text={blockedTooltip()} style={segmentFlex(summary.counts.blocked)} className="work-segment-tip">
            <span class="work-segment segment-blocked" aria-label={`${summary.counts.blocked} blocked ${taskNoun(summary.counts.blocked, 'task')}`}></span>
          </Tooltip>
        {/if}
        {#if summary.counts.done > 0}
          <Tooltip text={doneTooltip()} style={segmentFlex(summary.counts.done)} className="work-segment-tip">
            <span class="work-segment segment-done" aria-label={`${summary.counts.done} done ${taskNoun(summary.counts.done, 'task')}`}></span>
          </Tooltip>
        {/if}
        {#if summary.counts.shelved > 0}
          <Tooltip text={shelvedTooltip()} style={segmentFlex(summary.counts.shelved)} className="work-segment-tip">
            <span class="work-segment segment-shelved" aria-label={`${summary.counts.shelved} shelved ${taskNoun(summary.counts.shelved, 'task')}`}></span>
          </Tooltip>
        {/if}
        {#if summary.counts.total === 0}
          <Tooltip text="No tasks yet" style={segmentFlex(workMixTotal)} className="work-segment-tip">
            <span class="work-segment segment-empty" aria-label="No tasks yet"></span>
          </Tooltip>
        {/if}
      </div>

      <div class="recent-workline" aria-label={recentWorkLabel}>
        {#each recentWorkBars as bar, index (`${index}-${bar.value}`)}
          <Tooltip text={bar.label} style={`--bar-scale: ${summary.taskActivity.max > 0 ? Math.max(0.16, bar.value / summary.taskActivity.max) : 0.16};`} className="recent-workline-tip">
            <span
              class:recent-workline-empty={summary.taskActivity.max === 0 || bar.value === 0}
              aria-label={bar.label}
            ></span>
          </Tooltip>
        {/each}
      </div>

    <div class="story">
      <div class="activity-row">
        <p class="activity">
          <span class="activity-tip" aria-label={summary.activityLabel}>
            <Activity size={14} />
            <span>{primaryTaskSignal}</span>
          </span>
        </p>
        {#if projectGuildMembers.length > 0}
          <div class="project-guild" aria-label="Guild members assigned to this project">
            {#each projectGuildMembers as member (member.role)}
              {@const memberTooltip = guildMemberTooltip(member)}
              <Tooltip text={memberTooltip}>
                <span
                  class={`project-guild-member avatar-tone-${member.tone}`}
                  class:project-guild-member-active={member.active}
                  aria-label={memberTooltip}
                >
                  <span class="project-avatar">{member.initial}</span>
                </span>
              </Tooltip>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="metrics" aria-label="Project task summary">
      {#if summary.counts.active > 0}
        <Tooltip text={activeTooltip()}>
          <span class="metric tone-running" aria-label={`${summary.counts.active} active ${taskNoun(summary.counts.active, 'task')}`}>
            <Activity size={13} />
            <strong>{summary.counts.active}</strong>
          </span>
        </Tooltip>
      {/if}
      {#if summary.counts.draftReview > 0}
        <Tooltip text={draftTooltip()}>
          <span class="metric tone-warn" aria-label={`${summary.counts.draftReview} draft ${taskNoun(summary.counts.draftReview, 'brief')}`}>
            <PauseCircle size={13} />
            <strong>{summary.counts.draftReview}</strong>
          </span>
        </Tooltip>
      {/if}
      {#if summary.counts.blocked > 0}
        <Tooltip text={blockedTooltip()}>
          <span class="metric tone-warn" aria-label={`${summary.counts.blocked} blocked ${taskNoun(summary.counts.blocked, 'task')}`}>
            <AlertTriangle size={13} />
            <strong>{summary.counts.blocked}</strong>
          </span>
        </Tooltip>
      {/if}
      {#if summary.counts.done > 0}
        <Tooltip text={doneTooltip()}>
          <span class="metric tone-ok" aria-label={`${summary.counts.done} done ${taskNoun(summary.counts.done, 'task')}`}>
            <CheckCircle2 size={13} />
            <strong>{summary.counts.done}</strong>
          </span>
        </Tooltip>
      {/if}
      {#if summary.counts.total > 0}
        <Tooltip text={totalTooltip()}>
          <span class="metric tone-neutral" aria-label={`${summary.counts.total} total ${taskNoun(summary.counts.total, 'task')}`}>
            <PauseCircle size={13} />
            <strong>{summary.counts.total}</strong>
          </span>
        </Tooltip>
      {/if}
    </div>

    </div>
    <ActionBar className="project-card-actions">
      <Button variant="secondary" size="sm" disabled={busy || !summary.canOpen} title={openTitle} onclick={() => onOpen?.(summary.id)}>
        <FolderOpen size={14} />
        {summary.actionLabel}
      </Button>
      {#if summary.canStart && !effectiveRunning}
        <Button variant="primary" size="sm" disabled={busy} title={`Start Guildhall on ${summary.name}`} onclick={() => onStart?.(summary.id)}>
          <Play size={14} />
          {summary.runActionLabel}
        </Button>
      {:else if effectiveRunning}
        <Button variant="danger" size="sm" disabled={busy} title={`Stop Guildhall on ${summary.name}`} onclick={() => onStop?.(summary.id)}>
          <Square size={13} />
          Stop
        </Button>
      {/if}
    </ActionBar>
  </div>
</Card>

<style>
  :global(section.project-card) {
    min-height: 8.5rem;
    display: flex;
    flex-direction: column;
    padding: var(--s-2);
    border-radius: var(--r-2);
    border-color: color-mix(in srgb, var(--glass-border-strong) 78%, var(--border));
    --card-reflect:
      radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 28%),
      radial-gradient(circle at 92% 24%, color-mix(in srgb, var(--accent-2) 10%, transparent), transparent 30%);
    box-shadow:
      0 16px 34px color-mix(in srgb, var(--bg-base) 56%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent),
      var(--glass-etch);
  }
  :global(section.project-card.project-card-running) {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--accent-2) 26%, transparent),
      var(--light-emitted-agent),
      var(--glass-shadow);
  }
  :global(section.project-card[role="button"]) {
    cursor: pointer;
  }
  :global(section.project-card[role="button"]:focus-visible) {
    outline: 2px solid color-mix(in srgb, var(--accent) 72%, white);
    outline-offset: 2px;
  }
  :global(section.project-card .card-head) {
    margin-bottom: var(--s-2);
  }
  :global(section.project-card .card-body) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .card-layout {
    width: 100%;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-4);
    font-weight: 700;
    line-height: var(--lh-tight);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .top-chips {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    flex: 1 1 auto;
    min-width: 0;
  }
  .title-block {
    min-width: 0;
  }
  .path {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .workline {
    display: flex;
    gap: 3px;
    width: 100%;
    height: 0.72rem;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
    overflow: hidden;
  }
  :global(section.project-card.project-card-running) .workline {
    background:
      linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent-2) 20%, transparent), transparent),
      var(--bg);
    background-size: 220% 100%;
    animation: workline-sweep 1.8s linear infinite;
  }
  @keyframes workline-sweep {
    0% {
      background-position: 120% 0;
    }
    100% {
      background-position: -120% 0;
    }
  }
  .work-segment {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0.45rem;
    border-radius: calc(var(--r-2) - 2px);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 52%),
      var(--segment-color);
  }
  .segment-active {
    --segment-color: var(--accent-2);
  }
  .segment-draft {
    --segment-color: var(--signal-warn-strong);
  }
  .segment-blocked {
    --segment-color: var(--danger);
  }
  .segment-done {
    --segment-color: var(--accent);
  }
  .segment-shelved {
    --segment-color: color-mix(in srgb, var(--text-muted) 55%, transparent);
  }
  .segment-empty {
    --segment-color: color-mix(in srgb, var(--text-muted) 20%, transparent);
  }
  .recent-workline {
    display: grid;
    grid-template-columns: repeat(18, minmax(0, 1fr));
    align-items: end;
    gap: 2px;
    width: 100%;
    height: 1.3rem;
    padding: 2px;
    border: 1px solid color-mix(in srgb, var(--glass-border) 72%, transparent);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg) 54%, transparent);
    overflow: hidden;
  }
  .recent-workline span {
    min-width: 0;
    height: calc(100% * var(--bar-scale));
    min-height: 3px;
    border-radius: 2px;
    background:
      linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 54%),
      var(--accent-2);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent-2) 14%, transparent);
  }
  :global(.workline .work-segment-tip) {
    height: 100%;
    min-width: 0.45rem;
  }
  :global(.recent-workline .recent-workline-tip) {
    display: flex;
    align-items: end;
    min-width: 0;
    height: 100%;
  }
  :global(.recent-workline .recent-workline-tip > span:first-child) {
    width: 100%;
  }
  .recent-workline span:nth-child(3n) {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 22%, transparent), transparent 54%),
      var(--accent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .recent-workline span:nth-child(5n) {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 22%, transparent), transparent 54%),
      var(--signal-warn-strong);
    box-shadow: 0 0 10px color-mix(in srgb, var(--signal-warn-strong) 12%, transparent);
  }
  .recent-workline .recent-workline-empty {
    background: color-mix(in srgb, var(--text-muted) 18%, transparent);
    box-shadow: none;
  }
  .story {
    display: grid;
    gap: var(--s-1);
    align-content: start;
  }
  .activity-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: center;
  }
  .activity {
    margin: 0;
    font-size: var(--fs-0);
    line-height: var(--lh-body);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text);
    font-weight: 700;
  }
  .activity :global(svg) {
    color: var(--accent-2);
    flex: none;
  }
  .activity-tip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .project-guild {
    display: flex;
    gap: 0.2rem;
    min-width: 0;
    overflow: hidden;
  }
  .project-guild-member {
    --avatar-color: var(--avatar-system);
    display: inline-flex;
    align-items: center;
    padding: 0.12rem;
    border: 1px solid color-mix(in srgb, var(--avatar-color) 22%, var(--border));
    border-radius: 999px;
    color: color-mix(in srgb, var(--avatar-color) 76%, var(--text-muted));
    background: color-mix(in srgb, var(--glass-bg-strong) 78%, var(--bg-raised));
  }
  .project-avatar {
    display: grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--avatar-color) 24%, var(--bg-raised));
    color: color-mix(in srgb, var(--avatar-color) 88%, white);
    font-size: 0.62rem;
    font-weight: 800;
  }
  .project-guild-member-active {
    color: var(--avatar-color);
    border-color: color-mix(in srgb, var(--avatar-color) 48%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--avatar-color) 40%, transparent);
  }
  .project-guild-member-active .project-avatar {
    animation: agent-pip-pulse 1.4s ease-in-out infinite;
  }
  .avatar-tone-coordinator { --avatar-color: var(--avatar-coordinator); }
  .avatar-tone-spec { --avatar-color: var(--avatar-spec); }
  .avatar-tone-builder { --avatar-color: var(--avatar-builder); }
  .avatar-tone-reviewer { --avatar-color: var(--avatar-reviewer); }
  .avatar-tone-gate { --avatar-color: var(--avatar-gate); }
  .avatar-tone-human { --avatar-color: var(--avatar-human); }
  .avatar-tone-system { --avatar-color: var(--avatar-system); }
  @keyframes agent-pip-pulse {
    0%, 100% {
      opacity: 0.62;
      transform: scale(0.9);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(section.project-card.project-card-running) .workline,
    .project-guild-member-active .project-avatar {
      animation: none;
    }
  }
  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-content: start;
  }
  .metric {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.16rem 0.34rem;
    border-radius: 999px;
    font-size: var(--fs-0);
    font-weight: 700;
    line-height: 1;
  }
  .metric strong {
    font-size: var(--fs-1);
  }
  .tone-running {
    background: rgba(78, 204, 163, 0.15);
    color: var(--accent-2);
  }
  .tone-warn {
    background: color-mix(in srgb, var(--signal-warn-strong) 15%, transparent);
    color: var(--signal-warn-strong);
  }
  .tone-ok {
    background: rgba(93, 114, 255, 0.12);
    color: var(--accent);
  }
  .tone-neutral {
    background: rgba(136, 136, 153, 0.12);
    color: var(--text-muted);
  }
  :global(.project-card-actions) {
    width: 100%;
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid color-mix(in srgb, var(--glass-border) 76%, transparent);
  }
</style>
