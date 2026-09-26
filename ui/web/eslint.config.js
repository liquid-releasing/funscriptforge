// ESLint, added 2026-09-26 for one reason: an undefined identifier must not be
// able to reach a white screen.
//
// ★ The bug this exists to prevent.
//
// `fdaafc6` shipped App.jsx using `useMemo` without importing it. Nothing
// caught it:
//
//   * `vite build` passed  -- an undefined identifier is a RUNTIME
//                             ReferenceError, not a compile error;
//   * `vitest run` passed  -- the suite never renders App;
//   * there was no linter at all.
//
// The app booted to a white screen with `useMemo is not defined`. A stopgap
// test (`src/lib/hookImports.test.js`) covered React hooks specifically; this
// covers the whole class, everywhere.
//
// Measured before choosing the rule set:
//
//   const b = useMemo(...)            -> caught by core `no-undef`
//   return <Missing value={b} />      -> MISSED by core; a JSX element name is
//                                        not a scope reference, so it needs
//                                        `react/jsx-no-undef`
//
// Both are white-screen bugs, so both rules are on. Wanting the React plugin
// is what pins eslint to 9.x -- eslint-plugin-react@7.37.5 declares
// `eslint: ^3 || ... || ^9.7` and npm refuses 10. Revisit when the plugin
// ships eslint 10 support.
//
// Deliberately NOT a style config. Nothing here is about formatting or taste,
// only about code that cannot run. Style rules would mean a large diff and a
// standing argument, and would bury the errors that matter in warnings.

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist/**',
      'src-tauri/target/**',
      // Vendored/generated, and not ours to lint. `src-tauri/resources` is
      // the PyInstaller bundle -- it ships plotly.min.js and matplotlib's web
      // backend, which alone accounted for 2346 of the first run's 2413
      // problems and would have drowned out every real one.
      'src-tauri/resources/**',
      'node_modules/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Vite exposes these in config and node-side scripts.
        ...globals.node,
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,

      // The two rules this config is for.
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      // Without this, a component imported and used only in JSX reads as
      // unused -- JSX names are invisible to the base rule.
      'react/jsx-uses-vars': 'error',

      // Real, but not a reason to fail a build: an unused local is dead code,
      // not a crash. Leading-underscore names are the convention here for
      // "deliberately ignored".
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // `catch {}` with a comment explaining why is used on purpose around
      // localStorage and other environment probes.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // A hook called conditionally corrupts React's hook order and throws at
      // runtime -- same white-screen class as an undefined identifier, so it
      // is an error.
      'react-hooks/rules-of-hooks': 'error',
      // A warning on purpose. The codebase already carries 28
      // `eslint-disable-next-line react-hooks/exhaustive-deps` comments from
      // whenever a config last existed, so the rule has to be REGISTERED --
      // an unknown rule name in a disable directive is itself an error. But a
      // missing dependency is usually a considered choice here (effects that
      // must run once on a project change), and 28 build failures is not the
      // deal this config is making.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Vitest's globals are injected, not imported.
    files: ['**/*.test.{js,jsx}', '**/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', test: 'readonly',
        expect: 'readonly', vi: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
  },
];
