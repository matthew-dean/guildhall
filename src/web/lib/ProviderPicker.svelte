<!--
  Provider picker shared by the Setup wizard and the Providers page.
  Parent supplies the full providers map and controls the selected key.
-->
<script lang="ts">
  import Input from './Input.svelte'

  interface ProviderMeta {
    label: string
    detail: string
    detected: boolean
    url?: string
    baseUrl?: string | null
  }

  type Providers = Record<string, ProviderMeta>

  interface Props {
    providers: Providers
    selected: string | null
    onselect: (key: string) => void
    /** Set only by the Providers page — the caller wants the API key / URL */
    apiKey?: string
    openaiBaseUrl?: string
    llamaUrl?: string
    onApiKeyChange?: (v: string) => void
    onOpenAiBaseUrlChange?: (v: string) => void
    onLlamaUrlChange?: (v: string) => void
  }

  let {
    providers,
    selected,
    onselect,
    apiKey = '',
    openaiBaseUrl = '',
    llamaUrl = '',
    onApiKeyChange,
    onOpenAiBaseUrlChange,
    onLlamaUrlChange,
  }: Props = $props()

  const ORDER = ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp']

  const rows = $derived(
    ORDER.filter(k => providers[k]).map(k => ({ key: k, meta: providers[k] })),
  )
</script>

<div class="list">
  {#each rows as row (row.key)}
    <button
      type="button"
      class="row"
      class:selected={row.key === selected}
      onclick={() => onselect(row.key)}
    >
      <span class="radio" aria-hidden="true"></span>
      <span class="body">
        <span class="label">{row.meta.label}</span>
        <span class="detail">{row.meta.detail}</span>
      </span>
      <span class="chip" class:ok={row.meta.detected} class:missing={!row.meta.detected}>
        {row.meta.detected ? 'ready' : 'not found'}
      </span>
    </button>
  {/each}
</div>

{#if selected === 'anthropic-api' || selected === 'openai-api'}
  <label class="field-label" for="pp-key">
    API key (stored globally in <code>~/.guildhall/providers.yaml</code>)
  </label>
  <Input
    id="pp-key"
    type="password"
    placeholder="sk-…"
    value={apiKey}
    oninput={(v) => onApiKeyChange?.(v)}
  />
  {#if selected === 'openai-api'}
    <label class="field-label" for="pp-openai-url">
      Base URL (optional; blank uses real OpenAI)
    </label>
    <Input
      id="pp-openai-url"
      placeholder="https://api.openai.com/v1"
      value={openaiBaseUrl || providers['openai-api']?.baseUrl || ''}
      oninput={(v) => onOpenAiBaseUrlChange?.(v)}
    />
  {/if}
{:else if selected === 'llama-cpp'}
  <label class="field-label" for="pp-url">OpenAI-compatible local server URL</label>
  <Input
    id="pp-url"
    value={llamaUrl || providers['llama-cpp']?.url || 'http://localhost:1234/v1'}
    oninput={(v) => onLlamaUrlChange?.(v)}
  />
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: var(--text);
    width: 100%;
  }
  .row:hover {
    border-color: var(--accent);
  }
  .row.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg));
  }
  .radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--border);
    flex-shrink: 0;
  }
  .row.selected .radio {
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
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .detail {
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .chip {
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px var(--s-2);
    border-radius: 10px;
  }
  .chip.ok {
    background: rgba(78, 204, 163, 0.15);
    color: var(--accent-2);
  }
  .chip.missing {
    background: rgba(136, 136, 153, 0.12);
    color: var(--text-muted);
  }
  .field-label {
    display: block;
    font-size: var(--fs-1);
    color: var(--text-muted);
    margin-top: var(--s-3);
    margin-bottom: var(--s-1);
  }
  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--fs-1);
  }
</style>
