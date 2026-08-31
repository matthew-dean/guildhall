---
title: Ways to work
---

# Ways to work

Guildhall does not need you to choose a process before you describe the work.
You can drop in a rough idea, a feature request, a bug, a release goal, or a
repo with almost no notes. Guildhall's job is to turn that into the right shape
of work, with enough pressure-testing to make the next step trustworthy.

## Start with the whole project

For a new or unfamiliar repo, start from the project shell. Guildhall surveys
the folder, asks for the minimum project direction, drafts the first useful
work, and keeps the queue small enough that you can tell what is happening.

This is the right mode when the project does not have a shared direction yet,
when you are importing old notes, or when you want Guildhall to find the first
safe slice instead of handing it a finished backlog.

## Start with one feature

Use **New request** when you already know the feature, fix, or release outcome.
You do not need to pre-split it. Write the request the way you would say it:
what you want, what should not change, what you are worried about, and any
source material worth reading.

Guildhall pressure-tests that ask, then decides whether it is one work item or
containing work with nested work below it. A feature might become planning,
implementation, docs, screenshots, migration, and verification items, all tied
to the same visible hierarchy.

## Start one focused work item

Sometimes you do not want the whole queue to run. Open a work card or task
drawer and choose **Start only this work item**. Guildhall scopes the run to
that item and its nested work instead of quietly moving unrelated project tasks.

That makes feature-at-a-time work practical. You can let Guildhall split a
feature into the right pieces, then run just the piece you are ready to trust:
implementation, verification, docs, release prep, or a decision item.

## Let setup move first

If the repo cannot run yet, Guildhall may create setup or verification work
before product implementation. That is not busywork. It keeps the build,
runtime, provider, screenshot, or release proof from being discovered at the
end, when every failure is more expensive.

The setup item can be nested under the feature or project goal it supports, so
the queue still explains why the work exists.

## Explore before building

Some requests are really decisions: choose a policy, compare libraries, map a
legacy system, or decide whether a change belongs in this release. Guildhall can
hold that as research or decision work, collect evidence, and only then create
implementation work.

The important part is that dependencies and containment stay separate. Nested
work explains ownership and shape. Dependencies explain order. A verification
item can depend on implementation without becoming a child of the implementation
item, and a feature can contain several independent slices without pretending
they all block each other.

## Finish at the right boundary

Each containing item has a completion boundary: what must be true before
Guildhall can call that item done. For a small fix, that might be one changed
file and a passing check. For a feature, it might be all required nested items,
fresh screenshots, docs, migration proof, and a clean Git Story.

You still get the simple work list. Done and shelved work stays out of the way
by default, but it is still there when you need the receipt trail.
