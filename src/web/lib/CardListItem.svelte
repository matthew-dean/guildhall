<script lang="ts">
  import type { Snippet } from 'svelte'
  import UtilityPanel from './UtilityPanel.svelte'

  type Tone = 'default' | 'accent' | 'warn' | 'danger' | 'ok' | 'neutral'
  type RailTone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'
  type RailStrength = 'subtle' | 'strong'

  interface Props {
    as?: 'div' | 'section' | 'article' | 'button'
    tone?: Tone
    className?: string
    railTone?: RailTone | null
    railStrength?: RailStrength
    ariaLabel?: string
    ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false' | null
    interactive?: boolean
    dense?: boolean
    selected?: boolean
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    onclick?: (event: MouseEvent) => void
    onkeydown?: (event: KeyboardEvent) => void
    children?: Snippet
  }

  let {
    as = 'div',
    tone = 'neutral',
    className = '',
    railTone = null,
    railStrength = 'subtle',
    ariaLabel,
    ariaCurrent = null,
    interactive = as === 'button',
    dense = false,
    selected = false,
    disabled = false,
    type = 'button',
    onclick,
    onkeydown,
    children,
  }: Props = $props()
</script>

<UtilityPanel
  {as}
  {tone}
  className={['card-list-item', className].filter(Boolean).join(' ')}
  {railTone}
  {railStrength}
  {ariaLabel}
  {ariaCurrent}
  {interactive}
  {dense}
  {selected}
  {disabled}
  {type}
  {onclick}
  {onkeydown}
>
  {@render children?.()}
</UtilityPanel>

<style>
  :global(.card-list-item) {
    min-width: 0;
  }
</style>
