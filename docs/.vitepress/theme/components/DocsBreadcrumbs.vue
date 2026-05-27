<script setup lang="ts">
import { computed } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'

const route = useRoute()
const { page, site } = useData()

const sections: Record<string, { label: string; href: string }> = {
  guide: { label: 'Guide', href: '/guide/' },
  'web-ui': { label: 'Reference', href: '/reference/' },
  cli: { label: 'Reference', href: '/reference/' },
  reference: { label: 'Reference', href: '/reference/' },
  levers: { label: 'Reference', href: '/reference/' },
  subsystems: { label: 'Reference', href: '/reference/' },
  releases: { label: 'Reference', href: '/reference/' },
}

const getStartedPaths = new Set([
  '/guide/quick-start',
  '/guide/introduction',
  '/guide/concepts',
  '/guide/new-project',
  '/guide/existing-project',
  '/guide/first-tasks',
  '/guide/managing-projects',
])

const pathInfo = computed(() => {
  const base = site.value.base.replace(/\/$/, '')
  const rawPath = route.path.startsWith(`${base}/`)
    ? route.path.slice(base.length)
    : route.path
  const path = rawPath.replace(/\.html$/, '')
  const versionMatch = path.match(/^(\/next|\/versions\/[^/]+)(\/.*)?$/)
  return {
    path,
    prefix: versionMatch?.[1] ?? '',
    unversionedPath: versionMatch ? (versionMatch[2] || '/') : path,
  }
})

function hrefForVersion(href: string): string {
  const prefix = pathInfo.value.prefix
  if (!prefix || !href.startsWith('/')) return href
  return `${prefix}${href}`
}

const crumbs = computed(() => {
  const path = pathInfo.value.unversionedPath
  const normalizedPath = path.replace(/\/$/, '')
  if (getStartedPaths.has(normalizedPath)) {
    return [
      { label: 'Get started', href: hrefForVersion('/guide/quick-start') },
      { label: page.value.title || 'Get started' },
    ]
  }

  const parts = path.split('/').filter(Boolean)
  const section = sections[parts[0] ?? '']
  if (!section) return []

  const normalizedSectionHref = section.href.replace(/\/$/, '')
  const currentTitle = page.value.title || section.label
  if (normalizedPath === normalizedSectionHref) {
    return [{ label: section.label }]
  }
  return [
    { label: section.label, href: hrefForVersion(section.href) },
    { label: currentTitle },
  ]
})
</script>

<template>
  <nav v-if="crumbs.length" class="gh-doc-breadcrumbs" aria-label="Breadcrumb">
    <ol>
      <li v-for="(crumb, index) in crumbs" :key="`${crumb.label}-${index}`">
        <a v-if="crumb.href" :href="withBase(crumb.href)">{{ crumb.label }}</a>
        <span v-else>{{ crumb.label }}</span>
      </li>
    </ol>
  </nav>
</template>
