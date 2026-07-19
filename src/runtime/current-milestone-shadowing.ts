export type ShadowingSource = {
  path: string
  content: string
}

export type ShadowedCurrentMilestoneDeliverable = {
  sourcePath: string
  title: string
}

export type ShadowedStageAlignedDeliverable = {
  sourcePath: string
  title: string
}

function logicalBulletTitles(section: string): string[] {
  const lines = section.split('\n')
  const titles: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const bullet = /^\s*-\s+(.+?)\s*$/.exec(line)
    if (!bullet?.[1]) continue
    let title = bullet[1].trim()
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? ''
      if (!/^\s{2,}\S/.test(next)) break
      if (/^\s*(?:-\s+|\d+\.\s+|##\s+|[A-Z][^:\n]*:\s*$)/.test(next)) break
      title = `${title} ${next.trim()}`
      index += 1
    }
    titles.push(title)
  }

  return titles
}

export function detectShadowedCurrentMilestoneDeliverableImports(
  sources: readonly ShadowingSource[],
): ShadowedCurrentMilestoneDeliverable[] {
  const shadowed: ShadowedCurrentMilestoneDeliverable[] = []

  for (const source of sources) {
    const currentMilestoneMatch = source.content.match(/##\s+Current Next Milestone[\s\S]*?The next milestone is\s+(Stage\s+\d+)(?:\s*:.*)?\./i)
    if (!currentMilestoneMatch?.[1]) continue
    const currentMilestoneSection = source.content.match(/##\s+Current Next Milestone[\s\S]*$/i)?.[0] ?? ''
    if (!/^\s*\d+\.\s+.+$/m.test(currentMilestoneSection)) continue

    const stageNumber = currentMilestoneMatch[1].match(/Stage\s+(\d+)/i)?.[1]
    if (!stageNumber) continue
    const stageSection = source.content.match(
      new RegExp(`##\\s+Stage\\s+${stageNumber}\\s*:[\\s\\S]*?(?=\\n##\\s+|$)`, 'i'),
    )?.[0]
    if (!stageSection) continue
    const deliverablesMatch = stageSection.match(/Deliverables:\s*([\s\S]*?)(?=\n[A-Z][^\n]*:\s*$|\n##\s+|$)/i)
    if (!deliverablesMatch?.[1]) continue
    const deliverableTitles = logicalBulletTitles(deliverablesMatch[1])

    for (const title of deliverableTitles) {
      shadowed.push({ sourcePath: source.path, title })
    }
  }

  return shadowed
}

export function detectShadowedStageAlignedRoadmapDeliverables(
  sources: readonly ShadowingSource[],
): ShadowedStageAlignedDeliverable[] {
  const shadowed: ShadowedStageAlignedDeliverable[] = []
  const stageNumbersWithDecomposedReplacements = new Set<string>()

  for (const source of sources) {
    for (const match of source.content.matchAll(/\*\*Stage alignment:\*\*\s*Stage\s+(\d+)/gi)) {
      if (match[1]) stageNumbersWithDecomposedReplacements.add(match[1])
    }
  }

  if (stageNumbersWithDecomposedReplacements.size === 0) return shadowed

  for (const source of sources) {
    for (const stageNumber of stageNumbersWithDecomposedReplacements) {
      const stageSection = source.content.match(
        new RegExp(`##\\s+Stage\\s+${stageNumber}\\s*:[\\s\\S]*?(?=\\n##\\s+|$)`, 'i'),
      )?.[0]
      if (!stageSection) continue
      const deliverablesMatch = stageSection.match(/Deliverables:\s*([\s\S]*?)(?=\n[A-Z][^\n]*:\s*$|\n##\s+|$)/i)
      if (!deliverablesMatch?.[1]) continue
      const deliverableTitles = logicalBulletTitles(deliverablesMatch[1])
      for (const title of deliverableTitles) {
        shadowed.push({ sourcePath: source.path, title })
      }
    }
  }

  return shadowed
}
