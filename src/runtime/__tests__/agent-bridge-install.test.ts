import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bootstrapWorkspace } from '@guildhall/config'
import {
  configureClaudeProjectMcpBridge,
  configureCodexMcpBridge,
  installAgentBridgeInstructions,
} from '../agent-bridge-install.js'

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'guildhall-agent-bridge-'))
}

describe('installAgentBridgeInstructions', () => {
  it('creates a Codex AGENTS.md bridge for an existing Guildhall project', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Bridge Test' })

    const result = installAgentBridgeInstructions({ projectPath, target: 'codex' })
    const content = readFileSync(join(projectPath, 'AGENTS.md'), 'utf8')

    expect(result.action).toBe('created')
    expect(content).toContain('# Agent Instructions')
    expect(content).toContain('<!-- BEGIN Guildhall MCP bridge -->')
    expect(content).toContain('## Guildhall MCP Bridge')
    expect(content).toContain('Bridge Test is a Guildhall project.')
    expect(content).toContain('guildhall://project/artifacts')
    expect(content).toContain('guildhall.read_artifact')
    expect(content).toContain('guildhall mcp serve .')
  })

  it('updates only the managed bridge block and preserves existing instructions', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Managed Block Test' })
    const filePath = join(projectPath, 'AGENTS.md')
    writeFileSync(filePath, [
      '# Existing Instructions',
      '',
      'Keep this local rule.',
      '',
      '<!-- BEGIN Guildhall MCP bridge -->',
      'old bridge text',
      '<!-- END Guildhall MCP bridge -->',
      '',
      'Keep this footer.',
      '',
    ].join('\n'), 'utf8')

    const result = installAgentBridgeInstructions({ projectPath })
    const content = readFileSync(filePath, 'utf8')

    expect(result.action).toBe('updated')
    expect(content).toContain('Keep this local rule.')
    expect(content).toContain('Keep this footer.')
    expect(content).not.toContain('old bridge text')
    expect(content).toContain('Managed Block Test is a Guildhall project.')
  })

  it('is idempotent once the managed block is current', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Idempotent Test' })

    installAgentBridgeInstructions({ projectPath })
    const second = installAgentBridgeInstructions({ projectPath })

    expect(second.action).toBe('unchanged')
  })

  it('rejects non-Guildhall directories', () => {
    const projectPath = tmpProject()

    expect(() => installAgentBridgeInstructions({ projectPath })).toThrow(/guildhall.yaml not found/)
  })

  it('rejects unsupported targets', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Target Test' })

    expect(() => installAgentBridgeInstructions({ projectPath, target: 'gemini' })).toThrow(/Unsupported agent bridge target/)
  })

  it('creates Claude instructions for an existing Guildhall project', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Claude Bridge Test' })

    const result = installAgentBridgeInstructions({ projectPath, target: 'claude' })
    const content = readFileSync(join(projectPath, 'CLAUDE.md'), 'utf8')

    expect(result.action).toBe('created')
    expect(result.filePath).toBe(join(projectPath, 'CLAUDE.md'))
    expect(content).toContain('# Claude Instructions')
    expect(content).toContain('Claude Bridge Test is a Guildhall project.')
    expect(content).toContain('guildhall://project/tasks')
    expect(content).toContain('guildhall.read_artifact')
  })

  it('adds project-scoped Claude MCP config when it is missing', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Claude MCP Test' })

    const result = configureClaudeProjectMcpBridge({ projectPath })
    const content = JSON.parse(readFileSync(join(projectPath, '.mcp.json'), 'utf8'))

    expect(result.action).toBe('configured')
    expect(content.mcpServers.guildhall).toEqual({
      command: 'guildhall',
      args: ['mcp', 'serve', '${CLAUDE_PROJECT_DIR:-.}'],
    })
  })

  it('leaves matching project-scoped Claude MCP config alone', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Claude MCP Idempotent Test' })

    configureClaudeProjectMcpBridge({ projectPath })
    const result = configureClaudeProjectMcpBridge({ projectPath })

    expect(result.action).toBe('already-configured')
  })

  it('reports a conflicting Claude MCP config without replacing it', () => {
    const projectPath = tmpProject()
    bootstrapWorkspace(projectPath, { name: 'Claude MCP Conflict Test' })
    writeFileSync(join(projectPath, '.mcp.json'), JSON.stringify({
      mcpServers: {
        guildhall: {
          command: 'node',
          args: ['old-server.js'],
        },
      },
    }, null, 2), 'utf8')

    const result = configureClaudeProjectMcpBridge({ projectPath })
    const content = JSON.parse(readFileSync(join(projectPath, '.mcp.json'), 'utf8'))

    expect(result.action).toBe('conflict')
    expect(result.message).toContain('.mcp.json')
    expect(content.mcpServers.guildhall.command).toBe('node')
  })

  it('adds the global Codex MCP bridge when it is missing', () => {
    const calls: Array<{ command: string, args: string[] }> = []

    const result = configureCodexMcpBridge({
      run(command, args) {
        calls.push({ command, args })
        if (args.join(' ') === 'mcp get guildhall') {
          return { status: 1, stdout: '', stderr: 'not found' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(result.action).toBe('configured')
    expect(calls).toEqual([
      { command: 'codex', args: ['mcp', 'get', 'guildhall'] },
      { command: 'codex', args: ['mcp', 'add', 'guildhall', '--', 'guildhall', 'mcp', 'serve', '.'] },
    ])
  })

  it('leaves an existing matching Codex MCP bridge alone', () => {
    const calls: Array<{ command: string, args: string[] }> = []

    const result = configureCodexMcpBridge({
      run(command, args) {
        calls.push({ command, args })
        return {
          status: 0,
          stdout: [
            'guildhall',
            '  enabled: true',
            '  transport: stdio',
            '  command: guildhall',
            '  args: mcp serve .',
          ].join('\n'),
          stderr: '',
        }
      },
    })

    expect(result.action).toBe('already-configured')
    expect(calls).toEqual([{ command: 'codex', args: ['mcp', 'get', 'guildhall'] }])
  })

  it('reports a conflicting Codex MCP bridge without replacing it', () => {
    const result = configureCodexMcpBridge({
      run() {
        return {
          status: 0,
          stdout: [
            'guildhall',
            '  enabled: true',
            '  transport: stdio',
            '  command: node',
            '  args: old-server.js',
          ].join('\n'),
          stderr: '',
        }
      },
    })

    expect(result.action).toBe('conflict')
    expect(result.message).toContain('codex mcp remove guildhall')
  })
})
