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
      const match = route.path.match(/^(?:\/guildhall)?(\/next|\/versions\/[^/]+)?\//)
      return match?.[1] ?? ''
    }

    const extractVersionLabel = (text: string | null | undefined) => {
      const match = text?.match(/\(v([^)]+)\)/)
      return match ? `v${match[1]}` : null
    }

    const currentVersionLabel = () => {
      const prefix = currentDocsPrefix()
      const archived = prefix.match(/^\/versions\/(\d+\.\d+)(?:\.\d+)?(?:-[^/]+)?$/)
      if (archived) return `v${archived[1]}`

      const navText = Array.from(document.querySelectorAll<HTMLElement>('.VPFlyout .VPMenuLink span'))
        .map((element) => element.textContent?.trim() ?? '')

      if (prefix === '/next') {
        return extractVersionLabel(navText.find((text) => text.startsWith('Next '))) ?? 'Next'
      }

      return extractVersionLabel(navText.find((text) => text.startsWith('Current '))) ?? 'Current'
    }

    const syncVersionNavLabel = () => {
      const label = currentVersionLabel()
      for (const buttonText of document.querySelectorAll<HTMLElement>('.VPNavBarMenuGroup .button .text')) {
        const text = buttonText.textContent?.trim() ?? ''
        if (text === 'Version' || text === 'Next' || text === 'Current' || /^v\d+\.\d+$/.test(text)) {
          buttonText.textContent = label
        }
      }
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
          const root = href.startsWith('/guildhall/') ? `/guildhall/${section}` : `/${section}`
          if (href === root || href.startsWith(`${root}/`)) {
            const versionedRoot = href.startsWith('/guildhall/')
              ? `/guildhall${prefix}/${section}`
              : `${prefix}/${section}`
            anchor.setAttribute('href', href.replace(root, versionedRoot))
            break
          }
        }
      }
    }

    onMounted(() => {
      syncTheme()
      syncVersionedNavLinks()
      syncVersionNavLabel()
      observer = new MutationObserver(syncTheme)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })
    })

    watch(
      () => route.path,
      () => {
        nextTick(() => {
          syncVersionedNavLinks()
          syncVersionNavLabel()
        })
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
