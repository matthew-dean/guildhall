<script lang="ts">
  import { untrack } from 'svelte'
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Button from '../../../lib/Button.svelte'
  import Row from '../../../lib/Row.svelte'
  import Stack from '../../../lib/Stack.svelte'
  import UtilityPanel from '../../../lib/UtilityPanel.svelte'
  import { OPERATING_PROFILES, type OperatingProfile } from '@guildhall/levers'
  import type { Lever } from './types.js'
  import type { SettingsStore } from './settings-store.svelte.js'

  interface Props {
    store: SettingsStore
  }

  let { store }: Props = $props()

  $effect(() => {
    untrack(() => {
      void store.loadProfile()
    })
  })

  const levers = $derived(store.profile.levers ?? [])
  const changedOverrides = $derived(levers.filter(lever => lever.setBy !== 'system-default'))
  const activeProfile = $derived(resolveActiveProfile(levers))

  function resolveActiveProfile(items: Lever[]): OperatingProfile {
    const byName = new Map(items.map(lever => [lever.name, lever.position]))
    const matches = OPERATING_PROFILES
      .filter(profile => Object.entries(profile.leverPositions).every(([name, position]) => byName.get(name) === position))
      .sort((a, b) => Object.keys(b.leverPositions).length - Object.keys(a.leverPositions).length)
    return matches[0] ?? OPERATING_PROFILES[0]!
  }

  function humanizeLeverName(name: string): string {
    return name.replace(/[_.-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
  }

  function humanizeLeverPosition(position: string): string {
    return position.replaceAll('_', ' ')
  }
</script>

<SectionHeader
  eyebrow="Settings"
  title="Operating profile"
  description="Use named project behavior instead of scanning every lever by default."
  headingTag="h2"
  density="compact"
>
  {#snippet meta()}
    <StatusPill label={activeProfile.label} tone="ok" />
    <StatusPill label={`${changedOverrides.length} override${changedOverrides.length === 1 ? '' : 's'}`} tone={changedOverrides.length > 0 ? 'warn' : 'neutral'} />
  {/snippet}
</SectionHeader>

<Stack gap="4">
  {#if store.profile.error}
    <NoticeBand tone="danger" role="alert" label="Profile" title="Could not load operating profile" density="compact">
      {#snippet actions()}
        <Button variant="secondary" size="sm" onclick={store.resetLevers}>Reset project overrides</Button>
      {/snippet}
      <p>{store.profile.error}</p>
    </NoticeBand>
  {:else if !store.profile.levers}
    <NoticeBand tone="neutral" role="status" label="Profile" title="Loading operating profile" density="compact">
      <p>Reading project behavior settings...</p>
    </NoticeBand>
  {:else}
    <FrameCard class="profile-card" density="compact">
      {#snippet header()}
        <SectionHeader title={activeProfile.label} description={activeProfile.summary} headingTag="h3" density="dense" />
      {/snippet}

      <div class="profile-grid">
        {#each OPERATING_PROFILES as profile (profile.id)}
          <UtilityPanel as="article" className="profile-option" tone={profile.id === activeProfile.id ? 'ok' : 'neutral'}>
            <strong>{profile.label}</strong>
            <p>{profile.summary}</p>
          </UtilityPanel>
        {/each}
      </div>
    </FrameCard>

    <FrameCard class="profile-card" density="compact">
      {#snippet header()}
        <SectionHeader title="Changed overrides" description="Only project-specific differences are shown here." headingTag="h3" density="dense">
          {#snippet meta()}
            <StatusPill label={`${changedOverrides.length}`} tone={changedOverrides.length > 0 ? 'warn' : 'neutral'} />
          {/snippet}
        </SectionHeader>
      {/snippet}

      {#if changedOverrides.length === 0}
        <p class="muted">This project is using global defaults.</p>
      {:else}
        <div class="override-list">
          {#each changedOverrides as lever (`${lever.scope}:${lever.name}`)}
            <UtilityPanel as="article" className="override-row" tone={lever.setBy === 'user-direct' ? 'warn' : 'neutral'}>
              <div>
                <strong>{humanizeLeverName(lever.name)}</strong>
                <span>{lever.scope.replace('domain:', 'Domain: ')}</span>
              </div>
              <StatusPill label={humanizeLeverPosition(lever.position)} tone="neutral" />
            </UtilityPanel>
          {/each}
        </div>
      {/if}

      <Row justify="end">
        <Button variant="secondary" size="sm" onclick={store.resetLevers}>Reset project overrides</Button>
      </Row>
    </FrameCard>
  {/if}
</Stack>

<style>
  .profile-grid,
  .override-list {
    display: grid;
    gap: var(--gh-space-2);
  }
  :global(.profile-option),
  :global(.override-row) {
    display: grid;
    gap: var(--gh-space-1);
  }
  :global(.override-row) {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  :global(.profile-option) p,
  .muted,
  :global(.override-row) span {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  @container (min-width: 52rem) {
    .profile-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
