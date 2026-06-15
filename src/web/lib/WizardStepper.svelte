<script lang="ts">
  import Chip from './Chip.svelte'

  export interface WizardStep {
    id: string
    label: string
  }

  interface Props {
    steps: WizardStep[]
    activeId: string
  }

  let { steps, activeId }: Props = $props()

  function splitStepLabel(label: string): { number: string; text: string } {
    const match = label.match(/^(\d+)\.\s*(.+)$/)
    if (!match) return { number: '', text: label }
    return { number: match[1] ?? '', text: match[2] ?? label }
  }
</script>

<div class="wizard-stepper" aria-label="Wizard steps">
  {#each steps as step (step.id)}
    {@const parts = splitStepLabel(step.label)}
    <div class:active={step.id === activeId} class="wizard-step">
      {#if parts.number}
        <Chip label={parts.number} tone={step.id === activeId ? 'accent' : 'neutral'} />
      {/if}
      <span class="wizard-step-label">{parts.text}</span>
    </div>
  {/each}
</div>

<style>
  .wizard-stepper {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--s-4);
  }
  .wizard-step {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-4) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    color: var(--text-muted);
    background: var(--bg-raised);
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
  }
  .wizard-step.active {
    color: var(--text);
    border-color: var(--accent);
    background: var(--bg-raised);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .wizard-step-label {
    line-height: var(--gh-type-line-height-tight);
  }
</style>
