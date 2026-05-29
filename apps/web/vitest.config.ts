import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    server: {
      deps: {
        // Force Vite to inline tsx/jsx files through the full transform pipeline
        // instead of using rolldown SSR transform (which doesn't support JSX)
        inline: [/components\//, /app\//],
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
