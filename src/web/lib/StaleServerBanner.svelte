<!--
  Stale-server warning. Polls /api/build-info every 5s; if the running
  server's loaded code is older than dist/cli.js on disk, render a sticky
  warning at the top of the viewport. The point: stop the silent failure
  where the user reloads the browser, sees no change, and assumes a fix
  didn't ship — when actually the running Node process is yesterday's
  binary because no one restarted `guildhall serve`.
-->
<script lang="ts">
  interface BuildInfo {
    pid: number
    processStartedAt: string
    bootBuildMtimeMs: number
    currentBuildMtimeMs: number
    stale: boolean
    distPath: string | null
  }

  let info = $state<BuildInfo | null>(null)
  let dismissed = $state(false)

  async function poll(): Promise<void> {
    try {
      const r = await fetch('/api/build-info', { cache: 'no-store' })
      if (!r.ok) return
      info = (await r.json()) as BuildInfo
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    void poll()
    const id = setInterval(() => void poll(), 5000)
    return () => clearInterval(id)
  })

  const visible = $derived(info?.stale === true && !dismissed)
  const ageMinutes = $derived.by(() => {
    if (!info) return 0
    const diffMs = info.currentBuildMtimeMs - info.bootBuildMtimeMs
    return Math.max(0, Math.round(diffMs / 60000))
  })
</script>

{#if visible}
  <div class="stale" role="alert">
    <div class="copy">
      <div class="msg">
        <strong>Restart guildhall serve.</strong>
        <span>{ageMinutes} min behind the code on disk.</span>
      </div>
      <div class="hint">
        <code>kill {info?.pid}</code>
        <span>then</span>
        <code>guildhall serve</code>
        <span>and reload.</span>
      </div>
    </div>
    <button type="button" class="x" onclick={() => (dismissed = true)} aria-label="Dismiss">
      ×
    </button>
  </div>
{/if}

<style>
  .stale {
    position: sticky;
    top: 0;
    z-index: 9999;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: var(--warn-bg, #3a2c14);
    color: var(--warn, #d0a146);
    border-bottom: 1px solid var(--warn, #d0a146);
    font-size: var(--fs-1);
  }
  .copy {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .msg {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    flex-wrap: wrap;
    line-height: var(--lh-tight);
  }
  .msg strong,
  .msg span {
    min-width: 0;
  }
  .hint {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--s-1);
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-tight);
  }
  .hint code {
    background: var(--bg);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'SF Mono', monospace;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .x {
    background: none;
    border: none;
    color: var(--warn, #d0a146);
    font-size: 18px;
    cursor: pointer;
    padding: 0 var(--s-1);
    line-height: 1;
  }
  .x:hover { color: var(--text); }

  @media (max-width: 640px) {
    .stale {
      padding: var(--s-2);
    }
    .copy {
      display: grid;
      gap: 4px;
    }
    .msg {
      display: grid;
      gap: 2px;
    }
    .hint {
      gap: 4px;
    }
  }
</style>
