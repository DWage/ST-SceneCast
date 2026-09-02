import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        setupFiles: ['./test/setup.js'],
        globals: false,
        restoreMocks: true,
        testTimeout: 10000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.js'],
            exclude: ['src/ui.js'],
        },
    },
});
