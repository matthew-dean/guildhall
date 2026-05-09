---
title: Node vs Deno packaging for Guildhall 0.5.0
---

# Node vs Deno packaging for Guildhall 0.5.0

## Decision

For `0.5.0`, Guildhall should ship the **Node-based packaged executable** path.

That means:

- recommended install: curl installer
- artifact shape: macOS-first packaged directory/tarball with:
  - bundled Node runtime
  - packaged Guildhall app payload
  - LaunchAgent install/uninstall helpers
- secondary install path: `npm install -g guildhall`

We are **not** choosing Deno packaging for `0.5.0`.

## Why this comparison mattered

The `0.5.0` product pivot wants Guildhall to feel like a real local tool and
service, not a repo-local sub-package. That makes packaging part of the
product, not just a release chore.

The question was whether Deno gave us a meaningfully better bundled-executable
story than staying with Node.

## Comparison setup

### Node experiment

Measured the real packaged artifact built by:

```bash
pnpm build:macos-package
```

Then installed it into a temp home with the local installer artifact:

```bash
HOME="$tmp_home" GUILDHALL_ARTIFACT_DIR="artifacts/macos/guildhall-macos" sh scripts/install.sh
```

Measured:

- artifact size
- startup behavior
- install complexity

### Deno experiment

Ran `deno compile` directly against the real built Guildhall CLI bundle:

```bash
deno compile \
  --allow-env \
  --allow-read \
  --allow-write \
  --allow-run \
  --allow-net \
  --allow-sys \
  --output guildhall-deno \
  dist/cli.js
```

Then retried with:

```bash
deno compile --no-check ...
```

Measured:

- compile viability
- binary size
- startup behavior
- workflow disruption

## Measured results

### Node packaged artifact

- tarball size: **45,436,293 bytes** (~45.4 MB)
- unpacked size: **217,124,864 bytes** (~217.1 MB)
- `guildhall --help`: **0.48s**
- `guildhall serve --no-open`: **0.49s** to return after starting the service

Runtime proof:

- installer wrote `~/Library/LaunchAgents/io.guildhall.agent.plist`
- installer started the Guildhall service
- `~/.guildhall/service.json` was written
- the service answered `GET /api/version`
- `guildhall stop` shut it down cleanly

Install complexity:

- moderate, but now explicit and controlled
- requires:
  - packaged artifact build
  - LaunchAgent install/uninstall scripts
  - curl installer
- importantly, it works with the current codebase without a runtime rewrite

### Deno compile of the real Guildhall CLI

#### First pass: straight compile

This failed immediately:

- `deno compile dist/cli.js` exited with module-resolution errors for:
  - `@modelcontextprotocol/sdk/client/index.js`
  - `@modelcontextprotocol/sdk/client/stdio.js`
  - `@modelcontextprotocol/sdk/client/streamableHttp.js`

That means the real Guildhall bundle is not currently Deno-compilable as-is.

#### Second pass: forced compile with `--no-check`

This did produce a binary, but only by bypassing type/module checking:

- compile time: **14.80s**
- binary size: **296,692,658 bytes** (~296.7 MB)
- `guildhall-deno --help`: **2.40s**

The compile output also showed Deno embedding a very large payload:

- repo `node_modules`
- packaged app payload under `artifacts/macos/...`
- other local files pulled in by the bundle graph

#### Runtime behavior

When running:

```bash
guildhall-deno serve --no-open
```

the compiled binary failed to start the service successfully:

- no `~/.guildhall/service.json`
- command exited with:
  - `Guildhall service did not become ready in time.`

Measured runtime:

- `guildhall-deno serve --no-open`: **8.24s**, ending in failure

## What this means

### Node path strengths

- works with the current Guildhall runtime architecture
- keeps the CLI/service semantics intact
- supports the LaunchAgent model cleanly
- no runtime-porting project hidden inside the installer work
- gave us a real install/start/stop proof this turn

### Deno path weaknesses for 0.5.0

- does not compile cleanly without `--no-check`
- produces a **larger** binary than the current Node packaged artifact
- is slower to start on the simple `--help` path
- failed the real `serve --no-open` startup path in this experiment
- introduces a second runtime model right when `0.5.0` is already doing a
  substantial product pivot

## Recommendation

Ship `0.5.0` with the **Node-based packaged executable**.

That is the best balance of:

- user experience
- packaging clarity
- implementation risk
- compatibility with the current Guildhall architecture

## Why Deno is rejected for now

Deno is not rejected forever. It is rejected for `0.5.0` because, in the
measured experiment, it was:

- less direct to compile
- larger
- slower
- and not yet reliable on the real service startup path

If we revisit it later, it should be as a deliberate runtime/product decision,
not as a side-effect of installer work.
