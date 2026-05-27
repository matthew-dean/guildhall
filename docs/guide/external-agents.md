---
title: External agents and MCP
help_topic: guide.external_agents
help_summary: |
  How to let Codex, Claude Code, and other MCP-aware tools read Guildhall
  project context, task memory, artifacts, and capability requests.
---

# External agents and MCP

Guildhall works best when it is the place where work is planned, run,
reviewed, and remembered. Sometimes you still want to open another agent in the
same repository: a quick Codex session, a Claude Code pass, or another MCP-aware
tool your team already uses.

The Guildhall MCP bridge gives those tools a safer way to read the project than
digging through raw files. Instead of asking an outside agent to guess which
`.guildhall` files matter, you can expose a small project context API:

- project summary and coordinator configuration
- current task queue and individual task records
- registered artifact IDs, including audit checklists
- project memory, decisions, and capability requests
- tools for reading artifacts, appending task evidence, and requesting missing
  capabilities

That does not make the outside agent "be Guildhall." It gives the agent a
front door into Guildhall's memory so it can answer questions and make changes
with the same project facts Guildhall uses.

## Install the bridge

From any existing Guildhall project, run:

```sh
guildhall bridge install --target all .
```

Guildhall writes project instructions for supported agents and offers to wire
their MCP configuration. Use `--yes` when you want the setup to run without an
interactive prompt:

```sh
guildhall bridge install --target all --yes .
```

Use a single target when you only want one agent family:

```sh
guildhall bridge install --target codex --yes .
guildhall bridge install --target claude --yes .
```

The installer is idempotent. Re-running it updates Guildhall's managed block
and leaves your other project instructions alone.

## What gets written

For Codex, Guildhall writes or updates `AGENTS.md` in the project root. It also
offers to add a user-level Codex MCP server:

```sh
codex mcp add guildhall -- guildhall mcp serve .
```

Codex stores MCP servers in the user's Codex configuration. The command uses
`.` so the same `guildhall` MCP entry follows the repository where Codex is
launched.

For Claude Code, Guildhall writes or updates `CLAUDE.md` and creates a
project-scoped `.mcp.json` entry:

```json
{
  "mcpServers": {
    "guildhall": {
      "command": "guildhall",
      "args": ["mcp", "serve", "${CLAUDE_PROJECT_DIR:-.}"]
    }
  }
}
```

Claude Code treats project-scoped MCP servers as shared project configuration,
so `.mcp.json` is meant to be reviewed and checked in when the team wants that
behavior. Claude may ask for approval before using a project-scoped MCP server.

## What outside agents can read

The bridge exposes stable resource URIs:

```text
guildhall://project
guildhall://project/tasks
guildhall://project/tasks/<task-id>
guildhall://project/artifacts
guildhall://project/decisions
guildhall://project/memory
guildhall://project/capability-requests
```

It also exposes a small tool set:

```text
guildhall.read_artifact
guildhall.append_task_evidence
guildhall.create_capability_request
guildhall.list_capability_requests
```

That lets an outside agent answer questions like "what did Guildhall decide
about this task?", "which checklist is active?", or "what evidence marked this
work done?" without treating internal storage files as its public API.

## When to use it

Use the bridge when:

- you want another agent to answer a project-state question using Guildhall's
  task memory
- you want a short outside-agent pass without losing Guildhall's context
- you want the same artifact IDs and task evidence to stay visible after the
  pass
- you are evaluating another agent and want it to work from the same project
  facts

Keep using Guildhall itself for the full loop: shaping tasks, dispatching work,
reviewing evidence, recovery, and release state. The bridge is there for
interoperability, not to replace the harness.

## If MCP is not available

The generated instructions tell the outside agent to say when Guildhall MCP is
not configured. That distinction matters. A normal filesystem read can still be
useful, but it is not the same as reading Guildhall through the bridge.

If an outside agent needs a tool or credential it does not have, it can create a
capability request through the MCP bridge instead of inventing a workaround.
