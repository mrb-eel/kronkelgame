// Minimal lint config: catches undefined names, unused variables and other easy-to-miss bugs.
export default [
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'tools/**/*.mjs', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', localStorage: 'readonly',
        performance: 'readonly', fetch: 'readonly', Image: 'readonly', URLSearchParams: 'readonly', console: 'readonly',
        getComputedStyle: 'readonly', structuredClone: 'readonly', self: 'readonly', caches: 'readonly', URL: 'readonly',
        process: 'readonly', setTimeout: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
    },
  },
];
