import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// oxlint (.oxlintrc.json) covers everything else in the repo. This config is scoped to
// eslint-plugin-react-hooks' React Compiler rule set (set-state-in-effect, immutability,
// purity, etc.), which has no oxlint equivalent yet — see the disable comments across
// packages/client/src/features/sim for the rules this actually catches.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**', '**/*.d.ts'],
  },

  {
    files: ['packages/client/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
);
