module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  env: { es2022: true, node: true, browser: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  ignorePatterns: ['out/', 'dist/', 'node_modules/'],
  rules: {
    // TypeScript checks names and declarations; unused legacy parameters are allowed.
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-redeclare': 'off',
    'no-dupe-class-members': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
