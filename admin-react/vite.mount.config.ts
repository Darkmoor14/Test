import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'path';

const dirname = import.meta.dirname;

// Separate build for the bundle admin-3.html actually loads (as a plain
// classic <script> tag, same pattern as every other feature file there) --
// as opposed to vite.config.ts, which builds the standalone dev app
// (index.html + main.tsx). One self-contained IIFE, no code-splitting, no
// external CSS (admin-3.html already loads the real admin.css itself).
export default defineConfig({
  plugins: [react()],
  // react-dom/chart.js both branch on process.env.NODE_ENV internally
  // (extra dev-mode warnings, prop-type checks, etc.) -- app.config.ts's
  // own app build gets this for free from Vite's normal mode handling,
  // but build.lib doesn't set it automatically. Without this, `process`
  // is a bare undefined global in a real browser (no Node, no dev
  // server) and the bundle throws immediately on load.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-mount',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(dirname, 'src/mount.tsx'),
      name: 'AdminReactStatusBundle',
      formats: ['iife'],
      fileName: () => 'admin-react-status.js',
    },
    rollupOptions: {
      output: {
        // IIFE builds can't have multiple chunks -- this keeps CSS (if
        // any slips in from a future component) in one predictable file
        // instead of a hashed name.
        assetFileNames: 'admin-react-status.[ext]',
      },
    },
  },
});
