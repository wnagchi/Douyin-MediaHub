import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: [],
    include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['web/src/**/*.ts', 'web/src/**/*.tsx'],
      exclude: [
        'web/src/**/*.test.ts',
        'web/src/**/*.test.tsx',
        'web/src/**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './web/src'),
    },
  },
});
