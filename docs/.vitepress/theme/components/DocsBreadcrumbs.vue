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
  levers: { label: 'Levers', href: '/levers/' },
  subsystems: { label: 'Subsystems', href: '/subsystems/' },
  releases: { label: 'Releases', href: '/releases/' },
}

const crumbs = computed(() => {
  const base = site.value.base.replace(/\/$/, '')
  const rawPath = route.path.startsWith(`${base}/`)
    ? route.path.slice(base.length)
    : route.path
  const path = rawPath.replace(/\.html$/, '')
  const parts = path.split('/').filter(Boolean)
  const section = sections[parts[0] ?? '']
  if (!section) return []

  const normalizedSectionHref = section.href.replace(/\/$/, '')
  const normalizedPath = path.replace(/\/$/, '')
  const currentTitle = page.value.title || section.label
  if (normalizedPath === normalizedSectionHref) {
    return [{ label: section.label }]
  }
  return [
    { label: section.label, href: section.href },
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
