import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A browser-like DOM by default; server-rendering tests opt out per file
    // with `@vitest-environment node`, where there is no window at all.
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
