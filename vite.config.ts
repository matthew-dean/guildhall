import { sveltekit } from '@sveltejs/kit/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      '@guildhall/shared': resolve('src/shared/index.ts'),
      '@guildhall/levers/profiles': resolve('src/levers/profiles.ts'),
    },
  },
  build: {
    sourcemap: true,
  },
})
