---
title: Sessions
help_topic: subsystem.sessions
help_summary: |
  Every agent conversation is snapshotted to ~/.cache/guildhall/sessions/
  after each turn. Resume warm with loadSessionById. Tool metadata is
  filtered through a persist-allowlist to avoid leaking secrets.
---

# Sessions

**Source:** `src/sessions/`

A `SessionSnapshot` captures everything needed to resume an agent:

```ts
interface SessionSnapshot {
  session_id: string
  cwd: string
  model: string
  system_prompt: string
  messages: ConversationMessage[]
  usage: UsageSnapshot
  tool_metadata: Record<string, unknown>
  created_at: string
  summary?: string
}
```

## Where they live

Session files are keyed by `SHA1(cwd)` so each project has its own subtree under `~/.cache/guildhall/sessions/<project-hash>/<session-id>.json`. Override the cache root with `GUILDHALL_DATA_DIR`.

## Public API

```ts
import {
  saveSessionSnapshot,
  loadSessionById,
  getProjectSessionDir,
  sanitizeConversationMessages,
} from 'guildhall/sessions'
```

- `saveSessionSnapshot({ cwd, snapshot })` — atomic write via `src/sessions/atomic.ts`.
- `loadSessionById(cwd, sessionId)` — returns `SessionSnapshot | null`.
- `sanitizeConversationMessages(messages)` — strips tool-result contents flagged as sensitive before persistence.

## Tool-metadata allowlist

Only keys in `PERSISTED_TOOL_METADATA_KEYS` (see `src/sessions/storage.ts`) survive persistence — e.g. `read_file_state`, `invoked_skills`. Everything else is dropped to avoid accidentally writing auth tokens or large in-memory buffers to disk.

## Atomic writes

`src/sessions/atomic.ts` implements write-then-rename. A crash mid-write leaves the previous snapshot intact; a stray temp file is cleaned up on next load.
