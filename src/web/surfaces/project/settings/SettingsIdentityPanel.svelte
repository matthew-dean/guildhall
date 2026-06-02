<script lang="ts">
  import { untrack } from 'svelte'
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import Button from '../../../lib/Button.svelte'
  import Input from '../../../lib/Input.svelte'
  import Row from '../../../lib/Row.svelte'
  import Stack from '../../../lib/Stack.svelte'
  import Textarea from '../../../lib/Textarea.svelte'
  import type { SettingsStore } from './settings-store.svelte.js'

  interface Props {
    store: SettingsStore
  }

  let { store }: Props = $props()

  $effect(() => {
    untrack(() => {
      void store.loadIdentity()
    })
  })

  const identity = $derived(store.identity)
</script>

<SectionHeader
  eyebrow="Settings"
  title="Project identity"
  description="Name, slug, and the local config files task worktrees may receive."
  headingTag="h2"
  density="compact"
/>

<div class="identity-grid">
  <FrameCard class="identity-card" density="compact">
    {#snippet header()}
      <SectionHeader
        title="Workspace identity"
        description="Operator-facing name and slug for this project."
        headingTag="h3"
        density="dense"
      />
    {/snippet}

    <Stack gap="3">
      <label class="field">
        <span>Workspace name</span>
        <Input value={identity.name} oninput={store.setIdentityName} />
      </label>
      <label class="field">
        <span>Workspace ID (slug)</span>
        <Input value={identity.id} oninput={store.setIdentityId} />
      </label>
      <Row justify="start" gap="2" align="center" wrap>
        {#if store.identityStatus}
          <span class="status" class:error={store.identityStatus.error}>{store.identityStatus.text}</span>
        {/if}
        <Button variant="primary" disabled={store.savingIdentity} onclick={store.saveIdentity}>
          Save identity
        </Button>
      </Row>
    </Stack>
  </FrameCard>

  <FrameCard class="identity-card identity-card-wide" density="compact">
    {#snippet header()}
      <SectionHeader
        title="Task worktree local files"
        description="Root-relative files or directories Guildhall may copy into isolated task worktrees before bootstrap."
        headingTag="h3"
        density="dense"
      />
    {/snippet}

    <Stack gap="3">
      <NoticeBand tone="neutral" role="note" label="Worktrees" title="Opt in local runtime config" density="compact">
        <p>
          Use this for files like <code>.env</code>, <code>.env.local</code>, or
          <code>appsettings.local.yaml</code> when workers need them to run local setup.
          Guildhall detects likely filenames, but only copies the paths listed here.
        </p>
      </NoticeBand>
      {#if identity.worktreeIncludeScopes.length > 1}
        <div class="candidate-list" aria-label="Workspace project worktree settings">
          {#each identity.worktreeIncludeScopes as scope (scope.projectId ?? scope.rootPath)}
            <Button
              size="sm"
              variant={(scope.projectId ?? null) === identity.selectedWorktreeProjectId ? 'secondary' : 'ghost'}
              title={scope.rootPath}
              onclick={() => store.selectWorktreeIncludeScope(scope)}
            >
              {scope.label ?? scope.projectId ?? 'Workspace'}
            </Button>
          {/each}
        </div>
      {/if}
      {#if identity.worktreeIncludeCandidates.length > 0}
        <div class="candidate-list" aria-label="Detected local config candidates">
          {#each identity.worktreeIncludeCandidates.slice(0, 6) as candidate (candidate.path)}
            <Button
              size="sm"
              variant={identity.worktreeIncludeText.split(/\r?\n/).map(line => line.trim()).includes(candidate.path) ? 'secondary' : 'ghost'}
              title={candidate.reason}
              onclick={() => store.addWorktreeIncludeCandidate(candidate.path)}
            >
              {candidate.path}
            </Button>
          {/each}
        </div>
      {/if}
      <label class="field">
        <span>Include in task worktrees</span>
        <Textarea
          value={identity.worktreeIncludeText}
          rows={5}
          spellcheck="false"
          placeholder=".env&#10;appsettings.local.yaml&#10;config/local/**"
          oninput={store.setWorktreeIncludeText}
        />
      </label>
      <Row justify="start" gap="2" align="center" wrap>
        {#if store.worktreeIncludeStatus}
          <span class="status" class:error={store.worktreeIncludeStatus.error}>{store.worktreeIncludeStatus.text}</span>
        {/if}
        <Button variant="primary" disabled={store.worktreeIncludeBusy} onclick={store.saveWorktreeIncludes}>
          {store.worktreeIncludeBusy ? 'Saving...' : 'Save worktree files'}
        </Button>
      </Row>
    </Stack>
  </FrameCard>
</div>

<style>
  .identity-grid {
    display: grid;
    gap: var(--gh-space-4);
    max-inline-size: 62rem;
  }
  .field {
    display: grid;
    gap: var(--gh-space-1);
  }
  .field > span:first-child {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .candidate-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
  }
  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }
  .status.error {
    color: var(--danger);
  }
</style>
