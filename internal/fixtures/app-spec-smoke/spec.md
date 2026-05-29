# Pantry Pulse App Spec

## Product Idea

Build a small local web app that tracks pantry items, highlights what expires soon, and lets the user mark an item as used.

## Required Behavior

- A page titled `Pantry Pulse`.
- A seeded list of at least five pantry items.
- Each item shows name, category, quantity, and expiration date.
- Items expiring within seven days are visually distinguished.
- A filter lets the user switch between all items and expiring-soon items.
- A `Mark used` action removes or marks an item as used.
- A visible count updates after marking an item used.

## Non-Goals

- User accounts.
- Remote persistence.
- Barcode scanning.
- Notifications.
- Multi-page navigation.
- Real database setup.
- Deployment.

## Stack Assumption

Use the smallest local web stack the runtime can run without external services. A tiny Vite/Svelte app is preferred when available; a plain Vite app is acceptable if it still supports automated and browser proof.

## Quality Bar

The app is complete only when the visible behavior works in the browser, the design foundation and rendered proof are recorded, filter controls use the right persistent-mode semantics, the palette rationale fits a warm grocery/domestic product with controlled saturation, and the actual design tokens match that rationale. Pantry Pulse should use a warm off-white or soft neutral base with sage, leaf-green, warm amber, citrus, or tomato/coral roles; a generic cool-blue or medical-blue primary/accent fails unless the design decision packet gives a product-specific reason reviewers accept. Design review must approve the result, and the completion handoff explains what shipped, how to launch it, what was verified, and what remains out of scope.
