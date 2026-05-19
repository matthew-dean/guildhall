<script setup lang="ts">
import { useData, useRoute, withBase } from 'vitepress'
import { computed } from 'vue'

const { isDark } = useData()
const route = useRoute()

const items = [
  { text: 'Overview', link: '/web-ui/' },
  { text: 'Setup wizard', link: '/web-ui/setup' },
  { text: 'Projects home', link: '/web-ui/dashboard' },
  { text: 'Project shell', link: '/web-ui/project-view' },
  { text: 'Task drawer', link: '/web-ui/task-drawer' },
  { text: 'Providers', link: '/web-ui/providers' },
  { text: 'Design tokens', link: '/web-ui/design-tokens' },
  { text: 'In-UI help', link: '/web-ui/help-system' },
]

const currentPath = computed(() => route.path.replace(/\/$/, '') || '/')

const normalizedItems = computed(() =>
  items.map((item) => {
    const normalizedLink = item.link.replace(/\/$/, '') || '/'
    return {
      ...item,
      href: withBase(normalizedLink),
      isActive: currentPath.value === normalizedLink,
    }
  }),
)
</script>

<template>
  <nav class="gh-ui-subnav" aria-label="Guildhall app navigation" :data-theme="isDark ? 'dark' : 'light'">
    <p class="gh-ui-subnav__eyebrow">App pages</p>
    <div class="gh-ui-subnav__list">
      <a
        v-for="item in normalizedItems"
        :key="item.href"
        class="gh-ui-subnav__link"
        :class="{ 'is-active': item.isActive }"
        :href="item.href"
        :aria-current="item.isActive ? 'page' : undefined"
      >
        {{ item.text }}
      </a>
    </div>
  </nav>
</template>
