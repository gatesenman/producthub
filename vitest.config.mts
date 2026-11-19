import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { root: '.', include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'], testTimeout: 20000, coverage: { include: ['src/server/**'] } } });
