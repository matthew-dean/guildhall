# Security standards
OWASP Top 10 awareness baked into every change.

## Secrets
- Never commit secrets to `config.yaml`, `guildhall.yaml`, or any tracked file.
- Secrets live in `.guildhall/config.yaml` (gitignored) or environment variables.
- Never log tokens, API keys, passwords, or PII. Redact before logging.
- Rotate any secret that has ever hit a commit, even if reverted.

## Input handling
- Validate all input at system boundaries: HTTP handlers, file parsers, queue consumers, CLI args.
- Internal code trusts its types. Do not re-validate between pure functions.
- Use a schema library (Zod) at the boundary. Parse, don't check.

## Injection
- Never concatenate user input into SQL, HTML, shell commands, or file paths.
- Use parameterized queries, templating with auto-escape, `execFile` with arg arrays.
- No `eval`, no `new Function`, no `setTimeout(string)`.
- Avoid `dangerouslySetInnerHTML` / `v-html` / equivalent. If unavoidable, sanitize with a vetted library and comment why.

## Surface area
- Rate-limit public endpoints. Per-IP and per-account where relevant.
- Authenticate before authorizing. Authorize every request, not just login.
- CSRF protection on state-changing requests from browsers.
- Set security headers: CSP, X-Content-Type-Options, Referrer-Policy, HSTS on HTTPS.

## Dependencies
- Run `pnpm audit` on add and on CI. Block high-severity without override.
- Review install scripts before adding deps.
- Prefer deps with active maintenance and a clean CVE history.
