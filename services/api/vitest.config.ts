import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**'],
    // Con ~11 workers por defecto el arranque (imports pesados de AWS SDK/Prisma) se
    // satura y vitest tira "Timeout waiting for worker"; 4 es estable.
    maxWorkers: 4,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
