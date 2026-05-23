import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import { z } from 'zod'
import { ensureProjectGuildhallFilePolicy, PROJECT_CONFIG_DIRNAME } from './project-config.js'

export const ARTIFACT_REGISTRY_FILENAME = 'artifacts.yaml'

export const ProjectArtifact = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  path: z.string().min(1),
  description: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  deprecatedPaths: z.array(z.string()).default([]),
})

export const ProjectArtifactRegistry = z.object({
  version: z.literal(1).default(1),
  artifacts: z.array(ProjectArtifact).default([]),
})

export type ProjectArtifact = z.infer<typeof ProjectArtifact>
export type ProjectArtifactRegistry = z.infer<typeof ProjectArtifactRegistry>

export function artifactRegistryPath(projectPath: string): string {
  return join(resolve(projectPath), PROJECT_CONFIG_DIRNAME, ARTIFACT_REGISTRY_FILENAME)
}

export function readArtifactRegistry(projectPath: string): ProjectArtifactRegistry {
  const path = artifactRegistryPath(projectPath)
  if (!existsSync(path)) return ProjectArtifactRegistry.parse({})
  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${String(err)}`)
  }
  try {
    return ProjectArtifactRegistry.parse(raw ?? {})
  } catch (err) {
    throw new Error(`Invalid ${path}: ${String(err)}`)
  }
}

export function writeArtifactRegistry(projectPath: string, registry: ProjectArtifactRegistry): void {
  ensureArtifactRegistryTrackable(projectPath)
  const validated = ProjectArtifactRegistry.parse(registry)
  writeFileSync(artifactRegistryPath(projectPath), yamlDump(validated, { lineWidth: 120, noRefs: true }), 'utf8')
}

export function resolveArtifact(projectPath: string, artifactRef: string): ProjectArtifact | null {
  const id = artifactRef.startsWith('artifact:') ? artifactRef.slice('artifact:'.length) : artifactRef
  const registry = readArtifactRegistry(projectPath)
  return registry.artifacts.find((artifact) => artifact.id === id || artifact.aliases.includes(id)) ?? null
}

export function ensureArtifactRegistryTrackable(projectPath: string): void {
  ensureProjectGuildhallFilePolicy(projectPath)
}
