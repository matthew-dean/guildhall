<!--
  Markdown primitive. Renders a markdown string as HTML using the `marked`
  library. Use wherever agent output, spec text, briefs, escalation details,
  or PROGRESS.md content appears — anything that arrives as markdown should
  render with headings/bold/lists/code, not as raw asterisks.

  Safety: `marked` preserves raw HTML, so sanitize the rendered fragment before
  passing it to Svelte's {@html}. Rich agent HTML should go through a separate
  validated artifact path, not this plain markdown renderer.
-->
<script lang="ts">
  import { marked } from 'marked'

  interface Props {
    source: string | null | undefined
    inline?: boolean
  }

  let { source, inline = false }: Props = $props()

  marked.setOptions({ gfm: true, breaks: false })

  const ALLOWED_TAGS = new Set([
    'A',
    'BLOCKQUOTE',
    'BR',
    'CODE',
    'DEL',
    'DIV',
    'EM',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HR',
    'LI',
    'OL',
    'P',
    'PRE',
    'SPAN',
    'STRONG',
    'TABLE',
    'TBODY',
    'TD',
    'TH',
    'THEAD',
    'TR',
    'UL',
  ])
  const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'])
  const URL_ATTRS = new Set(['href'])
  const SAFE_ATTRS = new Set(['href', 'title'])

  function safeUrl(value: string): boolean {
    const trimmed = value.trim()
    if (!trimmed) return false
    if (trimmed.startsWith('#')) return true
    try {
      const url = new URL(trimmed, 'https://guildhall.local')
      return ['http:', 'https:', 'mailto:'].includes(url.protocol)
    } catch {
      return false
    }
  }

  function sanitizeNode(node: Node): void {
    for (const child of Array.from(node.childNodes)) {
      if (!(child instanceof Element)) {
        continue
      }
      const tag = child.tagName.toUpperCase()
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove()
        continue
      }
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes))
        sanitizeNode(node)
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (!SAFE_ATTRS.has(name)) {
          child.removeAttribute(attr.name)
          continue
        }
        if (URL_ATTRS.has(name) && !safeUrl(attr.value)) {
          child.removeAttribute(attr.name)
        }
      }
      if (tag === 'A' && !child.getAttribute('href')) {
        child.replaceWith(...Array.from(child.childNodes))
        sanitizeNode(node)
        continue
      }
      sanitizeNode(child)
    }
  }

  function sanitizeMarkdownHtml(rawHtml: string): string {
    if (typeof document === 'undefined') return rawHtml
    const template = document.createElement('template')
    template.innerHTML = rawHtml
    sanitizeNode(template.content)
    return template.innerHTML
  }

  const html = $derived.by(() => {
    const src = (source ?? '').trim()
    if (!src) return ''
    const rendered = inline ? marked.parseInline(src) : marked.parse(src)
    return sanitizeMarkdownHtml(String(rendered))
  })
</script>

{#if html && inline}
  <span class="md md-inline">
    {@html html}
  </span>
{:else if html}
  <div class="md">
    {@html html}
  </div>
{:else}
  <span class="md-empty">—</span>
{/if}

<style>
  .md {
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    color: var(--text);
  }
  .md-inline {
    display: inline;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4),
  .md :global(h5),
  .md :global(h6) {
    line-height: var(--lh-tight);
    font-weight: 600;
    margin-top: var(--s-3);
    margin-bottom: var(--s-2);
  }
  .md :global(h1):first-child,
  .md :global(h2):first-child,
  .md :global(h3):first-child,
  .md :global(h4):first-child,
  .md :global(h5):first-child,
  .md :global(h6):first-child {
    margin-top: 0;
  }
  .md :global(h1) { font-size: var(--fs-4); }
  .md :global(h2) { font-size: var(--fs-3); }
  .md :global(h3) { font-size: var(--fs-2); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .md :global(h4),
  .md :global(h5),
  .md :global(h6) { font-size: var(--fs-1); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

  .md :global(p) {
    margin: 0 0 var(--s-2);
  }
  .md :global(p):last-child {
    margin-bottom: 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 var(--s-2);
    padding-left: var(--s-4);
  }
  .md :global(li) {
    margin: var(--s-1) 0;
  }
  .md :global(li) :global(> p) {
    margin: 0;
  }
  .md :global(code) {
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 0.9em;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: 1px 4px;
  }
  .md :global(pre) {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: var(--s-2) var(--s-3);
    overflow-x: auto;
    margin: 0 0 var(--s-2);
  }
  .md :global(pre) :global(code) {
    background: transparent;
    border: none;
    padding: 0;
  }
  .md :global(a) {
    color: var(--accent);
    text-decoration: underline dotted;
  }
  .md :global(strong) { font-weight: 700; }
  .md :global(em) { font-style: italic; }
  .md :global(blockquote) {
    border-left: 3px solid var(--border);
    padding-left: var(--s-3);
    color: var(--text-muted);
    margin: 0 0 var(--s-2);
  }
  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: var(--s-3) 0;
  }
  .md :global(table) {
    border-collapse: collapse;
    font-size: var(--fs-1);
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: var(--s-1) var(--s-2);
    text-align: left;
  }
  .md-empty {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
</style>
