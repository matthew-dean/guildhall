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

export interface ProviderCapabilities {
  streaming: boolean
  toolCalls: boolean
  resumableSessions: boolean
  reasoningSideChannel: 'none' | 'compatible'
  browserAppControl: boolean
  recommendedConcurrency: number
  localServer: boolean
}

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

export function providerLabelForAnyKey(
  key:
    | SetupProviderKey
    | 'codex-oauth'
    | 'none'
    | null
    | undefined,
): string {
  switch (key) {
    case 'claude-oauth':
      return 'Claude Code CLI'
    case 'codex':
    case 'codex-oauth':
      return 'Codex CLI'
    case 'anthropic-api':
      return 'Anthropic-compatible API'
    case 'openai-api':
      return 'OpenAI-compatible API'
    case 'llama-cpp':
      return 'OpenAI-compatible local server'
    case 'none':
      return 'None'
    default:
      return 'Not selected'
  }
}

export function providerFamilyForAnyKey(
  key:
    | SetupProviderKey
    | 'codex-oauth'
    | 'none'
    | null
    | undefined,
): ProviderFamily | null {
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
    default:
      return null
  }
}

export function providerCapabilitiesForAnyKey(
  key:
    | SetupProviderKey
    | 'codex-oauth'
    | 'none'
    | null
    | undefined,
): ProviderCapabilities | null {
  switch (key) {
    case 'claude-oauth':
      return {
        streaming: true,
        toolCalls: true,
        resumableSessions: true,
        reasoningSideChannel: 'none',
        browserAppControl: false,
        recommendedConcurrency: 2,
        localServer: false,
      }
    case 'codex':
    case 'codex-oauth':
      return {
        streaming: true,
        toolCalls: true,
        resumableSessions: true,
        reasoningSideChannel: 'none',
        browserAppControl: false,
        recommendedConcurrency: 2,
        localServer: false,
      }
    case 'anthropic-api':
      return {
        streaming: true,
        toolCalls: true,
        resumableSessions: false,
        reasoningSideChannel: 'none',
        browserAppControl: false,
        recommendedConcurrency: 4,
        localServer: false,
      }
    case 'openai-api':
      return {
        streaming: true,
        toolCalls: true,
        resumableSessions: false,
        reasoningSideChannel: 'compatible',
        browserAppControl: false,
        recommendedConcurrency: 4,
        localServer: false,
      }
    case 'llama-cpp':
      return {
        streaming: true,
        toolCalls: true,
        resumableSessions: false,
        reasoningSideChannel: 'compatible',
        browserAppControl: false,
        recommendedConcurrency: 1,
        localServer: true,
      }
    default:
      return null
  }
}
