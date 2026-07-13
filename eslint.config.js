import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**', '**/*.d.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Deliberate unused values are marked with a leading underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // The simulation engine is the one piece of code that must stay deterministic and
  // dependency-free: it runs identically on the client and on the grading server.
  {
    files: ['packages/shared/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The engine must advance by an explicit dt, never wall-clock time.' },
        { name: 'performance', message: 'The engine must advance by an explicit dt, never wall-clock time.' },
        { name: 'window', message: 'packages/shared must not touch the DOM.' },
        { name: 'document', message: 'packages/shared must not touch the DOM.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'The engine must stay deterministic.' },
        { object: 'Date', property: 'now', message: 'The engine must advance by an explicit dt.' },
      ],
    },
  },

  {
    files: ['packages/server/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ['packages/client/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Tests, tooling scripts, and the server entrypoint (which prints a startup banner).
  {
    files: [
      '**/*.test.ts',
      '**/*.config.ts',
      '**/tests/**',
      'scripts/**',
      'packages/server/src/db/**',
      'packages/server/src/index.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
