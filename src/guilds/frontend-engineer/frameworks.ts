import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Detected frontend framework for a project, derived from the nearest
 * `package.json`. We only report the frameworks we have dedicated principles
 * layers for; anything else is `null` and the Frontend Engineer ships its
 * framework-agnostic principles.
 */
export type DetectedFramework =
  | 'react'
  | 'vue'
  | 'svelte'
  | 'solid'
  | 'angular'
  | null

export function detectFramework(projectPath: string): DetectedFramework {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const deps = {
    ...(parsed as Record<string, unknown>).dependencies as Record<string, string> | undefined,
    ...(parsed as Record<string, unknown>).devDependencies as Record<string, string> | undefined,
    ...(parsed as Record<string, unknown>).peerDependencies as Record<string, string> | undefined,
  }
  if (!deps) return null
  // Detection order: more specific frameworks first.
  if ('svelte' in deps) return 'svelte'
  if ('vue' in deps) return 'vue'
  if ('@angular/core' in deps) return 'angular'
  if ('solid-js' in deps) return 'solid'
  if ('react' in deps) return 'react'
  return null
}

/**
 * A small framework-specific "skill layer" the Frontend Engineer wears on
 * top of its base principles. Kept short — the engineer already knows how
 * to write code; this nudges toward idiomatic patterns and away from common
 * anti-patterns in each framework.
 */
const FRAMEWORK_LAYERS: Record<Exclude<DetectedFramework, null>, string> = {
  react: `
**React layer.** Follow the Rules of Hooks strictly — no conditional hook calls,
no hooks inside loops. Stale-closure bugs start with misusing \`useEffect\`
dependencies; prefer \`useCallback\` / \`useMemo\` only when profiling shows
re-render pressure, not speculatively. For server components vs. client
components, annotate \`'use client'\` only at the leaf — don't bubble it up.
Keys on lists are stable ids, never array indexes.
`.trim(),
  vue: `
**Vue layer.** Use the Composition API (\`<script setup>\`) for new code. Reactivity
is through \`ref\` / \`reactive\` / \`computed\` — don't mutate props. Emit events
with typed \`defineEmits\`; expose a typed \`defineProps\`. Use \`v-model\` with
explicit modelValue / update:modelValue for controlled components. Slots are
named; scoped slots carry typed payloads. Avoid global mixins.
`.trim(),
  svelte: `
**Svelte layer.** Prefer runes (\`$state\`, \`$derived\`, \`$effect\`) on Svelte 5.
Use \`$props()\` for typed props, \`$bindable()\` when the component supports
two-way binding. \`$effect\` is for side effects (subscriptions, DOM touching);
\`$derived\` is for values computed from other state. Don't reach for stores
where a rune does the job. CSS stays scoped unless :global is deliberate.
`.trim(),
  solid: `
**Solid layer.** Signals are not React state — don't destructure props or
you'll break reactivity. Use \`createSignal\` / \`createMemo\` / \`createEffect\`
consistently. \`<Show>\` and \`<For>\` are preferred over ternaries and \`.map()\`.
Avoid recreating components inside render paths.
`.trim(),
  angular: `
**Angular layer.** Signals and the new control flow (\`@if\`, \`@for\`, \`@switch\`)
on Angular 17+. Prefer standalone components — avoid NgModules for new work.
Typed reactive forms. OnPush change detection unless there's a documented
reason otherwise.
`.trim(),
}

export function frameworkLayer(framework: DetectedFramework): string {
  if (!framework) return ''
  return FRAMEWORK_LAYERS[framework]
}
