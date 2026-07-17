import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'shared/models/proto/models_pb.js'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {...globals.browser, ...globals.node},
      parserOptions: {
        ecmaFeatures: {jsx: true},
        sourceType: 'module',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'error',
    },
  },
]
