<!--
  Experts tab: surfaces the guild personas at the table for this task, their
  review verdicts (one per persona, strict-all aggregation), and the guild-
  attributed gate results. Calls /api/project/task/:id/experts.
-->
<script lang="ts">
  import Stack from '../../lib/Stack.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import type { ReviewVerdict, GateResult } from '../../lib/types.js'

  interface Props {
    taskId: string
  }

  interface Expert {
    slug: string
    name: string
    role: 'engineer' | 'designer' | 'specialist' | 'overseer'
    blurb: string
  }

  interface ExpertsPayload {
    primaryEngineer: string | null
    applicable: Expert[]
    reviewers: Array<{ slug: string; name: string; role: Expert['role'] }>
    verdictsBySlug: Record<string, ReviewVerdict[]>
    gateResultsBySlug: Record<string, GateResult[]>
    warnings: string[]
  }

  let { taskId }: Props = $props()

  let payload = $state<ExpertsPayload | null>(null)
  let error = $state<string | null>(null)

  async function load() {
    try {
      const res = await fetch(
        `/api/project/task/${encodeURIComponent(taskId)}/experts`,
      )
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        error = b.error ?? `HTTP ${res.status}`
        return
      }
      payload = (await res.json()) as ExpertsPayload
      error = null
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void taskId
    payload = null
    void load()
  })

  const roleTone: Record<Expert['role'], 'neutral' | 'accent' | 'ok' | 'warn'> = {
    engineer: 'accent',
    designer: 'ok',
    specialist: 'warn',
    overseer: 'neutral',
  }

  function verdictTone(v?: string): 'ok' | 'warn' | 'neutral' {
    if (v === 'approve') return 'ok'
    if (v === 'revise') return 'warn'
    return 'neutral'
  }

  const reviewerSlugs = $derived(
    new Set((payload?.reviewers ?? []).map(r => r.slug)),
  )
</script>

{#if error}
  <Card title="Experts" tone="warn">
    <p class="muted">Failed to load: {error}</p>
  </Card>
{:else if !payload}
  <Card title="Experts">
    <p class="muted">Loading…</p>
  </Card>
{:else if payload.applicable.length === 0}
  <Card title="Experts">
    <p class="muted">No personas applicable for this task.</p>
  </Card>
{:else}
  <Stack gap="4">
    {#if payload.warnings.length > 0}
      <Card title="Composition warnings" tone="warn">
        <ul>
          {#each payload.warnings as w (w)}<li>{w}</li>{/each}
        </ul>
      </Card>
    {/if}

    <Card title="At the table ({payload.applicable.length})">
      <Stack gap="2">
        {#each payload.applicable as expert (expert.slug)}
          {@const verdicts = payload.verdictsBySlug[expert.slug] ?? []}
          {@const gates = payload.gateResultsBySlug[expert.slug] ?? []}
          {@const isPrimary = payload.primaryEngineer === expert.slug}
          {@const isReviewer = reviewerSlugs.has(expert.slug)}
          <article class="expert">
            <header>
              <span class="name">{expert.name}</span>
              <Chip label={expert.role} tone={roleTone[expert.role]} />
              {#if isPrimary}
                <Chip label="primary" tone="accent" />
              {/if}
              {#if isReviewer}
                <Chip label="reviewer" tone="neutral" />
              {/if}
            </header>
            <p class="blurb">{expert.blurb}</p>

            {#if verdicts.length > 0}
              <section class="verdicts">
                <h4>Verdicts ({verdicts.length})</h4>
                <Stack gap="2">
                  {#each verdicts as v, i (`${expert.slug}-v-${i}`)}
                    <article class="verdict">
                      <header>
                        <Chip
                          label={v.verdict ?? 'unknown'}
                          tone={verdictTone(v.verdict)}
                        />
                        <span class="path">{v.reviewerPath ?? 'llm'}</span>
                        <time>{v.recordedAt ?? ''}</time>
                      </header>
                      {#if v.reason}<p class="reason">{v.reason}</p>{/if}
                      {#if v.reasoning}<Markdown source={v.reasoning} />{/if}
                    </article>
                  {/each}
                </Stack>
              </section>
            {/if}

            {#if gates.length > 0}
              <section class="gates">
                <h4>Gate results ({gates.length})</h4>
                <Stack gap="2">
                  {#each gates as g, i (`${expert.slug}-g-${i}`)}
                    <article class="gate">
                      <header>
                        <span class="id">{g.gateId ?? '—'}</span>
                        <Chip
                          label={g.passed ? 'pass' : 'fail'}
                          tone={g.passed ? 'ok' : 'danger'}
                        />
                        <time>{g.checkedAt ?? ''}</time>
                      </header>
                      {#if g.output}<pre>{g.output}</pre>{/if}
                    </article>
                  {/each}
                </Stack>
              </section>
            {/if}

            {#if verdicts.length === 0 && gates.length === 0}
              <p class="muted">No verdicts or gate results yet.</p>
            {/if}
          </article>
        {/each}
      </Stack>
    </Card>

    {#if (payload.verdictsBySlug['unattributed']?.length ?? 0) + (payload.gateResultsBySlug['unattributed']?.length ?? 0) > 0}
      <Card title="Unattributed">
        <Stack gap="2">
          {#each payload.gateResultsBySlug['unattributed'] ?? [] as g, i (`u-g-${i}`)}
            <article class="gate">
              <header>
                <span class="id">{g.gateId ?? '—'}</span>
                <Chip
                  label={g.passed ? 'pass' : 'fail'}
                  tone={g.passed ? 'ok' : 'danger'}
                />
                <time>{g.checkedAt ?? ''}</time>
              </header>
              {#if g.output}<pre>{g.output}</pre>{/if}
            </article>
          {/each}
          {#each payload.verdictsBySlug['unattributed'] ?? [] as v, i (`u-v-${i}`)}
            <article class="verdict">
              <header>
                <Chip
                  label={v.verdict ?? 'unknown'}
                  tone={verdictTone(v.verdict)}
                />
                <span class="path">{v.reviewerPath ?? 'llm'}</span>
                <time>{v.recordedAt ?? ''}</time>
              </header>
              {#if v.reason}<p class="reason">{v.reason}</p>{/if}
            </article>
          {/each}
        </Stack>
      </Card>
    {/if}
  </Stack>
{/if}

<style>
  .expert {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .expert header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .expert .name {
    font-weight: 700;
    font-size: var(--fs-2);
    color: var(--text);
  }
  .blurb {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .verdicts h4,
  .gates h4 {
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-muted);
    margin: var(--s-2) 0 var(--s-2);
  }
  .verdict,
  .gate {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .verdict header,
  .gate header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .gate header .id,
  .verdict header .path {
    color: var(--text);
  }
  .gate header time,
  .verdict header time {
    margin-left: auto;
  }
  .reason {
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  pre {
    background: var(--bg-raised-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: var(--s-2);
    font-size: var(--fs-0);
    font-family: 'SF Mono', monospace;
    white-space: pre-wrap;
    color: var(--text);
    line-height: var(--lh-body);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  ul {
    padding-left: var(--s-3);
    font-size: var(--fs-1);
    color: var(--text);
  }
</style>
