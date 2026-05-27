import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  findWorkspaceRoot,
  FORGE_YAML_FILENAME,
  readWorkspaceConfig,
} from '@guildhall/config'

const CODEX_TARGET = 'codex'
const CLAUDE_TARGET = 'claude'
const BEGIN_MARKER = '<!-- BEGIN Guildhall MCP bridge -->'
const END_MARKER = '<!-- END Guildhall MCP bridge -->'

export type AgentBridgeTarget = typeof CODEX_TARGET | typeof CLAUDE_TARGET
export type AgentBridgeInstallAction = 'created' | 'updated' | 'unchanged'
export type CodexMcpBridgeAction = 'configured' | 'already-configured' | 'conflict' | 'unavailable'
export type ClaudeMcpBridgeAction = 'configured' | 'already-configured' | 'conflict'

export interface CommandResult {
  status: number
  stdout: string
  stderr: string
}

export interface ConfigureCodexMcpBridgeInput {
  run?: (command: string, args: string[]) => CommandResult
}

export interface ConfigureCodexMcpBridgeResult {
  action: CodexMcpBridgeAction
  message: string
}

export interface ConfigureClaudeProjectMcpBridgeInput {
  projectPath: string
}

export interface ConfigureClaudeProjectMcpBridgeResult {
  action: ClaudeMcpBridgeAction
  filePath: string
  message: string
}

export interface InstallAgentBridgeInstructionsInput {
  projectPath: string
  target?: string
}

export interface InstallAgentBridgeInstructionsResult {
  action: AgentBridgeInstallAction
  filePath: string
  projectPath: string
  target: AgentBridgeTarget
}

export function installAgentBridgeInstructions(
  input: InstallAgentBridgeInstructionsInput,
): InstallAgentBridgeInstructionsResult {
  const target = normalizeTarget(input.target ?? CODEX_TARGET)
  const projectPath = resolveProjectRoot(input.projectPath)
  const config = readWorkspaceConfig(projectPath)
  const filePath = join(projectPath, target === CLAUDE_TARGET ? 'CLAUDE.md' : 'AGENTS.md')
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const next = upsertManagedSection(
    existing,
    renderGuildhallMcpInstructionSection({ projectName: config.name }),
    target === CLAUDE_TARGET ? '# Claude Instructions' : '# Agent Instructions',
  )

  if (existing === next) {
    return { action: 'unchanged', filePath, projectPath, target }
  }

  writeFileSync(filePath, next, 'utf8')
  return {
    action: existing ? 'updated' : 'created',
    filePath,
    projectPath,
    target,
  }
}

export function renderCodexGuildhallMcpSection(input: { projectName?: string }): string {
  return renderGuildhallMcpInstructionSection(input)
}

export function renderGuildhallMcpInstructionSection(input: { projectName?: string }): string {
  const projectLabel = input.projectName?.trim() || 'this project'
  return `## Guildhall MCP Bridge

${projectLabel} is a Guildhall project. When Guildhall MCP tools are available, use them as the first source of project context before reading raw \`.guildhall/\` files.

Start with these MCP resources:

- \`guildhall://project\`
- \`guildhall://project/tasks\`
- \`guildhall://project/artifacts\`
- \`guildhall://project/decisions\`
- \`guildhall://project/memory\`

For artifact-scoped work, resolve IDs through \`guildhall://project/artifacts\` and prefer \`guildhall.read_artifact\` over guessing paths. If the task changes project state, use \`guildhall.append_task_evidence\` for audit notes when there is an active Guildhall task. If an external agent needs permission, tools, or host access it does not have, use \`guildhall.create_capability_request\` instead of silently working around the missing capability.

To start the local MCP server from this project root:

\`\`\`sh
guildhall mcp serve .
\`\`\`

If Guildhall MCP tools are not configured in the current agent session, say so explicitly and fall back to normal repository inspection. Do not imply that filesystem reads came from Guildhall MCP.`
}

export function configureCodexMcpBridge(
  input: ConfigureCodexMcpBridgeInput = {},
): ConfigureCodexMcpBridgeResult {
  const run = input.run ?? runCommand
  const current = run('codex', ['mcp', 'get', 'guildhall'])

  if (current.status === 0) {
    if (isExpectedCodexMcpConfig(current.stdout)) {
      return {
        action: 'already-configured',
        message: 'Codex MCP server "guildhall" is already configured.',
      }
    }
    return {
      action: 'conflict',
      message: [
        'Codex MCP server "guildhall" already exists with a different command.',
        'Review it with `codex mcp get guildhall`.',
        'To replace it manually: `codex mcp remove guildhall` then `codex mcp add guildhall -- guildhall mcp serve .`.',
      ].join(' '),
    }
  }

  const added = run('codex', ['mcp', 'add', 'guildhall', '--', 'guildhall', 'mcp', 'serve', '.'])
  if (added.status !== 0) {
    return {
      action: 'unavailable',
      message: `Could not configure Codex MCP bridge: ${added.stderr || added.stdout || 'codex command failed'}`,
    }
  }

  return {
    action: 'configured',
    message: 'Configured Codex MCP server "guildhall" as `guildhall mcp serve .`.',
  }
}

export function configureClaudeProjectMcpBridge(
  input: ConfigureClaudeProjectMcpBridgeInput,
): ConfigureClaudeProjectMcpBridgeResult {
  const projectPath = resolveProjectRoot(input.projectPath)
  const filePath = join(projectPath, '.mcp.json')
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const parsed = existing.trim() ? parseMcpJson(existing, filePath) : {}
  const root = isRecord(parsed) ? parsed : {}
  const mcpServersRaw = root.mcpServers
  const mcpServers = isRecord(mcpServersRaw) ? mcpServersRaw : {}
  const current = mcpServers.guildhall

  if (current !== undefined) {
    if (isExpectedClaudeMcpConfig(current)) {
      return {
        action: 'already-configured',
        filePath,
        message: 'Claude project MCP server "guildhall" is already configured.',
      }
    }
    return {
      action: 'conflict',
      filePath,
      message: 'Claude project MCP server "guildhall" already exists in .mcp.json with a different command. Review it before replacing user state.',
    }
  }

  const next = {
    ...root,
    mcpServers: {
      ...mcpServers,
      guildhall: expectedClaudeMcpConfig(),
    },
  }
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return {
    action: 'configured',
    filePath,
    message: 'Configured Claude project MCP server "guildhall" in .mcp.json.',
  }
}

function resolveProjectRoot(projectPath: string): string {
  const resolved = resolve(projectPath)
  const root = findWorkspaceRoot(resolved)
  if (root) return root
  throw new Error(`Cannot install agent bridge: ${FORGE_YAML_FILENAME} not found at or above ${resolved}`)
}

function normalizeTarget(target: string): AgentBridgeTarget {
  if (target === CODEX_TARGET) return CODEX_TARGET
  if (target === CLAUDE_TARGET) return CLAUDE_TARGET
  throw new Error(`Unsupported agent bridge target "${target}". Supported targets: ${CODEX_TARGET}, ${CLAUDE_TARGET}`)
}

function upsertManagedSection(existing: string, section: string, defaultHeading: string): string {
  const block = `${BEGIN_MARKER}\n${section.trimEnd()}\n${END_MARKER}`
  if (!existing.trim()) return `${defaultHeading}\n\n${block}\n`

  const managedSection = new RegExp(`${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`)
  if (managedSection.test(existing)) {
    const replaced = existing.replace(managedSection, block)
    return ensureTrailingNewline(replaced)
  }

  return `${existing.trimEnd()}\n\n${block}\n`
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isExpectedCodexMcpConfig(output: string): boolean {
  return /command:\s*guildhall/.test(output) && /args:\s*mcp serve \./.test(output)
}

function runCommand(command: string, args: string[]): CommandResult {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const failed = err as { status?: number, stdout?: Buffer | string, stderr?: Buffer | string }
    return {
      status: failed.status ?? 1,
      stdout: bufferishToString(failed.stdout),
      stderr: bufferishToString(failed.stderr),
    }
  }
}

function bufferishToString(value: Buffer | string | undefined): string {
  if (!value) return ''
  return typeof value === 'string' ? value : value.toString('utf8')
}

function expectedClaudeMcpConfig(): Record<string, unknown> {
  return {
    command: 'guildhall',
    args: ['mcp', 'serve', '${CLAUDE_PROJECT_DIR:-.}'],
  }
}

function isExpectedClaudeMcpConfig(value: unknown): boolean {
  return isRecord(value) &&
    value.command === 'guildhall' &&
    Array.isArray(value.args) &&
    value.args.length === 3 &&
    value.args[0] === 'mcp' &&
    value.args[1] === 'serve' &&
    value.args[2] === '${CLAUDE_PROJECT_DIR:-.}'
}

function parseMcpJson(raw: string, filePath: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
