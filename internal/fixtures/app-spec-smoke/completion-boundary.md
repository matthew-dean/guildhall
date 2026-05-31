# Pantry Pulse Completion Boundary

The app-level work item can be marked complete only when:

- all required child work is done or explicitly deferred with rationale;
- the app can be launched inside the runtime;
- runtime command evidence exists for install/build/test or the fixture's equivalent checks;
- runtime dev-server evidence exists with host port mapping;
- design foundation evidence exists before the app is accepted;
- rendered desktop and mobile proof screenshots exist;
- control semantics are reviewed so persistent filter modes do not look like one-shot commands;
- palette rationale explains product mood, color roles, saturation budget, and accessibility expectations;
- token audit inspects the actual palette tokens, whether they are CSS custom properties, Sass/Less variables, JavaScript/TypeScript token objects, JSON, or another token source;
- the primary/accent token family fits warm domestic pantry use: sage, leaf-green, warm amber, citrus, or tomato/coral. Generic cool-blue, medical-blue, gray-only utility, one-note beige, all-purple, rustic brown-only, or grocery-cart green overload palettes fail unless a design decision packet gives a product-specific reason reviewers accept;
- a design reviewer approves the design proof;
- at least one reusable-vs-local design finding classification is recorded so Guildhall knows what belongs to the app and what might improve the design system;
- browser proof exists for opening the app, seeing seeded items, switching to expiring-soon items, marking one item used, and seeing the count update;
- review and gate records approve completion;
- completion handoff includes what was built, how to launch it, what was verified, what remains out of scope, known risks or residual uncertainty, and links or refs to runtime evidence and the proof path;
- memory candidates are generated for any repeated lesson or workflow miss;
- MCP/context audit can summarize the run without direct shell reads.

## False-Success Guard

If any required evidence is missing, the run is incomplete. The handoff may say what succeeded, but it must not claim the Pantry Pulse app spec is done.
