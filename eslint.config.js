import tsParser from '@typescript-eslint/parser';

/* Flat config, ESLint 9. The rules reflect this codebase's conventions rather
 * than a generic preset. max-len is a warning at 140 because the view builders
 * are string concatenation and a hard wrap would hurt them; no-duplicate-imports
 * is an error because it caught two real duplicates in main.js.
 */
export default [
  {
    ignores: ['node_modules/**', 'app/vendor/**', 'supabase/functions/**/dist/**',
              'supabase/functions/**/DASHBOARD-PASTE-index.ts'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
        fetch: 'readonly', crypto: 'readonly', console: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', alert: 'readonly',
        Blob: 'readonly', File: 'readonly', FileReader: 'readonly', URL: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', Response: 'readonly',
        Request: 'readonly', Headers: 'readonly', AbortController: 'readonly',
        atob: 'readonly', btoa: 'readonly', structuredClone: 'readonly',
        requestAnimationFrame: 'readonly', getComputedStyle: 'readonly',
        MutationObserver: 'readonly', IntersectionObserver: 'readonly', Image: 'readonly',
        process: 'readonly', globalThis: 'readonly', Deno: 'readonly',
        DecompressionStream: 'readonly', CompressionStream: 'readonly',
        Buffer: 'readonly', FormData: 'readonly', URLSearchParams: 'readonly',
        confirm: 'readonly', CSS: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      'no-duplicate-imports': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'max-len': ['warn', { code: 140, ignoreUrls: true, ignoreStrings: true,
                            ignoreTemplateLiterals: true, ignoreRegExpLiterals: true }],
    },
  },
  {
    /* The edge functions are TypeScript and were unlinted: 1,258 lines with no
       static analysis at all, in the two places that hold a service role. They
       need a parser that understands annotations; the rules are the same. */
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { Deno: 'readonly', crypto: 'readonly', console: 'readonly', fetch: 'readonly',
                 Response: 'readonly', Request: 'readonly', Headers: 'readonly', URL: 'readonly',
                 TextEncoder: 'readonly', TextDecoder: 'readonly', atob: 'readonly', btoa: 'readonly',
                 setTimeout: 'readonly', clearTimeout: 'readonly', AbortController: 'readonly',
                 AbortSignal: 'readonly', FormData: 'readonly', Blob: 'readonly', File: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      'no-duplicate-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
