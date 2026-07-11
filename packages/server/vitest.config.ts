import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // node:sqlite is a newer built-in that Vite's resolver doesn't know about;
    // keep it external so it is required from Node at runtime.
    server: {
      deps: {
        external: [/node:sqlite/],
      },
    },
  },
  ssr: {
    external: ['node:sqlite'],
  },
});
