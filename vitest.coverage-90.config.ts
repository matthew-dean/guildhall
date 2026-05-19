import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from './vitest.config.js'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 90,
        },
      },
    },
  }),
)
