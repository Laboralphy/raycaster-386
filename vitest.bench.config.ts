import { defineConfig } from 'vitest/config';

/**
 * Benchmarks are kept out of `npm test`: they are slow and their results are
 * informational rather than pass/fail. Run with `npm run bench`.
 */
export default defineConfig({
    test: {
        include: ['tests/bench/**/*.bench.ts'],
        environment: 'node',
        testTimeout: 600_000
    }
});
