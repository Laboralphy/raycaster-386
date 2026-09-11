import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        // Announces what this run is not testing. See the file for why a
        // silent skip is not good enough here.
        globalSetup: ['tests/harness/announce.ts']
    }
});
