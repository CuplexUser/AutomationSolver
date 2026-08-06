import { defineConfig } from 'vite';

// The landing page is its own tiny Vite app: one hand-written index.html and
// one TypeScript entry that pulls in @automationsolver/shared. Building it
// here is what lets the demo run the real engine instead of a hand-ported
// copy of it.
export default defineConfig({
  // Pages serves the site from /AutomationSolver/, so every asset URL has to
  // be base-relative rather than rooted at /.
  base: './',
  build: {
    outDir: '../_site',
    // outDir sits outside the Vite root, so this has to be explicit.
    emptyOutDir: true,
    target: 'es2020',
  },
});
