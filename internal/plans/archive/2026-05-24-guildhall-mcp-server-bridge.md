# Guildhall MCP Server Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a host-owned MCP server that lets external agents read Guildhall project context and record auditable task evidence without depending on the future Podman runtime shape.

**Architecture:** Add a server-side MCP package beside the existing MCP client package. The server exposes stable Guildhall concepts as MCP resources and tools: project context, task context, artifact lookup, decisions, compact memory, evidence append, and capability request creation/status. Podman and host/container proxying stay behind a narrow `GuildhallMcpContext` interface so the public MCP contract does not name container implementation details.

**Tech Stack:** TypeScript, Node 20 ESM, `@modelcontextprotocol/sdk`, Zod, Vitest, existing `@guildhall/config`, `@guildhall/runtime`, `@guildhall/sessions`, and `@guildhall/core` storage types.

---

## Scope

This plan builds the first verified MCP server slice only.

In scope:

- Stdio MCP server entrypoint for local agent clients.
- Resources for project summary, task list, task context, artifacts, decisions, memory, and capability requests.
- Tools for reading artifacts by logical ID, appending task evidence, and creating/listing capability requests.
- A live integration smoke that connects with the MCP SDK client over stdio and exercises list/read/call behavior.
- Internal docs for the bridge contract and host-owned runtime boundary.

Out of scope:

- Podman container lifecycle.
- Host browser proxy.
- Credential broker.
- Container-engine broker.
- Claude hook generation.
- AGENTS.md export generation.
- Public docs promotion.

## File Structure

- Create `src/mcp-server/types.ts`
  - Owns the server-facing context interface, resource URI helpers, and stable payload schemas.
- Create `src/mcp-server/project-reader.ts`
  - Reads Guildhall shared state from a project root and renders bounded context payloads.
- Create `src/mcp-server/evidence.ts`
  - Appends MCP-originated evidence to `.guildhall/PROGRESS.md` and task notes with trace metadata.
- Create `src/mcp-server/server.ts`
  - Registers MCP resources and tools against an SDK server instance.
- Create `src/mcp-server/stdio.ts`
  - Starts the stdio transport for external clients.
- Create `src/mcp-server/index.ts`
  - Exports the public server helpers.
- Modify `src/runtime/cli.ts`
  - Adds `guildhall mcp serve <project>` as the first CLI entrypoint.
- Modify `tsconfig.json`
  - Adds `@guildhall/mcp-server`.
- Modify `build.mjs`
  - Keeps the bundled CLI entrypoint working with the new server files.
- Create `src/mcp-server/__tests__/project-reader.test.ts`
  - Verifies resources are bounded, parseable, and path-safe.
- Create `src/mcp-server/__tests__/server.test.ts`
  - Verifies registered resources/tools with an in-process server harness.
- Create `src/mcp-server/__tests__/stdio-smoke.test.ts`
  - Runs the built CLI as a stdio MCP server and connects with the SDK client.
- Modify `docs/subsystems/mcp.md`
  - Corrects the current client-only transport claim and points to the internal bridge plan.
- Create `internal/specs/guildhall-mcp-server-contract.md`
  - Documents the stable logical MCP contract, URI scheme, tool names, audit behavior, and Podman boundary.

## Contract

Use a Guildhall-owned URI scheme:

```text
guildhall://project
guildhall://project/tasks
guildhall://project/tasks/<task-id>
guildhall://project/artifacts
guildhall://project/artifacts/<artifact-id>
guildhall://project/decisions
guildhall://project/memory
guildhall://project/capability-requests
```

Use these tools in the first slice:

```text
guildhall.read_artifact
guildhall.append_task_evidence
guildhall.create_capability_request
guildhall.list_capability_requests
```

Keep the payload rule simple: every resource and tool returns compact Markdown by default, with a JSON string available through tool output when the caller asks for `format: "json"`.

## Tasks

### Task 1: Define Server Types And URI Helpers

**Files:**

- Create: `src/mcp-server/types.ts`
- Create: `src/mcp-server/index.ts`
- Modify: `tsconfig.json`
- Test: `src/mcp-server/__tests__/project-reader.test.ts`

- [ ] **Step 1: Write the failing URI helper tests**

Add this test file:

```ts
import { describe, expect, it } from 'vitest'

import {
  parseGuildhallUri,
  projectUri,
  taskUri,
  artifactUri,
  type GuildhallMcpContext,
} from '../index.js'

describe('Guildhall MCP URI helpers', () => {
  it('renders stable resource URIs', () => {
    expect(projectUri()).toBe('guildhall://project')
    expect(taskUri('task-001')).toBe('guildhall://project/tasks/task-001')
    expect(artifactUri('flow-audit')).toBe('guildhall://project/artifacts/flow-audit')
  })

  it('parses known resource URIs', () => {
    expect(parseGuildhallUri('guildhall://project')).toEqual({ kind: 'project' })
    expect(parseGuildhallUri('guildhall://project/tasks')).toEqual({ kind: 'tasks' })
    expect(parseGuildhallUri('guildhall://project/tasks/task-001')).toEqual({
      kind: 'task',
      taskId: 'task-001',
    })
    expect(parseGuildhallUri('guildhall://project/artifacts/flow-audit')).toEqual({
      kind: 'artifact',
      artifactId: 'flow-audit',
    })
  })

  it('rejects non-Guildhall URIs and path traversal segments', () => {
    expect(() => parseGuildhallUri('file:///etc/passwd')).toThrow(/unsupported/i)
    expect(() => parseGuildhallUri('guildhall://project/tasks/../x')).toThrow(/invalid/i)
  })

  it('keeps the context runtime-agnostic', () => {
    const context: GuildhallMcpContext = {
      projectRoot: '/tmp/example',
      projectStateDir: '/tmp/example/.guildhall',
      localHistoryDir: '/tmp/home/.guildhall/data/projects/hash',
      runtime: { kind: 'host' },
    }
    expect(context.runtime.kind).toBe('host')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/project-reader.test.ts
```

Expected: fail because `src/mcp-server/index.ts` does not exist.

- [ ] **Step 3: Add the type and URI implementation**

Create `src/mcp-server/types.ts`:

```ts
import { z } from 'zod'

export type GuildhallMcpRuntime =
  | { kind: 'host' }
  | { kind: 'proxied'; proxyName: string }

export interface GuildhallMcpContext {
  projectRoot: string
  projectStateDir: string
  localHistoryDir?: string
  runtime: GuildhallMcpRuntime
}

const safeId = /^[A-Za-z0-9_.-]+$/

export const GuildhallArtifactFormat = z.enum(['markdown', 'json'])
export type GuildhallArtifactFormat = z.infer<typeof GuildhallArtifactFormat>

export type ParsedGuildhallUri =
  | { kind: 'project' }
  | { kind: 'tasks' }
  | { kind: 'task'; taskId: string }
  | { kind: 'artifacts' }
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'decisions' }
  | { kind: 'memory' }
  | { kind: 'capabilityRequests' }

export function projectUri(): string {
  return 'guildhall://project'
}

export function taskUri(taskId: string): string {
  assertSafeId(taskId, 'task id')
  return `guildhall://project/tasks/${taskId}`
}

export function artifactUri(artifactId: string): string {
  assertSafeId(artifactId, 'artifact id')
  return `guildhall://project/artifacts/${artifactId}`
}

export function parseGuildhallUri(uri: string): ParsedGuildhallUri {
  if (!uri.startsWith('guildhall://project')) {
    throw new Error(`Unsupported Guildhall MCP URI: ${uri}`)
  }
  const rest = uri.slice('guildhall://project'.length)
  if (rest === '') return { kind: 'project' }
  const parts = rest.split('/').filter(Boolean)
  if (parts.length === 1 && parts[0] === 'tasks') return { kind: 'tasks' }
  if (parts.length === 2 && parts[0] === 'tasks') {
    assertSafeId(parts[1]!, 'task id')
    return { kind: 'task', taskId: parts[1]! }
  }
  if (parts.length === 1 && parts[0] === 'artifacts') return { kind: 'artifacts' }
  if (parts.length === 2 && parts[0] === 'artifacts') {
    assertSafeId(parts[1]!, 'artifact id')
    return { kind: 'artifact', artifactId: parts[1]! }
  }
  if (parts.length === 1 && parts[0] === 'decisions') return { kind: 'decisions' }
  if (parts.length === 1 && parts[0] === 'memory') return { kind: 'memory' }
  if (parts.length === 1 && parts[0] === 'capability-requests') {
    return { kind: 'capabilityRequests' }
  }
  throw new Error(`Invalid Guildhall MCP URI: ${uri}`)
}

function assertSafeId(value: string, label: string): void {
  if (!safeId.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}
```

Create `src/mcp-server/index.ts`:

```ts
export * from './types.js'
```

Modify `tsconfig.json` paths:

```json
"@guildhall/mcp-server": ["./src/mcp-server/index.ts"]
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/project-reader.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```sh
git add tsconfig.json src/mcp-server
git commit -m "feat: define Guildhall MCP server contract"
```

### Task 2: Read Bounded Guildhall Project Resources

**Files:**

- Create: `src/mcp-server/project-reader.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `src/mcp-server/__tests__/project-reader.test.ts`

- [ ] **Step 1: Add failing project-reader tests**

Append these tests to `src/mcp-server/__tests__/project-reader.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import {
  buildGuildhallResourceIndex,
  readGuildhallResource,
} from '../index.js'

describe('Guildhall MCP project reader', () => {
  it('lists project, task, artifact, decision, memory, and capability resources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-reader-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      writeFileSync(join(root, 'guildhall.yaml'), 'name: Example\nid: example\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
        tasks: [{ id: 'task-001', title: 'Wire bridge', status: 'ready' }],
      }), 'utf8')
      writeFileSync(join(root, '.guildhall', 'DECISIONS.md'), '# Decisions\n\n- Use MCP.\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'MEMORY.md'), '# Memory\n\nProject fact.\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'artifacts.yaml'), [
        'version: 1',
        'artifacts:',
        '  - id: flow-audit',
        '    path: internal/audits/flow-audit.md',
        '    description: Live audit',
        '',
      ].join('\n'), 'utf8')
      mkdirSync(join(root, 'internal/audits'), { recursive: true })
      writeFileSync(join(root, 'internal/audits/flow-audit.md'), '# Audit\n\n- [ ] Bridge\n', 'utf8')

      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      const resources = await buildGuildhallResourceIndex(ctx)
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/tasks/task-001')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/artifacts/flow-audit')

      const artifact = await readGuildhallResource(ctx, 'guildhall://project/artifacts/flow-audit')
      expect(artifact).toContain('# Audit')
      expect(artifact).toContain('Bridge')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/project-reader.test.ts
```

Expected: fail because `buildGuildhallResourceIndex` and `readGuildhallResource` do not exist.

- [ ] **Step 3: Implement bounded project reading**

Create `src/mcp-server/project-reader.ts` with these exports:

```ts
import fsp from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'

import {
  artifactUri,
  parseGuildhallUri,
  projectUri,
  taskUri,
  type GuildhallMcpContext,
} from './types.js'

export interface GuildhallMcpResource {
  uri: string
  name: string
  description: string
  mimeType: 'text/markdown'
}

export async function buildGuildhallResourceIndex(
  ctx: GuildhallMcpContext,
): Promise<GuildhallMcpResource[]> {
  const tasks = await readTasks(ctx.projectStateDir)
  const artifacts = await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir)
  return [
    { uri: projectUri(), name: 'Guildhall project', description: 'Compact project context.', mimeType: 'text/markdown' },
    { uri: 'guildhall://project/tasks', name: 'Guildhall tasks', description: 'Active task queue summary.', mimeType: 'text/markdown' },
    ...tasks.map((task) => ({
      uri: taskUri(task.id),
      name: task.title || task.id,
      description: `Task ${task.id} (${task.status || 'unknown'})`,
      mimeType: 'text/markdown' as const,
    })),
    { uri: 'guildhall://project/artifacts', name: 'Guildhall artifacts', description: 'Registered artifact IDs.', mimeType: 'text/markdown' },
    ...artifacts.map((artifact) => ({
      uri: artifactUri(artifact.id),
      name: artifact.id,
      description: artifact.description || artifact.path,
      mimeType: 'text/markdown' as const,
    })),
    { uri: 'guildhall://project/decisions', name: 'Guildhall decisions', description: 'Committed decision log.', mimeType: 'text/markdown' },
    { uri: 'guildhall://project/memory', name: 'Guildhall memory', description: 'Committed compact project memory.', mimeType: 'text/markdown' },
    { uri: 'guildhall://project/capability-requests', name: 'Capability requests', description: 'Current capability request state.', mimeType: 'text/markdown' },
  ]
}

export async function readGuildhallResource(
  ctx: GuildhallMcpContext,
  uri: string,
): Promise<string> {
  const parsed = parseGuildhallUri(uri)
  if (parsed.kind === 'project') return renderProject(ctx)
  if (parsed.kind === 'tasks') return renderTasks(ctx)
  if (parsed.kind === 'task') return renderTask(ctx, parsed.taskId)
  if (parsed.kind === 'artifacts') return renderArtifacts(ctx)
  if (parsed.kind === 'artifact') return renderArtifact(ctx, parsed.artifactId)
  if (parsed.kind === 'decisions') return readOptional(path.join(ctx.projectStateDir, 'DECISIONS.md'), '# Decisions\n\nNo decisions recorded.\n')
  if (parsed.kind === 'memory') return readOptional(path.join(ctx.projectStateDir, 'MEMORY.md'), '# Memory\n\nNo compact memory recorded.\n')
  if (parsed.kind === 'capabilityRequests') return '# Capability Requests\n\nNo capability requests recorded in this first slice.\n'
  return '# Unknown\n'
}

async function renderProject(ctx: GuildhallMcpContext): Promise<string> {
  const config = await readOptional(path.join(ctx.projectRoot, 'guildhall.yaml'), '')
  return `# Guildhall Project\n\nRuntime: ${ctx.runtime.kind}\n\n## Config\n\n\`\`\`yaml\n${trimForMcp(config)}\n\`\`\`\n`
}

async function renderTasks(ctx: GuildhallMcpContext): Promise<string> {
  const tasks = await readTasks(ctx.projectStateDir)
  if (tasks.length === 0) return '# Tasks\n\nNo active tasks.\n'
  return ['# Tasks', '', ...tasks.map((task) => `- ${task.id}: ${task.title || '(untitled)'} (${task.status || 'unknown'})`), ''].join('\n')
}

async function renderTask(ctx: GuildhallMcpContext, taskId: string): Promise<string> {
  const task = (await readTasks(ctx.projectStateDir)).find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  return `# ${task.title || task.id}\n\n\`\`\`json\n${JSON.stringify(task, null, 2)}\n\`\`\`\n`
}

async function renderArtifacts(ctx: GuildhallMcpContext): Promise<string> {
  const artifacts = await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir)
  if (artifacts.length === 0) return '# Artifacts\n\nNo registered artifacts.\n'
  return ['# Artifacts', '', ...artifacts.map((artifact) => `- ${artifact.id}: ${artifact.description || artifact.path}`), ''].join('\n')
}

async function renderArtifact(ctx: GuildhallMcpContext, artifactId: string): Promise<string> {
  const artifact = (await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir))
    .find((candidate) => candidate.id === artifactId)
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
  const resolved = safeProjectPath(ctx.projectRoot, artifact.path)
  return readOptional(resolved, `# ${artifact.id}\n\nRegistered artifact file is missing: ${artifact.path}\n`)
}

async function readTasks(projectStateDir: string): Promise<Array<Record<string, unknown> & { id: string; title?: string; status?: string }>> {
  const raw = await readOptional(path.join(projectStateDir, 'TASKS.json'), '{"tasks":[]}')
  const parsed = JSON.parse(raw) as unknown
  const tasks = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? (parsed as { tasks: unknown[] }).tasks
      : []
  return tasks.filter((task): task is Record<string, unknown> & { id: string; title?: string; status?: string } =>
    Boolean(task && typeof task === 'object' && typeof (task as { id?: unknown }).id === 'string'),
  )
}

async function readArtifactRegistry(projectRoot: string, projectStateDir: string): Promise<Array<{ id: string; path: string; description?: string }>> {
  const raw = await readOptional(path.join(projectStateDir, 'artifacts.yaml'), 'artifacts: []\n')
  const parsed = yamlLoad(raw) as { artifacts?: Array<{ id?: unknown; path?: unknown; description?: unknown }> } | null
  return (parsed?.artifacts ?? [])
    .filter((artifact): artifact is { id: string; path: string; description?: string } =>
      typeof artifact.id === 'string' &&
      typeof artifact.path === 'string' &&
      safeProjectPath(projectRoot, artifact.path).startsWith(projectRoot),
    )
}

async function readOptional(filePath: string, fallback: string): Promise<string> {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch {
    return fallback
  }
}

function safeProjectPath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath)
  const root = path.resolve(projectRoot)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return resolved
}

function trimForMcp(text: string): string {
  return text.length > 12000 ? text.slice(0, 12000) + '\n\n[truncated]\n' : text
}
```

Update `src/mcp-server/index.ts`:

```ts
export * from './types.js'
export * from './project-reader.js'
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/project-reader.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/mcp-server
git commit -m "feat: expose Guildhall MCP resources"
```

### Task 3: Add Evidence And Capability Tools

**Files:**

- Create: `src/mcp-server/evidence.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `src/mcp-server/__tests__/server.test.ts`

- [ ] **Step 1: Write failing evidence tests**

Create `src/mcp-server/__tests__/server.test.ts`:

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  appendTaskEvidence,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
} from '../index.js'

describe('Guildhall MCP tools', () => {
  it('appends evidence to PROGRESS.md with MCP provenance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-tools-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      await appendTaskEvidence(ctx, {
        taskId: 'task-001',
        summary: 'External agent read the flow audit before editing.',
        source: 'claude-code',
      })
      const progress = readFileSync(join(root, '.guildhall', 'PROGRESS.md'), 'utf8')
      expect(progress).toContain('task-001')
      expect(progress).toContain('External agent read the flow audit')
      expect(progress).toContain('source: claude-code')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates and lists a mount-directory capability request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-capability-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      const request = await createMcpCapabilityRequest(ctx, {
        taskId: 'task-001',
        requestedBy: 'external-agent',
        reason: 'Read sibling package API docs.',
        hostPath: '/tmp/sibling',
        access: 'read-only',
      })
      expect(request.status).toBe('pending')
      const listed = await listMcpCapabilityRequests(ctx)
      expect(listed).toContain('Read sibling package API docs.')
      expect(listed).toContain('read-only')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/server.test.ts
```

Expected: fail because evidence helpers do not exist.

- [ ] **Step 3: Implement evidence and capability helpers**

Create `src/mcp-server/evidence.ts`:

```ts
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '@guildhall/sessions'
import {
  createCapabilityRequest,
  listCapabilityRequests,
  type CapabilityRequest,
} from '@guildhall/runtime'

import type { GuildhallMcpContext } from './types.js'

export interface AppendTaskEvidenceInput {
  taskId: string
  summary: string
  source: string
}

export async function appendTaskEvidence(
  ctx: GuildhallMcpContext,
  input: AppendTaskEvidenceInput,
): Promise<string> {
  const progressPath = path.join(ctx.projectStateDir, 'PROGRESS.md')
  const existing = await readOptional(progressPath, '# Progress\n')
  const entry = [
    '',
    `## ${new Date().toISOString()} MCP evidence for ${input.taskId}`,
    '',
    input.summary.trim(),
    '',
    `source: ${input.source.trim()}`,
    '',
  ].join('\n')
  await fsp.mkdir(path.dirname(progressPath), { recursive: true })
  atomicWriteText(progressPath, existing.trimEnd() + entry)
  return `Recorded MCP evidence for ${input.taskId}`
}

export async function createMcpCapabilityRequest(
  ctx: GuildhallMcpContext,
  input: {
    taskId: string
    requestedBy: string
    reason: string
    hostPath: string
    access: 'read-only' | 'read-write'
  },
): Promise<CapabilityRequest> {
  return createCapabilityRequest({
    memoryDir: ctx.projectStateDir,
    taskId: input.taskId,
    kind: 'mount_directory',
    requestedBy: input.requestedBy,
    reason: input.reason,
    mount: {
      hostPath: input.hostPath,
      containerPath: `/mnt/guildhall/${sanitizeMountName(input.hostPath)}`,
      access: input.access,
    },
  })
}

export async function listMcpCapabilityRequests(ctx: GuildhallMcpContext): Promise<string> {
  const requests = listCapabilityRequests(ctx.projectStateDir)
  if (requests.length === 0) return '# Capability Requests\n\nNo capability requests.\n'
  return [
    '# Capability Requests',
    '',
    ...requests.map((request) =>
      `- ${request.id}: ${request.status} ${request.mount.access} ${request.mount.hostPath} for ${request.taskId}. ${request.reason}`,
    ),
    '',
  ].join('\n')
}

async function readOptional(filePath: string, fallback: string): Promise<string> {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch {
    return fallback
  }
}

function sanitizeMountName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mount'
}
```

Update `src/mcp-server/index.ts`:

```ts
export * from './types.js'
export * from './project-reader.js'
export * from './evidence.js'
```

- [ ] **Step 4: Run focused tests**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/project-reader.test.ts src/mcp-server/__tests__/server.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit**

```sh
git add src/mcp-server
git commit -m "feat: record Guildhall MCP evidence"
```

### Task 4: Register The MCP Server Resources And Tools

**Files:**

- Create: `src/mcp-server/server.ts`
- Create: `src/mcp-server/stdio.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `src/mcp-server/__tests__/server.test.ts`

- [ ] **Step 1: Add failing server registration tests**

Append this test to `src/mcp-server/__tests__/server.test.ts`:

```ts
import { buildGuildhallMcpManifest } from '../index.js'

describe('Guildhall MCP server manifest', () => {
  it('declares the first stable resources and tools', () => {
    const manifest = buildGuildhallMcpManifest()
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project')
    expect(manifest.resourceTemplates.map((resource) => resource.uriTemplate)).toContain('guildhall://project/tasks/{taskId}')
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'guildhall.read_artifact',
      'guildhall.append_task_evidence',
      'guildhall.create_capability_request',
      'guildhall.list_capability_requests',
    ])
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/server.test.ts
```

Expected: fail because `buildGuildhallMcpManifest` does not exist.

- [ ] **Step 3: Implement server manifest and SDK registration**

Create `src/mcp-server/server.ts`:

```ts
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  appendTaskEvidence,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
} from './evidence.js'
import {
  buildGuildhallResourceIndex,
  readGuildhallResource,
} from './project-reader.js'
import type { GuildhallMcpContext } from './types.js'

export function buildGuildhallMcpManifest() {
  return {
    resources: [
      { uri: 'guildhall://project', name: 'Guildhall project' },
      { uri: 'guildhall://project/tasks', name: 'Guildhall tasks' },
      { uri: 'guildhall://project/artifacts', name: 'Guildhall artifacts' },
      { uri: 'guildhall://project/decisions', name: 'Guildhall decisions' },
      { uri: 'guildhall://project/memory', name: 'Guildhall memory' },
      { uri: 'guildhall://project/capability-requests', name: 'Guildhall capability requests' },
    ],
    resourceTemplates: [
      { uriTemplate: 'guildhall://project/tasks/{taskId}', name: 'Guildhall task' },
      { uriTemplate: 'guildhall://project/artifacts/{artifactId}', name: 'Guildhall artifact' },
    ],
    tools: [
      { name: 'guildhall.read_artifact' },
      { name: 'guildhall.append_task_evidence' },
      { name: 'guildhall.create_capability_request' },
      { name: 'guildhall.list_capability_requests' },
    ],
  }
}

export async function createGuildhallMcpServer(ctx: GuildhallMcpContext): Promise<McpServer> {
  const server = new McpServer({ name: 'guildhall', version: '0.1.0' })
  const resources = await buildGuildhallResourceIndex(ctx)
  for (const resource of resources) {
    server.resource(resource.name, resource.uri, async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: resource.mimeType,
        text: await readGuildhallResource(ctx, uri.href),
      }],
    }))
  }
  server.tool(
    'guildhall.read_artifact',
    { artifactId: z.string(), format: z.enum(['markdown', 'json']).default('markdown') },
    async ({ artifactId }) => ({
      content: [{
        type: 'text',
        text: await readGuildhallResource(ctx, `guildhall://project/artifacts/${artifactId}`),
      }],
    }),
  )
  server.tool(
    'guildhall.append_task_evidence',
    { taskId: z.string(), summary: z.string(), source: z.string().default('external-agent') },
    async (input) => ({
      content: [{ type: 'text', text: await appendTaskEvidence(ctx, input) }],
    }),
  )
  server.tool(
    'guildhall.create_capability_request',
    {
      taskId: z.string(),
      requestedBy: z.string().default('external-agent'),
      reason: z.string(),
      hostPath: z.string(),
      access: z.enum(['read-only', 'read-write']).default('read-only'),
    },
    async (input) => ({
      content: [{ type: 'text', text: JSON.stringify(await createMcpCapabilityRequest(ctx, input), null, 2) }],
    }),
  )
  server.tool(
    'guildhall.list_capability_requests',
    {},
    async () => ({
      content: [{ type: 'text', text: await listMcpCapabilityRequests(ctx) }],
    }),
  )
  return server
}
```

Create `src/mcp-server/stdio.ts`:

```ts
import path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { findWorkspaceRoot } from '@guildhall/config'
import { createGuildhallMcpServer } from './server.js'

export async function serveGuildhallMcpStdio(projectPath: string): Promise<void> {
  const projectRoot = findWorkspaceRoot(projectPath) ?? path.resolve(projectPath)
  const server = await createGuildhallMcpServer({
    projectRoot,
    projectStateDir: path.join(projectRoot, '.guildhall'),
    runtime: { kind: 'host' },
  })
  await server.connect(new StdioServerTransport())
}
```

Update `src/mcp-server/index.ts`:

```ts
export * from './types.js'
export * from './project-reader.js'
export * from './evidence.js'
export * from './server.js'
export * from './stdio.js'
```

- [ ] **Step 4: Run focused tests**

Run:

```sh
pnpm vitest run src/mcp-server/__tests__/project-reader.test.ts src/mcp-server/__tests__/server.test.ts
```

Expected: all focused server tests pass. If the SDK method signatures differ from the snippet above, adapt only the registration layer and keep the manifest test unchanged.

- [ ] **Step 5: Commit**

```sh
git add src/mcp-server
git commit -m "feat: register Guildhall MCP server"
```

### Task 5: Add CLI Entrypoint And Live Stdio Smoke

**Files:**

- Modify: `src/runtime/cli.ts`
- Test: `src/mcp-server/__tests__/stdio-smoke.test.ts`

- [ ] **Step 1: Inspect the current CLI command parser**

Run:

```sh
sed -n '1,220p' src/runtime/cli.ts
```

Expected: locate the top-level command dispatch and the usage/help text.

- [ ] **Step 2: Add failing stdio smoke test**

Create `src/mcp-server/__tests__/stdio-smoke.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'

describe('guildhall mcp serve', () => {
  it('serves Guildhall resources over stdio', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-stdio-'))
    let client: Client | undefined
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      writeFileSync(join(root, 'guildhall.yaml'), 'name: Smoke\nid: smoke\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
        tasks: [{ id: 'task-001', title: 'Smoke MCP', status: 'ready' }],
      }), 'utf8')

      client = new Client({ name: 'guildhall-test', version: '0.1.0' })
      const transport = new StdioClientTransport({
        command: 'node',
        args: [resolve('dist/cli.js'), 'mcp', 'serve', root],
      })
      await client.connect(transport)
      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toContain('guildhall://project/tasks/task-001')
      const body = await client.readResource({ uri: 'guildhall://project/tasks/task-001' })
      expect(JSON.stringify(body)).toContain('Smoke MCP')
    } finally {
      await client?.close()
      rmSync(root, { recursive: true, force: true })
    }
  }, 15000)
})
```

- [ ] **Step 3: Run the smoke and verify it fails before CLI wiring**

Run:

```sh
pnpm build
pnpm vitest run src/mcp-server/__tests__/stdio-smoke.test.ts
```

Expected: fail because `guildhall mcp serve` is not recognized.

- [ ] **Step 4: Wire the CLI command**

In `src/runtime/cli.ts`, add a dispatch branch near the other top-level commands:

```ts
if (command === 'mcp' && args[1] === 'serve') {
  const projectPath = args[2] ?? process.cwd()
  const { serveGuildhallMcpStdio } = await import('@guildhall/mcp-server')
  await serveGuildhallMcpStdio(projectPath)
  return
}
```

Add usage text:

```text
guildhall mcp serve [project-path]     Serve Guildhall project context over MCP stdio.
```

- [ ] **Step 5: Build and run the live smoke**

Run:

```sh
pnpm build
pnpm vitest run src/mcp-server/__tests__/stdio-smoke.test.ts
```

Expected: build succeeds and the stdio smoke passes.

- [ ] **Step 6: Commit**

```sh
git add src/runtime/cli.ts src/mcp-server/__tests__/stdio-smoke.test.ts
git commit -m "feat: serve Guildhall MCP over stdio"
```

### Task 6: Document The Internal Contract And Correct Current MCP Docs

**Files:**

- Create: `internal/specs/guildhall-mcp-server-contract.md`
- Modify: `docs/subsystems/mcp.md`
- Modify: `docs/versions/0.7.0/subsystems/mcp.md` only if this is a current-version generated copy in the branch workflow.

- [ ] **Step 1: Write the internal contract**

Create `internal/specs/guildhall-mcp-server-contract.md`:

```md
# Guildhall MCP Server Contract

**Status:** first implementation slice

Guildhall exposes project state to external agents through a host-owned MCP
server. The MCP contract names Guildhall concepts, not execution backends.
Podman, host-browser proxying, credential brokering, and container-engine
brokering can sit behind the same contract later.

## Resources

- `guildhall://project`
- `guildhall://project/tasks`
- `guildhall://project/tasks/<task-id>`
- `guildhall://project/artifacts`
- `guildhall://project/artifacts/<artifact-id>`
- `guildhall://project/decisions`
- `guildhall://project/memory`
- `guildhall://project/capability-requests`

## Tools

- `guildhall.read_artifact`
- `guildhall.append_task_evidence`
- `guildhall.create_capability_request`
- `guildhall.list_capability_requests`

## Audit Rule

Any tool that mutates Guildhall state writes a visible evidence record with the
calling source, task id when available, timestamp, and plain-language summary.

## Runtime Boundary

The first server runs on the host over stdio. Container runtimes can later use a
proxied context, but the public MCP tools remain intent-shaped:
`create_capability_request`, not `mount_podman_volume`.
```

- [ ] **Step 2: Correct the client MCP docs**

In `docs/subsystems/mcp.md`, change the transport claim to match code:

```md
Guildhall currently consumes stdio and streamable HTTP MCP servers. WebSocket
entries are parsed for configuration compatibility but are reported as
unsupported by the current client implementation.
```

Add a short internal note:

```md
Guildhall's own MCP server bridge is tracked internally in
`internal/plans/2026-05-24-guildhall-mcp-server-bridge.md`.
```

- [ ] **Step 3: Run docs and focused tests**

Run:

```sh
pnpm vitest run src/mcp/__tests__/mcp.test.ts src/tools/__tests__/mcp-auth.test.ts src/mcp-server/__tests__/project-reader.test.ts src/mcp-server/__tests__/server.test.ts src/mcp-server/__tests__/stdio-smoke.test.ts
pnpm docs:check-copy
```

Expected: all focused tests pass; docs copy check passes.

- [ ] **Step 4: Commit**

```sh
git add docs/subsystems/mcp.md internal/specs/guildhall-mcp-server-contract.md
git commit -m "docs: define Guildhall MCP bridge contract"
```

### Task 7: Final Verification

**Files:**

- Verify only.

- [ ] **Step 1: Run all MCP-related tests**

Run:

```sh
pnpm vitest run src/mcp/__tests__/mcp.test.ts src/tools/__tests__/mcp-auth.test.ts src/mcp-server/__tests__/project-reader.test.ts src/mcp-server/__tests__/server.test.ts src/mcp-server/__tests__/stdio-smoke.test.ts
```

Expected: every listed test file passes.

- [ ] **Step 2: Run repository checks**

Run:

```sh
pnpm typecheck
pnpm build
git diff --check
```

Expected: typecheck passes, build passes, and `git diff --check` prints no whitespace errors.

- [ ] **Step 3: Manual MCP smoke against the Guildhall repo**

Run:

```sh
pnpm build
node dist/cli.js mcp serve /Users/matthew/git/oss/guildhall
```

Expected: the process waits on stdio for an MCP client and does not print normal CLI chatter to stdout.

Use the SDK-client Vitest smoke as the automated proof for list/read/call behavior.

- [ ] **Step 4: Update the flow audit**

Mark the pending MCP bridge follow-up in `internal/audits/flow-audit.md` complete with the verification commands and any limitations found.

- [ ] **Step 5: Commit verification notes**

```sh
git add internal/audits/flow-audit.md
git commit -m "docs: record Guildhall MCP bridge verification"
```

## Acceptance Criteria

- `guildhall mcp serve <project>` starts a stdio MCP server with no stdout noise outside MCP frames.
- A real MCP SDK client can list Guildhall resources from the server.
- A real MCP SDK client can read `guildhall://project`, `guildhall://project/tasks`, `guildhall://project/tasks/<task-id>`, and `guildhall://project/artifacts/<artifact-id>`.
- An MCP client can call `guildhall.append_task_evidence` and the result appears in `.guildhall/PROGRESS.md`.
- An MCP client can call `guildhall.create_capability_request` and the request appears under `.guildhall/capability-requests`.
- The public tool/resource names do not mention Podman, container volume mounts, host browser proxying, or credential brokers.
- Current MCP client docs no longer claim WebSocket transport is supported by the implementation.
- Focused MCP tests, typecheck, build, and whitespace checks pass.

## Self-Review

- Spec coverage: the plan covers server contract, state reading, evidence mutation, capability requests, CLI serving, docs correction, and verification. Claude hooks and AGENTS.md export are intentionally out of scope for this first bridge slice.
- Placeholder scan: no task relies on an unspecified tool, path, or command.
- Type consistency: the plan uses `GuildhallMcpContext`, `buildGuildhallResourceIndex`, `readGuildhallResource`, `appendTaskEvidence`, `createMcpCapabilityRequest`, and `serveGuildhallMcpStdio` consistently across tasks.
