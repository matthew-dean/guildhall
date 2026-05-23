<script lang="ts">
  import Chip from './Chip.svelte'
  import { labelForIdentifier, type IdentifierKind, type IdentifierTone } from './identifier-labels.js'

  interface Props {
    kind: IdentifierKind
    value: string | undefined
    label?: string
    tone?: IdentifierTone
  }

  let { kind, value, label, tone }: Props = $props()
  const resolved = $derived(label ? { label, tone: tone ?? 'neutral' } : labelForIdentifier(kind, value))
</script>

<span class="identifier-chip identifier-chip-{resolved.tone}">
  <span class="identifier-dot" aria-hidden="true"></span>
  <Chip label={resolved.label} tone={resolved.tone} />
</span>

<style>
  .identifier-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .identifier-dot {
    flex: 0 0 8px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--text-muted);
  }
  .identifier-chip-accent .identifier-dot { background: var(--accent); }
  .identifier-chip-ok .identifier-dot { background: var(--ok); }
  .identifier-chip-warn .identifier-dot { background: var(--warn); }
  .identifier-chip-danger .identifier-dot { background: var(--danger); }
  .identifier-chip-neutral .identifier-dot { background: var(--text-muted); }
</style>
