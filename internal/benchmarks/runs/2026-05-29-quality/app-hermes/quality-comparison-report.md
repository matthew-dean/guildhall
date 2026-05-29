# Guildhall vs Hermes App Quality Comparison

Generated: 2026-05-29T14:44:13.877Z
Task: pantry-pulse-app-quality

This is an internal quality-first comparison. It measures whether each harness solved the same task accurately and truthfully. Token and cost telemetry are useful secondary context, not the score driver.

## Summary

- Guildhall: 5/100
- Hermes: 100/100
- Result: hermes

## Quality Scorecard

| Harness | Quality | Exit | Browser Load | Visible Items | Screenshots | Duration ms | Token/Cost Telemetry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| guildhall | 5/100 | 1 | no | 0 | 0 | 600015 | run-report / run-report |
| hermes | 100/100 | 0 | yes | 9 | 2 | 224914 | session-export / insights |

## Task

```
Build a dependency-free single-page Pantry Pulse web app in this project root. Use plain HTML, CSS, and JavaScript only; do not require npm install or a dev server. The app must include a visible heading "Pantry Pulse", at least seven seeded pantry items with category, quantity, and expiration text, an All / Expiring soon mutually-exclusive filter, a Mark used action that removes one visible item or marks it used, and a visible remaining-item count that updates. The design should feel app-store-caliber for a small domestic food utility: warm off-white or soft neutral base, sage/leaf green or warm amber primary/accent, coral/tomato or amber urgency, clear hierarchy, polished spacing, responsive mobile layout, and no generic blue primary/accent. Use semantic HTML and accessible controls. Then complete with truthful proof.
```

## Screenshots

### guildhall


### hermes

![hermes screenshot](/Users/matthew/git/oss/guildhall/internal/benchmarks/runs/2026-05-29-quality/app-hermes/screenshots/hermes/desktop.png)
![hermes screenshot](/Users/matthew/git/oss/guildhall/internal/benchmarks/runs/2026-05-29-quality/app-hermes/screenshots/hermes/mobile.png)


## Artifact Paths

- Guildhall project: /Users/matthew/git/oss/guildhall/internal/benchmarks/runs/2026-05-29-quality/app-hermes/guildhall-work
- Hermes project: /Users/matthew/git/oss/guildhall/internal/benchmarks/runs/2026-05-29-quality/app-hermes/hermes-work

## Interpretation Guardrail

Do not publish this as a broad benchmark claim. It is a smoke comparison of one task shape, useful for harness development and regression tracking.
