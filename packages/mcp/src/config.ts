/**
 * Ported from openharness/src/openharness/mcp/config.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python's `settings.mcp_servers` attribute access becomes a plain input
 *     `settings: { mcp_servers }` so the loader doesn't depend on the full
 *     Settings object. This avoids a cross-package import from @guildhall/config
 *     for one field.
 *   - `LoadedPlugin` is ported structurally — we only need
 *     `{ enabled, manifest: { name }, mcp_servers }`. When @guildhall/plugins
 *     lands upstream-side, the structural shape matches so it can slot in.
 *   - `setdefault` semantics are preserved: plugin entries only register under
 *     `pluginName:serverName` keys and never overwrite a settings entry.
 */

import type { McpServerConfig } from './types.js'

export interface LoadedPluginForMcp {
  enabled: boolean
  manifest: { name: string }
  mcp_servers: Record<string, McpServerConfig>
}

export interface McpSettingsSlice {
  mcp_servers: Record<string, McpServerConfig>
}

export function loadMcpServerConfigs(
  settings: McpSettingsSlice,
  plugins: readonly LoadedPluginForMcp[],
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = { ...settings.mcp_servers }
  for (const plugin of plugins) {
    if (!plugin.enabled) continue
    for (const [name, config] of Object.entries(plugin.mcp_servers)) {
      const key = `${plugin.manifest.name}:${name}`
      if (!(key in servers)) {
        servers[key] = config
      }
    }
  }
  return servers
}
