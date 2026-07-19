---
title: MCP
help_topic: subsystem.mcp
help_summary: |
  Connect Model Context Protocol servers to Guildhall, and expose Guildhall
  project context back out to other MCP-aware tools.
---

# MCP

**Source:** `./src/mcp/`

Guildhall consumes [Model Context Protocol](https://modelcontextprotocol.io)
servers. Any server you configure becomes available to agents as tools (and,
for resources, as `list_mcp_resources` / `read_mcp_resource`).

Guildhall can also serve its own project context over MCP. This lets tools such
as Codex and Claude Code read Guildhall task state, artifact IDs, project
memory, decisions, and capability requests without scraping raw `.guildhall`
files. See [External agents and MCP](../guide/external-agents) for the
user-facing setup flow.

## Configuration

```yaml
# ./guildhall.yaml
mcp:
  servers:
    github:
      type: stdio
      command: npx
      args: ["@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: ${GITHUB_TOKEN}
    notion:
      type: http
      url: https://mcp.example.com/notion
      headers:
        Authorization: "Bearer ${NOTION_TOKEN}"
    live:
      type: ws
      url: wss://mcp.example.com/live
```

Guildhall currently consumes stdio and streamable HTTP MCP servers. WebSocket
entries are parsed for configuration compatibility but are reported as
unsupported by the current client implementation.

## `McpClientManager`

```ts
import { McpClientManager, loadMcpServerConfigs } from 'guildhall/mcp'

const configs = loadMcpServerConfigs(workspace)
const manager = new McpClientManager(configs)
await manager.start()
const tools = await manager.listTools()
```

Manages connection lifecycle: auto-reconnect on disconnect, status tracking (`connected`, `failed`, `pending`, `disabled`), and graceful teardown.

## Adapter

`createMcpTools(manager, registry)` registers every MCP tool under the engine's `ToolRegistry`, prefixed by server name (e.g. `github.create_issue`). Resources become two tools:

- `list_mcp_resources` — returns every resource URI available across servers.
- `read_mcp_resource(uri)` — reads a single resource.

## Status in the UI

The browser UI surfaces `McpConnectionStatus` per server so you can see at a glance whether a configured server is up. Failed servers show the last error.

## Guildhall as an MCP server

```sh
guildhall mcp serve .
```

The server exposes resources such as:

- `guildhall://project`
- `guildhall://project/tasks`
- `guildhall://project/tasks/<task-id>`
- `guildhall://project/artifacts`
- `guildhall://project/decisions`
- `guildhall://project/memory`
- `guildhall://project/capability-requests`

It also exposes focused tools for artifact reads, task evidence, and capability
requests:

- `guildhall.read_artifact`
- `guildhall.append_task_evidence`
- `guildhall.create_capability_request`
- `guildhall.list_capability_requests`

Use `guildhall bridge install --target codex|claude|all .` to write the
project instructions and MCP configuration expected by supported external
agents.

## Security notes

MCP tool execution goes through the same `PermissionChecker` as built-in tools. You can scope which agents see which MCP tools via hook filters — e.g. make `github.*` available only to the `worker` role.
