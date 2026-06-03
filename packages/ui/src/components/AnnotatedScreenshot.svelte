<script lang="ts">
  import StatusPill from './StatusPill.svelte'
  import type { AnnotatedScreenshotProps } from './types.js'

  const defaultAnnotations = [
    { id: 'audit', label: 'Audit trail stays visible', detail: 'Pair screenshots with the exact reviewer checkpoints that matter.', x: 76, y: 22, tone: 'info' },
    { id: 'queue', label: 'Primary action lane', detail: 'Show where operators decide, inspect, or keep work in motion.', x: 22, y: 62, tone: 'accent' },
    { id: 'status', label: 'Live status scan', detail: 'Surface states and blockers without flattening the underlying history.', x: 56, y: 80, tone: 'ok' },
  ] as const satisfies NonNullable<AnnotatedScreenshotProps['annotations']>

  let {
    src,
    alt,
    title,
    description,
    eyebrow,
    caption,
    headingTag = 'h3',
    aspectRatio = '16 / 10',
    mode = 'display',
    density = 'comfortable',
    annotations = defaultAnnotations,
    class: className = '',
    ...restProps
  }: AnnotatedScreenshotProps = $props()
</script>

<figure
  {...restProps}
  class={['gh-annotated-screenshot', `mode-${mode}`, `density-${density}`, className].filter(Boolean).join(' ')}
>
  {#if eyebrow || title || description}
    <figcaption class="gh-annotated-caption">
      {#if eyebrow}
        <p class="gh-annotated-eyebrow">{eyebrow}</p>
      {/if}
      {#if title}
        <svelte:element this={headingTag} class="gh-annotated-title">{title}</svelte:element>
      {/if}
      {#if description}
        <p class="gh-annotated-description">{description}</p>
      {/if}
    </figcaption>
  {/if}

  <div class="gh-annotated-surface">
    <div class="gh-annotated-frame" style={`--gh-annotated-aspect-ratio:${aspectRatio};`}>
      <img class="gh-annotated-image" src={src} alt={alt} loading="lazy" />

      {#if annotations.length}
        <div class="gh-annotated-markers" aria-hidden="true">
          {#each annotations as annotation, index (annotation.id)}
            <span
              class={['gh-annotated-marker', `tone-${annotation.tone ?? 'neutral'}`].join(' ')}
              style={`inset-block-start:${annotation.y}%;inset-inline-start:${annotation.x}%;`}
            >
              {index + 1}
            </span>
          {/each}
        </div>
      {/if}
    </div>

    {#if annotations.length}
      <ol class="gh-annotated-notes">
        {#each annotations as annotation, index (annotation.id)}
          <li class="gh-annotated-note">
            <div class="gh-annotated-note-head">
              <span class={['gh-annotated-index', `tone-${annotation.tone ?? 'neutral'}`].join(' ')}>{index + 1}</span>
              <div class="gh-annotated-note-copy">
                <p class="gh-annotated-note-label">{annotation.label}</p>
                {#if annotation.detail}
                  <p class="gh-annotated-note-detail">{annotation.detail}</p>
                {/if}
              </div>
            </div>
            <StatusPill
              label={`${annotation.x}% x / ${annotation.y}% y`}
              tone={annotation.tone ?? 'neutral'}
              emphasis="quiet"
              mode={mode}
              density="dense"
            />
          </li>
        {/each}
      </ol>
    {/if}
  </div>

  {#if caption}
    <p class="gh-annotated-meta">{caption}</p>
  {/if}
</figure>

<style>
  .gh-annotated-screenshot,
  .gh-annotated-caption,
  .gh-annotated-surface {
    display: grid;
    gap: var(--gh-space-4);
    min-inline-size: 0;
  }

  .gh-annotated-screenshot {
    color: var(--gh-color-text-primary);
    container-type: inline-size;
  }

  .gh-annotated-eyebrow,
  .gh-annotated-title,
  .gh-annotated-description,
  .gh-annotated-meta,
  .gh-annotated-note-label,
  .gh-annotated-note-detail {
    margin: 0;
  }

  .gh-annotated-eyebrow {
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
  }

  .gh-annotated-title {
    font-size: var(--gh-type-size-5);
    line-height: var(--gh-type-line-height-tight);
    text-wrap: balance;
  }

  .gh-annotated-description {
    max-inline-size: min(60ch, 100%);
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-3);
    line-height: var(--gh-type-line-height-relaxed);
  }

  .gh-annotated-frame {
    position: relative;
    overflow: clip;
    aspect-ratio: var(--gh-annotated-aspect-ratio, 16 / 10);
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-subtle) 84%, white);
    border-radius: var(--gh-radius-3);
    background: linear-gradient(180deg, color-mix(in srgb, var(--gh-color-surface-raised-alt) 82%, black), var(--gh-color-surface-sunken));
    box-shadow: 0 14px 34px color-mix(in srgb, black 28%, transparent);
  }

  .gh-annotated-image {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .gh-annotated-markers {
    position: absolute;
    inset: 0;
  }

  .gh-annotated-marker,
  .gh-annotated-index {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    inline-size: 2rem;
    block-size: 2rem;
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-strong) 72%, white);
    border-radius: 999px;
    font-size: var(--gh-type-size-2);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-control);
  }

  .gh-annotated-marker {
    position: absolute;
    transform: translate(-50%, -50%);
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--gh-color-surface-canvas) 75%, transparent),
      0 8px 20px color-mix(in srgb, black 32%, transparent);
  }

  .gh-annotated-marker.tone-neutral,
  .gh-annotated-index.tone-neutral {
    background: color-mix(in srgb, var(--gh-color-feedback-neutral) 85%, var(--gh-color-surface-elevated));
  }

  .gh-annotated-marker.tone-info,
  .gh-annotated-index.tone-info {
    background: color-mix(in srgb, var(--gh-color-feedback-info) 75%, var(--gh-color-surface-elevated));
  }

  .gh-annotated-marker.tone-ok,
  .gh-annotated-index.tone-ok {
    background: color-mix(in srgb, var(--gh-color-feedback-ok) 72%, var(--gh-color-surface-elevated));
  }

  .gh-annotated-marker.tone-warn,
  .gh-annotated-index.tone-warn {
    background: color-mix(in srgb, var(--gh-color-feedback-warn) 72%, var(--gh-color-surface-elevated));
  }

  .gh-annotated-marker.tone-danger,
  .gh-annotated-index.tone-danger {
    background: color-mix(in srgb, var(--gh-color-feedback-danger) 72%, var(--gh-color-surface-elevated));
  }

  .gh-annotated-marker.tone-accent,
  .gh-annotated-index.tone-accent {
    background: color-mix(in srgb, var(--gh-color-feedback-accent) 76%, var(--gh-color-surface-elevated));
  }

  .gh-annotated-notes {
    display: grid;
    gap: var(--gh-space-3);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .gh-annotated-note {
    display: grid;
    gap: var(--gh-space-3);
    align-items: start;
    padding: var(--gh-space-3);
    border: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
    border-radius: var(--gh-radius-2);
    background: color-mix(in srgb, var(--gh-color-surface-raised) 85%, black);
  }

  .gh-annotated-note-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--gh-space-3);
    align-items: start;
    min-inline-size: 0;
  }

  .gh-annotated-note-copy {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: 0;
  }

  .gh-annotated-note-label {
    font-size: var(--gh-type-size-3);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  .gh-annotated-note-detail,
  .gh-annotated-meta {
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-2);
    line-height: var(--gh-type-line-height-body);
  }

  .gh-annotated-meta {
    max-inline-size: min(64ch, 100%);
  }

  .gh-annotated-screenshot.density-dense .gh-annotated-surface,
  .gh-annotated-screenshot.density-dense .gh-annotated-caption {
    gap: var(--gh-space-3);
  }

  .gh-annotated-screenshot.density-dense .gh-annotated-note {
    gap: var(--gh-space-2);
    padding: var(--gh-space-2);
  }

  @container (min-width: 52rem) {
    .gh-annotated-surface {
      grid-template-columns: minmax(0, 1.45fr) minmax(16rem, 0.95fr);
      align-items: start;
    }
  }
</style>
