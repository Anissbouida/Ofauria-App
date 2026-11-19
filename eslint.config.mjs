// G3-04 — qualité de code en CI. Deux niveaux :
//  - ERREUR (bloque la CI) : règles qui attrapent de vrais défauts (hooks React appelés hors ordre,
//    cas déjà vécu : page blanche des seuils d'alerte ; code inatteignable ; comparaisons erronées) ;
//  - AVERTISSEMENT : style et hygiène (any, variables inutilisées…), signalés sans bloquer tant que
//    l'existant n'est pas résorbé.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/coverage/**', 'server/scripts/**', '**/*.d.ts', '.claude/**'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Hygiène : signalée, non bloquante.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-control-regex': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-prototype-builtins': 'warn',
      // Vrais défauts : bloquants.
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-compare': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
