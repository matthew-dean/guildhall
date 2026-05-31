/**
 * Tiny client-side navigation helper. Keeps the current pathname and full href
 * in reactive Svelte `$state` cells. Router components render against
 * `pathname.value`; surfaces that care about query-only changes can depend on
 * `pathname.href`.
 */

class Path {
  value: string = $state(location.pathname)
  href: string = $state(`${location.pathname}${location.search}${location.hash}`)
  state: unknown = $state(history.state)

  constructor() {
    window.addEventListener('popstate', () => {
      this.setCurrent()
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
    this.setCurrent(href)
    this.state = state
  }

  replace(href: string, state: unknown = {}): void {
    history.replaceState(state, '', href)
    this.setCurrent(href)
    this.state = state
  }

  private setCurrent(href = `${location.pathname}${location.search}${location.hash}`): void {
    this.href = href
    this.value = href.split('?')[0]?.split('#')[0] ?? href
  }
}

export const path = new Path()

export function nav(href: string, state?: unknown): void {
  path.nav(href, state)
}
