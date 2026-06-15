import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'dist/web',
      assets: 'dist/web',
      fallback: 'index.html',
      strict: false,
    }),
    files: {
      appTemplate: 'src/web-kit/app.html',
      routes: 'src/web-kit/routes',
      hooks: {
        client: 'src/web-kit/hooks.client',
        server: 'src/web-kit/hooks.server',
        universal: 'src/web-kit/hooks',
      },
      lib: 'src/web-kit/lib',
      params: 'src/web-kit/params',
      serviceWorker: 'src/web-kit/service-worker',
    },
    output: {
      bundleStrategy: 'split',
    },
  },
}

export default config
