import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['scripts/**', 'tests/**', '*.config.*'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The engine is pure: no DOM, no map, no UI.
    files: ['src/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ui/**', '**/map/**', 'maplibre-gl'],
              message: 'The engine must stay DOM-free.',
            },
          ],
        },
      ],
    },
  },
  {
    // The observer only ever sees camera reads. It must not reach the raw GPS track
    // or the ground-truth code that works on it (see tests/observer-isolation.test.ts).
    files: [
      'src/engine/observer.ts',
      'src/engine/trips.ts',
      'src/engine/labeling.ts',
      'src/engine/schedule.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/ground-truth*',
                '**/data/**',
                '**/detection*',
                '**/worker*',
                '**/ui/**',
                '**/map/**',
              ],
              message:
                'The observer may only use Detection[] and Camera[]; it must never touch the raw track.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
