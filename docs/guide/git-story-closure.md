---
title: Git Story Closure
help_topic: guide.git_story_closure
help_summary: |
  Git Story Closure shows whether project and task work is dirty, local,
  pushed, in a PR, merged, local-only, deferred, or blocked before release
  readiness says the work is actually closed.
---

# Git Story Closure

A task is not really done if the work is still sitting in a dirty checkout and
everyone has quietly agreed to pretend that is fine.

Git Story Closure is Guildhall's answer to the last mile of software work. It
does not replace Git. It makes the current Git story visible enough that you do
not have to reconstruct it from terminal archaeology.

## What Guildhall watches

Guildhall now keeps a Git Story Snapshot for projects and tasks. A snapshot can
say the work is:

- clean;
- dirty with uncommitted files;
- committed locally but not pushed;
- on a branch with no upstream;
- pushed with no known PR;
- attached to an open PR;
- merged;
- intentionally local-only;
- intentionally deferred;
- blocked by a conflict;
- unknown because Guildhall could not inspect the repo.

The snapshot includes the branch, upstream, ahead/behind counts, changed and
untracked file counts, sample paths, local commits, and PR details when they
are available cheaply.

## Where you see it

Projects Home shows compact project Git health so dirty, unpushed, PR, and
unresolved task-worktree state can be spotted before you open the project.

Inside the project shell, Thread task cards show a Git Story section when the
state still needs attention. The Provenance drawer keeps the fuller snapshot
beside merge records, so you can see both what Guildhall tried and what Git
currently says.

Current work closure also gets stricter. Dirty repos, local commits, missing
upstreams, pending PRs, skipped merges, stale task worktrees, and unknown Git
inspection failures become blockers until they are closed, marked local-only,
or deferred with a reason.

## Actions are policy-gated

Guildhall can help with the ordinary closure moves:

- inspect the diff;
- commit local changes with an explicit scope;
- push the branch;
- open a PR or show the existing PR;
- mark the work local-only;
- defer the Git story with a reason.

Those writes are gated by the project's Git Story policy. The default posture
is ask-first. If your global policy says completed work should be auto-committed,
new projects can inherit that preference; a project can still opt out and ask
every time.

Guildhall does not force-push, rebase shared branches, or rewrite published
history as part of the normal 0.8.0 path. That kind of move belongs behind an
explicit project setting and a very awake confirmation.

## Commit Story

When Guildhall does create a commit, it uses the Commit Story practice. The
message is concise and outcome-first:

- strong task titles become the subject;
- weak titles fall back to changed-path context;
- larger changes include the task id, counts, and a short path sample;
- AI attribution is not added.

The point is to leave a useful project history, not a receipt that says a model
touched files.

## Local-only and deferred are real states

Sometimes work should stay local. Sometimes the right Git move is "not yet."

Marking work **local-only** or **deferred** records that decision with a reason
and removes it from the accidental-residue pile. The Closure view can then
distinguish "we meant to leave this here" from "nobody noticed the branch was
still dangling."
