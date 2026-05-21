---
title: Existing project
pageClass: gh-first-visit-page
---

# Existing project

Existing repos usually arrive with README notes, plans, specs, TODOs, and
partly finished work. Guildhall should survey that evidence, frame the useful
parts, and avoid pretending every note is already a safe task.

## 1. Open the repo in Guildhall

```bash
cd ~/projects/existing-app
guildhall serve
```

If the project is not registered yet, attach it from the projects home or
finish the setup wizard from the project shell.

## 2. Survey the existing material

Guildhall can look through project files and propose drafts from:

- README and goal sections
- roadmap and TODO files
- nested planning docs
- checked-off milestones
- recent git history
- TODO or FIXME comments

The scan is not approval. It is the site survey: a way to find possible work,
show where it came from, and decide what needs framing before it can run.

## 3. Review drafts as blueprint candidates

Approve a draft only when it is clear enough to become a task blueprint and run
today.

Leave it as a draft when it is:

- a duplicate
- a context note
- a broad idea without success criteria
- blocked on a human choice
- something that should be grouped into a later release

For a large import, review by source instead of approving everything at once.

## 4. Start with the smallest framed set

The useful question is not "how many tasks did Guildhall find?" It is "which
few tasks can move without confusion?"

A good first set has no unresolved human question, a visible success signal,
and enough blueprint context for a worker to act without inventing the plan.

## 5. Start and expect evidence

When you press **Start**, the project should move work or stop with a visible
reason. A quiet flip from Stop back to Start is not acceptable evidence.

Next: [First task set](./first-tasks).
