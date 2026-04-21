import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import securityPlugin from "eslint-plugin-security";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  securityPlugin.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "warn",
    },
    linterOptions: {
      // Set to false to temporarily suppress warnings about unused disable directives,
      // particularly those guarding against 'security/detect-non-literal-fs-filename' false positives.
      // These directives should be cleaned up as codebase matures.
      reportUnusedDisableDirectives: false,
    },
  },
);