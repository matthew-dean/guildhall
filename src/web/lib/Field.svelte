<!--
  Form field: tight label above a slotted input/textarea. No helper text
  (ADHD-minimal-UI: chip + label carry the framing; prose under the input
  is a design smell). If a longer explanation is truly required, the design
  is wrong — restructure, don't add prose.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    for?: string
    children?: Snippet
  }

  let { label, for: forId, children }: Props = $props()
</script>

<label class="field">
  <span class="field-label">{label}</span>
  <div class="field-control">
    {@render children?.()}
  </div>
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .field-label {
    font-size: var(--fs-1);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
</style>
