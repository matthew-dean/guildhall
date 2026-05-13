import DefaultTheme from 'vitepress/theme'
import { defineComponent, h, onBeforeUnmount, onMounted } from 'vue'

import '../../../packages/ui/src/styles.css'
import './custom.css'
import UiReferenceNav from './components/UiReferenceNav.vue'

const GuildhallThemeLayout = defineComponent({
  name: 'GuildhallThemeLayout',
  setup(_props, { slots }) {
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

    onMounted(() => {
      syncTheme()
      observer = new MutationObserver(syncTheme)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })
    })

    onBeforeUnmount(() => {
      observer?.disconnect()
    })

    return () => h(DefaultTheme.Layout, null, slots)
  },
})

export default {
  extends: DefaultTheme,
  Layout: GuildhallThemeLayout,
  enhanceApp({ app }) {
    app.component('UiReferenceNav', UiReferenceNav)
  },
}
