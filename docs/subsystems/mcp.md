---
title: MCP
help_topic: subsystem.mcp
help_summary: |
  Connect Model Context Protocol servers (stdio, HTTP, WebSocket) and expose
  their tools and resources to agents. Configured under mcp.servers in
  guildhall.yaml.
---

# MCP

**Source:** `src/mcp/`

GuildHall consumes [Model Context Protocol](https://modelcontextprotocol.io) servers. Any server you configure becomes available to agents as tools (and, for resources, as `list_mcp_resources` / `read_mcp_resource`).

## Configuration

```yaml
# guildhall.yaml
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

All three transports (`stdio`, `http`, `ws`) are supported.

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

The dashboard surfaces `McpConnectionStatus` per server so you can see at a glance whether a configured server is up. Failed servers show the last error.

## Security notes

MCP tool execution goes through the same `PermissionChecker` as built-in tools. You can scope which agents see which MCP tools via hook filters — e.g. make `github.*` available only to the `worker` role.
