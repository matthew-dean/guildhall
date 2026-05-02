export const SETUP_PROVIDER_ORDER = [
  'claude-oauth',
  'codex',
  'anthropic-api',
  'openai-api',
  'llama-cpp',
] as const

export type SetupProviderKey = (typeof SETUP_PROVIDER_ORDER)[number]

export type ProviderFamily =
  | 'authenticated-cli'
  | 'anthropic-compatible'
  | 'openai-compatible'

export function providerFamilyForSetupKey(key: SetupProviderKey): ProviderFamily {
  switch (key) {
    case 'claude-oauth':
    case 'codex':
      return 'authenticated-cli'
    case 'anthropic-api':
      return 'anthropic-compatible'
    case 'openai-api':
    case 'llama-cpp':
      return 'openai-compatible'
  }
}

export function providerFamilyForPreferredKey(
  key: 'claude-oauth' | 'codex' | 'codex-oauth' | 'llama-cpp' | 'anthropic-api' | 'openai-api',
): ProviderFamily {
  switch (key) {
    case 'claude-oauth':
    case 'codex':
    case 'codex-oauth':
      return 'authenticated-cli'
    case 'anthropic-api':
      return 'anthropic-compatible'
    case 'openai-api':
    case 'llama-cpp':
      return 'openai-compatible'
  }
}

export function providerLabelForSetupKey(key: SetupProviderKey): string {
  switch (key) {
    case 'claude-oauth':
      return 'Claude Code CLI'
    case 'codex':
      return 'Codex CLI'
    case 'anthropic-api':
      return 'Anthropic-compatible API key'
    case 'openai-api':
      return 'OpenAI-compatible API key'
    case 'llama-cpp':
      return 'OpenAI-compatible local server'
  }
}
