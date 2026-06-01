<!--
  Stale-server warning. Polls /api/build-info every 5s; if the running
  server's loaded code is older than dist/cli.js on disk, render a sticky
  warning at the top of the viewport. The point: stop the silent failure
  where the user reloads the browser, sees no change, and assumes a fix
  didn't ship — when actually the running Node process is yesterday's
  binary because no one restarted `guildhall serve`.
-->
<script lang="ts">
  import AlertBand from '../../../packages/ui/src/components/AlertBand.svelte'

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
  let bannerEl = $state<HTMLDivElement | null>(null)

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

  function syncBannerHeight(): void {
    const height = visible && bannerEl ? `${bannerEl.offsetHeight}px` : '0px'
    document.documentElement.style.setProperty('--app-banner-h', height)
  }

  $effect(() => {
    syncBannerHeight()
    return () => {
      document.documentElement.style.setProperty('--app-banner-h', '0px')
    }
  })

  $effect(() => {
    if (!bannerEl) return
    const observer = new ResizeObserver(() => syncBannerHeight())
    observer.observe(bannerEl)
    return () => observer.disconnect()
  })
</script>

{#if visible}
  <div class="stale" bind:this={bannerEl}>
    <AlertBand
      tone="warn"
      role="alert"
      density="compact"
      ariaLabel="Restart needed"
    >
      <strong>Guildhall needs a restart to show recent code changes.</strong>
      <span>This local server is {ageMinutes} min behind the code on disk.</span>
      {#snippet actions()}
        <details class="hint">
          <summary>Show restart steps</summary>
          <div class="hint-steps">
            <code>kill {info?.pid}</code>
            <span>then</span>
            <code>guildhall serve</code>
            <span>and reload.</span>
          </div>
        </details>
        <button type="button" class="gh-notice-inline-dismiss" aria-label="Dismiss" onclick={() => (dismissed = true)}>×</button>
      {/snippet}
    </AlertBand>
  </div>
{/if}

<style>
  .stale {
    z-index: var(--z-banner);
  }
  .hint {
    min-width: 0;
    color: inherit;
    font-size: var(--fs-1);
    line-height: var(--lh-tight);
  }
  .hint[open] {
    padding-top: 2px;
  }
  .hint summary {
    cursor: pointer;
    list-style: none;
  }
  .hint summary::-webkit-details-marker {
    display: none;
  }
  .hint-steps {
    margin-top: 4px;
    display: flex;
    align-items: baseline;
    gap: var(--s-1);
    flex-wrap: wrap;
  }
  .hint code {
    background: var(--surface-warn-strong);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'SF Mono', monospace;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
</style>
