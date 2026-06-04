<script lang="ts">
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../../lib/Button.svelte'
  import Row from '../../../lib/Row.svelte'
  import { nav } from '../../../lib/nav.svelte.js'
  import { project } from '../../../lib/project.svelte.js'
  import { projectActionHref } from '../../../lib/project-routes.js'
  import StructureHelpTip from './StructureHelpTip.svelte'

  const review = $derived(project.detail?.structuralMapReview ?? null)
  const conflicts = $derived(review?.conflicts ?? [])
  const ignoredGitRoots = $derived(review?.ignoredGitRoots ?? [])
  const state = $derived(review?.state ?? 'draft')
  const stateTone = $derived(state === 'accepted' ? 'ok' : state === 'draft' ? 'warn' : 'neutral')
  const hasAuditDetails = $derived(conflicts.length > 0 || ignoredGitRoots.length > 0 || state !== 'accepted')
</script>

{#if review}
  <section class="setup-audit-section" aria-label="Setup audit">
    <div class="setup-audit-head">
      <div class="setup-audit-title">
        <span class="inline-heading">
          <h2>Setup audit</h2>
          <StructureHelpTip
            label="Setup audit"
            text="Setup audit keeps setup review evidence for history and corrections. The Project map above is the current task-start map."
          />
        </span>
        <p>
          {state === 'accepted'
            ? 'The setup map was accepted. Guildhall keeps review evidence here only when it may explain or correct the current map.'
            : 'The setup map still needs owner review before it should be treated as routing truth.'}
        </p>
      </div>
      <div class="setup-audit-status">
        <StatusPill label={state} tone={stateTone} />
      </div>
    </div>

    {#if hasAuditDetails}
      <details class="setup-audit-details">
        <summary>Show setup audit details</summary>
        <div class="setup-audit-body">
          <Row justify="between" align="center" gap="3" wrap>
            <p class="muted">
              {state === 'accepted'
                ? 'This record is audit context for the accepted setup map.'
                : 'Review the proposed map in Thread before using it as routing truth.'}
            </p>
            <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/thread'))}>Open Threads</Button>
          </Row>

          {#if conflicts.length}
            <section class="audit-note" aria-label="Map conflicts">
              <span class="inline-heading">
                <h3>Map conflicts</h3>
                <StructureHelpTip
                  label="Map conflicts"
                  text="Map conflicts are setup findings that disagreed with each other, such as two possible homes for the same work area. They are kept so outdated setup findings can be corrected."
                />
              </span>
              <ul class="mini-list">
                {#each conflicts.slice(0, 4) as conflict, i (`conflict-${i}`)}
                  <li>{conflict.summary ?? conflict.reason ?? conflict.id ?? 'Structural map conflict'}</li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if ignoredGitRoots.length}
            <section class="audit-note" aria-label="Ignored dependency folders">
              <span class="inline-heading">
                <h3>Ignored dependency folders</h3>
                <StructureHelpTip
                  label="Ignored dependency folders"
                  text="Guildhall found nested dependency or vendored folders while mapping the repo and skipped them on purpose. For Jess, node_modules is ignored so installed packages do not become fake work areas."
                />
              </span>
              <ul class="mini-list">
                {#each ignoredGitRoots.slice(0, 4) as root, i (`root-${i}`)}
                  <li>{root.path ?? root}</li>
                {/each}
              </ul>
            </section>
          {/if}
        </div>
      </details>
    {/if}
  </section>
{/if}

<style>
  .setup-audit-section {
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-3);
    border-block-start: 1px solid var(--border-muted);
  }

  .setup-audit-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--gh-space-3);
  }

  .setup-audit-title {
    display: grid;
    gap: var(--gh-space-1);
    min-width: 0;
  }

  .inline-heading {
    display: inline-flex;
    align-items: center;
    gap: var(--gh-space-1);
  }

  .setup-audit-title h2,
  .audit-note h3 {
    margin: 0;
    color: var(--text);
    line-height: var(--gh-type-line-height-tight);
  }

  .setup-audit-title h2 {
    font-size: var(--gh-type-size-4);
  }

  .audit-note h3 {
    font-size: var(--gh-type-size-body);
  }

  .setup-audit-title p,
  .muted,
  .mini-list {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  .setup-audit-status {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--gh-space-2);
  }

  .setup-audit-details {
    border: 1px solid var(--border-muted);
    border-radius: var(--gh-radius-1);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
  }

  .setup-audit-details > summary {
    cursor: pointer;
    padding: var(--gh-space-2) var(--gh-space-3);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }

  .setup-audit-details > summary:hover {
    color: var(--text);
    background: var(--bg-raised);
  }

  .setup-audit-body {
    display: grid;
    gap: var(--gh-space-3);
    padding: var(--gh-space-3);
    border-block-start: 1px solid var(--border-muted);
  }

  .audit-note {
    display: grid;
    gap: var(--gh-space-2);
  }

  .mini-list {
    padding-inline-start: var(--gh-space-4);
  }

  @media (max-width: 760px) {
    .setup-audit-head {
      display: grid;
    }

    .setup-audit-status {
      justify-content: flex-start;
    }
  }
</style>
