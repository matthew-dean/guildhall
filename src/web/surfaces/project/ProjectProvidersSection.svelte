<!--
  Project-level providers sub-tab: SELECT which configured provider this
  project should prefer. Credentials live globally (~/.guildhall/providers.yaml)
  — this view is read-only for credentials and only writes
  `preferredProvider` to the project's private .guildhall/config.yaml override.

  Providers that aren't configured globally are shown disabled with a hint
  to open the global /providers page.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import CardList from '../../lib/CardList.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Row from '../../lib/Row.svelte'
  import Select from '../../lib/Select.svelte'
  import Stack from '../../lib/Stack.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { projectFetch } from '../../lib/project-routes.js'

  interface ProviderMeta {
    label: string
    detail: string
    detected: boolean
    verifiedAt: string | null
    url?: string
  }
  interface ModelCatalogItem {
    id: string
    provider: string
    notes: string
  }
  interface ModelConfig {
    globalModels: Record<string, string>
    projectModels: Record<string, string>
    effectiveModels: Record<string, string>
    loadedModels: string[]
    missingModels: string[]
    catalog: ModelCatalogItem[]
  }

  const ORDER = ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp']
  const MODEL_ROLES = [
    { id: 'spec', label: 'Spec author' },
    { id: 'coordinator', label: 'Coordinator' },
    { id: 'worker', label: 'Worker' },
    { id: 'reviewer', label: 'Reviewer' },
    { id: 'gateChecker', label: 'Gate checker' },
    { id: 'contextIndexer', label: 'Context indexer' },
  ]

  let providers = $state<Record<string, ProviderMeta> | null>(null)
  let models = $state<ModelConfig | null>(null)
  let modelsError = $state<string | null>(null)
  let preferred = $state<string | null>(null)
  let originalPreferred = $state<string | null>(null)
  let loadError = $state<string | null>(null)
  let saving = $state(false)
  let status = $state<{ text: string; error: boolean } | null>(null)

  async function load() {
    try {
      const r = await projectFetch('/api/setup/providers')
      const j = await r.json()
      if (j.error) {
        loadError = j.error
        return
      }
      providers = j.providers as Record<string, ProviderMeta>
      preferred = j.preferredProvider ?? null
      originalPreferred = preferred
      await reloadModels()
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  async function reloadModels(): Promise<boolean> {
    const modelRes = await projectFetch('/api/config/models')
    const modelJson = await modelRes.json().catch(() => ({}))
    if (!modelRes.ok || modelJson.error) {
      modelsError = modelJson.error ?? `Model reload failed (HTTP ${modelRes.status})`
      flash(modelsError, true)
      return false
    }
    modelsError = null
    models = modelJson as ModelConfig
    return true
  }

  $effect(() => {
    void load()
  })

  function flash(text: string, error: boolean) {
    status = { text, error }
    setTimeout(() => {
      if (status?.text === text) status = null
    }, 2500)
  }

  async function save() {
    if (!preferred) return flash('Pick a provider first', true)
    saving = true
    try {
      const r = await projectFetch('/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredProvider: preferred }),
      })
      const j = await r.json()
      if (j.error) return flash(j.error, true)
      originalPreferred = preferred
      flash('Saved', false)
    } finally {
      saving = false
    }
  }

  async function saveModel(role: string, scope: 'project' | 'global-default', model?: string) {
    saving = true
    try {
      const r = await projectFetch('/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role,
          scope,
          ...(model ? { model } : {}),
        }),
      })
      const j = await r.json()
      if (j.error) return flash(j.error, true)
      const reloaded = await reloadModels()
      if (!reloaded) return
      flash(scope === 'global-default' ? 'Using global default' : 'Override saved', false)
    } finally {
      saving = false
    }
  }

  const dirty = $derived(preferred !== originalPreferred)
</script>

<Stack gap="4">
<Card title="Project provider">
  <Stack gap="3">
    <p class="muted">
      Pick which configured provider this project should use by default.
      Credentials are machine-scoped — manage them in
      <button type="button" class="inline-link" onclick={() => nav('/providers')}>
        global Providers
      </button>.
    </p>

    {#if loadError}
      <p class="error">{loadError}</p>
    {:else if !providers}
      <p class="muted">Loading...</p>
    {:else}
      <CardList className="list">
        {#each ORDER.filter(k => providers?.[k]) as key (key)}
          {@const meta = providers[key]}
          {@const disabled = !meta.detected}
          <CardListItem
            as="button"
            className="provider-row"
            selected={preferred === key}
            disabled={disabled}
            tone={preferred === key ? 'accent' : 'neutral'}
            railTone={preferred === key ? 'accent' : disabled ? 'warn' : null}
            railStrength={preferred === key ? 'strong' : 'subtle'}
            onclick={() => (preferred = key)}
          >
            <span class="radio" aria-hidden="true"></span>
            <span class="body">
              <span class="label">{meta.label}</span>
              <span class="detail">
                {disabled ? 'Not configured globally — set up credentials in global Providers first.' : meta.detail}
              </span>
            </span>
            {#if meta.verifiedAt}
              <Chip label="verified" tone="ok" />
            {:else if meta.detected}
              <Chip label="configured" tone="ok" />
            {:else}
              <Chip label="unavailable" tone="warn" />
            {/if}
          </CardListItem>
        {/each}
      </CardList>

      <Row justify="end" gap="2" align="center">
        {#if status}
          <span class="status" class:error={status.error}>{status.text}</span>
        {/if}
        <Button variant="primary" disabled={saving || !dirty || !preferred} onclick={save}>
          {saving ? 'Saving...' : 'Save selection'}
        </Button>
      </Row>
    {/if}
  </Stack>
</Card>

<Card title="Project model overrides">
  <Stack gap="3">
    <p class="muted">
      Use the global model defaults unless this project needs something different.
    </p>
    {#if models?.missingModels?.length}
      <UtilityPanel as="div" className="model-warning" tone="warn" railStrength="strong" role="status">
        <strong>Model not loaded.</strong>
        <span>
          The configured local server reports {models.loadedModels.length ? models.loadedModels.join(', ') : 'no loaded models'}.
          Load {models.missingModels.join(', ')} or override this project to a loaded model.
        </span>
      </UtilityPanel>
    {/if}

    {#if modelsError}
      <p class="error">{modelsError}</p>
    {:else if !models}
      <p class="muted">Loading...</p>
    {:else}
      <CardList className="model-list">
        {#each MODEL_ROLES as role (role.id)}
          {@const overridden = Boolean(models.projectModels[role.id])}
          {@const effective = models.effectiveModels[role.id] ?? models.globalModels[role.id] ?? ''}
          <CardListItem as="div" className="model-row" tone={overridden ? 'accent' : 'neutral'}>
            <div class="model-copy">
              <span class="label">{role.label}</span>
              <span class="detail">
                {overridden ? 'Project override' : `Global default${models.globalModels[role.id] ? `: ${models.globalModels[role.id]}` : ''}`}
              </span>
            </div>
            <Select
              ariaLabel={`${role.label} scope`}
              value={overridden ? 'project' : 'global-default'}
              options={[
                { value: 'global-default', label: 'Use global default' },
                { value: 'project', label: 'Override for this project' },
              ]}
              onchange={(scope) => {
                const nextScope = scope as 'project' | 'global-default'
                void saveModel(role.id, nextScope, nextScope === 'project' ? effective : undefined)
              }}
            />
            <Select
              ariaLabel={`${role.label} model`}
              disabled={!overridden}
              value={effective}
              options={[
                ...models.catalog.map(item => ({ value: item.id, label: item.id })),
                ...(effective && !models.catalog.some(item => item.id === effective)
                  ? [{ value: effective, label: effective }]
                  : []),
              ]}
              onchange={(value) => void saveModel(role.id, 'project', value)}
            />
          </CardListItem>
        {/each}
      </CardList>
    {/if}
  </Stack>
</Card>
</Stack>

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .error {
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
  }
  .inline-link {
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  :global(.list) {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  :global(.provider-row) {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    text-align: left;
    font: inherit;
    color: var(--text);
    width: 100%;
  }
  .radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--border);
    flex-shrink: 0;
  }
  :global(.provider-row.is-selected) .radio {
    border-color: var(--accent);
    background: radial-gradient(circle, var(--accent) 35%, transparent 40%);
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
  }
  .detail {
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }
  .status {
    font-size: var(--gh-type-size-meta);
    color: var(--accent-2);
  }
  .status.error {
    color: var(--danger);
  }
  :global(.model-list) {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  :global(.model-row) {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(150px, 190px) minmax(220px, 1.2fr);
    gap: var(--s-2);
    align-items: center;
  }
  .model-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  :global(.model-row) :global(.select) {
    min-width: 0;
  }
  :global(.model-warning) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  @media (max-width: 780px) {
    :global(.model-row) {
      grid-template-columns: 1fr;
    }
  }
</style>
