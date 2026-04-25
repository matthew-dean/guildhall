<!--
  Help icon + popover/modal tied to a docs page.

  Usage:
    <Help topic="lever.reviewer_mode" />
    <Help topic="lever.reviewer_mode" variant="inline" label="Reviewer mode" />

  The topic id must correspond to a markdown page under docs/ that has
  `help_topic: <id>` in its YAML frontmatter. The build pipeline extracts
  { title, summary, href } from that frontmatter into help-topics.json.

  Two surfaces:
    - "?" icon with a hover/focus tooltip (summary)
    - click → modal with the same summary + "Open full docs" link

  The tooltip is passive (no interaction); the modal is the authoritative
  surface when the user wants to read more without leaving the app.
-->
<script lang="ts">
  import Icon from './Icon.svelte'
  import Modal from './Modal.svelte'
  import Tooltip from './Tooltip.svelte'
  import topics from '../generated/help-topics.json'

  type TopicMap = Record<string, { title: string; summary: string; href: string }>
  const topicMap = topics as TopicMap

  const DOCS_ORIGIN = 'https://anthropics.github.io'

  interface Props {
    topic: string
    label?: string
    variant?: 'icon' | 'inline'
    size?: number
  }

  let { topic, label, variant = 'icon', size = 14 }: Props = $props()

  let open = $state(false)

  const entry = $derived(topicMap[topic])
  const title = $derived(entry?.title ?? label ?? topic)
  const summary = $derived(entry?.summary ?? '')
  const href = $derived(entry ? DOCS_ORIGIN + entry.href : undefined)
  const missing = $derived(!entry)

  function onClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    open = true
  }
  function close() { open = false }
</script>

{#if variant === 'inline' && label}
  <span class="gh-help-inline">
    <span>{label}</span>
    <Tooltip text={missing ? `Missing help topic: ${topic}` : summary}>
      <button
        type="button"
        class="gh-help-btn"
        class:missing
        aria-label={`Help: ${title}`}
        onclick={onClick}
      ><Icon name="help-circle" size={size} /></button>
    </Tooltip>
  </span>
{:else}
  <Tooltip text={missing ? `Missing help topic: ${topic}` : summary}>
    <button
      type="button"
      class="gh-help-btn"
      class:missing
      aria-label={`Help: ${title}`}
      onclick={onClick}
    ><Icon name="help-circle" size={size} /></button>
  </Tooltip>
{/if}

<Modal {open} title={title} onClose={close} size="sm">
  {#if missing}
    <p class="gh-help-missing">
      No documentation found for <code>{topic}</code>. Add a page under
      <code>docs/</code> with <code>help_topic: {topic}</code> in its frontmatter.
    </p>
  {:else}
    <p class="gh-help-summary">{summary}</p>
    {#if href}
      <p class="gh-help-link">
        <a {href} target="_blank" rel="noopener">Open full docs ↗</a>
      </p>
    {/if}
  {/if}
  {#snippet footer()}
    <button type="button" class="gh-help-close" onclick={close}>Close</button>
  {/snippet}
</Modal>

<style>
  .gh-help-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: 50%;
    line-height: 0;
  }
  .gh-help-btn:hover,
  .gh-help-btn:focus-visible {
    color: var(--accent);
    background: var(--bg-raised-2);
    outline: none;
  }
  .gh-help-btn.missing {
    color: var(--warn);
  }
  .gh-help-inline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .gh-help-summary {
    margin: 0 0 var(--s-3);
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    white-space: pre-wrap;
  }
  .gh-help-link {
    margin: 0;
    font-size: var(--fs-1);
  }
  .gh-help-link a {
    color: var(--accent);
    text-decoration: none;
  }
  .gh-help-link a:hover {
    text-decoration: underline;
  }
  .gh-help-missing {
    margin: 0;
    color: var(--warn);
    font-size: var(--fs-2);
  }
  .gh-help-close {
    background: var(--bg-raised-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: var(--fs-2);
  }
  .gh-help-close:hover {
    background: var(--bg-elevated);
  }
</style>
