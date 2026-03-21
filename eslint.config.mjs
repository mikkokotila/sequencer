import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // ── Global ignores ──
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'tests/**',
      'src/engine/worklets/**',
      '*.js',
      '*.mjs',
      '*.cjs',
    ],
  },

  // ── Base: all TypeScript files ──
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'eqeqeq': ['error', 'always'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-non-null-assertion': 'off', // we use these intentionally with noUncheckedIndexedAccess
      '@typescript-eslint/restrict-template-expressions': 'off', // too noisy for string interpolation
      '@typescript-eslint/no-confusing-void-expression': 'off', // conflicts with arrow functions
      '@typescript-eslint/prefer-nullish-coalescing': 'off', // sometimes || is clearer
      '@typescript-eslint/no-unnecessary-type-parameters': 'off', // false positives on generic DB functions
    },
  },

  // ── DSP / AudioWorklet files: zero-allocation rules ──
  {
    files: ['src/engine/worklets/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'TemplateLiteral', message: 'No template strings in DSP path — allocates strings' },
        { selector: 'SpreadElement', message: 'No spread in DSP path — allocates arrays' },
      ],
      'no-restricted-globals': ['error',
        { name: 'console', message: 'No console in audio thread — allocates strings' },
        { name: 'setTimeout', message: 'No setTimeout in audio thread' },
        { name: 'setInterval', message: 'No setInterval in audio thread' },
        { name: 'fetch', message: 'No fetch in audio thread' },
      ],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use seeded PRNG in DSP path' },
      ],
    },
  },

  // ── Transport layer: no floating promises ──
  {
    files: ['src/transport/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // Prettier last — disables conflicting format rules
  prettierConfig,
);
