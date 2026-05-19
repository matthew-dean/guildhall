---
title: Setup wizard
pageClass: gh-first-visit-page
---

# Setup wizard

Setup is the first project-specific stop when Guildhall does not yet have
enough information to run safely. The job is deliberately narrow: identify the
project, detect usable providers, store credentials in the right place, and
decide whether to let meta-intake draft the first project shape.

## What happens there

1. **Identity**: name the project and confirm the slug Guildhall will use in URLs, CLI commands, and project-scoped state.
2. **Provider detection**: check the provider paths Guildhall knows about, including Claude, Codex, Anthropic-compatible API keys, OpenAI-compatible API keys, and local OpenAI-compatible servers.
3. **Credentials**: store hosted-provider keys in `~/.guildhall/providers.yaml`, while CLI OAuth credentials stay in their provider-owned auth stores.
4. **Launch choice**: start with meta-intake when you want Guildhall to draft coordinators, bootstrap checks, and lever defaults, or skip into the shell when you already know what you want to configure manually.

The setup wizard should feel like a launch checklist, not a second product.
Once the project is ready, the normal operating surface is the project shell.

For implementation-level details, see the [Setup wizard UI reference](/web-ui/setup).
