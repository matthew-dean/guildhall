<!-- Focused Settings shell: route + compose small panels. -->
<script lang="ts">
  import { untrack } from 'svelte'
  import NoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import Select from '../../lib/Select.svelte'
  import Stack from '../../lib/Stack.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import ProjectProvidersSection from './ProjectProvidersSection.svelte'
  import DeveloperToolsPanel from './settings/DeveloperToolsPanel.svelte'
  import OperatingProfilePanel from './settings/OperatingProfilePanel.svelte'
  import SettingsCoordinatorsPanel from './settings/SettingsCoordinatorsPanel.svelte'
  import SettingsIdentityPanel from './settings/SettingsIdentityPanel.svelte'
  import SettingsReadyPanel from './settings/SettingsReadyPanel.svelte'
  import { createSettingsStore } from './settings/settings-store.svelte.js'
  import type { DeliverySpine } from '../../lib/types.js'

  interface Props {
    subView?: string | null
    onMigrate?: () => void | Promise<void>
  }

  let { subView = null, onMigrate }: Props = $props()

  type SettingSection = 'ready' | 'delivery' | 'providers' | 'coordinators' | 'identity' | 'profile' | 'developer'

  const store = createSettingsStore(projectFetch)
  const settingsSections: Array<{ id: SettingSection; label: string }> = [
    { id: 'ready', label: 'Ready' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'providers', label: 'Providers' },
    { id: 'coordinators', label: 'Coordinators' },
    { id: 'identity', label: 'Identity' },
    { id: 'profile', label: 'Profile' },
    { id: 'developer', label: 'Developer' },
  ]
  const settingsSectionOptions = settingsSections.map(item => ({ value: item.id, label: item.label }))

  function normalizeSection(value: string | null | undefined): SettingSection {
    if (value === 'routing') return 'coordinators'
    if (value === 'advanced') return 'developer'
    if (settingsSections.some(item => item.id === value)) return value as SettingSection
    return 'ready'
  }

  const section = $derived(normalizeSection(subView))
  let deliverySpine = $state<DeliverySpine | null>(null)
  let deliverySpineError = $state<string | null>(null)
  const structureMoved = $derived(subView === 'graph' || subView === 'structure')
  const intelligenceMoved = $derived(subView === 'learning' || subView === 'reintake' || subView === 'facts')

  function settingsSectionHref(id: SettingSection): string {
    return projectActionHref(id === 'ready' ? '/settings/ready' : `/settings/${id}`)
  }

  $effect(() => {
    untrack(() => {
      void store.loadIdentity()
    })
  })

  $effect(() => {
    if (section !== 'delivery') return
    let cancelled = false
    async function loadDeliverySpine(): Promise<void> {
      try {
        const response = await projectFetch('/api/project/delivery-spine', { cache: 'no-store' })
        const body = await response.json().catch(() => ({})) as DeliverySpine & { error?: string }
        if (cancelled) return
        if (!response.ok || body.error) {
          deliverySpineError = body.error ?? `HTTP ${response.status}`
          deliverySpine = null
          return
        }
        deliverySpine = body
        deliverySpineError = null
      } catch (err) {
        if (cancelled) return
        deliverySpineError = err instanceof Error ? err.message : String(err)
        deliverySpine = null
      }
    }
    void loadDeliverySpine()
    return () => {
      cancelled = true
    }
  })

  function primitiveLabel(primitive: { id?: string; label?: string }): string {
    return primitive.label?.trim() || primitive.id || 'Primitive'
  }
</script>

{#if store.identity.initialized === null}
  <NoticeBand tone="neutral" role="status" label="Settings" title="Loading settings">
    <p>Fetching project setup state...</p>
  </NoticeBand>
{:else if !store.identity.initialized}
  <NoticeBand tone="warn" role="note" label="Settings" title="Project not initialized yet">
    {#snippet actions()}
      <Button variant="primary" onclick={() => nav(currentProjectHref('/setup'))}>Open setup wizard</Button>
    {/snippet}
    <p>Complete the setup wizard first.</p>
  </NoticeBand>
{:else}
  <div class="settings-shell">
  <Stack gap="4">
    <div class="settings-section-picker">
      <label class="settings-section-picker-label" for="settings-section-select">Section</label>
      <Select
        id="settings-section-select"
        ariaLabel="Settings section"
        value={section}
        options={settingsSectionOptions}
        onchange={(value) => nav(settingsSectionHref(value as SettingSection))}
      />
    </div>

    <Card className="settings-section-card" frosted>
      <nav class="settings-section-nav" aria-label="Settings sections">
        {#each settingsSections as item (item.id)}
          {@const active = section === item.id}
          <Button
            variant={active ? 'secondary' : 'ghost'}
            size="md"
            className="settings-section-button"
            aria-current={active ? 'page' : undefined}
            onclick={() => nav(settingsSectionHref(item.id))}
          >
            {item.label}
          </Button>
        {/each}
      </nav>
    </Card>

    {#if structureMoved}
      <NoticeBand tone="neutral" role="note" label="Project map" title="Map review moved out of Settings" density="compact">
        {#snippet actions()}
          <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/map'))}>Open Map</Button>
        {/snippet}
        <p>Project context is available from the compact Map when you need it.</p>
      </NoticeBand>
    {:else if intelligenceMoved}
      <NoticeBand tone="neutral" role="note" label="Project intelligence" title="Specialist review moved out of Settings" density="compact">
        {#snippet actions()}
          <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref(subView === 'facts' ? '/facts' : '/thread'))}>
            {subView === 'facts' ? 'Open Facts' : 'Open Threads'}
          </Button>
        {/snippet}
        <p>Facts, memory, and re-intake review no longer live inside Settings.</p>
      </NoticeBand>
    {:else if section === 'providers'}
      <ProjectProvidersSection />
    {:else if section === 'delivery'}
      <Card title="Delivery model" titleTag="h2">
        <Stack gap="4">
          {#if deliverySpineError}
            <p class="settings-muted">Could not load delivery settings: {deliverySpineError}</p>
          {:else if !deliverySpine}
            <p class="settings-muted">Loading delivery settings...</p>
          {:else}
            <section class="delivery-settings-section" aria-label="Drivers">
              <h3>Drivers</h3>
              {#if deliverySpine.model?.drivers?.length}
                <div class="delivery-settings-grid">
                  {#each deliverySpine.model.drivers as driver (`driver-${driver.id}`)}
                    <div class="delivery-settings-row">
                      <strong>{driver.label ?? driver.id}</strong>
                      <span>{driver.role ?? 'driver'}</span>
                      {#if driver.paths?.length}<small>{driver.paths.join(', ')}</small>{/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="settings-muted">No drivers recorded yet.</p>
              {/if}
            </section>

            <section class="delivery-settings-section" aria-label="Primitive registry">
              <h3>Primitive registry</h3>
              {#if deliverySpine.primitives?.length}
                <div class="delivery-settings-grid">
                  {#each deliverySpine.primitives as primitive (`primitive-${primitive.id}`)}
                    <div class="delivery-settings-row">
                      <strong>{primitiveLabel(primitive)}</strong>
                      <span>{primitive.kind ?? 'primitive'} · {primitive.status ?? 'unknown'}</span>
                      {#if primitive.paths?.length}<small>{primitive.paths.join(', ')}</small>{/if}
                      {#if primitive.proof?.length}<small>Proof: {primitive.proof.join(', ')}</small>{/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="settings-muted">No primitives recorded yet.</p>
              {/if}
            </section>
          {/if}
        </Stack>
      </Card>
    {:else if section === 'coordinators'}
      <SettingsCoordinatorsPanel />
    {:else if section === 'identity'}
      <SettingsIdentityPanel {store} />
    {:else if section === 'profile'}
      <OperatingProfilePanel {store} />
    {:else if section === 'developer'}
      <DeveloperToolsPanel {store} {onMigrate} />
    {:else}
      <SettingsReadyPanel {store} {onMigrate} />
    {/if}
  </Stack>
  </div>
{/if}

<style>
  .settings-shell {
    container-type: inline-size;
    max-inline-size: 72rem;
  }
  .settings-section-picker {
    display: none;
    gap: var(--gh-space-2);
    inline-size: 100%;
  }
  .settings-section-picker-label {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-medium);
    line-height: var(--gh-type-line-height-tight);
    text-transform: uppercase;
  }
  :global(.settings-section-card) {
    padding: var(--gh-space-2);
  }
  .settings-section-nav {
    display: grid;
    gap: var(--gh-space-2);
    grid-template-columns: repeat(auto-fit, minmax(min(9.5rem, 100%), 1fr));
    inline-size: 100%;
  }
  :global(.settings-section-button) {
    inline-size: 100%;
    justify-content: center;
    min-inline-size: 0;
    min-block-size: 38px;
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    color: var(--text-muted);
    box-shadow: none;
  }
  :global(.settings-section-button[aria-current='page']) {
    color: var(--text);
  }
  .delivery-settings-section {
    display: grid;
    gap: var(--gh-space-3);
  }
  .delivery-settings-section h3 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-section-title);
  }
  .delivery-settings-grid {
    display: grid;
    gap: var(--gh-space-2);
  }
  .delivery-settings-row {
    display: grid;
    gap: var(--gh-space-1);
    min-width: 0;
    padding: var(--gh-space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  .delivery-settings-row span,
  .delivery-settings-row small,
  .settings-muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .delivery-settings-row strong,
  .delivery-settings-row small {
    overflow-wrap: anywhere;
  }
  @container (max-width: 44rem) {
    .settings-section-picker {
      display: grid;
    }
    :global(.settings-section-card) {
      display: none;
    }
  }
</style>
