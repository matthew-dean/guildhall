# Hermes Comparison Smoke Report

Generated for the 0.9.0 internal benchmark milestone on 2026-05-28.

This is a Guildhall smoke run plus a Hermes availability check. It is not a
completed Guildhall-vs-Hermes comparison because no Hermes benchmark task ran.

## Guildhall Runs

Commands:

```bash
pnpm build
node dist/cli.js benchmarks run lifecycle --fixture-set smoke --automation fully-automated --output-dir /tmp/guildhall-hermes-comparison-20260528/guildhall/lifecycle
node dist/cli.js benchmarks run tblite --subset smoke --automation fully-automated --output-dir /tmp/guildhall-hermes-comparison-20260528/guildhall/tblite
node dist/cli.js benchmarks run swe-local --subset smoke --automation fully-automated --output-dir /tmp/guildhall-hermes-comparison-20260528/guildhall/swe-local
```

Results:

| Lane | Result | Subset hash | Output |
| --- | --- | --- | --- |
| Lifecycle smoke | passed 9/9 | `7600cb2cae178c33` | `/tmp/guildhall-hermes-comparison-20260528/guildhall/lifecycle/lifecycle-95910fe7-6f9d-480d-b34a-132819420d89.{jsonl,md}` |
| TBLite smoke | passed 1/1 | `0805b9523c1027af` | `/tmp/guildhall-hermes-comparison-20260528/guildhall/tblite/tblite-7a03ed25-fcf8-40a6-bf55-d45af7b9c295.{jsonl,md}` |
| SWE-local smoke | passed 1/1 | `4ddcc87c5f4c82b9` | `/tmp/guildhall-hermes-comparison-20260528/guildhall/swe-local/swe-local-8da1977a-6caa-4313-a2b0-1b1d23f865a4.{jsonl,md}` |

Telemetry exposed by the current Guildhall smoke harness:

| Field | Current value | Notes |
| --- | --- | --- |
| Input/output tokens | `0/0` for every smoke result | The current smoke fixtures are deterministic and use `modelProvider: fixture`, `model: deterministic-smoke`. |
| Cost | `0` for every smoke result | Not comparable to a live model-backed Hermes run. |
| Turns | `1` for every smoke result | Fixture-level count, not live agent loop depth. |
| Command count | `0` for lifecycle and SWE-local, `1` for TBLite | TBLite smoke runs one runtime command. |
| Latency | `0-4ms` in this local run | Fixture execution only; not model latency. |

## Hermes Availability Check

Local `PATH` and home-state checks:

- `command -v hermes` returned no path.
- `~/.hermes` was absent.
- No `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `NOUS_*`, `MODAL_TOKEN_ID`, or `MODAL_TOKEN_SECRET` variables were present in
  the process environment. Only unrelated Slack MCP auth was present.

Temp install and version checks:

```bash
git clone --depth 1 --branch v2026.5.28 https://github.com/NousResearch/hermes-agent.git /tmp/guildhall-hermes-comparison-20260528/hermes-agent
git clone --depth 1 https://github.com/NousResearch/hermes-agent.git /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main
HERMES_HOME=/tmp/guildhall-hermes-comparison-20260528/hermes-home uv run --python 3.11 --project /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main hermes --version
HERMES_HOME=/tmp/guildhall-hermes-comparison-20260528/hermes-home uv run --python 3.11 --project /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main hermes doctor
```

Evidence:

- Latest release tag `v2026.5.28` peeled to
  `0c859a1c044c77d24bcc8832f5a27d8b4a50fab7`.
- Current `main` cloned at `11d93096b39e2956deae7dbf5b2bdb67a2059521`.
- `hermes --version` reported `Hermes Agent v0.15.0 (2026.5.28)`,
  Python 3.11.13, OpenAI SDK 2.24.0.
- Both the pinned tag and current `main` lacked `environments/`.
- `hermes doctor` reported the temp home was missing `.env`, config, provider
  auth, and OpenRouter API configuration.

Hermes one-shot attempt:

```bash
HERMES_HOME=/tmp/guildhall-hermes-comparison-20260528/hermes-home \
  uv run --python 3.11 --project /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main \
  hermes --ignore-user-config --yolo -z "Benchmark smoke: create the file /tmp/guildhall-hermes-comparison-20260528/hermes-smoke-output.txt containing exactly guildhall hermes smoke, then report done."
```

Result: failed before a model call with `AuthError: No inference provider
configured. Run 'hermes model' to choose a provider and model, or set an API key
(OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env.`

## Comparison Status

`BLOCKED_FOR_HERMES_RUN`.

The Guildhall smoke output exists. Hermes did not run a benchmark task, so there
is no Hermes quality, token, cost, turn, command, or latency data to compare.

Current Hermes telemetry gap:

- Hermes session code exposes input/output/cache tokens, total tokens,
  estimated cost, actual cost, cost status, message count, tool-call count, and
  session duration through the session store and `hermes insights`.
- The documented Hermes benchmark entrypoints were not present in the checked
  current source tree, so this local pass could not confirm whether benchmark
  runs preserve those fields per task.
- If Hermes runs through normal sessions, token and cost can likely be read from
  `hermes sessions export` / `hermes insights` or provider telemetry. If it runs
  through restored benchmark scripts, the scripts must expose per-task usage or
  the comparison must mark token/cost as provider-log estimated or missing.

Do not publish comparative claims from this smoke report. It only proves that
Guildhall smoke outputs exist and that the Hermes half is blocked before task
execution in this environment.
