/**
 * Tiny client-side navigation helper. Keeps `location.pathname` in a reactive
 * Svelte `$state` cell. Router components render against `pathname.value`.
 */

class Path {
  value: string = $state(location.pathname)

  constructor() {
    window.addEventListener('popstate', () => {
      this.value = location.pathname
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

  nav(href: string): void {
    history.pushState({}, '', href)
    this.value = href.split('?')[0]?.split('#')[0] ?? href
  }

  replace(href: string): void {
    history.replaceState({}, '', href)
    this.value = href.split('?')[0]?.split('#')[0] ?? href
  }
}

export const path = new Path()

export function nav(href: string): void {
  path.nav(href)
}
