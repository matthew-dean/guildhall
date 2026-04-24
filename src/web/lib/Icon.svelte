<!--
  Thin wrapper around lucide-svelte so every icon usage goes through a single
  component with a stable prop API (`name`, `size`, `strokeWidth`, `spin`).
  The switch is intentionally explicit: only the icons listed here are
  bundled, which keeps the tree-shaken bundle small.
-->
<script lang="ts" module>
  export type IconName =
    | 'activity'
    | 'list-checks'
    | 'users'
    | 'clock'
    | 'rocket'
    | 'settings'
    | 'plug'
    | 'alert-triangle'
    | 'loader'
    | 'circle'
    | 'check-circle-2'
    | 'play'
    | 'square'
    | 'plus'
    | 'rotate-ccw'
    | 'check'
    | 'x'
    | 'chevron-down'
    | 'inbox'
    | 'wrench'
    | 'package'
    | 'file-text'
    | 'file-check'
    | 'sliders'
</script>

<script lang="ts">
  import Activity from 'lucide-svelte/icons/activity'
  import ListChecks from 'lucide-svelte/icons/list-checks'
  import Users from 'lucide-svelte/icons/users'
  import Clock from 'lucide-svelte/icons/clock'
  import Rocket from 'lucide-svelte/icons/rocket'
  import Settings from 'lucide-svelte/icons/settings'
  import Plug from 'lucide-svelte/icons/plug'
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert'
  import Loader from 'lucide-svelte/icons/loader'
  import Circle from 'lucide-svelte/icons/circle'
  import CheckCircle2 from 'lucide-svelte/icons/check-circle-2'
  import Play from 'lucide-svelte/icons/play'
  import Square from 'lucide-svelte/icons/square'
  import Plus from 'lucide-svelte/icons/plus'
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw'
  import Check from 'lucide-svelte/icons/check'
  import X from 'lucide-svelte/icons/x'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import Inbox from 'lucide-svelte/icons/inbox'
  import Wrench from 'lucide-svelte/icons/wrench'
  import Package from 'lucide-svelte/icons/package'
  import FileText from 'lucide-svelte/icons/file-text'
  import FileCheck from 'lucide-svelte/icons/file-check'
  import Sliders from 'lucide-svelte/icons/sliders'

  interface Props {
    name: IconName
    size?: number
    strokeWidth?: number
    spin?: boolean
  }

  let { name, size = 16, strokeWidth = 2, spin = false }: Props = $props()
</script>

<span class="ic" class:spin aria-hidden="true">
  {#if name === 'activity'}<Activity {size} {strokeWidth} />
  {:else if name === 'list-checks'}<ListChecks {size} {strokeWidth} />
  {:else if name === 'users'}<Users {size} {strokeWidth} />
  {:else if name === 'clock'}<Clock {size} {strokeWidth} />
  {:else if name === 'rocket'}<Rocket {size} {strokeWidth} />
  {:else if name === 'settings'}<Settings {size} {strokeWidth} />
  {:else if name === 'plug'}<Plug {size} {strokeWidth} />
  {:else if name === 'alert-triangle'}<AlertTriangle {size} {strokeWidth} />
  {:else if name === 'loader'}<Loader {size} {strokeWidth} />
  {:else if name === 'circle'}<Circle {size} {strokeWidth} />
  {:else if name === 'check-circle-2'}<CheckCircle2 {size} {strokeWidth} />
  {:else if name === 'play'}<Play {size} {strokeWidth} />
  {:else if name === 'square'}<Square {size} {strokeWidth} />
  {:else if name === 'plus'}<Plus {size} {strokeWidth} />
  {:else if name === 'rotate-ccw'}<RotateCcw {size} {strokeWidth} />
  {:else if name === 'check'}<Check {size} {strokeWidth} />
  {:else if name === 'x'}<X {size} {strokeWidth} />
  {:else if name === 'chevron-down'}<ChevronDown {size} {strokeWidth} />
  {:else if name === 'inbox'}<Inbox {size} {strokeWidth} />
  {:else if name === 'wrench'}<Wrench {size} {strokeWidth} />
  {:else if name === 'package'}<Package {size} {strokeWidth} />
  {:else if name === 'file-text'}<FileText {size} {strokeWidth} />
  {:else if name === 'file-check'}<FileCheck {size} {strokeWidth} />
  {:else if name === 'sliders'}<Sliders {size} {strokeWidth} />
  {/if}
</span>

<style>
  .ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    flex-shrink: 0;
  }
  .ic.spin :global(svg) {
    animation: icon-spin 0.9s linear infinite;
  }
  @keyframes icon-spin {
    to { transform: rotate(360deg); }
  }
</style>
