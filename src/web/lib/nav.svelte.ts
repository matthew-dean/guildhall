/**
 * Tiny client-side navigation helper. Keeps `location.pathname` in a reactive
 * Svelte `$state` cell. Router components render against `pathname.value`.
 */

class Path {
  value: string = $state(location.pathname)
  state: unknown = $state(history.state)

  constructor() {
    window.addEventListener('popstate', () => {
      this.value = location.pathname
      this.state = history.state
    })

    document.addEventListener('click', e => {
      if (e.defaultPrevented) return
      const target = e.target as Element | null
      const a = target?.closest?.('a[href^="/"]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return
      const href = a.getAttribute('href')
      if (!href) return
      e.preventDefault()
      this.nav(href)
    })
  }

  nav(href: string, state: unknown = {}): void {
    history.pushState(state, '', href)
    this.value = href.split('?')[0]?.split('#')[0] ?? href
    this.state = state
  }

  replace(href: string, state: unknown = {}): void {
    history.replaceState(state, '', href)
    this.value = href.split('?')[0]?.split('#')[0] ?? href
    this.state = state
  }
}

export const path = new Path()

export function nav(href: string, state?: unknown): void {
  path.nav(href, state)
}
