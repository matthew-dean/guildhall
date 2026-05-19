---
title: Project shell
pageClass: gh-first-visit-page
---

# Project shell

The project shell is where Guildhall shifts from service-level scanning into
the actual work happening inside one project. It should answer the same
questions every time: what is moving, what needs you, what is safe to start,
and what evidence exists for the last decision.

![Guildhall project shell with work queue, live activity, and progress groups.](../assets/ui-audit/work.png)

## The main surfaces

- **Thread**: the command and decision surface. Setup prompts, spec approvals, live worker trouble, and human questions all gather here.
- **Work**: the queue and movement surface. Use it to judge whether tasks are progressing, waiting, blocked, or ready for review.
- **Release**: the readiness lane. It keeps reviewer verdicts and release checks visible before work gets treated as shippable.
- **Settings**: the policy and setup layer. Providers, facts, learning, and advanced controls live here.

## What good looks like

- The next real action is obvious.
- Human questions and machine progress stay in one readable story.
- Reviewer and release state appear before they become surprises.
- Transcript and provenance are close enough that you can challenge the run.

For implementation-level details, see the [Project shell UI reference](/web-ui/project-view).
