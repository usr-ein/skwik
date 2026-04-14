import tseslint from "typescript-eslint"
import pluginVue from "eslint-plugin-vue"
import vueParser from "vue-eslint-parser"
import prettierConfig from "eslint-config-prettier"
import type { Linter } from "eslint"

export default tseslint.config(
    { ignores: ["dist/**", "*.config.ts"] },

    // TypeScript strict type-checked rules for .ts and .vue files
    {
        files: ["**/*.{ts,vue}"],
        extends: [...tseslint.configs.strictTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_" },
            ],
        },
    },

    // Vue strongly recommended
    ...(pluginVue.configs["flat/strongly-recommended"] as Linter.Config[]),

    // Vue parser + additional strict rules
    {
        files: ["**/*.vue"],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                ecmaVersion: "latest",
                sourceType: "module",
                extraFileExtensions: [".vue"],
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "vue/block-order": [
                "error",
                { order: ["script", "template", "style"] },
            ],
            "vue/component-api-style": ["error", ["script-setup"]],
            "vue/define-macros-order": [
                "error",
                {
                    order: [
                        "defineProps",
                        "defineEmits",
                        "defineSlots",
                    ],
                },
            ],
            "vue/no-empty-component-block": "error",
            "vue/no-ref-object-reactivity-loss": "error",
            "vue/no-unused-refs": "error",
            "vue/no-useless-mustaches": "error",
            "vue/no-useless-v-bind": "error",
            "vue/prefer-separate-static-class": "error",
            "vue/prefer-true-attribute-shorthand": "error",
        },
    },

    // Relax rules for generated shadcn-vue UI components
    {
        files: ["src/components/ui/**/*.{ts,vue}"],
        rules: {
            "vue/multi-word-component-names": "off",
            "vue/require-default-prop": "off",
            "vue/define-macros-order": "off",
            "vue/no-template-shadow": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
        },
    },

    prettierConfig as Linter.Config,
)
