// Flat config (ESLint 9+). The `lint` script in package.json referenced
// this file's default name for a long time before this file existed —
// `npx eslint` was silently falling back to whatever version npx happened
// to fetch, with no project rules applied at all.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
    rules: {
      // Nest constructor-injection params and decorated-but-unread fields
      // are common and not a bug — only flag genuinely unused locals/args.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  prettier,
);
