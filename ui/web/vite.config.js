import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const host = process.env.TAURI_DEV_HOST;

// Resolve forgemoment to its source rather than its built dist/. Bypassing
// the exports map gives full HMR across both repos — edits in
// ../../../forgemoment/src/*.jsx propagate without `npm run build` +
// `npm install`. forgemoment stays a library (its dist/ is still the
// shipping artifact); this alias just keeps the dev loop tight while
// funscriptforge is its first consumer.
//
// Array form + regex `find:` because Vite's string aliases are prefix
// matches — a bare `forgemoment` alias rewrites `forgemoment/styles` to
// `<src>/index.js/styles`. Anchored regexes give us exact-match per subpath
// so both `import 'forgemoment'` and `import 'forgemoment/styles'` resolve
// correctly. Add a new entry here whenever forgemoment exports a new subpath.
const forgemomentRoot = new URL('../../../forgemoment/', import.meta.url);

export default defineConfig({
  plugins: [react({
    // MediaViewer's mounted fiber tree can be very large when chapter clips,
    // timelines, and mode panels are active. React Fast Refresh recursively
    // walks that tree and can overflow the stack during HMR; excluding this
    // one shared source file falls back to Vite's normal module reload.
    exclude: /[\\/]forgemoment[\\/]src[\\/]MediaViewer\.jsx$/,
  })],
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^forgemoment\/styles$/, replacement: fileURLToPath(new URL('src/tokens.css', forgemomentRoot)) },
      { find: /^forgemoment$/,         replacement: fileURLToPath(new URL('src/index.js',  forgemomentRoot)) },
    ],
  },
  // Skip the dep-optimizer for forgemoment. Without this, Vite pre-bundles
  // `node_modules/forgemoment/dist/*.js` into `node_modules/.vite/deps/` and
  // serves that — bypassing the alias and breaking cross-repo HMR. Excluding
  // forces every import to flow through resolve.alias above and stay live.
  optimizeDeps: {
    exclude: ['forgemoment'],
  },
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1431 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    fs: {
      // Vite restricts file access to the project root by default;
      // forgemoment lives outside ui/web, so we whitelist its parent.
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../../../forgemoment', import.meta.url)),
      ],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
