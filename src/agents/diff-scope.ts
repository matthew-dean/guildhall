/**
 * Diff-scope classification for gate gating.
 *
 * Gate-checker uses this to skip gates that are irrelevant to the diff —
 * running `pnpm build` on a pure-docs change is wasted time and masks real
 * signal. Classification is a pure function of the file list so it can be
 * called from the orchestrator, the gate-checker tool, or a test without
 * spawning git.
 */
export type DiffScope = 'doc_only' | 'config_only' | 'code'

const DOC_EXT_RE = /\.(md|mdx|txt|rst)$/i
const DOC_PATH_RE = /(^|\/)(LICENSE|CHANGELOG|README)(\.[^/]+)?$/i
const DOCS_DIR_RE = /(^|\/)docs\//i

const CONFIG_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /\.(ya?ml|toml)$/i,
  /(^|\/)\.editorconfig$/,
  /(^|\/)\.gitignore$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.nvmrc$/,
  /(^|\/)\.prettierrc([^/]*)?$/,
  /(^|\/)\.eslintrc([^/]*)?$/,
]

function isDocFile(path: string): boolean {
  if (DOCS_DIR_RE.test(path)) return true
  if (DOC_PATH_RE.test(path)) return true
  return DOC_EXT_RE.test(path)
}

function isConfigFile(path: string): boolean {
  return CONFIG_PATTERNS.some((re) => re.test(path))
}

/**
 * Classify a list of changed file paths.
 *
 *   - `doc_only`: every file is documentation (md/mdx/txt/rst, `docs/**`,
 *     LICENSE/CHANGELOG/README). Empty input is also `doc_only` — nothing
 *     changed means nothing needs to be gated.
 *   - `config_only`: every file is configuration (package.json, tsconfig,
 *     yaml/toml, dotfile configs). A diff that is pure config still needs
 *     lint/typecheck/build verification but skipping tests is safe.
 *   - `code`: anything else (or any mix that includes a code file).
 *
 * Doc-and-config mixes count as `config_only` (the stricter of the two
 * "lightweight" scopes) — the caller decides whether to promote to `code`.
 */
export function classifyDiffScope(files: readonly string[]): DiffScope {
  if (files.length === 0) return 'doc_only'
  let allDocs = true
  let allConfigOrDoc = true
  for (const raw of files) {
    const f = raw.trim()
    if (!f) continue
    const isDoc = isDocFile(f)
    const isCfg = isConfigFile(f)
    if (!isDoc) allDocs = false
    if (!isDoc && !isCfg) {
      allConfigOrDoc = false
      break
    }
  }
  if (allDocs) return 'doc_only'
  if (allConfigOrDoc) return 'config_only'
  return 'code'
}
