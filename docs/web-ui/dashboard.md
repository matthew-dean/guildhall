---
title: Dashboard
pageClass: gh-first-visit-page
help_topic: web.dashboard
help_summary: |
  Service-level front door for Guildhall. Attach a project, scan what is
  blocked or moving, and open the shell that needs attention.
---

# Projects home keeps the local service organized

Guildhall behaves like a local service over projects, not a one-repo session.
Attach a folder, scan what is moving, and open the shell that actually needs
your eyes.

## What the dashboard should answer quickly

- **Can this project run at all?**
- **What is blocked or on fire?**
- **Which shell needs attention first?**

If the page cannot answer those three questions fast, it is being decorative when it should be operational.

## The actual job of each card

- Project identity and whether the service still recognizes it
- Run status and whether the guild is active, idle, paused, or unhappy
- Blocked work and unresolved escalations
- Enough signal to tell whether opening the shell is likely to be a quick check or a proper firefight

<picture class="gh-doc-picture">
  <source srcset="../assets/ui-audit/projects.avif" type="image/avif" />
  <img src="../assets/ui-audit/projects.png" alt="Guildhall projects home showing multiple local projects with paused, stable, and ready states." />
</picture>

The Projects home is deliberately shallow. It helps you choose where to look
next; the detailed Thread, Work, Settings, Learning, and Release surfaces stay
inside the project shell.
