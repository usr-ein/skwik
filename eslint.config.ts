import pluginVue from "eslint-plugin-vue";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import prettierConfig from "eslint-config-prettier";
import type { Linter } from "eslint";

const config: Linter.Config[] = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin as Record<string, unknown>,
    },
    rules: {
      ...tsPlugin.configs?.["recommended"]?.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
    },
    plugins: {
      vue: pluginVue as unknown as Record<string, unknown>,
      "@typescript-eslint": tsPlugin as Record<string, unknown>,
    },
    rules: {
      ...pluginVue.configs?.["flat/recommended"]?.reduce(
        (acc: Record<string, unknown>, cfg: Linter.Config) => ({
          ...acc,
          ...cfg.rules,
        }),
        {},
      ),
      "vue/multi-word-component-names": "off",
    },
  },
  prettierConfig as Linter.Config,
];

export default config;
