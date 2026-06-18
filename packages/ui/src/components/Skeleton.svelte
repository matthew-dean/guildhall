<script lang="ts">
  import type { SkeletonProps } from './types.js'

  let {
    shape = 'rect',
    width = '100%',
    height = 'var(--gh-space-4)',
    animated = true,
    label,
    class: className = '',
    style = '',
    ...restProps
  }: SkeletonProps = $props()

  const skeletonStyle = $derived([
    `--gh-skeleton-width: ${width}`,
    `--gh-skeleton-height: ${height}`,
    style,
  ].filter(Boolean).join('; '))
</script>

<span
  {...restProps}
  class={['gh-skeleton', `shape-${shape}`, animated ? 'is-animated' : '', className].filter(Boolean).join(' ')}
  style={skeletonStyle}
  role={label ? 'status' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
></span>

<style>
  .gh-skeleton {
    display: block;
    inline-size: var(--gh-skeleton-width);
    block-size: var(--gh-skeleton-height);
    min-inline-size: 0;
    overflow: hidden;
    background:
      linear-gradient(
        100deg,
        color-mix(in srgb, var(--gh-color-feedback-neutral) 34%, transparent),
        color-mix(in srgb, var(--gh-color-feedback-accent) 24%, transparent),
        color-mix(in srgb, var(--gh-color-feedback-neutral) 34%, transparent)
      );
    background-size: 220% 100%;
    opacity: 0.9;
  }

  .gh-skeleton.shape-rect {
    border-radius: var(--gh-radius-1);
  }

  .gh-skeleton.shape-circle {
    aspect-ratio: 1;
    border-radius: var(--gh-radius-full);
  }

  .gh-skeleton.is-animated {
    animation: gh-skeleton-sweep 1.6s ease-in-out infinite;
  }

  @keyframes gh-skeleton-sweep {
    0% {
      background-position: 120% 0;
    }
    100% {
      background-position: -120% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .gh-skeleton.is-animated {
      animation: none;
    }
  }
</style>
