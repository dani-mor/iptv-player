// `npm run lint`. The frontend is plain ES modules for the browser; the server, lib/
// and the tests are CommonJS for Node (the client-side tests are .mjs).

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.guide-cache/'] },
  js.configs.recommended,
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, Hls: 'readonly' } },
  },
  {
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
