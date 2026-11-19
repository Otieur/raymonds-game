import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * Makes the built page run when it is opened straight from disk. Browsers refuse to fetch
 * module scripts and CORS-checked stylesheets for a file:// page, so the page's own script
 * becomes a classic deferred one and its stylesheet an ordinary one.
 */
function runsFromDisk(): Plugin {
  return {
    name: 'runs-from-disk',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(/<(?:script|link)\b[^>]*\b(?:src|href)="\.\/[^>]*>/g, (tag) =>
          tag.replace(' crossorigin', '').replace(' type="module"', ' defer'),
        ),
    },
  };
}

// The web client lives in web/ and imports the engine from src/ and art from assets/.
// `vite build --mode app` builds the copy that the desktop app carries: one script, no folders,
// every address relative, so that it works from wherever the app is put.
export default defineConfig(({ mode }) => {
  const app = mode === 'app';
  return {
    root: fileURLToPath(new URL('./web', import.meta.url)),
    base: app ? './' : '/',
    plugins: [react(), ...(app ? [runsFromDisk()] : [])],
    server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
    build: app
      ? {
          outDir: '../build/site',
          emptyOutDir: true,
          assetsDir: '',
          rollupOptions: { output: { format: 'iife' as const } },
        }
      : { outDir: '../dist', emptyOutDir: true },
  };
});
