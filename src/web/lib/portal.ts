export function portal(node: HTMLElement, target: HTMLElement | string = 'body') {
  if (typeof document === 'undefined') return {}

  const targetElement = typeof target === 'string'
    ? document.querySelector<HTMLElement>(target)
    : target
  if (!targetElement) return {}

  const parent = node.parentNode
  const placeholder = document.createComment('guildhall-portal')
  parent?.insertBefore(placeholder, node)
  targetElement.appendChild(node)

  return {
    destroy() {
      node.remove()
      placeholder.remove()
    },
  }
}
