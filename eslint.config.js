import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**'] },
    ...tseslint.configs.recommended,
    prettier,
    {
        rules: {
            curly: 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        // Tests and hand-written ambient type shims legitimately use `any` (mocks,
        // third-party libs) and keep intentionally-unused setup bindings.
        files: ['**/__tests__/**', '**/*.test.ts', '**/*.d.ts', '**/@types/**'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
    {
        // Battle-system boundary: server production code must reach a battle system only
        // through its slice barrel (…/mud-game/battle-systems/<id>), never a deep internal
        // file, so each rules engine stays swappable behind one seam and the two systems
        // never reach into each other. The slices themselves are exempt (they import their
        // own files relatively) and so are tests (white-box access to internals).
        // See documentation/battle-systems.md.
        files: ['packages/server/src/**/*.ts'],
        ignores: ['packages/server/src/infrastructure/services/mud-game/battle-systems/*/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/battle-systems/*/*'],
                            message:
                                'Import a battle system through its slice barrel (…/mud-game/battle-systems/<id>), not a deep file — see documentation/battle-systems.md.',
                        },
                    ],
                },
            ],
        },
    }
);
