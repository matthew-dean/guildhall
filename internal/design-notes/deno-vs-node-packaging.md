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

## Result

The Node-based packaged executable won because it was smaller, faster to start,
compatible with the current runtime architecture, and already proven on the real
install/start/stop path.

The Deno experiment compiled only with `--no-check`, produced a larger binary,
and failed the real `serve --no-open` startup path in our comparison.
