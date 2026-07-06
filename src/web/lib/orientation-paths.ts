import type { ProjectOrientationSpine } from './types.js'

export function orientationPathByWorkId(spine: ProjectOrientationSpine | null | undefined): Map<string, string> {
  const paths = new Map<string, string>()
  const nodes = spine?.nodes ?? {}
  const visit = (node: { id?: string; title?: string; children?: unknown[] } | undefined, parents: string[]) => {
    if (!node) return
    const nodeId = node.id ?? ''
    const path = [...parents, node.title ?? nodeId]
    if (nodeId.startsWith('work:')) paths.set(nodeId.slice('work:'.length), path.join(' / '))
    for (const child of node.children ?? []) {
      if (child && typeof child === 'object') {
        visit(child as { id?: string; title?: string; children?: unknown[] }, path)
      }
    }
  }
  for (const root of spine?.roots ?? []) visit(root, [])
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!nodeId.startsWith('work:') || paths.has(nodeId.slice('work:'.length))) continue
    const titles: string[] = []
    let current = node
    let currentId = node.id ?? nodeId
    const seen = new Set<string>()
    while (current && currentId && !seen.has(currentId)) {
      seen.add(currentId)
      titles.unshift(current.title ?? currentId)
      const parentId = typeof current.parentId === 'string' ? current.parentId : ''
      current = parentId ? nodes[parentId] : undefined
      currentId = current?.id ?? parentId
    }
    if (titles.length > 0) paths.set(nodeId.slice('work:'.length), titles.join(' / '))
  }
  return paths
}
