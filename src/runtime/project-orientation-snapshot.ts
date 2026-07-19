import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { getProjectSystemStatePath } from '@guildhall/sessions'
import { readWorkspaceConfig, type WorkspaceYamlConfig } from '@guildhall/config'

import type { ProjectOrientationCharter } from './project-orientation-spine.js'

export interface ProjectOrientationSnapshot {
  charter: ProjectOrientationCharter | null
  sourceRefs: string[]
  refreshedAt: string
}

function stripMarkdownFrontMatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

function markdownParagraphs(content: string): string[] {
  return stripMarkdownFrontMatter(content)
    .split(/\r?\n\s*\r?\n/)
    .map(paragraph =>
      paragraph
        .split(/\r?\n/)
        .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
        .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('```'))
        .join(' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`*_]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}

/**
 * Read project documentation only at an explicit intake or summary-refresh
 * boundary. Product reads consume the stored snapshot instead.
 */
export function inferProjectOrientationSnapshot(
  projectPath: string,
  config?: WorkspaceYamlConfig | null,
): ProjectOrientationSnapshot {
  // Source inference is an explicit intake/refresh operation. Resolve the
  // workspace contract here so every writer that has a project root captures
  // the same charter, even when it was not already holding the parsed config.
  let resolvedConfig = config ?? null
  if (!resolvedConfig) {
    try {
      resolvedConfig = readWorkspaceConfig(projectPath)
    } catch {
      resolvedConfig = null
    }
  }
  const briefPath = getProjectSystemStatePath(projectPath, 'project-brief.md')
  const candidates = [
    { path: briefPath, ref: 'project-brief.md' },
    { path: join(projectPath, 'README.md'), ref: 'README.md' },
    { path: join(projectPath, 'readme.md'), ref: 'readme.md' },
    { path: join(projectPath, 'docs', 'index.md'), ref: 'docs/index.md' },
  ]
  const seenFiles = new Set<string>()
  const availableCandidates = candidates.filter(candidate => {
    if (!existsSync(candidate.path)) return false
    try {
      const stat = statSync(candidate.path)
      const fileIdentity = `${stat.dev}:${stat.ino}`
      if (seenFiles.has(fileIdentity)) return false
      seenFiles.add(fileIdentity)
      return true
    } catch {
      return false
    }
  })
  const sourceRefs = availableCandidates.map(candidate => candidate.ref)
  const paragraphs = availableCandidates.flatMap(candidate => {
    try {
      return markdownParagraphs(readFileSync(candidate.path, 'utf8'))
    } catch {
      return []
    }
  })
  const councilGoal = resolvedConfig?.council?.mandate?.trim() || null
  const coordinatorGoal = resolvedConfig?.coordinators?.map(coordinator => coordinator.mandate?.trim()).find(Boolean) || null
  const configAudience = resolvedConfig?.projects?.length
    ? resolvedConfig.projects.map(project => [project.label, project.type].filter(Boolean).join(' ')).filter(Boolean).join('; ')
    : null
  const goal = paragraphs.find(paragraph => /is a |is an |gathers|build|building|workspace|software|system|platform/i.test(paragraph))
  const weakContainerDescription = Boolean(goal && /^this is (a )?(mono)?repo containing:?$/i.test(goal))
  const isMetadataParagraph = (text: string) => /^\s*(status|target domain|license version)\s*:/i.test(text)
  const isNavigationParagraph = (text: string) => /^(quick links|documentation|reference documentation|essential|technical):/i.test(text)
  const targetAudience =
    paragraphs.find(paragraph => paragraph !== goal && !isMetadataParagraph(paragraph) && !isNavigationParagraph(paragraph) && /\btarget\b|\baudience\b/i.test(paragraph)) ??
    paragraphs.find(paragraph => paragraph !== goal && !isMetadataParagraph(paragraph) && !isNavigationParagraph(paragraph) && /\bauthors?\b|\busers?\b|\bwriters?\b|\bdevelopers?\b|\bmaintainers?\b/i.test(paragraph))
  const successDefinition = paragraphs.find(paragraph => /\bshould\b|\boptimize\b|\bmake\b|\bgoal\b|\bsuccess\b/i.test(paragraph) && paragraph !== goal && paragraph !== targetAudience)
  const currentReleaseTarget = paragraphs.find(paragraph => /\b(mvp|release|current scope|bounded scope|first milestone|first version|headless|script[- ]only)\b/i.test(paragraph))
  const selectedGoal = councilGoal ?? (goal && !weakContainerDescription ? goal : coordinatorGoal ?? goal)
  const charter = selectedGoal || configAudience || targetAudience || successDefinition
    ? {
        goal: selectedGoal ?? null,
        targetAudience: configAudience ?? targetAudience ?? null,
        currentReleaseTarget: currentReleaseTarget ?? null,
        successDefinition: successDefinition ?? null,
        nonGoals: [],
        source: existsSync(briefPath) ? 'owner_approved' as const : 'inferred' as const,
      }
    : null
  return { charter, sourceRefs, refreshedAt: new Date().toISOString() }
}
