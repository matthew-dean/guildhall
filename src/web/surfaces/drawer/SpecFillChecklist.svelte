<!--
  Per-task spec-fill checklist. Lives at the top of the Spec tab and shows
  the spec-fill wizard's four steps (title, description, brief, acceptance)
  as a single compact progress line with inline chips. Clicking a pending
  step scrolls the corresponding form section into view — the drawer
  already has the real editors; this is just the "what's missing" lens.

  Derivation-based: each step flips to "done" the moment the underlying
  task field is substantive enough. No mutation happens here beyond
  optional skip markers.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'

  interface Props {
    taskId: string
    /** Bumped whenever the task payload is reloaded — refetches progress. */
    refreshKey: unknown
  }

  let { taskId, refreshKey }: Props = $props()

  type Status = 'done' | 'pending' | 'skipped'
  interface StepShape {
    id: string
    title: string
    why: string
    status: Status
    skippable: boolean
  }
  interface WizardShape {
    id: string
    totalSteps: number
    doneCount: number
    complete: boolean
    activeStepId: string | null
    steps: StepShape[]
  }

  let wizard = $state<WizardShape | null>(null)
  let loaded = $state(false)
  let collapsed = $state(false)

  async function load() {
    try {
      const r = await fetch(`/api/project/task/${encodeURIComponent(taskId)}/wizards`)
      if (!r.ok) return
      const j = (await r.json()) as { wizards?: WizardShape[] }
      wizard = (j.wizards ?? []).find(w => w.id === 'spec-fill') ?? null
    } catch {
      /* leave prior value */
    } finally {
      loaded = true
    }
  }

  $effect(() => {
    void refreshKey
    void load()
  })

  async function skip(stepId: string) {
    await fetch(
      `/api/project/task/${encodeURIComponent(taskId)}/wizards/spec-fill/skip`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId }),
      },
    )
    await load()
  }

  async function unskip(stepId: string) {
    await fetch(
      `/api/project/task/${encodeURIComponent(taskId)}/wizards/spec-fill/unskip`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId }),
      },
    )
    await load()
  }

  function scrollTo(stepId: string) {
    // Map step ids to section anchors rendered by SpecTab.
    const anchorByStep: Record<string, string> = {
      title: 'section-about',
      description: 'section-about',
      brief: 'section-brief',
      acceptance: 'section-acceptance',
    }
    const sel = anchorByStep[stepId]
    if (!sel) return
    const el = document.querySelector(`[data-spec-section="${sel}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el?.classList.add('flash')
    setTimeout(() => el?.classList.remove('flash'), 1400)
  }

  function toneFor(status: Status): string {
    if (status === 'done') return 'ok'
    if (status === 'skipped') return 'warn'
    return 'pending'
  }
</script>

{#if loaded && wizard && !wizard.complete}
  <div class="checklist" class:collapsed>
    <header class="head">
      <div class="summary">
        <strong>Spec fill</strong>
        <span class="muted">
          {wizard.doneCount} of {wizard.totalSteps} — finish for the reviewer
        </span>
      </div>
      <button
        type="button"
        class="toggle"
        onclick={() => (collapsed = !collapsed)}
        aria-expanded={!collapsed}
      >
        {collapsed ? 'Show' : 'Hide'}
      </button>
    </header>

    {#if !collapsed}
      <Stack gap="1">
        {#each wizard.steps as step (step.id)}
          {@const isActive = step.id === wizard.activeStepId}
          <div class="step tone-{toneFor(step.status)}" class:active={isActive}>
            <button
              type="button"
              class="step-body"
              onclick={() => scrollTo(step.id)}
              title="Jump to {step.title}"
            >
              <span class="dot"></span>
              <span class="label">
                <span class="title">{step.title}</span>
                <span class="why">{step.why}</span>
              </span>
              <span class="chip">
                {step.status === 'done'
                  ? 'done'
                  : step.status === 'skipped'
                    ? 'skipped'
                    : isActive
                      ? 'do next'
                      : 'pending'}
              </span>
            </button>
            {#if step.status === 'pending' && step.skippable}
              <button
                type="button"
                class="linky"
                onclick={(e) => {
                  e.stopPropagation()
                  void skip(step.id)
                }}
              >
                Skip
              </button>
            {:else if step.status === 'skipped'}
              <button
                type="button"
                class="linky"
                onclick={(e) => {
                  e.stopPropagation()
                  void unskip(step.id)
                }}
              >
                Resume
              </button>
            {/if}
          </div>
        {/each}
      </Stack>
    {/if}
  </div>
{/if}

<style>
  .checklist {
    border: 1px solid var(--border);
    border-left: 3px solid var(--warn, #d0a146);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
    padding: var(--s-2) var(--s-3);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    justify-content: space-between;
  }
  .summary {
    display: flex;
    gap: var(--s-2);
    align-items: baseline;
    flex-wrap: wrap;
  }
  .muted { color: var(--text-muted); font-size: var(--fs-1); }
  .toggle {
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-1);
    text-decoration: underline;
    cursor: pointer;
  }
  .toggle:hover { color: var(--text); }
  .step {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) 0;
  }
  .step-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }
  .step.tone-ok .dot { background: var(--ok, #6fcf6f); }
  .step.tone-warn .dot { background: var(--warn, #d0a146); }
  .step.tone-pending .dot { background: var(--border); }
  .step.active .dot {
    background: var(--warn, #d0a146);
    box-shadow: 0 0 0 3px rgba(208, 161, 70, 0.2);
  }
  .label {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .title {
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .step.tone-ok .title { color: var(--text-muted); text-decoration: line-through; }
  .why {
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .chip {
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--text-muted);
  }
  .step.tone-ok .chip { background: var(--ok-bg, #1a3a1f); color: var(--ok, #6fcf6f); }
  .step.tone-warn .chip { background: var(--warn-bg, #3a2c14); color: var(--warn, #d0a146); }
  .step.active .chip { background: var(--warn-bg, #3a2c14); color: var(--warn, #d0a146); }
  .linky {
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-1);
    text-decoration: underline;
    cursor: pointer;
    padding: 0 0 0 var(--s-1);
  }
  .linky:hover { color: var(--text); }
  :global([data-spec-section].flash) {
    outline: 2px solid var(--warn, #d0a146);
    outline-offset: 4px;
    transition: outline 0.2s ease-out;
  }
</style>
