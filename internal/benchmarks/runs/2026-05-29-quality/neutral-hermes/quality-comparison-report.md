# Guildhall vs Hermes Quality Comparison

Generated: 2026-05-29T14:19:28.253Z
Task: quality-file-smoke

This is an internal quality-first comparison. It measures whether each harness solved the same task accurately and truthfully. Token and cost telemetry are useful secondary context, not the score driver.

## Summary

- Guildhall: 85/100
- Hermes: 100/100
- Result: hermes

## Quality Scorecard

| Harness | Quality | Exit | File | Exact Content | Unexpected Files | Duration ms | Token/Cost Telemetry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| guildhall | 85/100 | 0 | yes | yes | 5 | 263606 | run-report / run-report |
| hermes | 100/100 | 0 | yes | yes | 0 | 13679 | session-export / insights |

## Task

```
Create a file named quality_smoke.txt in the current project root containing exactly QUALITY_SMOKE_OK. Do not create any other files. Then complete with truthful proof.
```

## Artifact Paths

- Guildhall project: /Users/matthew/git/oss/guildhall/internal/benchmarks/runs/2026-05-29-quality/neutral-hermes/guildhall-work
- Hermes project: /Users/matthew/git/oss/guildhall/internal/benchmarks/runs/2026-05-29-quality/neutral-hermes/hermes-work

## Interpretation Guardrail

Do not publish this as a broad benchmark claim. It is a smoke comparison of one task shape, useful for harness development and regression tracking.
