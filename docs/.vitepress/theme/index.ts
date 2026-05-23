import DefaultTheme from 'vitepress/theme'
import { useRoute } from 'vitepress'
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'

import '../../../packages/ui/src/styles.css'
import './custom.css'
import DocsBreadcrumbs from './components/DocsBreadcrumbs.vue'
import UiReferenceNav from './components/UiReferenceNav.vue'

const GuildhallThemeLayout = defineComponent({
  name: 'GuildhallThemeLayout',
  setup(_props, { slots }) {
    const route = useRoute()
    let observer: MutationObserver | null = null

    const syncTheme = () => {
      const root = document.documentElement
      const isDark = root.classList.contains('dark')

      root.dataset.ghTheme = isDark ? 'dark' : 'light'
      root.classList.toggle('gh-theme-dark', isDark)
      root.classList.toggle('gh-theme-light', !isDark)

      const themeColor = document.querySelector('meta[name="theme-color"]')
      if (themeColor) {
        themeColor.setAttribute('content', isDark ? '#151217' : '#fcf9fd')
      }
    }

    const currentDocsPrefix = () => {
      const match = route.path.match(/^\/guildhall(\/next|\/versions\/[^/]+)?\//)
      return match?.[1] ?? ''
    }

    const syncVersionedNavLinks = () => {
      const prefix = currentDocsPrefix()
      if (!prefix) return

      const sections = ['guide', 'reference', 'web-ui', 'cli', 'levers', 'releases']
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>('.VPNav a[href]')) {
        if (anchor.closest('.VPFlyout')) continue
        const href = anchor.getAttribute('href')
        if (!href) continue
        for (const section of sections) {
          const root = `/guildhall/${section}`
          if (href === root || href.startsWith(`${root}/`)) {
            anchor.setAttribute('href', href.replace(root, `/guildhall${prefix}/${section}`))
            break
          }
        }
      }
    }

    onMounted(() => {
      syncTheme()
      syncVersionedNavLinks()
      observer = new MutationObserver(syncTheme)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })
    })

    watch(
      () => route.path,
      () => {
        nextTick(syncVersionedNavLinks)
      },
    )

    onBeforeUnmount(() => {
      observer?.disconnect()
    })

    return () => h(DefaultTheme.Layout, null, {
      ...slots,
      'doc-before': () => [
        slots['doc-before']?.(),
        h(DocsBreadcrumbs),
      ],
    })
  },
})

export default {
  extends: DefaultTheme,
  Layout: GuildhallThemeLayout,
  enhanceApp({ app }) {
    app.component('UiReferenceNav', UiReferenceNav)
  },
}
