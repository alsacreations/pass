/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 * Mise à jour : 2025-11-12
 */
export default {
  arrowParens: "always",
  bracketSpacing: true,
  bracketSameLine: true,
  editorconfig: true,
  jsxSingleQuote: true,
  printWidth: 80,
  quoteProps: "as-needed",
  semi: false,
  singleAttributePerLine: true,
  tabWidth: 2,
  trailingComma: "all",
  useTabs: false,
  overrides: [
    {
      files: ["*.css", "*.scss"],
      options: {
        singleQuote: false,
      },
    },
  ],
};
