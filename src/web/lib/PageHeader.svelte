<!--
  Slim header for full-screen takeover pages (Providers, Setup wizard, etc.)
  so the user always has an obvious way back. Not used on project-scoped
  pages — those already get the left rail for orientation.
-->
<script lang="ts">
  import Icon from './Icon.svelte'
  import Help from './Help.svelte'
  import { nav } from './nav.svelte.js'

  interface Props {
    title: string
    /** Route to go to when Back is clicked. Defaults to history.back(); falls back to /inbox. */
    backHref?: string
    /** Route to go to when Close is clicked. Defaults to /inbox. */
    closeHref?: string
    /** Hide the Back control (use on true-root pages like first-run setup). */
    hideBack?: boolean
    /** Optional help-topic slug to render a HelpCircle next to the title. */
    helpTopic?: string
  }

  let { title, backHref, closeHref = '/', hideBack = false, helpTopic }: Props = $props()

  function handleBack() {
    if (backHref) {
      nav(backHref)
      return
    }
    if (window.history.length > 1) {
      window.history.back()
      return
    }
    nav('/')
  }
</script>

<header class="gh-page-head">
  <div class="gh-page-head-left">
    {#if !hideBack}
      <button type="button" class="gh-page-head-btn" onclick={handleBack} aria-label="Back">
        <Icon name="arrow-left" size={18} />
        <span>Back</span>
      </button>
    {/if}
  </div>
  <h1 class="gh-page-head-title">
    {title}
    {#if helpTopic}<Help topic={helpTopic} size={14} />{/if}
  </h1>
  <div class="gh-page-head-right">
    <button type="button" class="gh-page-head-btn icon-only" onclick={() => nav(closeHref)} aria-label="Close">
      <Icon name="x" size={18} />
    </button>
  </div>
</header>

<style>
  .gh-page-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .gh-page-head-left {
    justify-self: start;
  }
  .gh-page-head-right {
    justify-self: end;
  }
  .gh-page-head-title {
    margin: 0;
    font-size: var(--fs-3);
    font-weight: 600;
    color: var(--text);
    justify-self: center;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gh-page-head-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 6px var(--s-2);
    border-radius: var(--r-1);
    font: inherit;
    font-size: var(--fs-1);
  }
  .gh-page-head-btn:hover {
    color: var(--text);
    background: var(--bg-raised-2);
    border-color: var(--border);
  }
  .gh-page-head-btn.icon-only {
    padding: 6px;
  }
</style>
