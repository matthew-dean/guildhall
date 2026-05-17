---
title: New project
pageClass: gh-first-visit-page
---

# New project

Use this path when the repo is empty, young, or still mostly in your head. The
goal is not to generate a giant backlog. The goal is to make the project
visible and prove one small loop.

## 1. Open the repo

```bash
cd ~/projects/my-new-app
guildhall serve
```

Guildhall opens the setup wizard if the folder is not registered yet.

## 2. Name the project

Use a human project name and a stable slug. The slug is what makes URLs
project-scoped, so it should not depend on a temporary folder name.

## 3. Choose how the guild does AI work

Pick the account, CLI, or local model Guildhall should use. You can change
this later; the first run only needs one working path.

## 4. Create one starter task

Start with a task that proves the system can move:

- create the first README
- add a tiny route or component
- wire one test command
- fix one known setup failure

Avoid "build the whole app" as the first task. That belongs after the guild
has enough project context and a shaped plan.

## 5. Start and watch

Press **Start** only after the task is clear enough to judge. You should see
live movement in the shell: the task changing state, notes appearing, and any
blocker attached to the project.

Next: [First task set](./first-tasks).
