import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    restoreMocks: true,
  },
  fmt: {
    printWidth: 100,
    singleQuote: true,
    ignorePatterns: [
      '.claude/**',
      '.expo/**',
      'android/**',
      'assets/**',
      'dist/**',
      'ios/**',
      'node_modules/**',
      'package-lock.json',
      'tools/oxlint/anti-slop/**',
      'web-build/**',
    ],
  },
  lint: {
    plugins: ['eslint', 'typescript', 'react', 'import', 'oxc', 'promise', 'vitest'],
    env: {
      browser: true,
      es2024: true,
      'shared-node-browser': true,
    },
    globals: {
      __DEV__: 'readonly',
      ErrorUtils: 'readonly',
      process: 'readonly',
      requestIdleCallback: 'readonly',
      cancelIdleCallback: 'readonly',
      setImmediate: 'readonly',
      clearImmediate: 'readonly',
    },
    ignorePatterns: [
      '.agent/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      '.continue/**',
      '.cursor/**',
      '.expo/**',
      '.gemini/**',
      '.opencode/**',
      '.pi/**',
      '.roo/**',
      '.windsurf/**',
      'android/**',
      'dist/**',
      'expo-env.d.ts',
      'ios/**',
      'node_modules/**',
      'tools/oxlint/anti-slop/**',
      'web-build/**',
    ],
    jsPlugins: [
      {
        name: 'anti-slop',
        specifier: './tools/oxlint/anti-slop/index.ts',
      },
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
      perf: 'warn',
    },
    rules: {
      'eslint/eqeqeq': ['warn', 'smart'],
      'eslint/no-var': 'error',
      'eslint/no-await-in-loop': 'off',
      'react/immutability': 'off',
      'eslint/no-unused-expressions': [
        'warn',
        {
          allowShortCircuit: true,
          enforceForJSX: true,
        },
      ],
      'typescript/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'none',
          ignoreRestSiblings: true,
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'typescript/array-type': [
        'warn',
        {
          default: 'array',
        },
      ],
      'typescript/consistent-type-assertions': [
        'warn',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'allow',
        },
      ],
      'typescript/no-empty-object-type': 'warn',
      'typescript/no-wrapper-object-types': 'warn',
      'typescript/no-extra-non-null-assertion': 'warn',
      'typescript/no-useless-constructor': 'warn',
      'typescript/no-require-imports': [
        'warn',
        {
          allow: [
            '\\.(aac|aiff|avif|bmp|caf|db|gif|heic|html|jpeg|jpg|json|m4a|m4v|mov|mp3|mp4|mpeg|mpg|otf|pdf|png|psd|svg|ttf|wav|webm|webp|xml|yaml|yml|zip)$',
          ],
        },
      ],
      'import/first': 'warn',
      'import/no-unassigned-import': [
        'warn',
        {
          allow: ['**/*.css'],
        },
      ],
      'react/react-in-jsx-scope': 'off',
      'react/jsx-no-target-blank': 'off',
      'react/no-unknown-property': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'oxc/no-accumulating-spread': 'error',
      'anti-slop/no-array-filter-map': 'error',
      'anti-slop/no-reduce-accumulator-copy': 'error',
      'anti-slop/no-chained-type-assertions': 'error',
      'anti-slop/no-conditional-empty-object-spread': 'error',
      'anti-slop/no-known-value-widening': 'error',
      'anti-slop/no-module-mocking': [
        'error',
        {
          allowedModules: ['expo-secure-store', 'expo-crypto', 'expo/fetch', 'expo-haptics'],
        },
      ],
      'anti-slop/no-object-parameters': 'error',
      'anti-slop/no-reflect-apply': 'error',
      'anti-slop/no-reflect-get': 'error',
      'anti-slop/no-runtime-typeof': [
        'error',
        {
          allowInTypeGuards: true,
        },
      ],
      'anti-slop/no-shape-in-symbol-names': 'error',
      'anti-slop/no-unknown-parameters': 'error',
      'anti-slop/no-unknown-returns': 'error',
      'anti-slop/no-unknown-type-aliases': 'error',
      'anti-slop/no-unsafe-dictionary-type': 'error',
      'anti-slop/no-widen-then-assert': 'error',
      'anti-slop/require-readable-spacing': 'error',
      'anti-slop/require-safety-comment-for-type-assertion': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      {
        files: ['**/*.test.ts', '**/*.test.tsx'],
        plugins: ['vitest'],
      },
      {
        files: ['*.config.js', '*.config.ts', 'metro.config.js', 'plugins/**', 'scripts/**'],
        env: {
          node: true,
        },
        rules: {
          'typescript/no-require-imports': 'off',
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
