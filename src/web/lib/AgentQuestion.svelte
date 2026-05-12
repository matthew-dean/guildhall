<!--
  Renders ONE agent → user question with a kind-specific deterministic
  affordance. Every kind also exposes a free-text reply ("Reply differently…")
  so the user is never trapped by a misclassified question.

  Kinds:
    confirm — "Here's what I think you want." UI: Approve | Reply
    yesno   — Yes/No. UI: Yes | No | Reply
    choice  — multiple choice (2..6). UI: chip per choice + Other… textbox
    text    — open-ended. UI: textarea + Send

  The component is presentational. Parents pass `onAnswer(answer: string)` —
  the answer is always a string regardless of kind, so producers (server,
  agents) can store it uniformly.
-->
<script lang="ts">
  import Button from './Button.svelte'
  import Textarea from './Textarea.svelte'
  import Stack from './Stack.svelte'
  import Row from './Row.svelte'
  import Markdown from './Markdown.svelte'
  import { roleLabel } from './escalation-labels.js'
  import type { AgentQuestion } from './types.js'

  interface Props {
    question: AgentQuestion
    busy?: boolean
    onAnswer: (answer: string) => void | Promise<void>
  }

  let { question, busy = false, onAnswer }: Props = $props()

  let mode = $state<'idle' | 'reply' | 'other'>('idle')
  let replyText = $state('')
  let selectedChoices = $state<string[]>([])

  const isProjectMapQuestion = $derived(
    /coordinator domains|project areas|review lanes/i.test(question.prompt ?? ''),
  )

  async function send(answer: string): Promise<void> {
    if (!answer.trim()) return
    await onAnswer(answer.trim())
    mode = 'idle'
    replyText = ''
  }

  async function pickChoice(choice: string): Promise<void> {
    await send(answerChoice(choice))
  }

  function toggleChoice(choice: string): void {
    selectedChoices = selectedChoices.includes(choice)
      ? selectedChoices.filter(c => c !== choice)
      : [...selectedChoices, choice]
  }

  async function sendSelectedChoices(): Promise<void> {
    if (selectedChoices.length === 0) return
    await send(selectedChoices.map(answerChoice).join(', '))
    selectedChoices = []
  }

  function titleizeSlug(value: string): string {
    const cleaned = value
      .replace(/\*\*/g, '')
      .replace(/[`_]+/g, ' ')
      .replace(/[-/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return value
    return cleaned
      .split(' ')
      .map(part => {
        const lower = part.toLowerCase()
        if (['ui', 'api', 'cli', 'ci', 'cd', 'db', 'llm', 'js', 'ts', 'vscode', 'ide'].includes(lower)) {
          return lower === 'vscode' ? 'VS Code' : lower.toUpperCase()
        }
        return lower.charAt(0).toUpperCase() + lower.slice(1)
      })
      .join(' ')
  }

  function looksLikeCodeLabel(value: string): boolean {
    const trimmed = value.trim()
    return /^[a-z0-9]+(?:[-_/.][a-z0-9]+)+$/.test(trimmed) || trimmed.includes('spec-agent')
  }

  function choiceLabel(value: string): string {
    const role = roleLabel(value)
    return role !== value
      ? role
      : looksLikeCodeLabel(value)
        ? titleizeSlug(value)
        : value
  }

  function answerChoice(value: string): string {
    return choiceLabel(value)
  }

  function choiceParts(value: string): { title: string; detail: string | null } {
    const label = choiceLabel(value)
    const match = label.match(/^(.+?)\s+(?:[-–—])\s+(.+)$/)
    if (!match) return { title: label, detail: null }
    return { title: match[1]!.trim(), detail: match[2]!.trim() }
  }

  function displayPrompt(value: string | undefined): string {
    const prompt = value ?? ''
    if (/coordinator domains|project areas|review lanes/i.test(prompt)) {
      return 'Guildhall inferred this structure from the repo. Confirm it only if it looks materially wrong.'
    }
    if (/workspace importer scanned the repo/i.test(prompt) && /importable tasks/i.test(prompt)) {
      return 'Guildhall found planning notes across several project documents. Which of these should become real tasks? Choose all that apply.'
    }
    return prompt
  }

  // User-facing questions should come from the coordinating persona, not a
  // generic system voice or an internal worker label.
  const askedBy = $derived('From the coordinator:')
  const isMultiChoice = $derived(
    question.kind === 'choice' &&
      (
        question.selectionMode === 'multiple' ||
        (
          question.selectionMode !== 'single' &&
          /pick all|select all|all that apply|choose all|which of these should|which of these do|which options|which parts|which items/i.test(question.prompt ?? '')
        )
      ),
  )
  const kindLabel = $derived(
    isProjectMapQuestion
      ? 'Confirm only if needed'
      : question.kind === 'confirm'
      ? 'Check this'
      : question.kind === 'yesno'
        ? 'Yes or no'
        : question.kind === 'choice'
          ? isMultiChoice ? 'Choose any' : 'Choose one'
          : 'Reply',
  )

  const sendLabel = $derived(isProjectMapQuestion ? 'Use this map' : 'Send')

  $effect(() => {
    if (!isProjectMapQuestion || !isMultiChoice) return
    if (selectedChoices.length > 0) return
    selectedChoices = [...question.choices]
  })
</script>

<div class="agent-question">
  <div class="question-head">
    <div class="meta">{askedBy}</div>
    <div class="question-kind">{kindLabel}</div>
  </div>

  {#if question.kind === 'confirm'}
    <div class="prompt"><Markdown source={displayPrompt(question.restatement)} /></div>
    {#if mode === 'idle'}
      <Row justify="end" gap="2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => (mode = 'reply')}
        >
          Reply
        </Button>
        <Button variant="primary" disabled={busy} onclick={() => send('Yes, that\u2019s right.')}>
          Looks right
        </Button>
      </Row>
    {/if}
  {:else if question.kind === 'yesno'}
    <div class="prompt"><Markdown source={displayPrompt(question.prompt)} /></div>
    {#if mode === 'idle'}
      <Row justify="end" gap="2">
        <Button variant="ghost" disabled={busy} onclick={() => (mode = 'reply')}>
          Reply
        </Button>
        <Button variant="secondary" disabled={busy} onclick={() => send('No')}>
          No
        </Button>
        <Button variant="primary" disabled={busy} onclick={() => send('Yes')}>
          Yes
        </Button>
      </Row>
    {/if}
  {:else if question.kind === 'choice'}
    <div class="prompt"><Markdown source={displayPrompt(question.prompt)} /></div>
    {#if mode === 'idle'}
      {#if isProjectMapQuestion}
        <div class="inferred-list" aria-label="Guildhall inferred repo structure">
          {#each question.choices as c (c)}
            {@const parts = choiceParts(c)}
            <div class="inferred-item">
              <span class="inferred-check" aria-hidden="true">✓</span>
              <span class="choice-copy">
                <span class="choice-title"><Markdown source={parts.title} inline /></span>
                {#if parts.detail}
                  <span class="choice-detail"><Markdown source={parts.detail} inline /></span>
                {/if}
              </span>
            </div>
          {/each}
        </div>
        <Row justify="end" gap="2">
          <Button variant="secondary" disabled={busy} onclick={() => (mode = 'other')}>
            Correct it…
          </Button>
          <Button
            variant="primary"
            disabled={busy || question.choices.length === 0}
            onclick={() => send(question.choices.join(', '))}
          >Looks right</Button>
        </Row>
      {:else}
        <div class="choices">
          {#each question.choices as c (c)}
            {@const parts = choiceParts(c)}
            <button
              type="button"
              class="choice"
              class:multi={isMultiChoice}
              class:selected={selectedChoices.includes(c)}
              aria-pressed={isMultiChoice ? selectedChoices.includes(c) : undefined}
              disabled={busy}
              onclick={() => isMultiChoice ? toggleChoice(c) : pickChoice(c)}
            >
              <span class="choice-mark" aria-hidden="true"></span>
              <span class="choice-copy">
                <span class="choice-title"><Markdown source={parts.title} inline /></span>
                {#if parts.detail}
                  <span class="choice-detail"><Markdown source={parts.detail} inline /></span>
                {/if}
              </span>
            </button>
          {/each}
          <button
            type="button"
            class="choice choice-other"
            class:multi={isMultiChoice}
            disabled={busy}
            onclick={() => (mode = 'other')}
          >
            <span class="choice-mark" aria-hidden="true"></span>
            <span class="choice-copy">
              <span class="choice-title">Other…</span>
            </span>
          </button>
        </div>
        {#if isMultiChoice}
          <Row justify="end">
            <Button
              variant="primary"
              disabled={busy || selectedChoices.length === 0}
              onclick={sendSelectedChoices}
            >{sendLabel}</Button>
          </Row>
        {/if}
      {/if}
    {/if}
  {:else if question.kind === 'text'}
    <div class="prompt"><Markdown source={displayPrompt(question.prompt)} /></div>
    {#if mode === 'idle'}
      <Textarea bind:value={replyText} rows={3} placeholder="Type your answer…" />
      <Row justify="end">
        <Button
          variant="primary"
          disabled={busy || replyText.trim().length === 0}
          onclick={() => send(replyText)}
        >Send</Button>
      </Row>
    {/if}
  {/if}

  {#if mode === 'reply' || mode === 'other'}
    <Textarea bind:value={replyText} rows={3} placeholder="Type your answer…" />
    <Row justify="end" gap="2">
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => { mode = 'idle'; replyText = '' }}
      >Cancel</Button>
      <Button
        variant="primary"
        disabled={busy || replyText.trim().length === 0}
        onclick={() => send(replyText)}
      >Send</Button>
    </Row>
  {/if}
</div>

<style>
  .agent-question {
    min-width: 0;
    display: grid;
    gap: var(--s-3);
  }
  .question-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .meta {
    font-size: var(--fs-0);
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .question-kind {
    font-size: var(--fs-0);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .prompt {
    margin: 0;
    font-size: var(--fs-3);
    font-weight: 550;
    line-height: 1.12;
    color: var(--text);
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--s-2);
  }
  .choice {
    background: var(--bg-raised);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-2) var(--s-3);
    font: inherit;
    font-size: var(--fs-2);
    font-weight: 400;
    cursor: pointer;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: var(--s-2);
    align-items: start;
    text-align: left;
    width: 100%;
    min-height: 42px;
  }
  .choice:hover:not(:disabled) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 5%, var(--bg-raised));
  }
  .choice.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-raised));
    color: var(--text);
  }
  .choice-mark {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    font-size: var(--fs-0);
    font-weight: 800;
    line-height: 1;
    margin-top: 1px;
    position: relative;
  }
  .choice.multi .choice-mark {
    border-radius: 4px;
  }
  .choice.selected .choice-mark {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--bg));
  }
  .choice.selected .choice-mark::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .choice.multi.selected .choice-mark::after {
    content: '✓';
    width: auto;
    height: auto;
    border-radius: 0;
    background: none;
    font-size: 12px;
    line-height: 1;
    font-weight: 800;
  }
  .choice-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .choice-title {
    font-weight: 600;
    line-height: var(--lh-tight);
  }
  .choice-title :global(strong),
  .choice-detail :global(strong),
  .prompt :global(strong) {
    font-weight: 700;
  }
  .choice-title :global(.md),
  .choice-detail :global(.md),
  .prompt :global(.md) {
    color: inherit;
    font-size: inherit;
    line-height: inherit;
  }
  .choice-detail {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .choice:disabled { opacity: 0.5; cursor: default; }
  .choice-other {
    border-style: dashed;
    color: var(--text-muted);
    background: transparent;
  }
  .inferred-list {
    display: grid;
    gap: var(--s-2);
  }
  .inferred-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: var(--s-2);
    align-items: start;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: color-mix(in srgb, var(--bg-elevated) 82%, var(--bg));
  }
  .inferred-check {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--accent) 16%, var(--bg));
    color: var(--accent);
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    margin-top: 1px;
  }
</style>
