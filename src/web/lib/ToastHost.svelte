<script lang="ts">
  import { CheckCircle2, Info, X, XCircle } from 'lucide-svelte'
  import { fly } from 'svelte/transition'
  import { dismiss, getToasts, type ToastKind } from './toast.svelte.js'

  const toasts = $derived(getToasts())

  function iconFor(kind: ToastKind) {
    if (kind === 'success') return CheckCircle2
    if (kind === 'error') return XCircle
    return Info
  }
</script>

{#if toasts.length}
  <div class="toast-host" role="region" aria-label="Notifications">
    {#each toasts as item (item.id)}
      {@const ToastIcon = iconFor(item.kind)}
      <div
        class={`toast toast-${item.kind}`}
        role={item.kind === 'error' ? 'alert' : 'status'}
        transition:fly={{ y: 8, opacity: 0.04, duration: 170 }}
      >
        <ToastIcon size={18} aria-hidden="true" />
        <p>{item.message}</p>
        <button type="button" aria-label="Dismiss notification" onclick={() => dismiss(item.id)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-host {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 1000;
    display: grid;
    width: min(380px, calc(100vw - 32px));
    gap: 10px;
    pointer-events: none;
  }

  .toast {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 10px 10px 10px 12px;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    color: var(--text);
    background:
      var(--glass-reflect-violet),
      var(--glass-reflect-mint),
      linear-gradient(180deg, color-mix(in srgb, white 5%, transparent), color-mix(in srgb, white 1.5%, transparent)),
      color-mix(in srgb, var(--glass-bg-strong) 86%, var(--glass-bg));
    box-shadow: var(--glass-shadow), var(--glass-etch);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    pointer-events: auto;
  }

  .toast p {
    min-width: 0;
    margin: 0;
    color: inherit;
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }

  .toast button {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 0;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .toast button:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--surface-3) 80%, transparent);
  }

  .toast-success {
    border-color: color-mix(in srgb, var(--ok) 24%, var(--glass-border));
  }

  .toast-success :global(svg:first-child) {
    color: var(--ok);
  }

  .toast-error {
    border-color: color-mix(in srgb, var(--danger) 30%, var(--glass-border));
  }

  .toast-error :global(svg:first-child) {
    color: var(--danger);
  }

  .toast-info,
  .toast-message {
    border-color: color-mix(in srgb, var(--accent) 24%, var(--glass-border));
  }

  .toast-info :global(svg:first-child),
  .toast-message :global(svg:first-child) {
    color: var(--accent);
  }
</style>
