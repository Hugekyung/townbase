import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const typescriptFiles = ["apps/api/**/*.ts", "packages/**/*.ts"];

export default [
  {
    ignores: ["dist", "coverage", "node_modules", ".omo"],
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./apps/api/tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
