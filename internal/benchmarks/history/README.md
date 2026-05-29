# Benchmark History

This folder is the durable benchmark memory. It keeps curated summaries that
are useful for future product and engineering decisions without checking raw run
artifacts into Git.

## What Belongs Here

- benchmark date, branch or commit, benchmark id, and fixture/subset version
- model/provider and runtime settings that affect interpretation
- compact score summaries and pass/fail counts
- a short interpretation of what the result proves, does not prove, and what
  should be retested
- notable regressions, false successes, harness failures, and product follow-up
  decisions
- pointers to local raw artifacts when useful, clearly labeled as local/ignored

## What Does Not Belong Here

- raw model session exports
- generated project directories
- nested Git repositories or worktrees
- full screenshots from every run
- bulky JSONL/JSON reports for every attempt
- absolute-path-heavy logs copied wholesale
- repeated failed/rerun outputs that do not change the interpretation

Raw runs are generated under `internal/benchmarks/runs/` and are ignored. If a
specific screenshot or generated file becomes product documentation or a stable
fixture, move just that curated artifact into the appropriate docs or fixtures
folder with a short note explaining why it is durable.

## Entry Shape

Each history entry should be a Markdown file named:

```text
YYYY-MM-DD-<short-topic>.md
```

Use this structure:

```markdown
# <Benchmark Topic> - YYYY-MM-DD

## Scope

- Branch/commit:
- Benchmark:
- Fixture/subset:
- Models/providers:
- Runtime:
- Automation policy:

## Results

| Lane | Result | Score | Notes |
| --- | --- | --- | --- |

## Interpretation

- What this proves:
- What this does not prove:
- Regressions or false-success risks:
- Follow-up:

## Raw Evidence

Raw artifacts were generated under `internal/benchmarks/runs/...` and are
ignored by Git.
```
