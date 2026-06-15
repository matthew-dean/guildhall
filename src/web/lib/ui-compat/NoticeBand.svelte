<!-- Temporary compatibility wrapper for the retired src/web/lib/NoticeBand.svelte API. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import AlertBand from '../../../../packages/ui/src/components/AlertBand.svelte'
  import type { AlertBandIcon } from '../../../../packages/ui/src/components/types.js'
  import type { IconName } from '../Icon.svelte'

  type Tone = 'neutral' | 'accent' | 'attention' | 'ok' | 'warn' | 'danger'
  type Density = 'regular' | 'compact'

  interface Props {
    tone?: Tone
    icon?: IconName
    density?: Density
    children?: Snippet
    actions?: Snippet
  }

  let {
    tone = 'neutral',
    icon,
    density = 'regular',
    children,
    actions,
  }: Props = $props()

  const alertDensity = $derived(density === 'compact' ? 'compact' : 'regular')
  const alertIcon = $derived.by<AlertBandIcon | false>(() => {
    if (icon === 'alert-triangle' || icon === 'check-circle-2' || icon === 'sparkles') return icon
    return false
  })
</script>

<AlertBand {tone} icon={alertIcon} density={alertDensity} role="status" {actions}>
  {@render children?.()}
</AlertBand>
