/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    // Coverage instrumentation on a loaded CI machine is slow; do not fail on timing alone.
    testTimeout: 20_000,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/api/generated/**',
        'src/test/**',
        'src/main.tsx',
        'src/**/*.test.*',
        'src/vite-env.d.ts',
      ],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
